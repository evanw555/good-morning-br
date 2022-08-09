import { Snowflake } from "discord.js";
import { GameState } from "../types";

export default abstract class AbstractGame<T extends GameState> {
    protected readonly state: T;

    constructor(state: T) {
        this.state = state;
    }

    abstract isSeasonComplete(): boolean
    abstract renderState(): Promise<Buffer>
    abstract addPlayerDecision(userId: Snowflake, text: string): string
    abstract processPlayerDecisions(): void

    getState(): T {
        return this.state;
    }
}
