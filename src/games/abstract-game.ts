import { GuildMember, Snowflake } from "discord.js";
import { GameState } from "../types";

export default abstract class AbstractGame<T extends GameState> {
    protected readonly state: T;

    constructor(state: T) {
        this.state = state;
    }

    abstract hasPlayer(userId: Snowflake): boolean
    abstract addPlayer(member: GuildMember): void
    abstract isSeasonComplete(): boolean
    abstract renderState(): Promise<Buffer>
    abstract beginTurn(): void
    abstract getPoints(userId: Snowflake): number
    abstract addPoints(userId: Snowflake, points: number): void
    abstract addPlayerDecision(userId: Snowflake, text: string): string
    abstract processPlayerDecisions(): { summary: string, continueProcessing: boolean }

    getState(): T {
        return this.state;
    }
}
