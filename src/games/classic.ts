import canvas, {  } from 'canvas';
import { ActionRowData, ButtonStyle, ComponentType, GuildMember, MessageActionRowComponentData, MessageFlags, Snowflake } from "discord.js";
import { DiscordTimestampFormat, getMostSimilarByNormalizedEditDistance, getRankString, getTodayDateString, naturalJoin, randChoice, getNumberOfDaysUntil, toDiscordTimestamp, toFixed, toDateString } from 'evanw555.js';
import { DecisionProcessingResult, GamePlayerAddition, Medals, MessengerPayload, PrizeType } from "../types";
import AbstractGame from "./abstract-game";
import { text } from '../util';
import { ClassicGameState } from './types';

import imageLoader from '../image-loader';

export default class ClassicGame extends AbstractGame<ClassicGameState> {
    private static NERFED_TAKE_AMOUNT = 3;

    constructor(state: ClassicGameState) {
        super(state);
    }

    static create(members: GuildMember[], season: number, halloween?: true): ClassicGame {
        const names: Record<Snowflake, string> = {};
        const points: Record<Snowflake, number> = {};
        for (const member of members) {
            names[member.id] = member.displayName;
            points[member.id] = 0;
        }
        // Determine the end date
        const endDate = new Date();
        if (halloween) {
            // TODO: This is hardcoded
            endDate.setDate(28); // 28
            endDate.setMonth(9); // October
            // Advance the year if the target date is in the past
            if (new Date().getTime() > endDate.getTime()) {
                endDate.setFullYear(endDate.getFullYear() + 1);
            }
        } else {
            // TODO: Using a year as the end date for a standard season
            endDate.setDate(endDate.getDate() + 365);
        }
        return new ClassicGame({
            type: 'CLASSIC',
            season,
            winners: [],
            decisions: {},
            turn: 0,
            halloween: halloween || undefined,
            goal: 100,
            endDate: toDateString(endDate),
            names,
            points,
            actionPointDiffs: {},
            revealedActions: {}
        });
    }

    getIntroductionText(): string[] {
        if (this.isHalloween()) {
            return [
                'Halloween is approaching, my dear dogs... Enjoy this classic GMBR season, but with a graveyard twist!',
                `This season will end on ${toDiscordTimestamp(new Date(this.state.endDate), DiscordTimestampFormat.LongDate)}, whoever has the most points by then wins!`
            ];
        }
        return ['I know you all must be exhausted, so this season will just be classic GMBR! Say Good Morning and get points, have fun!'];
    }

    getInstructionsText(): string {
        // If today is the end date, send a message not prompting any action
        if (this.isTodayEndDate()) {
            return 'This season ends today at noon, good luck!';
        }
        if (this.isHalloween()) {
            return 'Each week, you can choose one of three actions: **creep**, **spook**, or **hide**! Pick an action, or **creep** by default.\n'
                + '🐈‍⬛ **creep** to spread a little Halloween cheer! (free point to yourself and a random player below you)\n'
                + '👻 **spook** to steal **4** points from a player above you (e.g. `spook Dezryth`)\n'
                + '🙈 **hide** to close your eyes and avoid being spooked';
        }
        return 'Each week, you can choose one of three actions: **cheer**, **take**, or **peek**! Pick an action, or **cheer** by default.\n'
            + '🌞 **cheer** to spread a little Good Morning cheer! (free point to yourself and a random player below you)\n'
            + '‼️ **take** to take **3-5** points from GMBR\'s infinite golden coffer.\n'
            + '👀 **peek** to stop a player from taking. If you stop a player, you steal **3-5** points from them! (e.g. `peek Robert`)';
    }

    override getReminderText(): string {
        // If today is the end date, send a message not prompting any action
        if (this.isTodayEndDate()) {
            return 'The end is almost here...';
        }
        // Else, just the default message
        return super.getReminderText();
    }

    getHelpText(): string {
        return this.getInstructionsText();
    }

    getDebugText(): string {
        return this.getDebugString();
    }

    getDebugString(): string {
        return 'Classic game' + (this.isHalloween() ? ' (Halloween)' : '');
    }

    getSeasonCompletion(): number {
        // Completion is defined as the minimum of the top 3 players' completion.
        // This way, completion reaches 100% only once the top 3 players have finished.
        const podiumUsers = this.getOrderedPlayers().slice(0, 3);
        if (podiumUsers.length === 0) {
            return 0;
        }
        return Math.min(...podiumUsers.map(userId => this.getPoints(userId)));
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

    override addLatePlayers(players: GamePlayerAddition[]): MessengerPayload[] {
        for (const { userId, displayName, points } of players) {
            this.addPoints(userId, points);
            this.state.names[userId] = displayName;
        }
        return this.getStandardWelcomeMessages(players.map(p => p.userId));
    }

    updatePlayer(member: GuildMember): void {
        this.state.names[member.id] = member.displayName;
    }

    removePlayer(userId: Snowflake): void {
        delete this.state.decisions[userId];
        delete this.state.points[userId];
        delete this.state.actionPointDiffs[userId];
        delete this.state.names[userId];
        delete this.state.revealedActions[userId];
    }

    override doesPlayerNeedHandicap(userId: Snowflake): boolean {
        // Player needs handicap if below 35% of the top player's points
        return this.getPoints(userId) < (this.getMaxPoints() * 0.35);
    }

    override doesPlayerNeedNerf(userId: string): boolean {
        // Player needs nerf if we're 20% into the season and player is above 90% of the top player's points
        // TODO: This is dynamic so it can have weird results depending on the ordering of points awarded in a day
        return this.getSeasonCompletion() > 0.2 && this.getPoints(userId) > (this.getMaxPoints() * 0.9);
    }

    /**
     * @returns True if the player is within 10% of the goal
     */
    private isPlayerNearGoal(userId: string): boolean {
        return this.getPoints(userId) >= (this.state.goal * 0.9);
    }

    /**
     * @returns True if today's date is the game's "end date"
     */
    private isTodayEndDate(): boolean {
        return getTodayDateString() === this.state.endDate;
    }

    async renderState(options?: { showPlayerDecision?: Snowflake, seasonOver?: boolean, admin?: boolean }): Promise<Buffer> {
        // If the season is over, send a specific renedr for that
        if (options?.seasonOver) {
            return await this.createImage({}, {
                title: this.isHalloween() ? 'Halloween is upon us!' : `Here's to season ${this.getSeasonNumber()}!`
            });
        }
        // If within 10% of the goal, show a more ominous image...
        if (this.getSeasonCompletion() > 0.9) {
            return await this.createHomeStretchImage({});
        } else {
            return await this.createMidSeasonUpdateImage({});
        }
    }

    override async beginTurn(): Promise<MessengerPayload[]> {
        this.state.turn++;

        this.state.actionPointDiffs = {};
        this.state.revealedActions = {};

        const messages: string[] = [];
        for (const userId of this.getOrderedPlayers()) {
            // Add default decision
            this.state.decisions[userId] = this.isHalloween() ? ['creep'] : ['cheer'];
            // Add random decisions in testing mode
            if (this.isTesting()) {
                const testDecisions: [string][] = [];
                if (this.isHalloween()) {
                    testDecisions.push(['creep'], ['hide']);
                } else {
                    testDecisions.push(['cheer'], ['take']);
                }
                const playersAhead = this.getPlayersAheadOfPlayer(userId);
                if (playersAhead.length > 0) {
                    if (this.isHalloween()) {
                        testDecisions.push([`spook:${randChoice(...playersAhead)}`]);
                    } else {
                        testDecisions.push([`peek:${randChoice(...playersAhead)}`]);
                    }
                }
                this.state.decisions[userId] = randChoice(...testDecisions);
            }

            // If this user's points exceed the goal, then add them as a winner
            if (this.getPoints(userId) >= this.state.goal) {
                const added = this.addWinner(userId);
                if (added) {
                    messages.push(`**${this.getName(userId)}** finished for _${getRankString(this.state.winners.length)} place_!`);
                }
            }
        }

        // If anyone won during this time, add a prefix message
        if (messages.length > 0) {
            messages.unshift('But wait! Looks like we have some new winners since last week...');
        }

        return messages;
    }

    override async endTurn(): Promise<MessengerPayload[]> {
        const result: MessengerPayload[] = [];

        // Evaluate the winners all at once at the end of the turn.
        // This is done to prevent winners from being determined by the random order of taking
        for (const userId of this.getOrderedPlayers()) {
            // If this user's points exceed the goal, then add them as a winner
            if (this.getPoints(userId) >= this.state.goal) {
                const added = this.addWinner(userId);
                if (added) {
                    result.push(`**${this.getName(userId)}** finished for _${getRankString(this.state.winners.length)} place_!`);
                }
            }
        }

        // Add the universal turn-end message and state render
        result.push(...await super.endTurn());

        return result;
    }

    override async endDay() {
        // If the end date has been reached, add players to the winners list in-order
        if (this.isTodayEndDate()) {
            for (const userId of this.getOrderedPlayers()) {
                if (!this.isSeasonComplete()) {
                    this.addWinner(userId);
                }
            }
        }
        return [];
    }

    getPoints(userId: string): number {
        return this.state.points[userId] ?? 0;
    }

    addPoints(userId: string, points: number): void {
        if (isNaN(points)) {
            throw new Error('Cannot award NaN points!');
        }
        this.state.points[userId] = toFixed((this.state.points[userId] ?? 0) + points);
    }

    addPointsFromAction(userId: string, points: number): void {
        // Validation should be done in this delegated call
        this.addPoints(userId, points);
        this.state.actionPointDiffs[userId] = toFixed((this.state.actionPointDiffs[userId] ?? 0) + points);
    }
    
    awardPrize(userId: string, type: PrizeType, intro: string): string[] {
        // An empty return value won't trigger a DM response
        return [];
    }

    override async addPlayerDecision(userId: string, text: string): Promise<MessengerPayload> {
        // If today is the end date, don't accept any decisions
        if (this.isTodayEndDate()) {
            throw new Error('The season ends today!');
        }
        const sanitizedDecision = text.toLowerCase().trim();
        // Halloween actions
        if (this.isHalloween()) {
            if (sanitizedDecision === 'creep') {
                this.state.decisions[userId] = ['creep'];
                return 'Good choice! You will **creep** through the night...';
            } else if (sanitizedDecision === 'hide') {
                this.state.decisions[userId] = ['hide'];
                return 'Safe choice, you will put your hands over your eyes to **hide** from the ghouls of the night...';
            } else if (sanitizedDecision.startsWith('spook')) {
                const targetName = sanitizedDecision.replace(/^spook\s*/, '');
                if (targetName) {
                    const targetId = this.parseUserDecisionInput(targetName);
                    if (targetId) {
                        if (userId === targetId) {
                            throw new Error('What\'s your problem? You can\'t **spook** yourself...');
                        }
                        // Validate that the target player is ahead of this player
                        if (this.getPoints(userId) > this.getPoints(targetId)) {
                            throw new Error(`You can't spook **${this.getName(targetId)}**, for you're ahead of them!`)
                        }
                        this.state.decisions[userId] = [`spook:${targetId}`];
                        return `Ok, you will **spook** **${this.getName(targetId)}** this turn...`;
                    } else {
                        throw new Error('I have no idea who you\'re trying to spook, could you please be more specific?');
                    }
                } else {
                    throw new Error('Who are you trying to spook? For example, \`spook Dezryth\`');
                }
            }
        }
        // Standard actions
        else {
            if (sanitizedDecision === 'cheer') {
                this.state.decisions[userId] = ['cheer'];
                return 'Good choice! You will spread Good Morning **cheer** to your dear dogs';
            } else if (sanitizedDecision === 'take') {
                this.state.decisions[userId] = ['take'];
                // If the player is near the goal, let them know their take will be nerfed
                if (this.isPlayerNearGoal(userId)) {
                    return `You will **take**, but you're close to finishing so the amount will be exactly **${ClassicGame.NERFED_TAKE_AMOUNT}** points to avoid randomness in the winning condition`;
                } else {
                    return 'Oooooh risky choice! You will **take**, let\'s see if it pays off...';
                }
            } else if (sanitizedDecision.startsWith('peek')) {
                const targetName  = sanitizedDecision.replace(/^peek\s*/, '');
                if (targetName) {
                    const targetId = this.parseUserDecisionInput(targetName);
                    if (targetId) {
                        this.state.decisions[userId] = [`peek:${targetId}`];
                        return `Ok, you will **peek** at **${this.state.names[targetId]}** this turn...`;
                    } else {
                        throw new Error('I have no idea who you\'re trying to peek at, could you please be more specific?');
                    }
                } else {
                    throw new Error('Who are you trying to peek at? For example, \`peek Robert\`');
                }
            }
        }
        throw new Error('I don\'t recognize that action!');
    }

    override async processPlayerDecisions(): Promise<DecisionProcessingResult> {
        let summary = '';

        const anyCheerDecisions = Object.values(this.state.decisions).some(d => d.includes('cheer'));
        const anyCreepDecisions = Object.values(this.state.decisions).some(d => d.includes('creep'));
        const takers = Object.keys(this.state.decisions).filter(userId => this.state.decisions[userId].includes('take'));
        const peekersByTarget: Record<string, string[]> = {};
        const spookers = Object.keys(this.state.decisions).filter(userId => this.state.decisions[userId][0]?.startsWith('spook:'));
        const hiders = Object.keys(this.state.decisions).filter(userId => this.state.decisions[userId].includes('hide'));
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
                this.addPointsFromAction(userId, 1);
                const recipients = recipientsByCheerer[userId];
                if (recipients.length > 0) {
                    this.addPointsFromAction(randChoice(...recipients), 1);
                }
                // Remove decision for this player
                delete this.state.decisions[userId];
            }
            summary += `**${cheerers.length}** players spread some Good Morning cheer! `;
        } else if (anyCreepDecisions) {
            // Process the creeps
            const creepers = Object.keys(this.state.decisions).filter(userId => this.state.decisions[userId].includes('creep'));
            const recipientsByCreeper = {};
            for (const userId of creepers) {
                recipientsByCreeper[userId] = this.getPlayersBehindPlayer(userId);
            }

            for (const userId of creepers) {
                this.state.revealedActions[userId] = 'creep';
                // Award points
                this.addPointsFromAction(userId, 1);
                const recipients = recipientsByCreeper[userId];
                if (recipients.length > 0) {
                    this.addPointsFromAction(randChoice(...recipients), 1);
                }
                // Remove decision for this player
                delete this.state.decisions[userId];
            }
            summary += `Oh my, oh might! **${creepers.length}** players crept through the night, raising our hairs and spreading Halloween fright... `;
        } else if (takers.length > 0) {
            const taker = randChoice(...takers);
            // If the taker is near the goal, use a constant value to (1) nerf them and (2) prevent unfair winning conditions
            const amount = this.isPlayerNearGoal(taker) ? ClassicGame.NERFED_TAKE_AMOUNT : randChoice(3, 4, 5);
            if (taker in peekersByTarget) {
                // Taker was peeked by one or more players!
                const peekers = peekersByTarget[taker];
                this.addPointsFromAction(taker, -amount * peekers.length);
                this.state.revealedActions[taker] = 'take-fail';
                for (const peeker of peekers) {
                    this.addPointsFromAction(peeker, amount);
                    this.state.revealedActions[peeker] = 'peek';
                }
                if (peekers.length === 1) {
                    summary += `**${this.getName(taker)}** tried to steal from GMBR, but was stopped by **${this.getName(peekers[0])}** who looted **${amount}** points from the bastard's pile`;
                } else {
                    summary += `**${this.getName(taker)}** tried to steal from GMBR, but was stopped by ${naturalJoin(peekers.map(u => `**${this.getName(u)}**`), { conjunction: '&' })}! They each plundered **${amount}** points from **${this.getName(taker)}**`;
                }
            } else {
                // Taker was not peeked
                this.addPointsFromAction(taker, amount);
                this.state.revealedActions[taker] = 'take';
                summary += `**${this.getName(taker)}** took **${amount}** points from GMBR! `;
                // The taker also needs a handicap
                if (this.doesPlayerNeedHandicap(taker)) {
                    const tipAmount = randChoice(3, 4, 5);
                    this.addPointsFromAction(taker, tipAmount);
                    summary += `He turned the iPad and GMBR tipped him **${tipAmount}** more points out of pity... `;
                }
            }
            // Delete the decisions
            delete this.state.decisions[taker];
        } else if (spookers.length > 0) {
            const spooker = randChoice(...spookers);
            const decision = this.state.decisions[spooker];
            const targetUserId = decision[0].split(':')[1];
            if (hiders.includes(targetUserId)) {
                // Reveal the target as hiding
                this.state.revealedActions[targetUserId] = 'hide';
                this.state.revealedActions[spooker] = 'spook-fail';
                summary += this.getFailedSpookString(this.getName(spooker), this.getName(targetUserId));
            } else {
                // Successful spook
                this.state.revealedActions[spooker] = 'spook';
                // Update points
                this.addPointsFromAction(spooker, 4);
                this.addPointsFromAction(targetUserId, -4);
                summary += this.getSpookString(this.getName(spooker), this.getName(targetUserId));
            }
            // Delete the decisions
            delete this.state.decisions[spooker];
        }

        // End the turn if the only thing remaining are unfulfilled peek/hide actions
        const endTurn = Object.values(this.state.decisions).every(d => d[0] && (d[0].startsWith('peek:') || d[0] === 'hide'));

        // If nothing happened for some reason, add a default message
        if (!summary) {
            summary = this.isHalloween() ? 'The wind blew softly throughout the night, while neither ghost nor ghoul were anywhere in sight...' : 'Dogs sat around with their hands in their pockets...';
        }

        return {
            summary: {
                content: summary,
                files: [await this.renderStateAttachment()],
                flags: MessageFlags.SuppressNotifications
            },
            continueProcessing: !endTurn
        };
    }

    private getSpookString(spooker: string, spookee: string): string {
        return randChoice(
            text(`**${spooker}** {!crept|snuck} up behind **${spookee}** and {!pulled|yanked|tugged} on his hair, {!slapped up|groped|spanked up} his ass, and gave him a scare!`),
            text(`**${spooker}** {!shrieked before|spooked|startled} **${spookee}** with all his might, {!causing a scene|curdling his blood|raising his hair} and {!creating|stirring up} a fright!`),
            text(`**${spooker}** {!crept|snuck} up behind **${spookee}** and gave him a scare, curdling his blood and raising his hair!`),
            text(`**${spooker}** shrieked {!at|before|toward} **${spookee}** with a {!sound|noise|voice} so loud, the demons {!rejoiced|cheered on} and {!the devil|even Satan} was proud!`),
            text(`**${spooker}** shrieked into the night with a sound so brave, **${spookee}** {!tumbled|fell over} backward into his grave!`),
            text(`**${spooker}** emerged from the dark of night, and spooked **${spookee}** with a terrible might!`)
        );
    }

    private getFailedSpookString(spooker: string, spookee: string): string {
        return randChoice(
            text(`**${spooker}** {!crept|snuck} up before **${spookee}** to {!deliver|give him} a spook, but his eyes were squinting shut like a... coward!`),
            text(`**${spooker}** shrieked before **${spookee}** from the bottom of his lungs, but his victim was safe with a pair of ear plugs!`),
            text(`**${spooker}** failed to spook **${spookee}**, oh how sad - his victim was out {!fishing|grilling|drinking beers} with his dad!`),
            text(`**${spooker}** failed to spook **${spookee}**, oh how pathetic - his victim had hid, in a move so prophetic!`),
            text(`**${spooker}** failed to spook **${spookee}**, oh how lame - his victim was hiding, for he's good at this game!`),
            text(`**${spooker}** failed to spook **${spookee}** and dropped to the ground, {!bawling|crying} his eyes out after his victim wasn't found!`),
            text(`**${spooker}** tried to spook **${spookee}** but failed so bad, it made GMBR oh so glad!`)
        );
    }

    private isHalloween(): boolean {
        return this.state.halloween ?? false;
    }

    private getActionPointDiff(userId: Snowflake): number {
        return this.state.actionPointDiffs[userId] ?? 0;
    }

    /**
     * TODO: Make this is a generic utility for all games, but we need to make "name" more generally accessible
     * @param input The user's ID or a name to search with
     * @returns The ID of the matching user, if any
     */
    private parseUserDecisionInput(input: string): Snowflake | undefined {
        if (this.hasPlayer(input)) {
            return input;
        }
        return this.getClosestUserByName(input);
    }

    private getClosestUserByName(input: string): Snowflake | undefined {
        const userIds: Snowflake[] = this.getPlayers();
        const sanitizedDisplayNames: string[] = userIds.map(userId => this.getName(userId).toLocaleLowerCase().trim());
        const result = getMostSimilarByNormalizedEditDistance(input.toLowerCase().trim(), sanitizedDisplayNames);
        if (result) {
            return userIds[result.index];
        }
    }

    private getName(userId: Snowflake): string {
        return this.state.names[userId] ?? userId;
    }

    private async createHomeStretchImage(medals: Record<Snowflake, Medals>): Promise<Buffer> {
        return await this.createImage(medals, {
            title: `It's week ${this.state.turn} of season ${this.getSeasonNumber()}\n  The final days are upon us`
        });
    }

    private async createMidSeasonUpdateImage(medals: Record<Snowflake, Medals>): Promise<Buffer> {
        return await this.createImage(medals, {
            title: this.isHalloween()
                ? `${getNumberOfDaysUntil(this.state.endDate)} nights until judgment day...`
                : `It's week ${this.state.turn} of season ${this.getSeasonNumber()}\n  What a blessed experience!`
        });
    }

    private async createSeasonResultsImage(medals: Record<Snowflake, Medals>): Promise<Buffer> {
        return await this.createImage(medals);
    }

    // TODO: This logic is horrible, please clean it up
    private async createImage(medals: Record<Snowflake, Medals>, options?: { title?: string }): Promise<Buffer> {
        const COLOR_BLACK = 'black';
        const COLOR_SKY = 'rgba(100,157,250,1)';
        const COLOR_BAR_CONTAINER = 'rgb(221,231,239)';
        const COLOR_HALLOWEEN_BAR_CONTAINER = 'rgb(30,30,30)';

        // Start by loading the header image, then use that to determine the total dimensions
        const headerImage = await imageLoader.loadImage(`assets/classic/header-${this.isHalloween() ? 'halloween' : 'classic'}.png`);

        const HEADER_HEIGHT = 200;
        const WIDTH = (headerImage.width / headerImage.height) * HEADER_HEIGHT;

        const BAR_HEIGHT = 36;
        const AVATAR_HEIGHT = BAR_HEIGHT;
        const BAR_PADDING = 3;
        const BAR_SPACING = BAR_PADDING * 1.5;
        const BASE_MARGIN = BAR_HEIGHT / 2;
        const BAR_WIDTH = WIDTH - (2 * BASE_MARGIN) - AVATAR_HEIGHT - BAR_SPACING;
        const INNER_BAR_WIDTH = BAR_WIDTH - (BAR_PADDING * 2);
        // TODO (2.0): This isn't really relevant anymore because there's no longer a season goal
        const SEASON_GOAL = 100;
        const PIXELS_PER_POINT = INNER_BAR_WIDTH / SEASON_GOAL;
        const LOWEST_SCORE = Math.min(...Object.values(this.state.points));
        const MARGIN = Math.max(BASE_MARGIN, PIXELS_PER_POINT * Math.abs(Math.min(LOWEST_SCORE, 0)) - (2 * BAR_PADDING + AVATAR_HEIGHT));
        const BASE_BAR_X = MARGIN + AVATAR_HEIGHT + BAR_SPACING;
        // const WIDTH = BASE_BAR_X + BAR_WIDTH + MARGIN;
        const HEIGHT = HEADER_HEIGHT + Object.keys(this.state.points).length * (BAR_HEIGHT + BAR_SPACING) + MARGIN - BAR_SPACING;
        const c = canvas.createCanvas(WIDTH, HEIGHT);
        const context = c.getContext('2d');

        // Fill the solid background
        context.fillStyle = this.isHalloween() ? COLOR_BLACK : COLOR_SKY;
        context.fillRect(0, 0, WIDTH, HEIGHT);

        // Draw the header image
        context.drawImage(headerImage, 0, 0, WIDTH, HEADER_HEIGHT);

        // Fetch all user display names
        const orderedUserIds: string[] = this.getOrderedPlayers();

        // Load medal images
        const sunIconImage = await imageLoader.loadImage('assets/sunicon.png');
        const greenDollarIcon = await imageLoader.loadImage('assets/dollargreenicon2.png');
        const redDollarIcon = await imageLoader.loadImage('assets/dollarredicon2.png');
        const eyeImage = await imageLoader.loadImage('assets/eye.png');
        const creepIcon = await imageLoader.loadImage('assets/classic/blackcatsmirk.png');
        const spookIcon = await imageLoader.loadImage('assets/ghost-icon.png');
        const hideIcon = await imageLoader.loadImage('assets/classic/blindfold.png');
        const rank1Image = await imageLoader.loadImage('assets/rank1.png');
        const rank2Image = await imageLoader.loadImage('assets/rank2.png');
        const rank3Image = await imageLoader.loadImage('assets/rank3.png');
        const rankLastImage = await imageLoader.loadImage('assets/ranklast.png');

        // Write the header text
        context.fillStyle = this.isHalloween() ? COLOR_BLACK : COLOR_BAR_CONTAINER;
        const TITLE_FONT_SIZE = Math.floor(WIDTH / 25);
        context.font = `${TITLE_FONT_SIZE}px sans-serif`;
        if (options?.title) {
            context.fillText(options.title, WIDTH * 0.33, HEADER_HEIGHT * 7 / 16);
        } else {
            const winnerName: string = this.state.names[orderedUserIds[0]] ?? `Player ${orderedUserIds[0]}`;
            // `Celebrating the end of season ${state.getSeasonNumber()}\n   ${state.getSeasonStartedOn()} - ${getTodayDateString()}\n      Congrats, ${winnerName}!`
            context.fillText(`Celebrating the end of the season\n   Congrats, ${winnerName}!`,
                WIDTH * 0.33,
                HEADER_HEIGHT * 5 / 16);
        }

        let textInsideBar = true;
        for (let i = 0; i < orderedUserIds.length; i++) {
            const userId: Snowflake = orderedUserIds[i];
            // const displayName = options?.showMultiplier ? state.getPlayerDisplayNameWithMultiplier(userId) : state.getPlayerDisplayName(userId);
            const displayName = this.state.names[userId] ?? `Player ${userId}`;
            const baseY = HEADER_HEIGHT + i * (BAR_HEIGHT + BAR_SPACING);

            // Draw the avatar container
            context.fillStyle = this.isHalloween() ? COLOR_HALLOWEEN_BAR_CONTAINER : COLOR_BAR_CONTAINER;
            context.fillRect(MARGIN, baseY, AVATAR_HEIGHT, AVATAR_HEIGHT);
            // Draw the player's avatar
            const avatarImage = await imageLoader.loadAvatar(userId, 64);
            context.drawImage(avatarImage, MARGIN + BAR_PADDING, baseY + BAR_PADDING, AVATAR_HEIGHT - (BAR_PADDING * 2), AVATAR_HEIGHT - (BAR_PADDING * 2));

            // Determine the bar's actual rendered width (may be negative, but clip to prevent it from being too large)
            const actualBarWidth = Math.min(this.getPoints(userId), SEASON_GOAL) * PIXELS_PER_POINT;

            // Draw the bar container
            context.fillRect(BASE_BAR_X, baseY, BAR_WIDTH, BAR_HEIGHT);

            // Draw the actual bar using a hue corresponding to the user's rank
            const hue = 256 * (orderedUserIds.length - i) / orderedUserIds.length;
            const halloweenSaturation = 100 * (orderedUserIds.length - i) / orderedUserIds.length;
            context.fillStyle = this.isHalloween() ? `hsl(0,${halloweenSaturation}%,30%)` : `hsl(${hue},50%,50%)`;
            context.fillRect(BASE_BAR_X + BAR_PADDING,
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
            const textX = BASE_BAR_X + BAR_PADDING * 2 + (textInsideBar ? 0 : Math.max(actualBarWidth, 0));
            context.fillStyle = `rgba(0,0,0,.4)`;
            context.fillText(displayName, textX, baseY + 0.7 * BAR_HEIGHT);
            context.fillStyle = this.isHalloween() ? COLOR_BAR_CONTAINER : (textInsideBar ? 'white' : 'BLACKISH');
            context.fillText(displayName, textX + 1, baseY + 0.7 * BAR_HEIGHT + 1);

            // Draw the number of points to the right of the name
            let pointText = `${Math.floor(this.getPoints(userId))}`;
            const actionPointDiff = this.getActionPointDiff(userId);
            if (actionPointDiff > 0) {
                pointText += ` (+${actionPointDiff})`;
            } else if (actionPointDiff < 0) {
                pointText += ` (${actionPointDiff})`;
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
                } else if (revealedAction === 'creep') {
                    context.drawImage(creepIcon, baseMedalX, baseY + BAR_PADDING, imageWidth, imageWidth);
                } else if (revealedAction === 'spook' || revealedAction === 'spook-fail') {
                    context.drawImage(spookIcon, baseMedalX, baseY + BAR_PADDING, imageWidth, imageWidth);
                } else if (revealedAction === 'hide') {
                    context.drawImage(hideIcon, baseMedalX, baseY + BAR_PADDING, imageWidth, imageWidth);
                }
            }
        }

        return c.toBuffer();
    }

    override getDecisionActionRow(): ActionRowData<MessageActionRowComponentData>[] {
        // If today is the end date, don't prompt any decisions
        if (this.isTodayEndDate()) {
            return [];
        }
        // Else, send action rows for this week's decision
        if (this.isHalloween()) {
            return [{
                type: ComponentType.ActionRow,
                components: [{
                    type: ComponentType.Button,
                    style: ButtonStyle.Secondary,
                    customId: 'decision:creep',
                    label: 'Creep',
                    emoji: '🐈‍⬛'
                }, {
                    type: ComponentType.Button,
                    style: ButtonStyle.Secondary,
                    customId: 'spawnDecisionUserSelect:spook',
                    label: 'Spook',
                    emoji: '👻'
                }, {
                    type: ComponentType.Button,
                    style: ButtonStyle.Secondary,
                    customId: 'decision:hide',
                    label: 'Hide',
                    emoji: '🙈'
                }]
            }];
        }
        return [{
            type: ComponentType.ActionRow,
            components: [{
                type: ComponentType.Button,
                style: ButtonStyle.Primary,
                customId: 'decision:cheer',
                label: 'Cheer',
                emoji: '🌞'
            }, {
                type: ComponentType.Button,
                style: ButtonStyle.Primary,
                customId: 'decision:take',
                label: 'Take',
                emoji: '‼️'
            }, {
                type: ComponentType.Button,
                style: ButtonStyle.Primary,
                customId: 'spawnDecisionUserSelect:peek',
                label: 'Peek',
                emoji: '👀'
            }]
        }];
    }

    override async getSeasonEndMessages(): Promise<MessengerPayload[]> {
        const winners: Snowflake[] = this.getWinners();
        if (this.isHalloween()) {
            return [
                `This season, **${this.getNumPlayers()}** players competed each morning to leave us aghast`,
                'Many of us were spooked, but many cowered under the covers - waiting for the night to pass...',
                'Through all the screams and tears, only one could be crowned the King of the Graveyard...',
                {
                    content: `That King's name is <@${winners[0]}> - a monster who goes oh so hard!`,
                    files: [await this.renderSeasonEndStateAttachment()]
                },
                `<@${winners[1]}> and <@${winners[2]}> arose from their graves to unleash terror, but the champion beat them to it`,
                '...as for the rest of you wannabe ghouls, you absolutely blew it!',
                'As the season comes to a bittersweet close, remember all those October mornings so gay',
                'Thank you all for a truly horrific season, and I\'ll see you all tonight at the Grand Ghost Soiree!'
            ];
        }
        return [
            `This season, **${this.getNumPlayers()}** players competed each morning to bring the most sunshine and cheer...`,
            'Many of you were takers, but many of you were peekers too!',
            {
                content: `Ultimately, only one could be crowned the King of the Morning... <@${winners[0]}>!`,
                files: [await this.renderSeasonEndStateAttachment()]
            },
            `<@${winners[1]}> and <@${winners[2]}> put up a good fight - and for that we are grateful - yet it was not enough to be crowned champion`
        ];
    }
}
