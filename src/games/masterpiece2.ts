import canvas, { Canvas, CanvasRenderingContext2D } from 'canvas';
import { ActionRowData, APIButtonComponent, AttachmentBuilder, ButtonInteraction, ButtonStyle, ComponentType, GuildMember, Interaction, MessageActionRowComponentData, MessageFlags, Snowflake } from "discord.js";
import { DecisionProcessingResult, GamePlayerAddition, MessengerManifest, MessengerPayload, PrizeType } from "../types";
import AbstractGame from "./abstract-game";
import { capitalize, getObjectSize, getRandomlyDistributedAssignments, groupByProperty, incrementProperty, isObjectEmpty, naturalJoin, randChoice, shuffle, toFixed, toLetterId, } from "evanw555.js";
import { cropToSquare, getTextLabel, joinCanvasesHorizontal, toCircle, withDropShadow } from "node-canvas-utils";
import { text } from '../util';
import { Masterpiece2PlayerState, Masterpiece2PieceState, Masterpiece2GameState, Masterpiece2AuctionType, Masterpiece2ItemType, Masterpiece2AuctionState } from './types';

import logger from "../logger";
import imageLoader from '../image-loader';
import dmReplyCollector from '../dm-reply-collector';
import controller from '../controller';

type VoteRank = 'most' | 'second' | 'least';

const VOTE_RANK_NAMES: Record<VoteRank, string> = {
    most: 'favorite',
    second: 'second favorite',
    least: 'most HATED'
};
const ALL_VOTE_RANKS = Object.keys(VOTE_RANK_NAMES);
const NUM_VOTE_RANKS = ALL_VOTE_RANKS.length;

// TODO(2): IMPORTANT TODOS:
// 1. Actually implement some of the item code
// 2. Implement a timer so that player reward choosers don't run the clock out
// 3. Enforce some sort of cap on how many pieces will be in the game? Or a minimum?

// If true, this item type will be wiped each week at the beginning of the decision phase
const TEMPORARY_ITEMS: Record<Masterpiece2ItemType, boolean> = {
    "random-peek": false,
    "sneaky-peek": false,
    buy: true,
    force: true,
    sell: true,
    smudge: true
};

const ITEM_NAMES: Record<Masterpiece2ItemType, string> = {
    "random-peek": 'Random Peek',
    "sneaky-peek": 'Sneaky Peek',
    buy: 'Buy Piece',
    force: 'Force Auction',
    sell: 'Sell Piece',
    smudge: 'Smudge Piece'
};

const ITEM_DESCRIPTIONS: Record<Masterpiece2ItemType, string> = {
    "random-peek": 'Peek at the value of one random piece in the game',
    "sneaky-peek": 'Peek at the value of any piece of your choice',
    buy: 'Buy one piece directly from the bank for an average price',
    force: 'Force any opponent\'s piece of your choice into a private auction this week',
    sell: 'Sell any piece directly to the bank for its listed value',
    smudge: 'Smudge a piece, anyone who peeks at it will see a random lower value yet know it\'s smudged'
};

export default class Masterpiece2Game extends AbstractGame<Masterpiece2GameState> {
    private static MAX_PIECES_BY_ARTIST = 3;
    private auctionLock: boolean = false;
    private uploadLock: boolean = false;

    constructor(state: Masterpiece2GameState) {
        super(state);
    }

    static create(members: GuildMember[], season: number): Masterpiece2Game {
        // Initialize all players
        const players: Record<Snowflake, Masterpiece2PlayerState> = {};
        for (const member of members) {
            players[member.id] = {
                displayName: member.displayName,
                points: 0
            };
        }
        return new Masterpiece2Game({
            type: 'MASTERPIECE_2',
            season,
            winners: [],
            decisions: {},
            turn: 0,
            players,
            pieces: {},
            auctions: {}
        });
    }

    private static getPieceValues(): number[] {
        return [
            50,
            40, 40,
            30, 30, 30,
            25, 25, 25, 25,
            20, 20, 20, 20, 20,
            15, 15, 15, 15,
            10, 10, 10,
            5,  5,  5,
            0,  0,  0,  0,  0,  0
        ];
    }

    private static constructValueDistribution(n: number): number[] {
        // TODO(2): Is there a better way to construct this?
        const POSSIBLE_VALUES = [
            // Start by uniformly adding every possible value
            15, 30, 0,  20, 10, 25, 5, 40, 50,
            // Add a lump from 0-25 from the middle outward
            15, 10, 20, 5,  0,  25,
            // Add a smaller lump from 10-20 from the middle outward
            15, 10, 20,
            // Move the curve upward by adding 25-30, add tiny lump from 15-20, fill in 0
            30, 25, 15, 20, 0,
            // Move the curve upward again by adding 25-40, add extra 0
            40, 30, 25, 0,
            // Add crown at the tip of the curve at 20, fill in chasm at 5, add extra 0
            20, 5,  0,
            // Add one final 0 for hilarity
            0
        ];
        // First, fill the distribution using the above ordering
        const result = POSSIBLE_VALUES.slice(0, n);
        // If we're still short, just start adding random values
        while (result.length < n) {
            result.push(randChoice(...Array.from(new Set(POSSIBLE_VALUES))));
        }
        // Sort the list descending and return
        return result.sort((x, y) => y - x);
    }

    private static getAuctionTypes(): Masterpiece2AuctionType[] {
        return ['bank', 'private'];
    }

    private getPieces(): Masterpiece2PieceState[] {
        return Object.values(this.state.pieces);
    }

    /**
     * @returns IDs of all pieces in the game.
     */
    private getPieceIds(): string[] {
        return Object.keys(this.state.pieces);
    }

    private hasPieceWithId(pieceId: string): boolean {
        return pieceId in this.state.pieces;
    }

    /**
     * WARNING: You must use a lock when using this method, as it may result in ID collision.
     * @returns The lowest unused piece ID.
     */
    private getNextUnusedPieceId(): string {
        let i = 0;
        // Determine the next available piece ID
        while (this.hasPieceWithId(toLetterId(i))) {
            i++;
        }
        return toLetterId(i);
    }

    private getNumPieces(): number {
        return Object.keys(this.state.pieces).length;
    }

    /**
     * @returns IDs of pieces that are ownerless and removed from the game.
     */
    private getSoldPieceIds(): string[] {
        return Object.keys(this.state.pieces).filter(id => this.state.pieces[id].owner === true);
    }

    private getNumSoldPieces(): number {
        return this.getSoldPieceIds().length;
    }

    /**
     * @returns IDs of pieces that are unsold (still in play or yet-to-be in play)
     */
    private getUnsoldPieceIds(): string[] {
        return Object.keys(this.state.pieces).filter(id => this.state.pieces[id].owner !== true);
    }

    private getNumUnsoldPieces(): number {
        return this.getUnsoldPieceIds().length;
    }

    /**
     * @returns IDs of pieces that are available (ownerless and ready to be auctioned off to players)
     */
    private getAvailablePieceIds(): string[] {
        return Object.keys(this.state.pieces).filter(id => this.state.pieces[id].owner === false);
    }

    private getNumAvailablePieces(): number {
        return this.getAvailablePieceIds().length;
    }

    /**
     * @returns The number of pieces that aren't available to be auctioned off (currently owned by a player or out of play)
     */
    private getNumUnavailablePieces(): number {
        return this.getNumPieces() - this.getNumAvailablePieces();
    }

    /**
     * @returns The number of pieces currently owned by a player.
     */
    private getNumOwnedPieces(): number {
        return Object.values(this.state.pieces).filter(p => typeof p.owner === 'string').length;
    }

    override async getIntroductionMessages(): Promise<MessengerPayload[]> {
        return [
            'I\'m sure you all remember the _Masterpiece_ Art Auction, well get ready for _Masterpiece 2: Auctionhouse Anarchy_!',
            'Similar to the original game, you will use your coveted GMBR dollars to bid on pieces of art',
            'In this twist, however all the pieces will be uploaded by YOU and their values will be determined via a confidential vote',
            'In addition, new meddling mechanics have been introduced - such as the ability to peek at the value of other pieces 👀',
            {
                content: 'Please read over the rules of the game',
                files: [await this.renderRules()]
            }
        ];
    }

    override getInstructionsText(): string {
        // During the first week, players should be instructed to upload images
        if (this.getTurn() === 1) {
            return 'This week, everyone will be uploading their own pieces of art. Those who contribute will be rewarded with one free starter piece! You have until tomorrow morning to come up with something.';
        }
        // Auctions begin on the second week
        if (this.getTurn() === 2) {
            return 'The very first auction begins at mid-morning!';
        }
        // If for some reason there aren't any pieces available (this shouldn't happen), then handle gracefully...
        if (this.getNumAvailablePieces() === 0) {
            return 'There won\'t be a bank auction today, as there are no pieces remaining in the bank';
        }
        return 'Today\'s auction begins at mid-morning!';
    }

    override getDecisionPhases(): { key: string, along: number }[] {
        // Do nothing the first week
        if (this.getTurn() === 1) {
            return [];
        }

        // Schedule a decision phase for each queued auction
        // TODO: Should this somehow be relative? "along" until pre-noon?
        return this.getAuctions().map((a, i) => ({
            key: `beginAuction:${a.pieceId}`,
            // e.g. 1st auction is halfway to pre-noon, 2nd is 3/4 to pre-noon, 3rd is 7/8 to pre-noon, etc.
            along: 1 - (1 / Math.pow(2, i + 1))
                // Add a random variance of +/- 1/40
                + ((Math.random() - 0.5) / 20)
        }));
    }

    override async onDecisionPhase(key: string): Promise<MessengerPayload[]> {
        const [root, arg] = key.split(':');
        // Start a particular queued-up auction
        if (root === 'beginAuction') {
            const pieceId = arg;
            const auction = this.state.auctions[pieceId];
            // If somehow there is no auction with that ID, log and abort...
            if (!auction) {
                void logger.log(`Cannot start auction with ID \`${pieceId}\`, it doesn't exist!`);
                return [];
            }
            // Mark it as active to begin!
            auction.active = true;
            // Introduce the piece and prompt players to bid
            return [
                auction.type === 'bank'
                    ? 'For today\'s bank auction, I present to you...'
                    // TODO(2): Since this can be any of the winners, specify which one
                    : `Oh dear! It looks like this week\'s contest winner has chosen to force one of **${this.getPieceOwnerString(auction.pieceId)}'s** pieces into auction...`,
                {
                    files: [await this.renderAuction(pieceId, auction.description, auction.type)]
                },
                {
                    content: 'Do we have any bidders? Let\'s start with **$1**',
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.Button,
                            style: ButtonStyle.Success,
                            label: 'Bid',
                            custom_id: `game:bid:${auction.pieceId}`
                        }]
                    }]
                }
            ];
        }
        return [];
    }

    override async onDecisionPreNoon(): Promise<MessengerManifest> {
        const responseDMs: Record<Snowflake, MessengerPayload[]> = {};
        const responseMessages: MessengerPayload[] = [];

        // If still in the setup phase...
        if (this.state.setup) {
            // If voting hasn't started yet, urge users to upload art
            if (!this.state.setup.voting) {
                return {
                    public: [{
                        content: 'You have until tomorrow to upload your own art! You can upload art, funny pics, honey pics, anything. Those who upload something will be rewarded with a free starter piece',
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.Button,
                                custom_id: 'game:upload',
                                label: 'Upload',
                                style: ButtonStyle.Primary
                            }]
                        }]
                    }]
                };
            }
            // Otherwise, do nothing
            return {};
        }

        // Process the active auctions
        for (const auction of this.getAuctions()) {
            const { pieceId, description, bid, bidder, type, active, forcedBy } = auction;
            // Mark as inactive to prevent futher action
            delete auction.active;
            // Clear the auction to double-prevent further action
            delete this.state.auctions[pieceId];
            // If the piece was somehow never activated (can happen due to outages), don't post anything about this piece
            if (!active) {
                void logger.log(`WARNING: ${type} auction for piece _"${this.getPieceName(pieceId)}"_ was never activated`);
                // If the piece was forced by someone, refund their force item
                if (forcedBy) {
                    this.incrementPlayerItem(forcedBy, 'force', 1);
                    void logger.log(`Refunded force item to forcer **${this.getPlayerDisplayName(forcedBy)}**`);
                    // Notify the player
                    responseDMs[forcedBy] = [`Since _"${this.getPieceName(pieceId)}"_ somehow failed to be forced into auction this week, I've refunded your **${ITEM_NAMES['force']}** item. Sorry about that...`];
                }
            }
            // If the piece was bidded on, finalize the auction
            else if (bidder) {
                // If the piece belonged to another player, add points to their balance
                const previousOwnerId = this.getPieceOwner(pieceId);
                if (typeof previousOwnerId === 'string') {
                    this.addPoints(previousOwnerId, bid);
                }
                // Assign the piece to this owner
                this.getPiece(pieceId).owner = bidder;
                // Deduct points from the player
                this.addPoints(bidder, -bid);
                // If this piece was flagged for sale, clear that
                // TODO: Should the previous owner be notified? Need to change the return type to a messenger manifest
                delete this.getPiece(pieceId).toBeSold;
                // Reply with appropriate message
                responseMessages.push({
                    content: `<@${bidder}> has won the auction for _"${this.getPieceName(pieceId)}"_ with a bid of **$${bid}**!`,
                    files: [await this.renderAuction(pieceId, description, type)],
                    components: this.getDecisionActionRow()
                });
            }
            // Else, point out that nobody bidded on the piece
            else {
                // Reply with appropriate message
                responseMessages.push({
                    content: `No one bid on _"${this.getPieceName(pieceId)}"_! What??? I guess we'll save that one for another day...`
                });
            }
        }

        // Begin the silent auction (if not in the midst of the setup process)
        if (!this.state.setup && this.getNumAvailablePieces() > 0) {
            // Update the state to prepare the silent auction
            const pieceId = randChoice(...this.getAvailablePieceIds());
            this.state.silentAuctionPieceId = pieceId;
            // Reply with appropriate message
            responseMessages.push(
                'As an additional treat, I\'d like to sell a piece from the bank collection. I present to you...',
                {
                    files: [await this.renderAuction(pieceId, 'Silent Auction', 'silent')]
                },
                {
                    content: 'If you\'d like to purchase this piece, please make an offer! I\'ll be accepting the highest offer I see tomorrow morning when I wake up...',
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.Button,
                            style: ButtonStyle.Success,
                            label: 'Make an Offer',
                            customId: 'spawnDecisionModal:offer'
                        }]
                    }]
                })
        }

        return {
            public: responseMessages,
            dms: responseDMs
        };
    }

    override getSeasonCompletion(): number {
        // Once all pieces are either owned/sold, the game is considered "complete"
        return this.getNumUnavailablePieces() / this.getNumPieces();
    }

    override getPlayers(): string[] {
        return Object.keys(this.state.players);
    }

    override getOrderedPlayers(): Snowflake[] {
        // This is the public ordering, so only use ASSUMED player wealth
        return this.getPlayers().sort((x, y) => this.getAssumedPlayerWealth(y) - this.getAssumedPlayerWealth(x));
    }

    private getTrueOrderedPlayers(): Snowflake[] {
        // This is only used at the end to determine the winners, NEVER show this to the players before then
        return this.getPlayers().sort((x, y) => this.getTruePlayerWealth(y) - this.getTruePlayerWealth(x));
    }

    override hasPlayer(userId: string): boolean {
        return userId in this.state.players;
    }

    override addLatePlayers(players: GamePlayerAddition[]): MessengerPayload[] {
        const userIds: Snowflake[] = [];
        for (const { userId, displayName, points } of players) {
            if (userId in this.state.players) {
                void logger.log(`Refusing to add **${displayName}** to the masterpiece state, as they're already in it!`);
                continue;
            }
            this.state.players[userId] = {
                displayName,
                points
            };
            userIds.push(userId);
        }
        return this.getStandardWelcomeMessages(userIds);
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

    private getPlayerDisplayName(userId: Snowflake): string {
        return this.state.players[userId]?.displayName ?? '???';
    }

    private getJoinedDisplayNames(userIds: Snowflake[]): string {
        return naturalJoin(userIds.map(id => this.getPlayerDisplayName(id)), { bold: true });
    }

    private getPlayerItems(userId: Snowflake): Partial<Record<Masterpiece2ItemType, number>> {
        return this.state.players[userId]?.items ?? {};
    }

    private hasAnyItems(userId: Snowflake): boolean {
        // TODO(2): This doesn't work if one of the entries is 0
        return !isObjectEmpty(this.getPlayerItems(userId));
    }

    private getPlayerItemQuantity(userId: Snowflake, itemType: Masterpiece2ItemType): number {
        return this.getPlayerItems(userId)[itemType] ?? 0;
    }

    private hasItem(userId: Snowflake, itemType: Masterpiece2ItemType): boolean {
        return this.getPlayerItemQuantity(userId, itemType) > 0;
    }

    private incrementPlayerItem(userId: Snowflake, itemType: Masterpiece2ItemType, amount: number) {
        const player = this.state.players[userId];
        if (!player) {
            void logger.log(`Tried to add ${amount} **${ITEM_NAMES[itemType] ?? itemType}** for nonexistent player <@${userId}>, aborting...`);
            return;
        }
        // Initialize the items map if missing
        if (!player.items) {
            player.items = {};
        }
        // TODO(2): Update utility to accept partial records
        incrementProperty(player.items as Record<Masterpiece2ItemType, number>, itemType, amount);
        // Delete the items map if now empty
        if (isObjectEmpty(player.items)) {
            delete player.items;
        }
    }

    private getPlayerItemsString(userId: Snowflake): string {
        const player = this.state.players[userId];
        if (!player || !player.items) {
            return 'nothing';
        }
        return naturalJoin(Object.entries(player.items).map(([itemType, quantity]) => (quantity === 1 ? 'a' : `x${quantity}`) + ` **${ITEM_NAMES[itemType] ?? itemType}**`));
    }

    private mayPlayerSell(userId: Snowflake): boolean {
        return this.getPlayerItemQuantity(userId, 'sell') > 0;
    }

    private mayPlayerForcePrivateAuction(userId: Snowflake): boolean {
        return this.getPlayerItemQuantity(userId, 'force') > 0;
    }

    private getNumCompleteVoters(): number {
        if (!this.state.setup?.voting) {
            return 0;
        }
        return Object.values(this.state.setup.voting).filter(v => getObjectSize(v.picks) === NUM_VOTE_RANKS).length;
    }

    private getRemainingVoters(): Snowflake[] {
        if (!this.state.setup?.voting) {
            return [];
        }
        return Object.entries(this.state.setup.voting)
            .filter(([userId, v]) => getObjectSize(v.picks) < NUM_VOTE_RANKS)
            .map(([userId, v]) => userId);
    }

    private getNumRemainingVoters(): number {
        return this.getRemainingVoters().length;
    }

    private getPiece(pieceId: string): Masterpiece2PieceState {
        return this.state.pieces[pieceId];
    }

    private getPieceName(pieceId: string): string {
        return this.getPiece(pieceId)?.name ?? '???';
    }

    private getPieceImageUrl(pieceId: string): string {
        // TODO: Is there a more elegant way to handle missing URLs?
        return this.getPiece(pieceId)?.imageUrl ?? '???';
    }

    private getPieceValue(pieceId: string): number {
        return this.getPiece(pieceId)?.value ?? 0;
    }

    private getPieceArtist(pieceId: string): Snowflake {
        return this.getPiece(pieceId).artist;
    }

    private getPieceIdsByArtist(userId: Snowflake): string[] {
        return this.getPieceIds().filter(id => this.getPieceArtist(id) === userId);
    }

    private getPiecesByArtist(userId: Snowflake): Masterpiece2PieceState[] {
        return this.getPieces().filter(piece => piece.artist === userId);
    }

    private getNumPiecesByArtist(userId: Snowflake): number {
        return this.getPiecesByArtist(userId).length;
    }

    private getPieceIdsForUser(userId: Snowflake): string[] {
        return Object.entries(this.state.pieces).filter(([id, piece]) => piece.owner === userId).map(([id, piece]) => id);
    }

    private getNumPiecesForUser(userId: Snowflake): number {
        return this.getPieceIdsForUser(userId).length;
    }

    private getPieceIdsForOtherUsers(userId: Snowflake): string[] {
        return Object.entries(this.state.pieces).filter(([id, piece]) => typeof piece.owner === 'string' && piece.owner !== userId).map(([id, piece]) => id);
    }

    private getPiecesForUser(userId: Snowflake): Masterpiece2PieceState[] {
        return this.getPieceIdsForUser(userId).map(pieceId => this.state.pieces[pieceId]);
    }

    private hasAnyPieces(userId: Snowflake): boolean {
        return this.getPieceIdsForUser(userId).length > 0;
    }

    private getPieceOwner(pieceId: Snowflake): string | boolean {
        return this.getPiece(pieceId).owner;
    }

    private getPieceOwnerString(pieceId: Snowflake): string {
        const owner = this.getPieceOwner(pieceId);
        if (owner === false) {
            return 'the bank';
        }
        if (owner === true) {
            return 'the museum';
        }
        return this.getPlayerDisplayName(owner);
    }

    private getPieceIdsToBeSold(): string[] {
        return this.getPieceIds().filter(id => this.getPiece(id).toBeSold);
    }

    private getPieceIdsWithValue(value: number): string[] {
        return this.getPieceIds().filter(id => this.getPieceValue(id) === value);
    }

    /**
     * @returns The sum value of all pieces in the game, regardless of piece status/owner
     */
    private getSumValueOfPieces(): number {
        return this.getPieces().map(p => p.value).reduce((a, b) => a + b, 0);
    }

    /**
     * @returns The sum value of all unsold pieces in the game
     */
    private getSumValueOfUnsoldPieces(): number {
        return this.getUnsoldPieceIds().map(id => this.getPieceValue(id)).reduce((a, b) => a + b, 0);
    }

    /**
     * @returns The average value of all pieces in the game, regardless of piece status/owner
     */
    private getAveragePieceValue(): number {
        return this.getSumValueOfPieces() / this.getNumPieces();
    }

    /**
     * @returns The values of all pieces, in descending order (duplicates included).
     */
    private getSortedPieceValues(): number[] {
        return this.getPieces()
            .map(p => p.value)
            .sort((x, y) => y - x);
    }

    /**
     * @returns The values of all pieces, in descending order (NOT including duplicates).
     */
    private getSortedUniquePieceValues(): number[] {
        return Array.from(new Set(this.getSortedPieceValues()))
            .sort((x, y) => y - x);
    }

    /**
     * @returns The highest occurrence of any given piece value (e.g. 5 if there are 5 zero-value pieces, with zero being the most represented value)
     */
    private getMaxPieceValueOccurrence(): number {
        // TODO(2): Write a utility for this maybe?
        return Math.max(...Object.values(groupByProperty(this.getPieces(), 'value')).map(l => l.length));
    }

    /**
     * @returns The average value of all unsold pieces
     */
    private getAverageUnsoldPieceValue(): number {
        if (this.getNumUnsoldPieces() === 0) {
            return 0;
        }
        return this.getSumValueOfUnsoldPieces() / this.getNumUnsoldPieces();
    }

    /**
     * @param userId Some player's user ID
     * @returns The assumed wealth of the player (cash + value of owned pieces assuming they have the average unsold piece value)
     */
    private getAssumedPlayerWealth(userId: Snowflake): number {
        return this.getPoints(userId) + this.getNumPiecesForUser(userId) * this.getAverageUnsoldPieceValue();
    }

    /**
     * @param userId Some player's user ID
     * @returns The true wealth of the player (cash + value of owned pieces)
     */
    private getTruePlayerWealth(userId: Snowflake): number {
        return this.getPoints(userId)
            // Sum up the true value of this player's pieces
            + this.getPieceIdsForUser(userId)
                .map(pieceId => this.getPieceValue(pieceId))
                .reduce((a, b) => a + b, 0);
    }

    /**
     * @param userId The ID of the player
     * @returns The amount this player is currently committing to spend in all existing auctions
     */
    private getPlayerBidLiability(userId: Snowflake): number {
        return Object.values(this.state.auctions)
            .filter(a => a.bidder === userId)
            .map(a => a.bid)
            .reduce((a, b) => a + b, 0);
    }

    private getAuctions(): Masterpiece2AuctionState[] {
        return Object.values(this.state.auctions);
    }

    private getNumAuctions(): number {
        return this.getAuctions().length;
    }

    private isAnyAuctionActive(): boolean {
        return this.getAuctions().some(a => a.active);
    }

    private async drawTextCentered(context: CanvasRenderingContext2D, text: string, left: number, right: number, y: number, options?: { padding?: number }) {
        const titleWidth = context.measureText(text).width;
        const padding = options?.padding ?? 0;
        const areaWidth = right - left - (2 * padding);
        if (titleWidth > areaWidth) {
            context.fillText(text, left + padding, y, areaWidth);
        } else {
            context.fillText(text, left + padding + (areaWidth - titleWidth) / 2, y);
        }
    }

    private async renderLegend(): Promise<Canvas> {
        const uniquePieceValues = this.getSortedUniquePieceValues();
        const rows = 7 + uniquePieceValues.length;
        const ROW_HEIGHT = 32;
        const padding = ROW_HEIGHT / 2;
        const columns = Math.max(5, this.getMaxPieceValueOccurrence());
        const c = canvas.createCanvas(columns * ROW_HEIGHT, rows * ROW_HEIGHT);
        const context = c.getContext('2d');

        // Draw background
        context.fillStyle = 'rgba(0,0,0,0.75)';
        context.fillRect(0, 0, c.width, c.height);

        // Draw the header
        const baseX = padding;
        let baseY = padding;
        context.fillStyle = 'white';
        context.font = 'italic 24px serif';
        this.drawTextCentered(context, 'Piece Values', 0, c.width, baseY + ROW_HEIGHT * 0.6, { padding });
        baseY += 1 * ROW_HEIGHT;

        // Draw top separator
        const topSeparator = await imageLoader.loadImage('assets/masterpiece/design/separator-top.png');
        context.drawImage(topSeparator, padding, baseY, c.width - 2 * padding, ROW_HEIGHT);
        baseY += 1.25 * ROW_HEIGHT;

        // Draw each row
        for (const pieceValue of uniquePieceValues) {
            const pieceIds = this.getPieceIdsWithValue(pieceValue);
            const numUnsold = pieceIds.filter(id => this.getPiece(id).owner !== true).length;
            const numSold = pieceIds.length - numUnsold;
            context.fillText(`$${pieceValue}`, baseX, baseY + ROW_HEIGHT * 0.6, ROW_HEIGHT);
            context.fillText(`${'▣'.repeat(numUnsold)}${'□'.repeat(numSold)}`, baseX + ROW_HEIGHT * 1.5, baseY + ROW_HEIGHT * 0.6, ROW_HEIGHT * 2.5);
            baseY += ROW_HEIGHT;
        }
    
        // Draw top separator
        baseY += 0.25 * ROW_HEIGHT;
        const bottomSeparator = await imageLoader.loadImage('assets/masterpiece/design/separator-bottom.png');
        context.drawImage(bottomSeparator, padding, baseY, c.width - 2 * padding, ROW_HEIGHT);
        baseY += 1.25 * ROW_HEIGHT;

        // Draw footer
        this.drawTextCentered(context, `${this.getNumUnsoldPieces()}/${this.getNumPieces()} In Play`, 0, c.width, baseY + ROW_HEIGHT * 0.6, { padding });
        baseY += ROW_HEIGHT;
        this.drawTextCentered(context, `$${this.getAverageUnsoldPieceValue().toFixed(2)} Avg.`, 0, c.width, baseY + ROW_HEIGHT * 0.6, { padding });
        baseY += ROW_HEIGHT;

        // Draw border of legend
        context.strokeStyle = 'rgb(232,164,4)';
        context.lineWidth = 2;
        context.strokeRect(0, 0, c.width, c.height);

        return c;
    }

    private async renderRules(): Promise<AttachmentBuilder> {
        return new AttachmentBuilder('assets/masterpiece/rules2.png');
    }

    private async renderGallery(pieceIds: string[], background: string, options?: { showAvatars?: boolean, showValues?: boolean }): Promise<AttachmentBuilder> {
        const backgroundImage = await imageLoader.loadImage(`assets/masterpiece/gallery/${background}.png`);
        const c = canvas.createCanvas(backgroundImage.width * pieceIds.length, backgroundImage.height);
        const context = c.getContext('2d');
        const showAvatars = options?.showAvatars ?? false;
        const showValues = options?.showValues ?? true;
        for (let i = 0; i < pieceIds.length; i++) {
            const pieceId = pieceIds[i];
            const baseX = i * backgroundImage.width;
            context.drawImage(backgroundImage, baseX, 0);
            // Draw the painting on the wall
            const pieceImage = await imageLoader.loadImage(this.getPieceImageUrl(pieceId));
            context.drawImage(pieceImage, baseX + 154, 59, 256, 256);
            // Draw text below the piece
            context.drawImage(withDropShadow(getTextLabel(this.getPieceName(pieceId), 250, 40, { font: 'italic 30px serif', style: 'white' }), { expandCanvas: true }), baseX + 157, 369);
            if (showValues) {
                context.drawImage(withDropShadow(getTextLabel(`$${this.getPieceValue(pieceId)}`, 250, 40, { font: '30px serif',  style: 'white' }), { expandCanvas: true }), baseX + 157, 405);
            }
            // If enabled, draw the owner's avatar
            if (showAvatars) {
                const ownerId = this.getPieceOwner(pieceId);
                if (typeof ownerId === 'string') {
                    const avatarImage = withDropShadow(toCircle(await imageLoader.loadAvatar(ownerId, 64)), { expandCanvas: true });
                    context.drawImage(avatarImage, baseX + 40, 369, 85, 85);
                }
            }
        }
        return new AttachmentBuilder(c.toBuffer()).setName(`gallery-${background}.png`);
    }

    private async renderInventory(userId: Snowflake): Promise<AttachmentBuilder> {
        const pieceIds = this.getPieceIdsForUser(userId);
        return await this.renderGallery(pieceIds, 'inventory');
    }

    private async renderAuction(pieceId: string, title: string, imageName: string): Promise<AttachmentBuilder> {
        const bankAuctionImage = await imageLoader.loadImage(`assets/masterpiece/auction/${imageName}.png`);
        const pieceImage = await imageLoader.loadImage(this.getPieceImageUrl(pieceId));
        const c = canvas.createCanvas(1224, 816);
        const context = c.getContext('2d');
        // Draw background and piece image on top of it
        context.drawImage(bankAuctionImage, 0, 0, 1224, 816);
        context.drawImage(pieceImage, 484, 246, 256, 256);

        // Draw text over the image
        context.fillStyle = 'white';
        context.font = '25px serif';
        await this.drawTextCentered(context, `Week ${this.getTurn()} ${title}`, 0, c.width, 35);
        context.font = 'italic 75px serif';
        await this.drawTextCentered(context, `"${this.getPieceName(pieceId)}"`, 0, c.width, 125);

        // Superimpose the legend
        const legendCanvas = await this.renderLegend();
        context.drawImage(legendCanvas, c.width - legendCanvas.width - 32, 214);

        // Show the owner (if it's a player
        const owner = this.getPieceOwner(pieceId);
        if (typeof owner === 'string') {
            const ownerAvatar = toCircle(await imageLoader.loadAvatar(owner, 128));
            const ownerCenterX = 242;
            const ownerCenterY = 374;
            context.drawImage(ownerAvatar, ownerCenterX - 64, ownerCenterY - 64, 128, 128);
            // Write the display name
            context.fillStyle = 'white';
            context.font = 'italic 30px serif';
            await this.drawTextCentered(context, this.getPlayerDisplayName(owner), ownerCenterX - 96, ownerCenterX + 96, ownerCenterY + 96);
            context.font = 'italic 25px serif';
            await this.drawTextCentered(context, 'Owner', ownerCenterX - 96, ownerCenterX + 96, ownerCenterY + 128);
        }

        return new AttachmentBuilder(c.toBuffer()).setName(`${imageName}-auction-week${this.getTurn()}.png`);
    }

    private async renderRoster(): Promise<Canvas> {
        // TODO: Do something real here
        const AVATAR_WIDTH = 32;
        const HORIZONTAL_MARGIN = 16;
        const VERTICAL_MARGIN = 12;
        const ROWS = 4 + this.getNumPlayers();
        const HEIGHT = ROWS * (AVATAR_WIDTH + VERTICAL_MARGIN) + VERTICAL_MARGIN;
        const MAX_INVENTORY_SIZE = Math.max(1, ...this.getPlayers().map(id => this.getNumPiecesForUser(id)));
        const WIDTH = (5 + MAX_INVENTORY_SIZE) * (AVATAR_WIDTH + HORIZONTAL_MARGIN) + HORIZONTAL_MARGIN;
        // const ROW_HEIGHT = 32;
        const c = canvas.createCanvas(WIDTH, HEIGHT);
        const context = c.getContext('2d');

        // Draw background
        // context.fillStyle = 'pink';
        // context.fillRect(0, 0, WIDTH, HEIGHT);

        // Draw the title row
        let baseY = VERTICAL_MARGIN;
        context.fillStyle = 'white';
        context.font = 'italic bold 32px serif';
        this.drawTextCentered(context, `GMBR's Art Auction - Week ${this.getTurn()}`, 0, c.width, AVATAR_WIDTH, { padding: AVATAR_WIDTH });
        baseY += AVATAR_WIDTH + VERTICAL_MARGIN;

        // Draw the banker row
        context.font = 'bold 20px serif';
        {
            let baseX = HORIZONTAL_MARGIN;
            const textY = baseY + (0.7 * AVATAR_WIDTH);
            // Draw banker name
            await this.drawTextCentered(context, 'The Banker', baseX, baseX + AVATAR_WIDTH * 3 + HORIZONTAL_MARGIN, textY);
            baseX += 3 * (AVATAR_WIDTH + HORIZONTAL_MARGIN);
            // Draw banker avatar
            const sunAvatar = await imageLoader.loadImage('assets/sun4.png');
            context.drawImage(sunAvatar, baseX, baseY, AVATAR_WIDTH, AVATAR_WIDTH);
            baseX += AVATAR_WIDTH + HORIZONTAL_MARGIN;
            // Draw remaining piece count
            context.font = '20px sans-serif';
            context.fillText(`x${this.getNumAvailablePieces()}`, baseX, textY, AVATAR_WIDTH);
            baseX += AVATAR_WIDTH + HORIZONTAL_MARGIN;
            // Draw mystery piece icon
            const pieceImage = await imageLoader.loadImage(`assets/masterpiece/mystery.png`);
            context.drawImage(pieceImage, baseX, baseY, AVATAR_WIDTH, AVATAR_WIDTH);
            // Draw frame
            context.strokeStyle = 'rgb(232,164,4)';
            context.lineWidth = 2;
            context.strokeRect(baseX, baseY, AVATAR_WIDTH, AVATAR_WIDTH);
            baseX += AVATAR_WIDTH + HORIZONTAL_MARGIN;
        }
        baseY += AVATAR_WIDTH + VERTICAL_MARGIN;

        // Draw the separator
        const separator = await imageLoader.loadImage('assets/masterpiece/design/separator-middle.png');
        context.drawImage(separator, HORIZONTAL_MARGIN, baseY, c.width - 2 * HORIZONTAL_MARGIN, AVATAR_WIDTH);
        baseY += AVATAR_WIDTH + VERTICAL_MARGIN;

        // Draw each player's inventory
        for (const userId of this.getOrderedPlayers()) {
            let baseX = HORIZONTAL_MARGIN;
            const textY = baseY + (0.7 * AVATAR_WIDTH);
            // Draw player name
            context.font = '20px serif';
            await this.drawTextCentered(context, this.getPlayerDisplayName(userId), baseX, baseX + AVATAR_WIDTH * 3 + HORIZONTAL_MARGIN, textY);
            baseX += 3 * (AVATAR_WIDTH + HORIZONTAL_MARGIN);
            // Draw player avatar
            const avatar = toCircle(await imageLoader.loadAvatar(userId, 32));
            context.drawImage(avatar, baseX, baseY, AVATAR_WIDTH, AVATAR_WIDTH);
            baseX += AVATAR_WIDTH + HORIZONTAL_MARGIN;
            // Draw truncated cash stack
            context.font = '20px sans-serif';
            context.fillText(`$${Math.floor(this.getPoints(userId))}`, baseX, textY, AVATAR_WIDTH);
            baseX += AVATAR_WIDTH + HORIZONTAL_MARGIN;
            // Draw any pieces this player owns
            for (const pieceId of this.getPieceIdsForUser(userId)) {
                const pieceImage = await imageLoader.loadImage(this.getPieceImageUrl(pieceId));
                context.drawImage(pieceImage, baseX, baseY, AVATAR_WIDTH, AVATAR_WIDTH);
                // Draw frame
                context.strokeStyle = 'rgb(232,164,4)';
                context.lineWidth = 2;
                context.strokeRect(baseX, baseY, AVATAR_WIDTH, AVATAR_WIDTH);
                baseX += AVATAR_WIDTH + HORIZONTAL_MARGIN;
            }
            baseY += AVATAR_WIDTH + VERTICAL_MARGIN;
        }

        // If there are any owned pieces, draw the ordering disclaimer at the bottom
        if (this.getNumOwnedPieces() > 0) {
            context.fillStyle = 'white';
            context.font = '11px serif';
            context.fillText(`(Ordered with an assumed value of $${this.getAverageUnsoldPieceValue().toFixed(2)} per piece)`, HORIZONTAL_MARGIN, baseY + (0.7 * AVATAR_WIDTH));
        }

        return c;
    }

    override async renderState(options?: { showPlayerDecision?: string | undefined; seasonOver?: boolean | undefined; admin?: boolean | undefined } | undefined): Promise<Buffer> {
        // Get the legend canvas
        const canvases: Canvas[] = [await this.renderRoster()];
        // Get the roster canvas if there's at least one unsold piece
        if (this.getNumUnsoldPieces() > 0) {
            canvases.push(await this.renderLegend());
        }
        const innerCanvas = joinCanvasesHorizontal(canvases);

        // Create composite canvas
        const margin = Math.floor(Math.max(.05 * innerCanvas.width, .05 * innerCanvas.height));
        const c = canvas.createCanvas(innerCanvas.width + 2 * margin, innerCanvas.height + 2 * margin);
        const context = c.getContext('2d');
        // Draw background
        context.fillStyle = 'black';
        context.fillRect(0, 0, c.width, c.height);
        const borderType = (innerCanvas.height / innerCanvas.width > 1.75) ? 'border-tall' : 'border';
        const border = await imageLoader.loadImage(`assets/masterpiece/design/${borderType}.png`);
        context.drawImage(border, 0, 0, c.width, c.height);
        // Draw the inner canvas
        context.drawImage(innerCanvas, margin, margin);

        return c.toBuffer();
    }

    override async beginTurn(): Promise<MessengerPayload[]> {
        this.state.turn++;
        this.state.decisions = {};

        // Wipe pending rewards data
        delete this.state.pendingRewards;

        // Reset metadata for each player
        for (const userId of this.getPlayers()) {
            const items = this.state.players[userId].items;
            if (items) {
                // Revoke any temporary items the player may have
                for (const itemType of Object.keys(items)) {
                    if (TEMPORARY_ITEMS[itemType]) {
                        delete items[itemType];
                    }
                }
                // If all items have been wiped, delete the map
                if (isObjectEmpty(items)) {
                    delete this.state.players[userId].items;
                }
            }
        }

        // If it's the very first week, prep the setup data
        if (this.getTurn() === 1) {
            this.state.setup = {
                warningsLeft: 3
            };
            return [{
                content: 'Click here to upload your own pieces of art!',
                components: [{
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.Button,
                        custom_id: 'game:upload',
                        label: 'Upload',
                        style: ButtonStyle.Primary
                    }]
                }]
            }];
        }

        const payloads: MessengerPayload[] = [];

        // If it's the second week, process the setup data
        if (this.getTurn() === 2) {
            if (this.state.setup && this.state.setup.voting) {
                // TODO(2): Trim the total set of pieces to a proper number
                // Count up all the votes and assign a total score to each piece
                const pieceScores: Record<string, number> = {};
                for (const pieceId of this.getPieceIds()) {
                    pieceScores[pieceId] = 0;
                }
                for (const entry of Object.values(this.state.setup.voting)) {
                    const { most, second, least } = entry.picks;
                    if (most) {
                        pieceScores[most] += 2;
                    }
                    if (second) {
                        pieceScores[second] += 1;
                    }
                    if (least) {
                        pieceScores[least] -= 1;
                    }
                }
                // Sort the pieces by score (shuffle first to break ties randomly)
                const sortedPieceIds = shuffle(this.getPieceIds()).sort((x, y) => pieceScores[y] - pieceScores[x]);
                // Construct a value distribution and assign values to each piece
                const values = Masterpiece2Game.constructValueDistribution(sortedPieceIds.length);
                for (let i = 0; i < sortedPieceIds.length; i++) {
                    this.getPiece(sortedPieceIds[i]).value = values[i];
                }
                await logger.log('__Piece Scores and Values:__\n' + sortedPieceIds.map((id, i) => `${i + 1}. **${pieceScores[id]}** -> _$${this.getPieceValue(id)}_`).join('\n'));
                // Reward players for uploading at least one piece by awarding a random piece
                let numPlayersAwardedPieces = 0;
                for (const userId of this.getOrderedPlayers()) {
                    // If there is at least one piece by this player, assign a random unsold piece to them
                    if (this.getNumPiecesByArtist(userId) > 0 && this.getNumAvailablePieces() > 0) {
                        const randomPieceId = randChoice(...this.getAvailablePieceIds());
                        this.getPiece(randomPieceId).owner = userId;
                        numPlayersAwardedPieces++;
                    }
                }
                // Reward players for voting by awarding an item
                let numPlayerAwardedItems = 0;
                for (const [userId, entry] of Object.entries(this.state.setup.voting)) {
                    if (getObjectSize(entry.picks) === NUM_VOTE_RANKS) {
                        // Note that the voting map may contain players NOT in the game, the increment player item method handles this
                        this.incrementPlayerItem(userId, 'sneaky-peek', 1);
                        numPlayerAwardedItems++;
                    }
                }
                // Wipe the setup data from the state
                delete this.state.setup;
                // Send out a message indicating that users were rewarded
                payloads.push(`**${numPlayersAwardedPieces}** players were awarded a free piece for uploading artwork, and **${numPlayerAwardedItems}** players were awarded a free item for voting! Good job guys`);
            }
        }

        // Queue up available pieces as bank auctions until there are 2 auctions queued up
        const randomAvailablePieces = shuffle(this.getAvailablePieceIds());
        let i = 0;
        while (this.getNumAuctions() < 2 && randomAvailablePieces.length > 0) {
            const pieceId = randomAvailablePieces.pop();
            i++;
            if (!pieceId) {
                // TODO(2): LOG
                break;
            }
            this.state.auctions[pieceId] = {
                pieceId: pieceId,
                type: 'bank',
                description: `Bank Auction ${i}`,
                bid: 0
            };
        }

        return payloads;
    }

    override async getPreProcessingMessages(): Promise<MessengerPayload[]> {
        // If still in the setup process, don't show the state
        if (this.state.setup) {
            return [{
                content: 'Good morning everyone! I\'m only accepting art piece submissions for a little while longer! Those who upload their own art pieces will be rewarded with a free piece at the start of the game.',
                components: [{
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.Button,
                        custom_id: 'game:upload',
                        label: 'Upload',
                        style: ButtonStyle.Primary
                    }]
                }]
            }];
        }
        // Otherwise, show the overall state render
        return [{
            content: 'Good morning everyone! Let me take a few minutes to look over the agenda for today, then we\'ll see the outcome of this weekend\'s pending sales...',
            files: [new AttachmentBuilder(await this.renderState()).setName(`game-turn${this.getTurn()}-preprocessing.png`)],
            components: this.getDecisionActionRow()
        }];
    }

    override async endTurn(): Promise<MessengerPayload[]> {
        // This is effectively handled at the end of decision processing, so don't show anything here
        return [];
    }

    override async endDay(): Promise<MessengerPayload[]> {
        // At noon after the final game update all the pieces should be sold, so add the winners here to complete the game
        if (this.getNumUnsoldPieces() === 0) {
            for (const userId of this.getTrueOrderedPlayers().slice(0, 3)) {
                this.addWinner(userId);
            }
        }
        // If people still need to vote, send a voting reminder message
        if (this.state.setup && this.state.setup.voting) {
            const votersRemaining = this.getNumRemainingVoters();
            if (votersRemaining > 0) {
                const targetText = votersRemaining <= 3
                    ? this.getJoinedDisplayNames(this.getRemainingVoters())
                    : `**${votersRemaining}** players`;
                return [{
                    content: `I'm still waiting on ${targetText} to vote on some art! If you vote I'll give you a free item`,
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.Button,
                            custom_id: 'game:vote',
                            label: 'Vote',
                            style: ButtonStyle.Primary
                        }]
                    }]
                }];
            }
        }
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

    override awardPrize(userId: string, type: PrizeType, intro: string): MessengerPayload[] {
        // If player isn't in the game yet, do nothing
        if (!this.hasPlayer(userId)) {
            return [];
        }
        // Only process submissions-related prize types
        if (!type.startsWith('submissions')) {
            return [];
        }
        // If this is the reward for winning in the first week, just give them a peek because there's no time to choose
        if (this.getTurn() === 0) {
            this.incrementPlayerItem(userId, 'sneaky-peek', 1);
            return [`${intro}! You've been awarded a **${ITEM_NAMES['sneaky-peek']}** for your early victory`];
        }
        // If still in the setup phase, just award an item that can be used later
        if (this.state.setup) {
            this.incrementPlayerItem(userId, 'random-peek', 1);
            return [`${intro}! Normally I would let you choose an item, but since we're still in the middle of voting I'll just award you a **${ITEM_NAMES['random-peek']}** to be used later`];
        }
        // If there are no pending rewards, initialize that now
        if (!this.state.pendingRewards) {
            this.state.pendingRewards = {
                players: [],
                // TODO(2): Use utility method for getting random items
                options: shuffle(Object.keys(TEMPORARY_ITEMS)).slice(0, 3) as Masterpiece2ItemType[]
            };
        }
        // Add this player to the reward list
        this.state.pendingRewards.players.push(userId);
        // If they're first in the queue, prompt them to choose now
        if (this.state.pendingRewards.players[0] === userId) {
            return [this.constructPrizeSelectionPayload(intro)];
        }
        // Else, tell them they'll have to wait...
        if (type === 'submissions1-tied') {
            return [`${intro}! Even though you tied for first, RNG says that the other winner gets to pick their prize first. I'll let you know once they've picked, then you can claim your prize`];
        } else {
            return [`${intro}! You'll be able to choose a prize once the guy ahead of you chooses theirs. Hang tight, I'll let you know when it's your turn to pick`];
        }
    }

    private constructPrizeSelectionPayload(intro: string): MessengerPayload {
        if (!this.state.pendingRewards) {
            throw new Error('Cannot construct prize selection payload if there are no pending prizes!');
        }
        const availableItems = this.state.pendingRewards.options;
        return {
            content: (availableItems.length === 1
                    ? `${intro}! Since you podiumed last, you've been left with this final option. Click the button below to claim it. `
                    : `${intro}! Select one prize from the following **${availableItems.length}** options. The other **${availableItems.length - 1}** will be available to the next-ranked player. `)
                + 'Items with an hourglass expire on Saturday morning. Items with a star may be saved for later in the season.\n'
                + availableItems.map((itemType, i) => `${i + 1}. **${ITEM_NAMES[itemType] ?? itemType}**: ${ITEM_DESCRIPTIONS[itemType] ?? '???'}`).join('\n'),
            components: [{
                type: ComponentType.ActionRow,
                components: availableItems.map(itemType => ({
                    type: ComponentType.Button,
                    customId: `game:claimPrize:${itemType}`,
                    label: ITEM_NAMES[itemType] ?? itemType,
                    style: ButtonStyle.Secondary,
                    emoji: TEMPORARY_ITEMS[itemType] ? '⏳' : '⭐'
                }))
            }]
        };
    }

    override async addPlayerDecision(userId: string, text: string): Promise<MessengerPayload | null> {
        // Ignore the user if there's no valid silent auction
        if (!this.state.silentAuctionPieceId) {
            return null;
        }
        // Validate that the command is well-formed
        if (!text.startsWith('offer ')) {
            throw new Error('That doesn\'t look right... please make an offer like \`offer 10\`');
        }
        const rawOffer = text.replace('offer ', '').trim();
        const offer = parseInt(rawOffer);
        if (isNaN(offer)) {
            throw new Error(`\`${rawOffer}\` is an invalid offer. Try a real number?`);
        }
        // Validate that the player can afford this
        if (offer > this.getPoints(userId)) {
            throw new Error(`You can't afford to make an offer for **$${offer}**! You only have **$${this.getPoints(userId)}**`);
        }
        // Update the state
        this.state.decisions[userId] = [`${offer}`, `${new Date().getTime()}`];

        return `You have offered **$${offer}** for the bank's piece _"${this.getPieceName(this.state.silentAuctionPieceId)}"_`;
    }

    override async processPlayerDecisions(): Promise<DecisionProcessingResult> {
        // If still in the initial setup phase...
        if (this.state.setup) {
            // Give users one last chance to submit pieces...
            if (this.state.setup.warningsLeft === 0) {
                // End the submissions process by initialize the voting map
                this.state.setup.voting = {};
                // Randomly assign pieces to all eligible voters (any player who's already in the game)
                // TODO(2): What happens if there are fewer than 5 pieces?
                const assignments = getRandomlyDistributedAssignments(this.getPlayers(), this.getPieceIds(), { valuesPerKey: 5 });
                // For all eligible voters (any player who's in the game), randomly assign them pieces to vote on
                for (const [userId, pieceIds] of Object.entries(assignments)) {
                    this.state.setup.voting[userId] = { picks: {}, pieceIds };
                }
                // Prompt players to vote
                return {
                    continueProcessing: false,
                    summary: {
                        content: 'And that\'s it, all submissions are in! Click here to vote on your randomly-assigned pieces. If you vote, you will be rewarded with a free item.',
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.Button,
                                custom_id: 'game:vote',
                                label: 'Vote',
                                style: ButtonStyle.Primary
                            }]
                        }]
                    }
                };
            } else {
                // Decrement the number of warnings left
                this.state.setup.warningsLeft--;
                // Prompt players to submit a piece
                return {
                    continueProcessing: true,
                    delayMultiplier: 3,
                    summary: {
                        content: this.state.setup.warningsLeft === 0
                            ? 'This is your final warning! Those who upload their own art pieces will be rewarded with a free piece at the start of the game.'
                            : 'I\'m only accepting art piece submissions for a little while longer! Click here to upload a picture that can be purchased by other players.',
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.Button,
                                custom_id: 'game:upload',
                                label: 'Upload',
                                style: ButtonStyle.Primary
                            }]
                        }]
                    }
                };
            }
        }

        // Process any pending sale first and foremost
        // TODO: How to handle sales for pieces that were forced into auction?
        const pendingSaleIds = this.getPieceIdsToBeSold();
        if (pendingSaleIds.length > 0) {
            const pieceId = randChoice(...pendingSaleIds);
            const ownerId = this.getPieceOwner(pieceId);
            const value = this.getPieceValue(pieceId);
            // Clear the piece's to-be-sold flag to prevent further processing
            delete this.getPiece(pieceId).toBeSold;
            // If for some reason the owner isn't a user, abort now
            if (typeof ownerId !== 'string') {
                return {
                    continueProcessing: true,
                    summary: `Tried to sell piece ${pieceId}, but the owner value is ${ownerId} (admin help!)`
                };
            }
            // Give funds to the owner of the piece
            this.addPoints(ownerId, value);
            // Mark this piece as sold
            this.getPiece(pieceId).owner = true;
            // Return a summary
            const museumTopic = randChoice('Gaming History', 'Internet Culture', 'MCMP Lore', 'Autism Awareness');
            return {
                continueProcessing: true,
                summary: {
                    content: `**${this.getPlayerDisplayName(ownerId)}** sold their piece _"${this.getPieceName(pieceId)}"_ to the Museum of ${museumTopic} for **$${value}**, removing this piece from the game!`,
                    files: [await this.renderAuction(pieceId, 'Museum Sale', `sold${randChoice('1', '2')}`)]
                }
            };
        }

        // Process any pending purchases
        const pendingBuyingUserIds = this.getOrderedPlayers().filter(id => this.state.players[id].buying);
        if (pendingBuyingUserIds.length > 0) {
            const userId = randChoice(...pendingBuyingUserIds);
            const playerState = this.state.players[userId];
            // TODO: Can we handle this better? Guarantee?
            const price = playerState.buying?.price ?? Math.floor(this.getAverageUnsoldPieceValue());
            // Clear the flag to prevent further processing
            delete playerState.buying;
            // Validate that the player has enough money
            if (this.getPoints(userId) < price) {
                // Refund the user's buy item
                this.incrementPlayerItem(userId, 'buy', 1);
                return {
                    continueProcessing: true,
                    summary: `**${this.getPlayerDisplayName(userId)}** tried to buy a random piece from the bank for **$${price}** with only **$${this.getPoints(userId)}** in hand... their **${ITEM_NAMES['buy']}** item was refunded`
                };
            }
            // Validate that there are any available pieces remaining
            const randomAvailablePieces = shuffle(this.getAvailablePieceIds());
            if (randomAvailablePieces.length === 0) {
                // Refund the user's buy item
                this.incrementPlayerItem(userId, 'buy', 1);
                return {
                    continueProcessing: true,
                    summary: `**${this.getPlayerDisplayName(userId)}** tried to buy a random piece from the bank for **$${price}**, yet there are no available pieces remaining...`
                };
            }
            // Assign the piece to this user and deduct points
            const pieceId = randChoice(...randomAvailablePieces);
            this.getPiece(pieceId).owner = userId;
            this.addPoints(userId, -price);
            return {
                continueProcessing: true,
                summary: {
                    content: `**${this.getPlayerDisplayName(userId)}** bought a random piece from the bank for **$${price}**. Presenting... _"${this.getPieceName(pieceId)}"_!`,
                    // TODO(2): Use special graphic for this render
                    files: [await this.renderAuction(pieceId, 'Direct Bank Purchase', 'bank')]
                }
            }
        }
    
        // Otherwise, handle all the silent auction decisions
        if (this.state.silentAuctionPieceId) {
            const pieceId = this.state.silentAuctionPieceId;
            // Clear the silent auction piece ID from the state to prevent further processing
            delete this.state.silentAuctionPieceId;
            // Determine the highest bid and bidder(s)
            const bids: Record<Snowflake, { value: number, timestamp: number }> = {};
            let maxValue: number = 0;
            for (const userId of Object.keys(this.state.decisions)) {
                const [ rawValue, rawTimestamp ] = this.state.decisions[userId];
                const value = parseInt(rawValue);
                const timestamp = parseInt(rawTimestamp);
                // Update the max bid
                if (value > maxValue) {
                    maxValue = value;
                }
                bids[userId] = {
                    value,
                    timestamp
                };
            }
            // Determine the highest bidders
            const highBidders = Object.keys(bids).filter(id => bids[id].value === maxValue);
            // If no one bid, leave the piece in the bank's inventory
            if (highBidders.length === 0) {
                return {
                    continueProcessing: true,
                    summary: {
                        content: `What's this?? It looks like no one placed a bid on _"${this.getPieceName(pieceId)}"_! I guess I'll save this one for another time...`,
                        files: [await this.renderAuction(pieceId, 'Silent Auction', 'silent')]
                    }
                }
            }
            // Sort the list so that the first bidder is first
            highBidders.sort((x, y) => bids[x].timestamp - bids[y].timestamp);
            const userId = highBidders[0];
            this.getPiece(pieceId).owner = userId;
            this.addPoints(userId, -maxValue);
            // Remove all other decisions from the state
            this.state.decisions = {};
            // Reply according to how many bidders there were
            if (highBidders.length === 1) {
                return {
                    continueProcessing: true,
                    summary: {
                        content: `**${this.getPlayerDisplayName(userId)}** has purchased _"${this.getPieceName(pieceId)}"_ with the high offer of **$${maxValue}**!`,
                        files: [await this.renderAuction(pieceId, 'Silent Auction', 'silent')]
                    }
                };
            } else {
                return {
                    continueProcessing: true,
                    summary: {
                        content: `${this.getJoinedDisplayNames(highBidders)} tied with a high offer of **$${maxValue}**, but **${this.getPlayerDisplayName(userId)}** acted the quickest. _"${this.getPieceName(pieceId)}"_ is theirs!`,
                        files: [await this.renderAuction(pieceId, 'Silent Auction', 'silent')]
                    }
                };
            }
        }

        // If the game is effectively over, begin the reveal process
        if (!this.state.finalReveal && this.getNumAvailablePieces() === 0) {
            this.state.finalReveal = true;
            return {
                continueProcessing: true,
                summary: 'Well my dear friends, it looks like I\'ve auctioned off all the pieces in the bank vault! This means our _Art Auction Adventure_ is coming to a close today...',
                extraSummaries: [
                    {
                        content: 'Here are the current standings (with the value of each unsold piece still hidden)',
                        files: [new AttachmentBuilder(await this.renderState()).setName(`game-week${this.getTurn()}-end.png`)],
                        components: this.getDecisionActionRow()
                    },
                    'In a few hours, I\'ll reveal the value of everyone\'s collection... and thus: the wealthiest three dogs who shall be named our winners!'
                ],
                nextUpdateTime: [10, 0, 0]
            }
        }

        // If the reveal process has begun, auction sets off one-by-one
        if (this.state.finalReveal) {
            // If everything has been revealed, end the game here
            if (this.getNumUnsoldPieces() === 0) {
                return {
                    continueProcessing: false,
                    summary: 'Everything has been sold away!'
                };
            }
            // Else, find the lowest unsold piece value
            const lowestValue = Math.min(...this.getUnsoldPieceIds().map(pieceId => this.getPieceValue(pieceId)));
            // Get all piece IDs with this value
            const pieceIds = this.getUnsoldPieceIds().filter(pieceId => this.getPieceValue(pieceId) === lowestValue);
            // Create the summary before updating the state
            const summary: MessengerPayload = {
                // TODO: This message could be improved
                content: pieceIds.length === 1
                    ? `Revealing... the **$${lowestValue}** piece!`
                    : `All the **$${lowestValue}** pieces have been sold off!`,
                files: [await this.renderGallery(pieceIds, 'reveal', { showAvatars: true })]
            };
            // Sell each piece
            for (const pieceId of pieceIds) {
                const ownerId = this.getPieceOwner(pieceId);
                if (typeof ownerId === 'string') {
                    this.addPoints(ownerId, this.getPieceValue(pieceId));
                } else {
                    void logger.log(`Couldn't do final reveal sale for piece _${this.getPieceName(pieceId)}_ worth **$${lowestValue}**, as the owner isn't a user ID...`);
                }
                // Mark the piece as sold regardless of whether the sale could go through, otherwise the game will loop infinitely
                this.state.pieces[pieceId].owner = true;
            }
            // Return the update message with an extra state render after the sale of these pieces
            const gameOver = this.getNumUnsoldPieces() === 0;
            return {
                continueProcessing: !gameOver,
                summary,
                extraSummaries: [{
                    content: gameOver
                        ? 'That concludes the game! Here are the final standings!'
                        : text('{!Here are|These are|Check out} the updated {!standings|ranks}... Who will {!come out on top|prevail|unveil the big cheddar piece}?'),
                    files: [new AttachmentBuilder(await this.renderState()).setName('game-reveal-standings.png')],
                    flags: MessageFlags.SuppressNotifications
                }]
            }
        }

        // Show the final state update here instead of in endTurn because it's easier to end the processing using a final fallback
        return {
            continueProcessing: false,
            summary: {
                content: text('{!Well|Alright}, that\'s all the {!art trading|auctioneering} for now. Have a blessed week and remember to {!stack your cheddar|count your bills|cherish each morning}!'),
                files: [new AttachmentBuilder(await this.renderState()).setName(`game-week${this.getTurn()}-end.png`)],
                components: this.getDecisionActionRow()
            }
        };
    }

    override getDecisionActionRow(): ActionRowData<MessageActionRowComponentData>[] {
        // TODO: This isn't really a "decision" action row, this whole API should be refactored
        return [{
            type: ComponentType.ActionRow,
            components: [{
                type: ComponentType.Button,
                style: ButtonStyle.Primary,
                label: 'Help',
                emoji: '❔',
                customId: 'game:help'
            }, {
                type: ComponentType.Button,
                style: ButtonStyle.Primary,
                label: 'My Inventory',
                emoji: '💰',
                customId: 'game:inventory'
            }]
        }];
    }

    override async handleGameInteraction(interaction: Interaction): Promise<MessengerManifest | undefined> {
        const userId = interaction.user.id;
        if (interaction.isButton()) {
            switch (interaction.customId) {
                case 'game:help':
                    await interaction.editReply({
                        content: 'Here are the rules of the game',
                        files: [await this.renderRules()]
                    });
                    break;
                case 'game:inventory': {
                    if (this.hasAnyPieces(userId)) {
                        await interaction.editReply({
                            content: `You have **$${this.getPoints(userId)}** in cash, `
                                + (this.hasAnyItems(userId) ? `${this.getPlayerItemsString(userId)}, ` : '')
                                + `plus the following pieces in your gallery:`,
                            files: [await this.renderInventory(userId)],
                            components: this.hasAnyItems(userId)
                                ? [{
                                    type: ComponentType.ActionRow,
                                    components: [{
                                        type: ComponentType.Button,
                                        custom_id: 'game:useItem',
                                        label: 'Use Item',
                                        style: ButtonStyle.Primary
                                    }]
                                }] : undefined
                        });
                    } else {
                        await interaction.editReply(`You have **$${this.getPoints(userId)}** in cash, but no pieces of art ...yet`);
                    }
                    break;
                }
                case 'game:useItem': {
                    // Validate that the user can do this
                    if (!this.hasAnyItems(userId)) {
                        throw new Error('You don\'t have any items to use!');
                    }
                    // Don't allow item usage during active auctions
                    if (this.isAnyAuctionActive()) {
                        throw new Error('You can\'t use items during an active auction!');
                    }
                    // Show a select menu of items that may be used
                    await interaction.editReply({
                        content: 'Which item would you like to use?',
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.StringSelect,
                                custom_id: 'game:selectItem',
                                min_values: 1,
                                max_values: 1,
                                options: Object.keys(this.getPlayerItems(userId)).map(itemType => ({
                                    value: itemType,
                                    label: ITEM_NAMES[itemType] ?? itemType,
                                    description: ITEM_DESCRIPTIONS[itemType]?.slice(0, 99)
                                }))
                            }]
                        }]
                    });
                    break;
                }
                case 'game:upload': {
                    // Validate that the user can do this
                    if (!this.state.setup) {
                        throw new Error('It\'s a little too late to upload art!');
                    }
                    if (this.state.setup.voting) {
                        throw new Error('It\'s too late to upload art, voting has already begun!');
                    }
                    // If they've already uploaded the max number of pieces, prompt them to view the pieces
                    if (this.getNumPiecesByArtist(userId) >= Masterpiece2Game.MAX_PIECES_BY_ARTIST) {
                        await interaction.editReply({
                            content: `You've already uploaded the max of **${Masterpiece2Game.MAX_PIECES_BY_ARTIST}** pieces! Click below to view them or start over.`,
                            components: [{
                                type: ComponentType.ActionRow,
                                components: [{
                                    type: ComponentType.Button,
                                    custom_id: 'game:viewUploads',
                                    style: ButtonStyle.Primary,
                                    label: 'View Uploads'
                                }]
                            }]
                        });
                        return;
                    }
                    // Send a DM to this user prompting them to send an image
                    await dmReplyCollector.solicitImageReply(interaction.user,
                        'Reply to this message (click "Reply") with an image (your art) and text (the title of the piece)',
                        async (replyMessage, imageAttachment) => {
                            // Validate (again) that the user can do this
                            if (!this.state.setup) {
                                await replyMessage.reply('It\'s a little too late to upload art!');
                                return;
                            }
                            if (this.state.setup.voting) {
                                await replyMessage.reply('It\'s too late to upload art, voting has already begun!');
                                return;
                            }
                            if (this.getNumPiecesByArtist(userId) >= Masterpiece2Game.MAX_PIECES_BY_ARTIST) {
                                await replyMessage.reply(`You've already uploaded the max of **${Masterpiece2Game.MAX_PIECES_BY_ARTIST}** pieces!`);
                                return;
                            }
                            // Validate the title
                            const title = replyMessage.content.trim();
                            if (!title) {
                                await replyMessage.reply('Your piece needs a title! Please reply to the message again but with both the picture _and_ your piece\'s title');
                                return;
                            }
                            if (title.length < 5) {
                                await replyMessage.reply(`The minimum title length is **5** characters, yet yours is only **${title.length}**! Come up with a longer title`);
                                return;
                            }
                            if (title.length > 35) {
                                await replyMessage.reply(`The maximum title length is **35** characters, yet yours is **${title.length}**! Come up with a shorter title`);
                                return;
                            }
                            // Check and acquire the lock (after validation)
                            if (this.uploadLock) {
                                await replyMessage.reply('Someone else is uploading a piece at this exact moment, try again in half a second...');
                                return;
                            }
                            this.uploadLock = true;
                            // Do all this in a try-catch just to ensure the lock gets released
                            try {
                                // Determine the next available piece ID
                                const pieceId = this.getNextUnusedPieceId();
                                // Center-crop the piece and save it locally
                                const croppedImage = cropToSquare(await imageLoader.loadImage(imageAttachment.url));
                                // Download the image and save it locally
                                // const downloadedImage = await downloadBufferFromUrl(imageAttachment.url);
                                // const fileName = `${pieceId}_${imageAttachment.name}`;
                                const fileName = `${pieceId}.png`;
                                const blobUrl = await controller.getAllReferences().storage.writeBlob(`blobs/masterpiece2/${fileName}`, croppedImage.toBuffer());
                                // Pre-evict this URL from the image cache just in case there was already a piece with this ID
                                imageLoader.evict(blobUrl);
                                // Write the piece to state
                                this.state.pieces[pieceId] = {
                                    value: 0,
                                    name: title,
                                    imageUrl: blobUrl,
                                    artist: userId,
                                    owner: false
                                };
                                await logger.log(`<@${userId}> uploaded MP2 piece **${pieceId}** (**${this.getNumPieces()}** total)`);
                                // Prompt the player to upload more
                                const remainingUploads = Masterpiece2Game.MAX_PIECES_BY_ARTIST - this.getNumPiecesByArtist(userId);
                                if (remainingUploads === 0) {
                                    await replyMessage.reply({
                                        content: 'Your piece was accepted! You\'ve uploaded the maximum number of pieces, enjoy your participation bonus!',
                                        components: [{
                                            type: ComponentType.ActionRow,
                                            components: [{
                                                type: ComponentType.Button,
                                                custom_id: 'game:viewUploads',
                                                style: ButtonStyle.Primary,
                                                label: 'View Uploads'
                                            }]
                                        }]
                                    });
                                } else {
                                    await replyMessage.reply({
                                        content: `Your piece was accepted! You may upload **${remainingUploads}** more.`,
                                        components: [{
                                            type: ComponentType.ActionRow,
                                            components: [{
                                                type: ComponentType.Button,
                                                custom_id: 'game:upload',
                                                style: ButtonStyle.Primary,
                                                label: 'Upload More'
                                            }, {
                                                type: ComponentType.Button,
                                                custom_id: 'game:viewUploads',
                                                style: ButtonStyle.Primary,
                                                label: 'View Uploads'
                                            }]
                                        }]
                                    });
                                }
                            } catch (err) {
                                await logger.log(`Unhandled error while <@${userId}> was uploading art: \`${err}\``);
                                await replyMessage.reply('There was an error while processing your upload, please try again or see the admin.');
                            }
                            // Release the lock
                            this.uploadLock = false;
                        });
                    // Reply to the interaction
                    await interaction.editReply('I just sent you a DM with instructions on how to upload a piece of art');
                    break;
                }
                case 'game:viewUploads': {
                    // Validate that the user can do this
                    if (!this.state.setup) {
                        throw new Error('You can\'t view your uploads right now');
                    }
                    // Get the user's uploaded pieces
                    const pieceIds = this.getPieceIdsByArtist(userId);
                    if (pieceIds.length === 0) {
                        throw new Error('You haven\'t uploaded any pieces yet');
                    }
                    // Render the player's uploaded pieces and prompt more actions
                    const buttons: APIButtonComponent[] = [{
                        type: ComponentType.Button,
                        custom_id: 'game:clearUploads',
                        style: ButtonStyle.Danger,
                        label: 'Delete All'
                    }];
                    if (this.getNumPiecesByArtist(userId) < Masterpiece2Game.MAX_PIECES_BY_ARTIST) {
                        buttons.unshift({
                            type: ComponentType.Button,
                            custom_id: 'game:upload',
                            style: ButtonStyle.Primary,
                            label: 'Upload More'
                        });
                    }
                    await interaction.editReply({
                        content: 'Your uploaded pieces...',
                        files: [await this.renderGallery(pieceIds, 'studio', { showValues: false })],
                        components: [{
                            type: ComponentType.ActionRow,
                            components: buttons
                        }]
                    });
                    break;
                }
                case 'game:clearUploads': {
                    // Validate that the user can do this
                    if (!this.state.setup) {
                        throw new Error('It\'s a little too late to delete your uploads!');
                    }
                    if (this.state.setup.voting) {
                        throw new Error('It\'s too late to delete your uploads, voting has already begun!');
                    }
                    // Get the user's uploaded pieces
                    const pieceIds = this.getPieceIdsByArtist(userId);
                    if (pieceIds.length === 0) {
                        throw new Error('You haven\'t uploaded any pieces yet');
                    }
                    // Delete the pieces from state
                    for (const pieceId of pieceIds) {
                        // Evict this key from the cache to prevent future collisions on this ID
                        imageLoader.evict(this.getPieceImageUrl(pieceId));
                        // Delete it from state
                        delete this.state.pieces[pieceId];
                    }
                    await logger.log(`<@${userId}> deleted ${pieceIds.length} MP2 upload(s) (**${this.getNumPieces()}** total)`);
                    await interaction.editReply({
                        content: 'Deleted all your uploads. You should upload again to ensure you get the participation bonus.',
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.Button,
                                custom_id: 'game:upload',
                                label: 'Upload',
                                style: ButtonStyle.Primary
                            }]
                        }]
                    });
                    break;
                }
                case 'game:vote': {
                    // Validate that the user can do this
                    if (!this.state.setup) {
                        throw new Error('It\'s a little too late to vote!');
                    }
                    if (!this.state.setup.voting) {
                        throw new Error('It\'s not time to vote yet!');
                    }
                    // If there's no voting info for this player, generate it now
                    const votingInfo = this.state.setup.voting[userId];
                    if (!votingInfo) {
                        this.state.setup.voting[userId] = {
                            picks: {},
                            // TODO(2): Should we make this more fair by only assigning pieces which were assigned to the fewest other players?
                            pieceIds: shuffle(this.getPieceIds()).slice(0, 5)
                        };
                        await logger.log(`Generated new voter info for player <@${userId}>`);
                    }
                    // Get the pieces this player may vote on
                    const pieceIds = votingInfo.pieceIds ?? [];
                    if (pieceIds.length === 0) {
                        throw new Error('There are no pieces for you to vote on (see admin)');
                    }
                    // Show the player the pieces they're voting on and present them with voting select menus
                    await interaction.editReply({
                        content: 'Here are the pieces you\'ll be voting on, use the drop-downs below. '
                            + 'Your _favorite_ and _second-favorite_ pieces will be appraised at a higher value, meanwhile your _most HATED_ piece\'s value will tank...',
                        files: [await this.renderGallery(pieceIds, 'voting', { showValues: false })],
                        components: ALL_VOTE_RANKS.map(r => ({
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.StringSelect,
                                custom_id: `game:selectPieceVote:${r}`,
                                placeholder: `Your ${VOTE_RANK_NAMES[r]}...`,
                                min_values: 1,
                                max_values: 1,
                                options: pieceIds.map(id => ({
                                    value: id,
                                    label: this.getPieceName(id),
                                    default: id === votingInfo.picks[r]
                                }))
                            }]
                        }))
                    });
                    break;
                }
                case 'game:forcePrivateAuction':
                    // Validate that this user can do this
                    if (!this.mayPlayerForcePrivateAuction(userId)) {
                        await interaction.editReply('You can\'t do that right now! Perhaps you\'ve already chosen an action?');
                        return;
                    }
                    // Get all the pieces that this user may force into auction
                    const otherPieceIds = this.getPieceIdsForOtherUsers(userId);
                    if (otherPieceIds.length === 0) {
                        await interaction.editReply('There are no pieces that can be forced into auction at this moment');
                        return;
                    }
                    // Respond with a select menu of all the pieces this user may force into auction
                    await interaction.editReply({
                        content: 'Which piece would you like to force into auction?',
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.StringSelect,
                                custom_id: 'game:forcePrivateAuctionSelect',
                                min_values: 1,
                                max_values: 1,
                                options: otherPieceIds.map(id => ({
                                    label: this.getPieceName(id),
                                    description: `Owned by ${this.getPieceOwnerString(id)}`,
                                    value: id
                                }))
                            }]
                        }],
                    });
                    break;
                default: {
                    // Not handled directly by other cases, so parse it
                    const [ rootCustomId, secondaryCustomId, arg ] = interaction.customId.split(':');
                    switch (secondaryCustomId) {
                        case 'bid': {
                            if (!arg) {
                                throw new Error('You seem to be bidding without specifying a piece to bid on... (see admin)');
                            }
                            await this.handleBid(arg, interaction);
                            break;
                        }
                        case 'claimPrize': {
                            // Validate that this user may claim a prize right now
                            if (!this.state.pendingRewards) {
                                throw new Error('Now is not the time to claim rewards! Too late?');
                            }
                            if (this.state.pendingRewards.players[0] !== userId) {
                                throw new Error('It\'s not your turn to claim a prize!');
                            }
                            // Validate that the prize being selected is a valid option
                            const itemType = arg as Masterpiece2ItemType;
                            if (!this.state.pendingRewards.options.includes(itemType)) {
                                // TODO(2): Use utility for getting item name/names
                                throw new Error(`You can't claim a **${ITEM_NAMES[itemType] ?? itemType}**! Valid options right now are ${naturalJoin(this.state.pendingRewards.options)}`);
                            }
                            // Award them the item
                            this.incrementPlayerItem(userId, itemType, 1);
                            // Remove it from the options list
                            this.state.pendingRewards.options = this.state.pendingRewards.options.filter(t => t !== itemType);
                            // Remove them from the players queue
                            this.state.pendingRewards.players.shift();
                            // Let them know they've claimed the item, show them their items
                            await interaction.editReply(`You've claimed a **${ITEM_NAMES[itemType] ?? itemType}**! You now have ${this.getPlayerItemsString(userId)}`);
                            // Notify the next guy in the queue
                            const nextUserId = this.state.pendingRewards.players[0];
                            if (nextUserId) {
                                void logger.log(`<@${userId}> claimed **${itemType}**, sent prompt to next player <@${nextUserId}>`);
                                return {
                                    dms: {
                                        [nextUserId]: [this.constructPrizeSelectionPayload('It\'s time to claim your prize')]
                                    }
                                };
                            } else {
                                void logger.log(`<@${userId}> claimed **${itemType}**`);
                            }
                            break;
                        }
                    }
                    break;
                }
            }
        } else if (interaction.isStringSelectMenu()) {
            switch (interaction.customId) {
                case 'game:selectItem': {
                    const itemType = interaction.values[0] as Masterpiece2ItemType;
                    // Validate that the user can do this
                    if (!this.hasItem(userId, itemType)) {
                        throw new Error(`You don't have a **${ITEM_NAMES[itemType] ?? itemType}** to use!`);
                    }
                    // Don't allow item usage during active auctions
                    if (this.isAnyAuctionActive()) {
                        throw new Error('You can\'t use items during an active auction!');
                    }
                    const pieceIds = this.getPieceIdsForUser(userId);
                    const otherPieceIds = shuffle(this.getPieceIdsForOtherUsers(userId));
                    // Handle item-specific logic
                    switch (itemType) {
                        case 'sneaky-peek': {
                            // TODO(2): FINISH THIS!
                            await interaction.editReply('This item hasn\'t been implemented yet. Hound the admin to finish the code!');
                            break;
                        }
                        case 'random-peek': {
                            // TODO(2): FINISH THIS!
                            await interaction.editReply('This item hasn\'t been implemented yet. Hound the admin to finish the code!');
                            break;
                        }
                        case 'buy': {
                            // Determine the current average price
                            const averagePrice = Math.floor(this.getAverageUnsoldPieceValue());
                            // Update the state
                            this.state.players[userId].buying = {
                                price: averagePrice
                            };
                            this.incrementPlayerItem(userId, 'buy', -1);
                            // TODO: Give user option to confirm?
                            await interaction.editReply(`Ok, you will buy a piece from the bank on Sunday morning for **$${averagePrice}**`
                                + (this.getPoints(userId) < averagePrice ? ' (since you currently don\'t have enough money, the purchase will be cancelled if you can\'t raise the funds by then)' : ''));
                            void logger.log(`<@${userId}> will buy a random piece from the bank for **$${averagePrice}**`);
                            break;
                        }
                        case 'force': {
                            // Get all the pieces that this user may force into auction
                            if (otherPieceIds.length === 0) {
                                throw new Error('There are no pieces that can be forced into auction at this moment');
                            }
                            // Respond with a select menu of all the pieces this user may force into auction
                            await interaction.editReply({
                                content: 'Which piece would you like to force into auction?'
                                    // TODO(2): Is there a better way to do this? Two menus?
                                    + (otherPieceIds.length > 25 ? ' (since there are more than 25 options, spawn this message again if you don\'t see the one you want)' : ''),
                                components: [{
                                    type: ComponentType.ActionRow,
                                    components: [{
                                        type: ComponentType.StringSelect,
                                        custom_id: 'game:forcePrivateAuctionSelect',
                                        min_values: 1,
                                        max_values: 1,
                                        options: otherPieceIds.slice(0, 25).map(id => ({
                                            label: this.getPieceName(id),
                                            description: `Owned by ${this.getPieceOwnerString(id)}`,
                                            value: id
                                        }))
                                    }]
                                }]
                            });
                            break;
                        }
                        case 'sell': {
                            // Get all the pieces that this user may sell
                            if (pieceIds.length === 0) {
                                throw new Error('You don\'t have any pieces to sell at the moment!');
                            }
                            // Respond with a select menu of all the pieces this user may sell
                            await interaction.editReply({
                                content: 'Which piece would you like to sell?',
                                components: [{
                                    type: ComponentType.ActionRow,
                                    components: [{
                                        type: ComponentType.StringSelect,
                                        custom_id: 'game:sellSelect',
                                        min_values: 1,
                                        max_values: 1,
                                        options: pieceIds.map(id => ({
                                            label: this.getPieceName(id),
                                            value: id
                                        }))
                                    }]
                                }]
                            });
                            break;
                        }
                        case 'smudge': {
                            // TODO(2): FINISH THIS!
                            await interaction.editReply('This item hasn\'t been implemented yet. Hound the admin to finish the code!');
                            break;
                        }
                        default: {
                            throw new Error(`No logic defined for item type **${itemType}** (see admin)`);
                        }
                    }
                    break;
                }
                case 'game:sellSelect': {
                    // Validate that this user can do this
                    if (!this.mayPlayerSell(userId)) {
                        await interaction.editReply('You can\'t do that right now! Perhaps you\'ve already chosen an action?');
                        return;
                    }
                    // Validate and set up the sale of this piece
                    const pieceId = interaction.values[0];
                    if (!this.hasPieceWithId(pieceId)) {
                        await interaction.editReply(`Woah! Piece with ID \`${pieceId}\` doesn't exist... (see admin)`);
                        return;
                    }
                    if (this.getPieceOwner(pieceId) !== userId) {
                        await interaction.editReply(`You can't sell _"${this.getPieceName(pieceId)}"_, that piece belongs to **${this.getPieceOwnerString(pieceId)}**`);
                        return;
                    }
                    // Update the state
                    this.getPiece(pieceId).toBeSold = true;
                    this.incrementPlayerItem(userId, 'sell', -1);
                    // Reply to the user confirming the sale
                    await interaction.editReply(`Confirmed! _"${this.getPieceName(pieceId)}"_ will be sold to the museum Sunday morning for **$${this.getPieceValue(pieceId)}**`);
                    void logger.log(`<@${userId}> has chosen to sell their piece _"${this.getPieceName(pieceId)}"_`);
                    break;
                }
                case 'game:forcePrivateAuctionSelect': {
                    // Validate that this user can do this
                    if (!this.mayPlayerForcePrivateAuction(userId)) {
                        await interaction.editReply('You can\'t do that right now! Perhaps you\'ve already chosen an action?');
                        return;
                    }
                    // Validate and set up the forced auction
                    const pieceId = interaction.values[0];
                    if (!this.hasPieceWithId(pieceId)) {
                        await interaction.editReply(`Woah! Piece with ID \`${pieceId}\` doesn't exist... (see admin)`);
                        return;
                    }
                    if (this.getPieceOwner(pieceId) === userId) {
                        await interaction.editReply(`You can't force _"${this.getPieceName(pieceId)}"_ into auction, that piece belongs to you!`);
                        return;
                    }
                    // Ensure there's not already a private auction queued up
                    if (this.getAuctions().some(a => a.type === 'private')) {
                        await interaction.editReply('There\'s already a piece being forced into auction this week! Try again next week.');
                        return;
                    }
                    // Update the state
                    this.state.auctions[pieceId] = {
                        pieceId,
                        description: 'Private Auction',
                        type: 'private',
                        bid: 0,
                        forcedBy: userId
                    };
                    this.incrementPlayerItem(userId, 'force', -1);
                    // Reply to the user confirming the forced auction
                    await interaction.editReply(`Confirmed! _"${this.getPieceName(pieceId)}"_ will be forced into a private auction on Saturday morning`);
                    void logger.log(`<@${userId}> has chosen to force **${this.getPieceOwnerString(pieceId)}'s** piece _"${this.getPieceName(pieceId)}"_ into a private auction`);
                    break;
                }
                default: {
                    // Not handled directly by other cases, so parse it
                    const [rootCustomId, secondaryCustomId, arg] = interaction.customId.split(':');
                    switch (secondaryCustomId) {
                        case 'selectPieceVote': {
                            // Validate that the user can do this
                            if (!this.state.setup) {
                                throw new Error('It\'s a little too late to vote!');
                            }
                            if (!this.state.setup.voting) {
                                throw new Error('It\'s not time to vote yet!');
                            }
                            const playerVotingData = this.state.setup.voting[userId];
                            if (!playerVotingData) {
                                throw new Error('You haven\'t been assigned any pieces to vote on! Likely because you haven\'t participated at all yet...');
                            }
                            // Determine the rank of the vote
                            let rank: VoteRank = arg as VoteRank;
                            if (!ALL_VOTE_RANKS.includes(rank)) {
                                throw new Error(`\`${rank}\` is an invalid vote rank (see admin)`);
                            }
                            // Insert the value into the picks map
                            const pieceId = interaction.values[0];
                            if (!pieceId) {
                                throw new Error('No piece ID (see admin)');
                            }
                            // Validate that this piece isn't being selected as the same rank again (makes the response message confusing)
                            if (pieceId === playerVotingData.picks[rank]) {
                                throw new Error(`You've already selected _${this.getPieceName(pieceId)}_ as your **${VOTE_RANK_NAMES[rank]}** piece. Use the other drop-downs...`);
                            }
                            // If this piece was selected for something else, wipe it
                            let replacedText: string = '';
                            for (const r of ALL_VOTE_RANKS) {
                                if (playerVotingData.picks[r] === pieceId) {
                                    delete playerVotingData.picks[r];
                                    replacedText = `It was previously your **${VOTE_RANK_NAMES[r]}** piece. `;
                                }
                            }
                            playerVotingData.picks[rank] = pieceId;
                            // Construct response message
                            const remainingRanks = ALL_VOTE_RANKS.filter(r => playerVotingData.picks[r] === undefined);
                            await interaction.editReply(
                                `You've selected _${this.getPieceName(pieceId)}_ as your **${VOTE_RANK_NAMES[rank]}** piece. `
                                    + replacedText
                                    + (remainingRanks.length === 0 ? 'You\'re all done, enjoy your voting participation bonus!' : `Please finish up by selecting your ${naturalJoin(remainingRanks.map(r => VOTE_RANK_NAMES[r]), { bold: true })} piece${remainingRanks.length === 1 ? '' : 's'}.`)
                            );
                            if (remainingRanks.length === 0) {
                                await logger.log(`<@${userId}> finished voting (**${this.getNumCompleteVoters()}** complete, **${this.getNumRemainingVoters()}** remaining)`);
                            }
                            break;
                        }
                    }
                    break;
                }
            }
        }
    }

    override handleNonDecisionDM(userId: Snowflake, text: string): MessengerPayload[] {
        if (text.trim().toLowerCase() === 'inventory') {
            return [{
                content: 'Click here to see your inventory',
                components: [{
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.Button,
                        style: ButtonStyle.Primary,
                        label: 'My Inventory',
                        emoji: '💰',
                        customId: 'game:inventory'
                    }]
                }]
            }]
        }
        return [];
    }

    private async handleBid(pieceId: string, interaction: ButtonInteraction) {
        const userId = interaction.user.id;
        const auction = this.state.auctions[pieceId];
        // Ensure the auction exists and is active
        if (!auction || !auction.active) {
            await interaction.editReply(`You can't place a bid on _"${this.getPieceName(pieceId)}"_ right now, as it's not currently in auction!`);
            return;
        }
        // The player cannot bid on the same piece twice in a row
        if (userId === auction.bidder) {
            await interaction.editReply('You were the last one to bid! Wait until someone else bids, then try again...');
            return;
        }
        // The player cannot bid on a piece they own (e.g. cannot bid on a piece stolen from you via private auction)
        if (userId === this.getPieceOwner(auction.pieceId)) {
            await interaction.editReply('This is your piece, buddy. You can\'t bid on it! You must sit in the corner and watch as everyone bids on your own piece.');
            return;
        }
        // Compute the target bid and validate whether the user can even place a bid
        const bidAmount = auction.bid + 1;
        const existingBidLiability = this.getPlayerBidLiability(userId);
        const totalLiability = bidAmount + existingBidLiability;
        if (totalLiability > this.getPoints(userId)) {
            await interaction.editReply(`You can't place a **$${bidAmount}** bid, as you only have **$${this.getPoints(userId)}**!`
                    + (existingBidLiability > 0 ? ` (and you're currently bidding **$${existingBidLiability}** on other auctions)` : ''));
            return;
        }
        // Check and acquire the lock
        if (this.auctionLock) {
            await interaction.editReply('Someone else is placing a bid at this exact moment, try again in half a second...');
            return;
        }
        this.auctionLock = true;
        // Place the bid
        auction.previousBidder = auction.bidder;
        auction.bidder = userId;
        auction.bid = bidAmount;
        // Reply and notify the channel
        const pieceName = this.getPiece(pieceId).name;
        await interaction.editReply(`You've placed a bid on _"${pieceName}"_!`);
        await interaction.channel?.send({
            content: `<@${userId}> has raised the bid on _"${pieceName}"_ to **$${bidAmount}**!`,
            flags: MessageFlags.SuppressNotifications
        });
        await interaction.channel?.send({
            content: `**$${bidAmount + 1}**, anyone?`,
            components: [{
                type: ComponentType.ActionRow,
                components: [{
                    type: ComponentType.Button,
                    style: ButtonStyle.Success,
                    label: 'Bid',
                    custom_id: `game:bid:${pieceId}`
                }]
            }],
            flags: MessageFlags.SuppressNotifications
        });
        // Delete the original message containing the previous bid button
        try {
            await interaction.message.delete();
        } catch (err) {
            // TODO: Better way to do this?
        }
        // Release the lock
        this.auctionLock = false;
    }

    override async getSeasonEndMessages(): Promise<MessengerPayload[]> {
        return [
            'I\'d like to thank you all for participating and bidding on the treasured artwork which was once locked away in my vault',
            `I'd like to give a special thanks to <@${this.getWinners()[0]}>, for this dog has been crowned _King of the Auction House_!`,
            `Thanks also to our runners-up <@${this.getWinners()[1]}> and <@${this.getWinners()[2]}>, putting in a valiant, baroque effort...`,
            'If you have any suggestions for how this game could be improved, please drop a suggestion in the suggestion box (this channel)'
        ];
    }
}