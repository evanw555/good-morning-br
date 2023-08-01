import { Guild, GuildMember, Snowflake } from "discord.js";
import canvas, { Image } from 'canvas';
import { DecisionProcessingResult, IslandGameState, IslandPlayerState, PrizeType } from "../types";
import AbstractGame from "./abstract-game";
import logger from "../logger";
import { getMostSimilarByNormalizedEditDistance, toFixed } from "evanw555.js";
import imageLoader from "../image-loader";

export default class IslandGame extends AbstractGame<IslandGameState> {

    constructor(state: IslandGameState) {
        super(state);
    }

    static create(members: GuildMember[]): IslandGame {
        const players: Record<Snowflake, IslandPlayerState> = {};
        for (const member of members) {
            players[member.id] = {
                displayName: member.displayName,
                points: 0
            };
        }
        return new IslandGame({
            type: 'ISLAND_GAME_STATE',
            decisions: {},
            turn: 0,
            winners: [],
            players
        });
    }

    getIntroductionText(): string[] {
        return [
            'My dear dogs... welcome to the Island of Mournful Mornings! This season, you are all castaways on my island 😼',
            'This game will be a true Battle Royale, and only those of you who have participated in the last week are eligible to win 🌞',
            'However, don\'t get too comfortable! Each week, some dogs will be voted off the island, killing their dreams of a sungazing victory ☠️'
        ];
    }

    getInstructionsText(): string {
        return 'Send me a DM letting me know who should be voted off the island this week! '
            + 'Your voting power is equivalent to the number of points earned this week. '
            + 'But bewarned! If you don\'t send me anything, you\'ll vote for yourself by default';
    }

    getHelpText(): string {
        return this.getInstructionsText();
    }

    getDebugText(): string {
        // TODO: Complete
        return '';
    }

    getDebugString(): string {
        // TODO: Complete
        return '';
    }

    getSeasonCompletion(): number {
        throw new Error("Method not implemented.");
    }

    getPlayers(): string[] {
        return Object.keys(this.state.players);
    }

    getOrderedPlayers(): string[] {
        // TODO: Complete this
        return this.getPlayers();
    }

    private getRemainingPlayers(): Snowflake[] {
        return this.getPlayers().filter(id => !this.isPlayerEliminated(id));
    }

    private getNumRemainingPlayers(): number {
        return this.getRemainingPlayers().length;
    }

    private getEliminatedPlayers(): Snowflake[] {
        return this.getPlayers().filter(id => this.isPlayerEliminated(id));
    }

    private getNumEliminatedPlayers(): number {
        return this.getEliminatedPlayers().length;
    }

    hasPlayer(userId: string): boolean {
        return userId in this.state.players;
    }

    addPlayer(member: GuildMember): string {
        logger.log(`Refusing to add **${member.displayName}** to the island, as it's already started`);
        return `Cannot add **${member.displayName}** (island game already started)`;
    }

    updatePlayer(member: GuildMember): void {
        if (this.hasPlayer(member.id)) {
            this.state.players[member.id].displayName = member.displayName;
        }
    }

    removePlayer(userId: string): void {
        delete this.state.decisions[userId];
        delete this.state.players[userId];
    }

    private getName(userId: Snowflake): string {
        return this.state.players[userId]?.displayName ?? userId;
    }

    private isPlayerEliminated(userId: Snowflake): boolean {
        return this.state.players[userId]?.eliminated ?? false;
    }

    private isPlayerImmune(userId: Snowflake): boolean {
        return this.state.players[userId]?.immunity ?? false;
    }

    async renderState(options?: { showPlayerDecision?: string | undefined; admin?: boolean | undefined; season?: number | undefined; } | undefined): Promise<Buffer> {
        const MARGIN = 16;
        const HEADER_WIDTH = 700;
        const HEADER_HEIGHT = 100;
        const WIDTH = HEADER_WIDTH + MARGIN * 2;

        // Load images
        const islandImage = await imageLoader.loadImage('assets/island.png');

        const HEIGHT = HEADER_HEIGHT * 2 + islandImage.height + MARGIN * 4;
        const c = canvas.createCanvas(WIDTH, HEIGHT);
        const context = c.getContext('2d');

        // Fill the blue sky background
        context.fillStyle = 'rgba(100,157,250,1)';
        context.fillRect(0, 0, WIDTH, HEIGHT);

        // Fill the sea
        context.fillStyle = 'rgba(28,50,138,1)';
        const horizonY = HEADER_HEIGHT + MARGIN * 2 + islandImage.height * 0.6;
        context.fillRect(0, horizonY, WIDTH, HEIGHT - horizonY);

        // Draw the island image
        context.drawImage(islandImage, MARGIN, HEADER_HEIGHT + MARGIN * 2);

        // Write the header text
        context.fillStyle = 'rgb(221,231,239)';
        const TITLE_FONT_SIZE = Math.floor(HEADER_HEIGHT / 2);
        context.font = `${TITLE_FONT_SIZE}px sans-serif`;
        context.fillText('Hello! Welcome to Island\nEnjoy your stay! Yeahhhh', MARGIN, MARGIN + TITLE_FONT_SIZE);

        return c.toBuffer();
    }

    beginTurn(): string[] {
        this.state.turn++;

        for (const userId of this.getOrderedPlayers()) {
            // Add default decision
            this.state.decisions[userId] = [userId];
        }

        return [];
    }

    override endTurn(): string[] {
        // Reset immunity for all players
        for (const userId of this.getOrderedPlayers()) {
            delete this.state.players[userId].immunity;
        }
        // Send no extra messages
        return [];
    }

    getPoints(userId: string): number {
        return this.state.players[userId]?.points ?? 0;
    }

    addPoints(userId: string, points: number): void {
        if (isNaN(points)) {
            throw new Error('Cannot award NaN points!');
        }
        if (!this.hasPlayer(userId)) {
            throw new Error(`Player ${userId} not in-game, can't award points!`);
        }
        this.state.players[userId].points = toFixed(this.getPoints(userId) + points);
    }

    awardPrize(userId: string, type: PrizeType, intro: string): string[] {
        // If player isn't in the game yet, do nothing
        if (!this.hasPlayer(userId)) {
            return [];
        }
        switch (type) {
            case 'submissions1':
                // If we're in the final week, don't award anything but still notify them
                if (this.getNumRemainingPlayers() === 2) {
                    return [`${intro}, but it's the final week so I can't grant you immunity. Sorry bud!`];
                }
                // Else, award immunity and notify
                this.state.players[userId].immunity = true;
                return [`${intro}, you've been granted immunity this week! No one will be able to vote to eliminate you until next week`];
            default:
                return [];
        }
    }

    getWeeklyDecisionDMs(): Record<string, string> {
        return {};
    }

    addPlayerDecision(userId: string, text: string): string {
        const votes = Math.round(this.getPoints(userId));
        if (votes < 1) {
            throw new Error('You don\'t have enough points to vote this week, dummy!');
        }
        const targetName  = text;
        if (targetName) {
            const targetId = this.getClosestUserByName(targetName);
            if (targetId) {
                // Validate the target user
                if (this.isPlayerEliminated(targetId)) {
                    throw new Error(`**${this.getName(targetId)}** has already been eliminated, choose someone else!`);
                }
                if (this.isPlayerImmune(targetId)) {
                    throw new Error(`**${this.getName(targetId)}** has immunity this turn, choose someone else!`);
                }
                this.state.decisions[userId] = [targetId];
                return `Ok, you will use your **${votes}** vote${votes === 1 ? '' : 's'} to eliminate **${this.getName(targetId)}** this week...`;
            } else {
                throw new Error('I have no idea who you\'re trying to peek at, could you please be more specific?');
            }
        } else {
            throw new Error('You are you trying to vote for? For example, \`Robert\`');
        }
    }

    processPlayerDecisions(): DecisionProcessingResult {
        let summary = '';

        // TODO: Process decisions

        // End the turn if there are no decisions left
        const endTurn = Object.keys(this.state.decisions).length === 0;

        return {
            summary,
            continueProcessing: !endTurn
        }
    }


    private getClosestUserByName(input: string): Snowflake | undefined {
        const userIds: Snowflake[] = this.getPlayers();
        const sanitizedDisplayNames: string[] = userIds.map(userId => this.getName(userId).toLocaleLowerCase().trim());
        const result = getMostSimilarByNormalizedEditDistance(input.toLowerCase().trim(), sanitizedDisplayNames);
        if (result) {
            return userIds[result.index];
        }
    }
}