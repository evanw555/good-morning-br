import { GuildMember, Snowflake } from "discord.js";
import { GameState } from "../types";

export default abstract class AbstractGame<T extends GameState> {
    protected readonly state: T;

    constructor(state: T) {
        this.state = state;
    }

    abstract getIntroductionText(): string
    abstract getInstructionsText(): string
    abstract hasPlayer(userId: Snowflake): boolean
    abstract addPlayer(member: GuildMember): string
    abstract isSeasonComplete(): boolean
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
}
