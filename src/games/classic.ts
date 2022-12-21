import canvas, { Image } from 'canvas';
import { GuildMember, Snowflake } from "discord.js";
import { getRankString, naturalJoin, randChoice, randInt } from 'evanw555.js';
import { ClassicGameState, DecisionProcessingResult, Medals, PrizeType } from "../types";
import { getNormalizedEditDistance, getOrderingUpsets } from '../util';
import AbstractGame from "./abstract-game";

export default class ClassicGame extends AbstractGame<ClassicGameState> {

    constructor(state: ClassicGameState) {
        super(state);
    }

    static create(members: GuildMember[]): ClassicGame {
        const names: Record<Snowflake, string> = {};
        const points: Record<Snowflake, number> = {};
        for (const member of members) {
            names[member.id] = member.displayName;
            points[member.id] = 0;
        }
        return new ClassicGame({
            type: 'CLASSIC_GAME_STATE',
            decisions: {},
            turn: 0,
            goal: 100,
            names,
            points,
            pointDiffs: {},
            winners: [],
            revealedActions: {}
        });
    }

    getIntroductionText(): string {
        return 'I know you all must be exhausted, so this season will just be classic GMBR! Say Good Morning and get points, have fun!'
    }

    getInstructionsText(): string {
        return 'You can choose one of three actions: **cheer**, **take**, or **peek**! DM me to secretly pick an action, or **cheer** by default.\n'
            + '🌞 **cheer** to spread a little Good Morning cheer! (free point to yourself and a random player below you)\n'
            + '‼️ **take** to take **2-6** points from GMBR\'s infinite golden coffer.\n'
            + '👀 **peek** to stop a player from taking. If you stop a player, you steal **2-6** points from them! (e.g. `peek Robert`)';
    }

    getHelpText(): string {
        return this.getInstructionsText();
    }

    getDebugText(): string {
        return 'Classic Game';
    }

    getSeasonCompletion(): number {
        return Math.max(...Object.values(this.state.points)) / this.state.goal;
    }

    getPlayers(): string[] {
        return Object.keys(this.state.points);
    }

    getOrderedPlayers(): string[] {
        return this.getPlayers().sort((x, y) => this.getPoints(y) - this.getPoints(x));
    }

    hasPlayer(userId: string): boolean {
        return userId in this.state.points;
    }

    addPlayer(member: GuildMember): string {
        this.addPoints(member.id, 0);
        this.state.names[member.id] = member.displayName;
        return `Added ${member.displayName}`;
    }

    updatePlayer(member: GuildMember): void {
        this.state.names[member.id] = member.displayName;
    }

    removePlayer(userId: Snowflake): void {
        delete this.state.decisions[userId];
        delete this.state.points[userId];
        delete this.state.pointDiffs[userId];
        delete this.state.names[userId];
        delete this.state.revealedActions[userId];
    }

    doesPlayerNeedHandicap(userId: Snowflake): boolean {
        // Player needs handicap if below 25% of the top player's points
        return this.getPoints(userId) < (this.getMaxPoints() * 0.25);
    }

    async renderState(options?: { showPlayerDecision?: string; admin?: boolean, season?: number }): Promise<Buffer> {
        return await this.createMidSeasonUpdateImage({}, options?.season);
    }

    beginTurn(): void {
        this.state.turn++;

        this.state.pointDiffs = {};
        this.state.revealedActions = {};

        // Add default decisions
        for (const userId of this.getPlayers()) {
            this.state.decisions[userId] = ['cheer'];

            // if (chance(0.1)) {
            //     this.state.decisions[userId] = ['cheer'];
            // } else if (chance(0.5)) {
            //     this.state.decisions[userId] = ['take'];
            // } else {
            //     const targetId = randChoice(...this.getPlayers());
            //     this.state.decisions[userId] = ['peek:' + targetId];
            // }
        }
    }

    getPoints(userId: string): number {
        return this.state.points[userId] ?? 0;
    }

    addPoints(userId: string, points: number): void {
        if (isNaN(points)) {
            throw new Error('Cannot award NaN points!');
        }
        this.state.points[userId] = (this.state.points[userId] ?? 0) + points;
        this.state.pointDiffs[userId] = (this.state.pointDiffs[userId] ?? 0) + points;
    }
    
    awardPrize(userId: string, type: PrizeType, intro: string): string[] {
        // An empty return value won't trigger a DM response
        return [];
    }

    getWeeklyDecisionDMs(): Record<Snowflake, string> {
        return {};
    }

    addPlayerDecision(userId: string, text: string): string {
        const sanitizedDecision = text.toLowerCase().trim();
        if (sanitizedDecision === 'cheer') {
            this.state.decisions[userId] = ['cheer'];
            return 'Good choice! You will spread Good Morning **cheer** to your dear dogs';
        } else if (sanitizedDecision === 'take') {
            this.state.decisions[userId] = ['take'];
            return 'Oooooh risky choice! You will **take**, let\'s see if it pays off...';
        } else if (sanitizedDecision.startsWith('peek')) {
            const targetName  = sanitizedDecision.replace(/^peek\s*/, '');
            console.log('peek at ' + targetName);
            if (targetName) {
                const targetId = this.getClosestUserByName(targetName);
                if (targetId) {
                    this.state.decisions[userId] = [`peek:${targetId}`];
                    return `Ok, you will **peek** at **${this.state.names[targetId]}** this turn...`;
                } else {
                    throw new Error('I have no idea who you\'re trying to peek at, could you please be more specific?');
                }
            } else {
                throw new Error('You are you trying to peek at? For example, \`peek Robert\`');
            }
        }
        throw new Error('I don\'t recognize that action!');
    }

    processPlayerDecisions(): DecisionProcessingResult {
        const beforeOrdering = this.getOrderedPlayers();

        let summary = '';

        const anyCheerDecisions = Object.values(this.state.decisions).some(d => d.includes('cheer'));
        const takers = Object.keys(this.state.decisions).filter(userId => this.state.decisions[userId].includes('take'));
        const peekersByTarget = {};
        for (const userId of Object.keys(this.state.decisions)) {
            const decision = this.state.decisions[userId];
            if (decision && decision[0] && decision[0].startsWith('peek:')) {
                const targetUserId = decision[0].replace(/^peek:/, '');
                if (!peekersByTarget[targetUserId]) {
                    peekersByTarget[targetUserId] = [];
                }
                peekersByTarget[targetUserId].push(userId);
            }
        }
        if (anyCheerDecisions) {
            summary += randChoice('Nice', 'Splendid', 'Fantastic', 'Serendipitous', 'Wonderful') + '! ';
            // Process the cheers
            const cheerers = Object.keys(this.state.decisions).filter(userId => this.state.decisions[userId].includes('cheer'));
            const recipientsByCheerer = {};
            for (const userId of cheerers) {
                recipientsByCheerer[userId] = this.getPlayersBehindPlayer(userId);
            }

            for (const userId of cheerers) {
                this.state.revealedActions[userId] = 'cheer';
                // Award points
                this.addPoints(userId, 1);
                const recipients = recipientsByCheerer[userId];
                if (recipients.length > 0) {
                    this.addPoints(randChoice(...recipients), 1);
                }
                // Remove decision for this player
                delete this.state.decisions[userId];
            }
            summary += `**${cheerers.length}** players spread some Good Morning cheer! `;
        } else if (takers.length > 0) {
            const taker = randChoice(...takers);
            const amount = randInt(2, 7, 2);
            if (taker in peekersByTarget) {
                const peekers = peekersByTarget[taker];
                this.addPoints(taker, -amount * peekers.length);
                this.state.revealedActions[taker] = 'take-fail';
                for (const peeker of peekers) {
                    this.addPoints(peeker, amount);
                    this.state.revealedActions[peeker] = 'peek';
                }
                if (peekers.length === 1) {
                    summary += `**${this.getName(taker)}** tried to steal from GMBR, but was stopped by **${this.getName(peekers[0])}** who looted **${amount}** points from the bastard's pile`;
                } else {
                    summary += `**${this.getName(taker)}** tried to steal from GMBR, but was stopped by ${naturalJoin(peekers.map(u => `**${this.getName(u)}**`), { conjunction: '&' })}! They each plundered **${amount}** points from **${this.getName(taker)}**`;
                }
            } else {
                this.addPoints(taker, amount);
                this.state.revealedActions[taker] = 'take';
                summary += `**${this.getName(taker)}** took **${amount}** points from GMBR! `;
            }
            // Delete the decisions
            delete this.state.decisions[taker];
        }

        const afterOrdering = this.getOrderedPlayers();
        const upsets = getOrderingUpsets(beforeOrdering, afterOrdering);

        const upsetStrings: string[] = [];
        for (const upsetter of Object.keys(upsets)) {
            const upsettees = upsets[upsetter];
            upsetStrings.push(`**${this.getName(upsetter)}** has overtaken ${naturalJoin(upsettees.map(u => `**${this.getName(u)}**`), { conjunction: '&' })}`);
        }
        const upsetString = naturalJoin(upsetStrings);
        if (upsetString) {
            // summary += ' ' + upsetString;
        }


        for (const userId of this.getOrderedPlayers()) {
            // If this user's points exceed the goal, then add them as a winner
            if (this.getPoints(userId) >= this.state.goal) {
                const added = this.addWinner(userId);
                if (added) {
                    summary += `**${this.getName(userId)}** finished for _${getRankString(this.state.winners.length)} place_! `;
                }
            }
        }

        // End the turn if the only thing remaining are unfulfilled peek actions
        const endTurn = Object.values(this.state.decisions).every(d => d[0] && d[0].startsWith('peek:'));

        return {
            summary,
            continueProcessing: !endTurn
        };
    }

    private getPointDiff(userId: Snowflake): number {
        return this.state.pointDiffs[userId] ?? 0;
    }

    private getClosestUserByName(input: string): Snowflake | undefined {
        let minNormalizedDistance = Number.MAX_SAFE_INTEGER;
        let closestId: Snowflake | undefined = undefined;
        const sanitizedInput = input.toLowerCase().trim();
        for (const userId of this.getPlayers()) {
            if (userId in this.state.names) {
                const sanitizedName = this.state.names[userId].toLowerCase().trim();
                const normalizedDistance = getNormalizedEditDistance(sanitizedInput, sanitizedName);
                if (normalizedDistance < minNormalizedDistance) {
                    minNormalizedDistance = normalizedDistance;
                    closestId = userId;
                }
            }
        }
        return closestId;
    }

    private getName(userId: Snowflake): string {
        return this.state.names[userId] ?? userId;
    }

    private async createHomeStretchImage(medals: Record<Snowflake, Medals>, season?: number): Promise<Buffer> {
        return await this.createImage(medals, {
            title: 'We\'re almost there!\n  The final days are upon us',
            sunImageName: 'sun_spooky.png',
            showMultiplier: true
        });
    }

    private async createMidSeasonUpdateImage(medals: Record<Snowflake, Medals>, season?: number): Promise<Buffer> {
        return await this.createImage(medals, {
            // title: `We're ${getNumberOfDaysSince(state.getSeasonStartedOn())} days into season ${state.getSeasonNumber()}\n  What a blessed experience!`
            title: `It's week ${this.state.turn} of season ${season ?? '???'}\n  What a blessed experience!`
        });
    }

    private async createSeasonResultsImage(medals: Record<Snowflake, Medals>, season?: number): Promise<Buffer> {
        return await this.createImage(medals);
    }

    // TODO: This logic is horrible, please clean it up
    private async createImage(medals: Record<Snowflake, Medals>, options?: { title?: string, sunImageName?: string, showMultiplier?: boolean }): Promise<Buffer> {
        const HEADER_HEIGHT = 150;
        const BAR_WIDTH = 735;
        const BAR_HEIGHT = 36;
        const BAR_PADDING = 3;
        const INNER_BAR_WIDTH = BAR_WIDTH - (BAR_PADDING * 2);
        const BAR_SPACING = BAR_PADDING * 1.5;
        // TODO (2.0): This isn't really relevant anymore because there's no longer a season goal
        const SEASON_GOAL = 100;
        const PIXELS_PER_POINT = INNER_BAR_WIDTH / SEASON_GOAL;
        const LOWEST_SCORE = Math.min(...Object.values(this.state.points));
        const MARGIN = Math.max(BAR_HEIGHT / 2, BAR_PADDING + PIXELS_PER_POINT * Math.abs(Math.min(LOWEST_SCORE, 0)));
        const WIDTH = BAR_WIDTH + 2 * MARGIN;
        const HEIGHT = HEADER_HEIGHT + Object.keys(this.state.points).length * (BAR_HEIGHT + BAR_SPACING) + MARGIN - BAR_SPACING;
        const c = canvas.createCanvas(WIDTH, HEIGHT);
        const context = c.getContext('2d');

        // Fill the blue sky background
        context.fillStyle = 'rgba(100,157,250,1)';
        context.fillRect(0, 0, WIDTH, HEIGHT);

        // Fetch all user display names
        const orderedUserIds: string[] = this.getOrderedPlayers();

        // Load medal images
        const sunIconImage = await this.loadImage('assets/sunicon.png');
        const greenDollarIcon = await this.loadImage('assets/dollargreen.png');
        const redDollarIcon = await this.loadImage('assets/dollarred.png');
        const eyeImage = await this.loadImage('assets/eye.png');
        const rank1Image = await this.loadImage('assets/rank1.png');
        const rank2Image = await this.loadImage('assets/rank2.png');
        const rank3Image = await this.loadImage('assets/rank3.png');
        const rankLastImage = await this.loadImage('assets/ranklast.png');

        // Draw the smiling sun graphic
        let sunImage: Image;
        try {
            sunImage = await this.loadImage(`assets/${options?.sunImageName ?? 'sun3.png'}`);
        } catch (err) {
            sunImage = await this.loadImage(`assets/sun3.png`);
        }
        const sunHeight = HEADER_HEIGHT + BAR_HEIGHT;
        const sunWidth = sunHeight * sunImage.width / sunImage.height;
        context.drawImage(sunImage, 0, 0, sunWidth, sunHeight);

        // Write the header text
        context.fillStyle = 'rgb(221,231,239)';
        const TITLE_FONT_SIZE = Math.floor(HEADER_HEIGHT / 4);
        context.font = `${TITLE_FONT_SIZE}px sans-serif`;
        if (options?.title) {
            context.fillText(options.title, sunWidth * .85, HEADER_HEIGHT * 7 / 16);
        } else {
            const winnerName: string = this.state.names[orderedUserIds[0]] ?? `Player ${orderedUserIds[0]}`;
            // `Celebrating the end of season ${state.getSeasonNumber()}\n   ${state.getSeasonStartedOn()} - ${getTodayDateString()}\n      Congrats, ${winnerName}!`
            context.fillText(`Celebrating the end of the season\n   Congrats, ${winnerName}!`,
                sunWidth * .7,
                HEADER_HEIGHT * 5 / 16);
        }

        let textInsideBar = true;
        for (let i = 0; i < orderedUserIds.length; i++) {
            const userId: Snowflake = orderedUserIds[i];
            // const displayName = options?.showMultiplier ? state.getPlayerDisplayNameWithMultiplier(userId) : state.getPlayerDisplayName(userId);
            const displayName = this.state.names[userId] ?? `Player ${userId}`;
            const baseY = HEADER_HEIGHT + i * (BAR_HEIGHT + BAR_SPACING);

            // Determine the bar's actual rendered width (may be negative, but clip to prevent it from being too large)
            const actualBarWidth = Math.min(this.getPoints(userId), SEASON_GOAL) * PIXELS_PER_POINT;

            // Draw the bar container
            context.fillStyle = 'rgb(221,231,239)';
            context.fillRect(MARGIN, baseY, BAR_WIDTH, BAR_HEIGHT);

            // Draw the actual bar using a hue corresponding to the user's rank
            const hue = 256 * (orderedUserIds.length - i) / orderedUserIds.length;
            context.fillStyle = `hsl(${hue},50%,50%)`;
            context.fillRect(MARGIN + BAR_PADDING,
                baseY + BAR_PADDING,
                actualBarWidth,
                BAR_HEIGHT - (BAR_PADDING * 2));

            const textHeight = BAR_HEIGHT - 4 * BAR_PADDING;
            // Must set the font before measuring the width
            context.font = `${textHeight}px sans-serif`;
            const textWidth = context.measureText(displayName).width;

            // If the text for this user no longer fits in the bar, place the text after the bar for all remaining entries
            if (textInsideBar) {
                textInsideBar = textWidth * 1.2 < actualBarWidth;
            }

            // Write the user's display name (with a "shadow")
            const textX = MARGIN + BAR_PADDING * 2 + (textInsideBar ? 0 : Math.max(actualBarWidth, 0));
            context.fillStyle = `rgba(0,0,0,.4)`;
            context.fillText(displayName, textX, baseY + 0.7 * BAR_HEIGHT);
            context.fillStyle = textInsideBar ? 'white' : 'BLACKISH';
            context.fillText(displayName, textX + 1, baseY + 0.7 * BAR_HEIGHT + 1);

            // Draw the number of points to the right of the name
            let pointText = `${this.getPoints(userId)}`;
            const pointDiff = this.getPointDiff(userId);
            if (pointDiff > 0) {
                pointText += ` (+${pointDiff})`;
            } else if (pointDiff < 0) {
                pointText += ` (${pointDiff})`;
            }
            context.font = `${textHeight * .6}px sans-serif`;
            context.fillText(pointText, textX + textWidth + (1.5 * BAR_PADDING), baseY + 0.7 * BAR_HEIGHT);

            // Draw medals for this user
            if (medals && medals[userId]) {
                const numMedals = Object.values(medals[userId]).reduce((x, y) => x + y);

                const imageWidth = BAR_HEIGHT - 2 * BAR_PADDING - 2;
                const IMAGE_WIDTH = imageWidth + BAR_PADDING;
                let j = 0;
                const baseMedalX = WIDTH - MARGIN - BAR_PADDING - (numMedals * IMAGE_WIDTH);

                const numGolds = medals[userId].gold ?? 0;
                for (let k = 0; k < numGolds; k++) {
                    context.drawImage(rank1Image, baseMedalX + j * IMAGE_WIDTH, baseY + BAR_PADDING, imageWidth, imageWidth);
                    j++;
                }
                const numSilvers = medals[userId].silver ?? 0;
                for (let k = 0; k < numSilvers; k++) {
                    context.drawImage(rank2Image, baseMedalX + j * IMAGE_WIDTH, baseY + BAR_PADDING, imageWidth, imageWidth);
                    j++;
                }
                const numBronzes = medals[userId].bronze ?? 0;
                for (let k = 0; k < numBronzes; k++) {
                    context.drawImage(rank3Image, baseMedalX + j * IMAGE_WIDTH, baseY + BAR_PADDING, imageWidth, imageWidth);
                    j++;
                }
                const numSkulls = medals[userId].skull ?? 0
                for (let k = 0; k < numSkulls; k++) {
                    context.drawImage(rankLastImage, baseMedalX + j * IMAGE_WIDTH, baseY + BAR_PADDING, imageWidth, imageWidth);
                    j++;
                }
            }

            // Draw revealed actions for each user
            if (this.state.revealedActions[userId]) {
                const revealedAction = this.state.revealedActions[userId];

                const imageWidth = (BAR_HEIGHT - 2 * BAR_PADDING - 2) + BAR_PADDING;
                const baseMedalX = WIDTH - MARGIN - BAR_PADDING - imageWidth;
                if (revealedAction === 'cheer') {
                    context.drawImage(sunIconImage, baseMedalX, baseY + BAR_PADDING, imageWidth, imageWidth);
                } else if (revealedAction === 'take') {
                    context.drawImage(greenDollarIcon, baseMedalX, baseY + BAR_PADDING, imageWidth, imageWidth);
                } else if (revealedAction === 'take-fail') {
                    context.drawImage(redDollarIcon, baseMedalX, baseY + BAR_PADDING, imageWidth, imageWidth);
                } else if (revealedAction === 'peek') {
                    context.drawImage(eyeImage, baseMedalX, baseY + BAR_PADDING, imageWidth, imageWidth);
                }
            }
        }

        return c.toBuffer();
    }
}
