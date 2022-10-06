import canvas, { Image } from 'canvas';
import { GuildMember, Snowflake } from "discord.js";
import { BasicGameState, Medals, PrizeType } from "../types";
import AbstractGame from "./abstract-game";

export default class BasicGame extends AbstractGame<BasicGameState> {

    constructor(state: BasicGameState) {
        super(state);
    }

    getIntroductionText(): string {
        return 'This season will just be a vanilla GMBR with no extra game. Say Good Morning and get points, have fun!'
    }

    getInstructionsText(): string {
        return 'Just say Good Morning and have a fun time!';
    }

    getSeasonCompletion(): number {
        return Math.max(...Object.values(this.state.points)) / this.state.goal;
    }

    getOrderedPlayers(): string[] {
        return Object.keys(this.state.points).sort((x, y) => this.getPoints(y) - this.getPoints(x));
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

    async renderState(options?: { showPlayerDecision?: string; admin?: boolean; }): Promise<Buffer> {
        return await this.createMidSeasonUpdateImage({});
    }

    beginTurn(): void {
        this.state.turn++;
    }

    getPoints(userId: string): number {
        return this.state.points[userId] ?? 0;
    }

    addPoints(userId: string, points: number): void {
        this.state.points[userId] = (this.state.points[userId] ?? 0) + points;
    }
    
    awardPrize(userId: string, type: PrizeType, intro: string): string {
        return `${intro}, you are appreciated!`;
    }

    addPlayerDecision(userId: string, text: string): string {
        return 'There are no decisions in this game but cool!';
    }

    processPlayerDecisions(): { summary: string; continueProcessing: boolean; } {
        for (const userId of this.getOrderedPlayers()) {
            // If this user's points exceed the goal, then add them as a winner
            if (this.getPoints(userId) >= this.state.goal) {
                this.addWinner(userId);
            }
        }

        return {
            summary: 'Wow! What a week!',
            continueProcessing: false
        };
    }

    private async createHomeStretchImage(medals: Record<Snowflake, Medals>): Promise<Buffer> {
        return await this.createImage(medals, {
            title: 'We\'re almost there!\n  The final days are upon us',
            sunImageName: 'sun_spooky.png',
            showMultiplier: true
        });
    }

    private async createMidSeasonUpdateImage(medals: Record<Snowflake, Medals>): Promise<Buffer> {
        return await this.createImage(medals, {
            // title: `We're ${getNumberOfDaysSince(state.getSeasonStartedOn())} days into season ${state.getSeasonNumber()}\n  What a blessed experience!`
            title: 'We\'re deep into the season\n  What a blessed experience!'
        });
    }

    private async createSeasonResultsImage(medals: Record<Snowflake, Medals>): Promise<Buffer> {
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
            const userId = orderedUserIds[i];
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
            const textWidth = context.measureText(displayName).width;

            // If the text for this user no longer fits in the bar, place the text after the bar for all remaining entries
            if (textInsideBar) {
                textInsideBar = textWidth * 1.1 < actualBarWidth;
            }

            // Write the user's display name (with a "shadow")
            const textX = MARGIN + BAR_PADDING * 2 + (textInsideBar ? 0 : Math.max(actualBarWidth, 0));
            context.font = `${textHeight}px sans-serif`;
            context.fillStyle = `rgba(0,0,0,.4)`;
            context.fillText(displayName, textX, baseY + 0.7 * BAR_HEIGHT);
            context.fillStyle = textInsideBar ? 'white' : 'BLACKISH';
            context.fillText(displayName, textX + 1, baseY + 0.7 * BAR_HEIGHT + 1);

            // Draw medals for this user
            if (medals && medals[userId]) {
                const numMedals = Object.values(medals[userId]).reduce((x, y) => x + y);

                const imageWidth = BAR_HEIGHT - 2 * BAR_PADDING - 2;
                const IMAGE_WIDTH = imageWidth + BAR_PADDING;
                let j = 0;
                const baseMedalX = WIDTH - MARGIN - BAR_PADDING - (numMedals * IMAGE_WIDTH);
                for (let k = 0; k < medals[userId].gold ?? 0; k++) {
                    context.drawImage(rank1Image, baseMedalX + j * IMAGE_WIDTH, baseY + BAR_PADDING, imageWidth, imageWidth);
                    j++;
                }
                for (let k = 0; k < medals[userId].silver ?? 0; k++) {
                    context.drawImage(rank2Image, baseMedalX + j * IMAGE_WIDTH, baseY + BAR_PADDING, imageWidth, imageWidth);
                    j++;
                }
                for (let k = 0; k < medals[userId].bronze ?? 0; k++) {
                    context.drawImage(rank3Image, baseMedalX + j * IMAGE_WIDTH, baseY + BAR_PADDING, imageWidth, imageWidth);
                    j++;
                }
                for (let k = 0; k < medals[userId].skull ?? 0; k++) {
                    context.drawImage(rankLastImage, baseMedalX + j * IMAGE_WIDTH, baseY + BAR_PADDING, imageWidth, imageWidth);
                    j++;
                }
            }
        }

        return c.toBuffer();
    }
}
