import { GuildMember } from "discord.js";
import { ArenaGameState, DecisionProcessingResult, PrizeType } from "../types";
import AbstractGame from "./abstract-game";

export default class ArenaGame extends AbstractGame<ArenaGameState> {

    static create(members: GuildMember[]): ArenaGame {
        return new ArenaGame({
            type: 'ARENA_GAME_STATE',
            decisions: {},
            turn: 0,
            winners: []
        });
    }

    getSeasonCompletion(): number {
        throw new Error("Method not implemented.");
    }
    getPlayers(): string[] {
        throw new Error("Method not implemented.");
    }
    getOrderedPlayers(): string[] {
        throw new Error("Method not implemented.");
    }
    hasPlayer(userId: string): boolean {
        throw new Error("Method not implemented.");
    }
    addPlayer(member: GuildMember): string {
        throw new Error("Method not implemented.");
    }
    updatePlayer(member: GuildMember): void {
        throw new Error("Method not implemented.");
    }
    removePlayer(userId: string): void {
        throw new Error("Method not implemented.");
    }
    renderState(options?: { showPlayerDecision?: string | undefined; admin?: boolean | undefined; season?: number | undefined; } | undefined): Promise<Buffer> {
        throw new Error("Method not implemented.");
    }
    beginTurn(): string[] {
        throw new Error("Method not implemented.");
    }
    getPoints(userId: string): number {
        throw new Error("Method not implemented.");
    }
    addPoints(userId: string, points: number): void {
        throw new Error("Method not implemented.");
    }
    awardPrize(userId: string, type: PrizeType, intro: string): string[] {
        throw new Error("Method not implemented.");
    }
    getWeeklyDecisionDMs(): Record<string, string> {
        throw new Error("Method not implemented.");
    }
    addPlayerDecision(userId: string, text: string): string {
        throw new Error("Method not implemented.");
    }
    processPlayerDecisions(): DecisionProcessingResult {
        throw new Error("Method not implemented.");
    }

    constructor(state: ArenaGameState) {
        super(state);
    }
}