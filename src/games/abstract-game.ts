import canvas from "canvas";
import { GuildMember, Snowflake } from "discord.js";
import { DecisionProcessingResult, GameState, PrizeType } from "../types";

export default abstract class AbstractGame<T extends GameState> {
    protected readonly state: T;
    private readonly imageCache: Record<string, canvas.Image>;
    private static readonly BROKEN_IMAGE_PATH: string = 'assets/broken.jpeg';

    constructor(state: T) {
        this.state = state;
        this.imageCache = {};

        // TODO (2.0): Temp logic to ensure the list exists after being loaded (remove this)
        if (this.state.winners === undefined) {
            this.state.winners = [];
        }
    }

    /**
     * Text sent out to the channel before the very first game decision of the season.
     */
    abstract getIntroductionText(): string
    /**
     * Text sent out to the channel at the beginning of the weekly game decision.
     */
    abstract getInstructionsText(): string
    /**
     * Text sent directly to users who request help during the game decision phase.
     */
    abstract getHelpText(): string
    abstract getDebugText(): string
    /**
     * Returns a number in the range [0, 1] representing the approximate completion of this game.
     * If the season is complete, then the value should always be 1.
     */
    abstract getSeasonCompletion(): number

    getNumPlayers(): number {
        return this.getPlayers().length;
    }

    abstract getPlayers(): Snowflake[]
    abstract getOrderedPlayers(): Snowflake[]

    getPlayersBehindPlayer(userId: Snowflake): Snowflake[] {
        const orderedPlayers = this.getOrderedPlayers();
        const index = orderedPlayers.indexOf(userId);
        if (index === -1) {
            return [];
        } else {
            return orderedPlayers.slice(index + 1);
        }
    }

    abstract hasPlayer(userId: Snowflake): boolean
    abstract addPlayer(member: GuildMember): string
    abstract updatePlayer(member: GuildMember): void
    abstract removePlayer(userId: Snowflake): void
    abstract doesPlayerNeedHandicap(userId: Snowflake): boolean
    abstract renderState(options?: { showPlayerDecision?: Snowflake, admin?: boolean, season?: number }): Promise<Buffer>
    abstract beginTurn(): void
    abstract getPoints(userId: Snowflake): number
    abstract addPoints(userId: Snowflake, points: number): void
    abstract awardPrize(userId: Snowflake, type: PrizeType, intro: string): string[]

    getMaxPoints(): number {
        return Math.max(0, ...this.getPlayers().map(userId => this.getPoints(userId)));
    }

    /**
     * Returns a mapping from user ID to text string for DMs that should be send to players on the morning of game decisions.
     */
    abstract getWeeklyDecisionDMs(): Record<Snowflake, string>
    abstract addPlayerDecision(userId: Snowflake, text: string): string
    abstract processPlayerDecisions(): DecisionProcessingResult

    /**
     * Hook for handling DMs from players during the window of time when decisions are not being processed.
     *
     * @param userId Player who sent the DM
     * @param text Contents of the DM received
     * @returns Sequence of replies to use to reply to the DM (empty list means this DM was ignored)
     */
    handleNonDecisionDM(userId: Snowflake, text: string): string[] {
        return [];
    }

    getState(): T {
        return this.state;
    }

    getTurn(): number {
        return this.state.turn;
    }

    isSeasonComplete(): boolean {
        return this.getWinners().length === 3;
    }

    getWinners(): Snowflake[] {
        return this.state.winners.slice(0, 3);
    }

    protected addWinner(userId: Snowflake): boolean {
        if (!this.state.winners.includes(userId)) {
            this.state.winners.push(userId);
            return true;
        }
        return false;
    }

    protected async loadImage(key: string): Promise<canvas.Image> {
        if (key in this.imageCache) {
            return this.imageCache[key];
        }

        try {
            const image = await canvas.loadImage(key);
            this.imageCache[key] = image;
            return image;
        } catch (err) {
            if (key !== AbstractGame.BROKEN_IMAGE_PATH) {
                return this.loadImage(AbstractGame.BROKEN_IMAGE_PATH);
            }
            throw err;
        }
    }
}
