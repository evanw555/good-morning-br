import canvas from "canvas";
import { GuildMember, Snowflake } from "discord.js";
import { GameState } from "../types";

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

    abstract getIntroductionText(): string
    abstract getInstructionsText(): string
    abstract hasPlayer(userId: Snowflake): boolean
    abstract addPlayer(member: GuildMember): string
    abstract updatePlayer(member: GuildMember): void
    abstract renderState(options?: { showPlayerDecision?: Snowflake, admin?: boolean }): Promise<Buffer>
    abstract getTurn(): number
    abstract beginTurn(): void
    abstract getPoints(userId: Snowflake): number
    abstract addPoints(userId: Snowflake, points: number): void
    abstract addPlayerDecision(userId: Snowflake, text: string): string
    abstract processPlayerDecisions(): { summary: string, continueProcessing: boolean }

    getState(): T {
        return this.state;
    }

    isSeasonComplete(): boolean {
        return this.getWinners().length === 3;
    }

    getWinners(): Snowflake[] {
        return this.state.winners.slice(0, 3);
    }

    protected addWinner(userId: Snowflake): void {
        if (!this.state.winners.includes(userId)) {
            this.state.winners.push(userId);
        }
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
