import canvas from 'canvas';
import { GuildMember, Snowflake } from "discord.js";
import { DecisionProcessingResult, MasterpieceGameState, MasterpiecePieceState, MasterpiecePlayerState, PrizeType } from "../types";
import AbstractGame from "./abstract-game";
import { shuffle, toFixed, toLetterId } from "evanw555.js";

import logger from "../logger";
import imageLoader from '../image-loader';

export default class MasterpieceGame extends AbstractGame<MasterpieceGameState> {
    constructor(state: MasterpieceGameState) {
        super(state);
    }

    static create(members: GuildMember[]): MasterpieceGame {
        // Initialize all players
        const players: Record<Snowflake, MasterpiecePlayerState> = {};
        for (const member of members) {
            players[member.id] = {
                displayName: member.displayName,
                points: 0
            };
        }
        // Initialize all pieces with random values
        const pieceValues = this.getPieceValues();
        shuffle(pieceValues);
        const totalNumPieces = pieceValues.length;
        const pieces: Record<string, MasterpiecePieceState> = {};
        for (let i = 0; i < totalNumPieces; i++) {
            const pieceId = toLetterId(i);
            pieces[pieceId] = {
                name: `Piece ${pieceId}`,
                value: pieceValues[i],
                owner: false
            };
        }
        // Determine how many initial pieces to dole out
        const numBankAuctions = 10;
        const maxInitialPieces = Math.min(members.length, totalNumPieces - numBankAuctions);
        // Dole out free pieces to the first N players (in order of first week performance)
        for (let i = 0; i < maxInitialPieces; i++) {
            const userId = members[i].id;
            const pieceId = toLetterId(i);
            pieces[pieceId].owner = userId;
        }
        return new MasterpieceGame({
            type: 'MASTERPIECE_GAME_STATE',
            decisions: {},
            turn: 0,
            winners: [],
            players,
            pieces
        });
    }

    private static getPieceValues(): number[] {
        return [
            50,
            40, 40,
            30, 30, 30,
            25, 25, 25, 25,
            20, 20, 20, 20,
            15, 15, 15, 15,
            10, 10, 10, 10,
            5, 5, 5,
            0, 0
        ]
    }

    private getPieces(): MasterpiecePieceState[] {
        return Object.values(this.state.pieces);
    }

    private getNumPieces(): number {
        return Object.keys(this.state.pieces).length;
    }

    private getNumSoldPieces(): number {
        return Object.values(this.state.pieces).filter(p => p.owner === true).length;
    }

    private getNumUnsoldPieces(): number {
        return this.getNumPieces() - this.getNumSoldPieces();
    }

    private getNumAvailablePieces(): number {
        return Object.values(this.state.pieces).filter(p => p.owner === false).length;
    }

    private getNumUnavailablePieces(): number {
        return this.getNumPieces() - this.getNumAvailablePieces();
    }

    private getNumOwnedPieces(): number {
        return Object.values(this.state.pieces).filter(p => typeof p.owner === 'string').length;
    }

    override getSeasonCompletion(): number {
        // Once all pieces are either owned/sold, the game is considered "complete"
        return this.getNumUnavailablePieces() / this.getNumPieces();
    }

    override getPlayers(): string[] {
        return Object.keys(this.state.players);
    }

    override getOrderedPlayers(): string[] {
        // TODO: Order players
        return this.getPlayers();
    }

    override hasPlayer(userId: string): boolean {
        return userId in this.state.players;
    }

    override addPlayer(member: GuildMember): string {
        if (member.id in this.state.players) {
            void logger.log(`Refusing to add **${member.displayName}** to the masterpiece state, as they're already in it!`);
            return `Cannot add **${member.displayName}** (already in-game)`;
        }
        this.state.players[member.id] = {
            displayName: member.displayName,
            points: 0
        };
        return `Added ${member.displayName}`;
    }

    override updatePlayer(member: GuildMember): void {
        if (this.hasPlayer(member.id)) {
            this.state.players[member.id].displayName = member.displayName;
        }
    }

    override removePlayer(userId: string): void {
        if (this.hasPlayer(userId)) {
            delete this.state.players[userId];
            // Make all their paintings available
            // TODO: Is this what we wanna do?
            for (const piece of this.getPiecesForUser(userId)) {
                piece.owner = false;
            }
        }
    }

    private getPiece(pieceId: string): MasterpiecePieceState {
        return this.state.pieces[pieceId];
    }

    private getPieceIdsForUser(userId: string): string[] {
        return Object.entries(this.state.pieces).filter(([id, piece]) => piece.owner === userId).map(([id, piece]) => id);
    }

    private getPiecesForUser(userId: string): MasterpiecePieceState[] {
        return this.getPieceIdsForUser(userId).map(pieceId => this.state.pieces[pieceId]);
    }

    /**
     * @returns The sum value of all pieces in the game, regardless of piece status/owner
     */
    private getSumValueOfPieces(): number {
        return this.getPieces().map(p => p.value).reduce((a, b) => a + b, 0);
    }

    /**
     * @returns The average value of all pieces in the game, regardless of piece status/owner
     */
    private getAveragePieceValue(): number {
        return this.getSumValueOfPieces() / this.getNumPieces();
    }

    override async renderState(options?: { showPlayerDecision?: string | undefined; seasonOver?: boolean | undefined; admin?: boolean | undefined; season?: number | undefined; } | undefined): Promise<Buffer> {
        // TODO: Do something real here
        const WIDTH = 200;
        const ROW_HEIGHT = 32;
        const HEIGHT = ROW_HEIGHT * this.getNumPieces();
        const c = canvas.createCanvas(WIDTH, HEIGHT);
        const context = c.getContext('2d');

        // Draw info about each piece
        let baseY = 0;
        for (const piece of this.getPieces()) {
            context.fillStyle = 'black';
            context.font = '20px sans serif';
            context.fillText(`${piece.name} $${piece.value}`, 0, baseY + ROW_HEIGHT);
            // Show owner if any
            if (typeof piece.owner === 'string') {
                const avatar = await imageLoader.loadAvatar(piece.owner, 32);
                context.drawImage(avatar, 100, baseY, ROW_HEIGHT, ROW_HEIGHT);
            }
            baseY += ROW_HEIGHT;
        }

        return c.toBuffer();
    }

    override beginTurn(): string[] {
        // TODO: Do something here
        return [];
    }

    override getPoints(userId: string): number {
        return this.state.players[userId]?.points ?? 0;
    }

    override addPoints(userId: string, points: number): void {
        if (isNaN(points)) {
            throw new Error('Cannot award NaN points!');
        }
        if (!this.hasPlayer(userId)) {
            throw new Error(`Player ${userId} not in-game, can't award points!`);
        }
        this.state.players[userId].points = toFixed(this.getPoints(userId) + points);
    }

    override awardPrize(userId: string, type: PrizeType, intro: string): string[] {
        // TODO: Handle this e.g. submissions1 winner gets to choose what is forced into auction
        return [];
    }

    override addPlayerDecision(userId: string, text: string): string {
        // TODO: Do something here
        return 'OK cool';
    }

    override processPlayerDecisions(): DecisionProcessingResult {
        // TODO: Do something here
        return {
            continueProcessing: false,
            summary: 'Nothing happened'
        };
    }
}