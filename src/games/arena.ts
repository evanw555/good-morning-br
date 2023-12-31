import { GuildMember } from "discord.js";
import { ArenaGameState, DecisionProcessingResult, GamePlayerAddition, MessengerPayload, PrizeType } from "../types";
import AbstractGame from "./abstract-game";

export default class ArenaGame extends AbstractGame<ArenaGameState> {

    static create(members: GuildMember[], season: number): ArenaGame {
        return new ArenaGame({
            type: 'ARENA_GAME_STATE',
            season,
            winners: [],
            decisions: {},
            turn: 0
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
    addLatePlayers(players: GamePlayerAddition[]): MessengerPayload[] {
        throw new Error("Method not implemented.");
    }
    updatePlayer(member: GuildMember): void {
        throw new Error("Method not implemented.");
    }
    removePlayer(userId: string): void {
        throw new Error("Method not implemented.");
    }
    renderState(options?: { showPlayerDecision?: string | undefined; admin?: boolean | undefined } | undefined): Promise<Buffer> {
        throw new Error("Method not implemented.");
    }
    beginTurn(): Promise<MessengerPayload[]> {
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
    addPlayerDecision(userId: string, text: string): Promise<MessengerPayload> {
        throw new Error("Method not implemented.");
    }
    processPlayerDecisions(): Promise<DecisionProcessingResult> {
        throw new Error("Method not implemented.");
    }

    constructor(state: ArenaGameState) {
        super(state);
    }
}