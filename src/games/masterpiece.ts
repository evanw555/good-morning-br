import canvas, { Canvas, CanvasRenderingContext2D } from 'canvas';
import { ActionRowData, AttachmentBuilder, ButtonInteraction, ButtonStyle, ComponentType, GuildMember, Interaction, MessageActionRowComponentData, MessageFlags, Snowflake } from "discord.js";
import { DecisionProcessingResult, GamePlayerAddition, MessengerManifest, MessengerPayload, PrizeType } from "../types";
import AbstractGame from "./abstract-game";
import { capitalize, joinCanvasesHorizontal, naturalJoin, randChoice, shuffle, toCircle, toFixed, toLetterId, withDropShadow } from "evanw555.js";
import { getTextLabel, text } from '../util';
import { MasterpieceGameState, MasterpiecePlayerState, MasterpiecePieceState } from './types';

import logger from "../logger";
import imageLoader from '../image-loader';

type AuctionType = 'bank' | 'private';

export default class MasterpieceGame extends AbstractGame<MasterpieceGameState> {
    private auctionLock: boolean = false;

    constructor(state: MasterpieceGameState) {
        super(state);
    }

    static create(members: GuildMember[], season: number): MasterpieceGame {
        // Initialize all players
        const players: Record<Snowflake, MasterpiecePlayerState> = {};
        for (const member of members) {
            players[member.id] = {
                displayName: member.displayName,
                points: 0
            };
        }
        // Declare piece titles
        const names: Record<string, string> = {
            A: 'Broccolis That Go Hard',
            B: 'Sex Tree',
            C: 'The CWCVille Guardian',
            D: 'Newgrounds Fauna',
            E: 'Big Burger Time',
            F: 'Cute Scott',
            G: 'I Just Bought More Land',
            H: 'Whomp\'s Fortress',
            I: 'David Frappes?',
            J: 'Death of Napoleon',
            K: 'The Critic',
            L: 'Love Yourself',
            M: '1man #Movie',
            N: 'Sematary',
            O: 'Homsar',
            P: 'Bliss',
            Q: 'Ceiling Cat',
            R: 'Smosh'
        };
        // Initialize all pieces with random values
        const pieceValues = this.getPieceValues();
        shuffle(pieceValues);
        const totalNumPieces = pieceValues.length;
        const pieces: Record<string, MasterpiecePieceState> = {};
        for (let i = 0; i < totalNumPieces; i++) {
            const pieceId = toLetterId(i);
            pieces[pieceId] = {
                name: names[pieceId] ?? '???',
                value: pieceValues[i],
                owner: false
            };
        }
        return new MasterpieceGame({
            type: 'MASTERPIECE',
            season,
            winners: [],
            decisions: {},
            turn: 0,
            players,
            pieces,
            auctions: {}
        });
    }

    private static getPieceValues(): number[] {
        return [
            40,
            30,
            25, 25,
            20, 20, 20,
            15, 15, 15,
            10, 10, 10,
            5,  5,  5,
            0,  0
        ]
    }

    private static getAuctionTypes(): AuctionType[] {
        return ['bank', 'private'];
    }

    private getPieces(): MasterpiecePieceState[] {
        return Object.values(this.state.pieces);
    }

    private getPieceIds(): string[] {
        return Object.keys(this.state.pieces);
    }

    private hasPieceWithId(pieceId: string): boolean {
        return pieceId in this.state.pieces;
    }

    private getNumPieces(): number {
        return Object.keys(this.state.pieces).length;
    }

    private getSoldPieceIds(): string[] {
        return Object.keys(this.state.pieces).filter(id => this.state.pieces[id].owner === true);
    }

    private getNumSoldPieces(): number {
        return this.getSoldPieceIds().length;
    }

    private getUnsoldPieceIds(): string[] {
        return Object.keys(this.state.pieces).filter(id => this.state.pieces[id].owner !== true);
    }

    private getNumUnsoldPieces(): number {
        return this.getUnsoldPieceIds().length;
    }

    private getAvailablePieceIds(): string[] {
        return Object.keys(this.state.pieces).filter(id => this.state.pieces[id].owner === false);
    }

    private getNumAvailablePieces(): number {
        return this.getAvailablePieceIds().length;
    }

    private getNumUnavailablePieces(): number {
        return this.getNumPieces() - this.getNumAvailablePieces();
    }

    private getNumOwnedPieces(): number {
        return Object.values(this.state.pieces).filter(p => typeof p.owner === 'string').length;
    }

    override async getIntroductionMessages(): Promise<MessengerPayload[]> {
        return [
            'I cordially invite you all to my high society _Auction House of Abundant Autism & Artistry!_',
            'You will be use your coveted GMBR points as dollars to spend in live auctions each week, with the chance to own a valuable piece of culture and history!',
            {
                content: 'Please read over the rules of the game',
                files: [await this.renderRules()]
            }
        ];
    }

    override getInstructionsText(): string {
        if (this.getTurn() === 1) {
            return 'The very first auction begins in half an hour!';
        }
        // If for some reason there aren't any pieces available (this shouldn't happen), then handle gracefully...
        if (this.getNumAvailablePieces() === 0) {
            return 'There won\'t be a bank auction today, as there are no pieces remaining in the bank';
        }
        return 'Today\'s auction begins in half an hour!';
    }

    override getDecisionPhases(): { key: string; millis: number; }[] {
        const phases: { key: string; millis: number; }[] = [];
        // If there are enough pieces for a bank auction, schedule a phase for that
        if (this.getNumAvailablePieces() > 0) {
            phases.push({
                key: 'beginBankAuction',
                millis: this.isTesting() ? (1000 * 5) : (1000 * 60 * 30) // 30 minutes, 5 seconds if testing
            });
        }
        // If there's a private auction today, schedule a phase for that
        if (this.state.auctions.private) {
            phases.push({
                key: 'beginPrivateAuction',
                millis: this.isTesting() ? (1000 * 10) : (1000 * 60 * 90) // 1.5 hours, 10 seconds if testing
            })
        }
        return phases;
    }

    override async onDecisionPhase(key: string): Promise<MessengerPayload[]> {
        switch(key) {
            case 'beginBankAuction':
                // TODO: Handle if there are no pieces left
                // First, choose a random available piece to auction off
                const pieceId = randChoice(...this.getAvailablePieceIds());
                // Set the bank auction state
                this.state.auctions.bank = {
                    pieceId,
                    bid: 0,
                    active: true
                };
                // Return the messages
                return [
                    'For today\'s bank auction, I present to you...',
                    {
                        files: [await this.renderAuction(pieceId, 'Bank Auction', 'bank')]
                    },
                    {
                        content: 'Do we have any bidders? Let\'s start with **$1**',
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.Button,
                                style: ButtonStyle.Success,
                                label: 'Bid',
                                custom_id: 'game:bankBid'
                            }]
                        }]
                    }
                ];
            case 'beginPrivateAuction':
                // Validate that the private auction even exists
                const auction = this.state.auctions.private;
                if (!auction) {
                    return [];
                }
                // Activate the private auction
                auction.active = true;
                // Return the messages
                return [
                    `Oh dear! It looks like this week\'s contest winner has chosen to force one of **${this.getPieceOwnerString(auction.pieceId)}'s** pieces into auction...`,
                    {
                        files: [await this.renderAuction(auction.pieceId, 'Private Auction', 'private')]
                    },
                    {
                        content: 'Do we have any bidders? Let\'s start with **$1**',
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.Button,
                                style: ButtonStyle.Success,
                                label: 'Bid',
                                custom_id: 'game:privateBid'
                            }]
                        }]
                    }
                ];
        }
        return [];
    }

    override async onDecisionPreNoon(): Promise<MessengerPayload[]> {
        const responseMessages: MessengerPayload[] = [];

        // Mark all existing auctions as inactive to prevent further action
        for (const auction of Object.values(this.state.auctions)) {
            delete auction.active;
        }

        // Process the active auctions
        for (const type of Object.keys(this.state.auctions)) {
            const auction = this.state.auctions[type];
            if (auction) {
                const { pieceId, bid, bidder } = auction;
                // Clear the auction to double-prevent further action
                delete this.state.auctions[type];
                if (bidder) {
                    // If the piece belonged to another player, add points to their balance
                    const previousOwnerId = this.getPieceOwner(pieceId);
                    if (typeof previousOwnerId === 'string') {
                        this.addPoints(previousOwnerId, bid);
                    }
                    // Assign the piece to this owner
                    this.getPiece(pieceId).owner = bidder;
                    // Deduct points from the player
                    this.addPoints(bidder, -bid);
                    // Reply with appropriate message
                    responseMessages.push({
                        content: `<@${bidder}> has won the auction for _"${this.getPieceName(pieceId)}"_ with a bid of **$${bid}**!`,
                        files: [await this.renderAuction(pieceId, `${capitalize(type)} Auction`, type)],
                        components: this.getDecisionActionRow()
                    });
                } else {
                    // Reply with appropriate message
                    responseMessages.push({
                        content: `No one bid on _"${this.getPieceName(pieceId)}"_! What??? I guess we'll save that one for another day...`
                    });
                }
            }
        }

        // Begin the silent auction
        if (this.getNumAvailablePieces() > 0) {
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

        return responseMessages;
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

    private mayPlayerSell(userId: Snowflake): boolean {
        return this.state.players[userId]?.maySell ?? false;
    }

    private mayPlayerForcePrivateAuction(userId: Snowflake): boolean {
        return this.state.players[userId]?.mayForceAuction ?? false;
    }

    private getPiece(pieceId: string): MasterpiecePieceState {
        return this.state.pieces[pieceId];
    }

    private getPieceName(pieceId: string): string {
        return this.getPiece(pieceId)?.name ?? '???';
    }

    private getPieceValue(pieceId: string): number {
        return this.getPiece(pieceId)?.value ?? 0;
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

    private getPiecesForUser(userId: Snowflake): MasterpiecePieceState[] {
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
        const uniquePieceValues = Array.from(new Set(MasterpieceGame.getPieceValues())).sort((x, y) => y - x);
        const rows = 7 + uniquePieceValues.length;
        const ROW_HEIGHT = 32;
        const padding = ROW_HEIGHT / 2;
        const c = canvas.createCanvas(ROW_HEIGHT * 5, rows * ROW_HEIGHT);
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
        return new AttachmentBuilder('assets/masterpiece/rules.png');
    }

    private async renderGallery(pieceIds: string[], background: string, options?: { showAvatars?: boolean }): Promise<AttachmentBuilder> {
        const backgroundImage = await imageLoader.loadImage(`assets/masterpiece/gallery/${background}.png`);
        const c = canvas.createCanvas(backgroundImage.width * pieceIds.length, backgroundImage.height);
        const context = c.getContext('2d');
        for (let i = 0; i < pieceIds.length; i++) {
            const pieceId = pieceIds[i];
            const baseX = i * backgroundImage.width;
            context.drawImage(backgroundImage, baseX, 0);
            // Draw the painting on the wall
            const pieceImage = await imageLoader.loadImage(`assets/masterpiece/pieces/${pieceId.toLowerCase()}.png`);
            context.drawImage(pieceImage, baseX + 154, 59);
            // Draw text below the piece
            context.drawImage(withDropShadow(getTextLabel(this.getPieceName(pieceId), 250, 40, { font: 'italic 30px serif', style: 'white' }), { expandCanvas: true }), baseX + 157, 369);
            context.drawImage(withDropShadow(getTextLabel(`$${this.getPieceValue(pieceId)}`, 250, 40, { font: '30px serif',  style: 'white' }), { expandCanvas: true }), baseX + 157, 405);
            // If enabled, draw the owner's avatar
            if (options?.showAvatars) {
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
        const pieceImage = await imageLoader.loadImage(`assets/masterpiece/pieces/${pieceId.toLowerCase()}.png`);
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
                const pieceImage = await imageLoader.loadImage(`assets/masterpiece/pieces/${pieceId.toLowerCase()}.png`);
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

        // Reset metadata for each player
        for (const userId of this.getPlayers()) {
            // Revoke any pending prize offers
            delete this.state.players[userId].maySell;
            delete this.state.players[userId].mayForceAuction;
        }

        // TODO: Do something here
        return [];
    }

    override async getPreProcessingMessages(): Promise<MessengerPayload[]> {
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

    override endDay(): void {
        // At noon after the final game update all the pieces should be sold, so add the winners here to complete the game
        if (this.getNumUnsoldPieces() === 0) {
            for (const userId of this.getTrueOrderedPlayers().slice(0, 3)) {
                this.addWinner(userId);
            }
        }
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
        switch (type) {
            case 'submissions1':
                // If the player has no paintings, only allow them to force someone's paintings into auction
                if (!this.hasAnyPieces(userId)) {
                    this.state.players[userId].mayForceAuction = true;
                    return [{
                        content: `${intro}! Since you don't currently own any pieces, I will only let you choose an opponent's piece to be forced into auction on Saturday. You have until Saturday morning to select this option`,
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.Button,
                                style: ButtonStyle.Danger,
                                label: 'Force Auction',
                                customId: 'game:forcePrivateAuction'
                            }]
                        }]
                    }];
                }
                // Else, allow them to pick
                this.state.players[userId].maySell = true;
                this.state.players[userId].mayForceAuction = true;
                return [
                    `${intro}, as a reward you may choose to sell one of your paintings to the museum or force another player's piece into auction. `
                        + 'If you choose to sell a piece, it will be sold to a museum at face value on Sunday morning, at which point it will be removed from the game. '
                        + 'If you choose to force a piece in auction, a private auction (excluding the piece\'s owner) will be held on Saturday morning for you and others to bid on it.',
                    {
                        content: 'Which would you like to do? You have until Saturday morning to choose',
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.Button,
                                style: ButtonStyle.Success,
                                label: 'Sell',
                                customId: 'game:sell'
                            }, {
                                type: ComponentType.Button,
                                style: ButtonStyle.Danger,
                                label: 'Force Auction',
                                customId: 'game:forcePrivateAuction'
                            }]
                        }]
                    }
                ];
            case 'submissions1-tied':
                // If the player has no paintings, don't let them do anything
                if (!this.hasAnyPieces(userId)) {
                    return [`${intro}! Since you don't currently own any pieces, there's no special prize for you (I can't let multiple players force a private auction). Sorry!`];
                }
                // Else, allow them to sell
                this.state.players[userId].maySell = true;
                return [
                    `${intro}, as a reward you may choose to sell one of your paintings to the museum (I can't let multiple players force a private auction). `
                        + 'If you choose to sell a piece, it will be sold to a museum at face value on Sunday morning, at which point it will be removed from the game.',
                    {
                        content: 'Which would you like to do? You have until Saturday morning to choose',
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.Button,
                                style: ButtonStyle.Success,
                                label: 'Sell',
                                customId: 'game:sell'
                            }]
                        }]
                    }
                ];
            default:
                return [];
        }
    }

    override async addPlayerDecision(userId: string, text: string): Promise<MessengerPayload> {
        // Validate that there's an active silent auction
        if (!this.state.silentAuctionPieceId) {
            throw new Error('You can\'t do that now, there\'s no piece currently for sale!');
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
        // Process any pending sale first and foremost
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
                    await interaction.reply({
                        ephemeral: true,
                        content: 'Here are the rules of the game',
                        files: [await this.renderRules()]
                    });
                    break;
                case 'game:inventory':
                    if (this.hasAnyPieces(userId)) {
                        await interaction.reply({
                            ephemeral: true,
                            content: `You have **$${this.getPoints(userId)}** in cash, plus the following pieces in your gallery:`,
                            files: [await this.renderInventory(userId)]
                        });
                    } else {
                        await interaction.reply({
                            ephemeral: true,
                            content: `You have **$${this.getPoints(userId)}** in cash, but no pieces of art ...yet`
                        });
                    }
                    break;
                case 'game:bankBid':
                    await this.handleBid('bank', interaction);
                    break;
                case 'game:privateBid':
                    await this.handleBid('private', interaction);
                    break;
                case 'game:sell':
                    // Validate that this user can do this
                    if (!this.mayPlayerSell(userId)) {
                        await interaction.reply({
                            ephemeral: true,
                            content: 'You can\'t do that right now! Perhaps you\'ve already chosen an action?'
                        });
                        return;
                    }
                    // Get all the pieces that this user may sell
                    const pieceIds = this.getPieceIdsForUser(userId);
                    if (pieceIds.length === 0) {
                        await interaction.reply({
                            ephemeral: true,
                            content: 'You don\'t have any pieces to sell at the moment!'
                        });
                        return;
                    }
                    // Respond with a select menu of all the pieces this user may sell
                    await interaction.reply({
                        ephemeral: true,
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
                        }],
                    });
                    break;
                case 'game:forcePrivateAuction':
                    // Validate that this user can do this
                    if (!this.mayPlayerForcePrivateAuction(userId)) {
                        await interaction.reply({
                            ephemeral: true,
                            content: 'You can\'t do that right now! Perhaps you\'ve already chosen an action?'
                        });
                        return;
                    }
                    // Get all the pieces that this user may force into auction
                    const otherPieceIds = this.getPieceIdsForOtherUsers(userId);
                    if (otherPieceIds.length === 0) {
                        await interaction.reply({
                            ephemeral: true,
                            content: 'There are no pieces that can be forced into auction at this moment'
                        });
                        return;
                    }
                    // Respond with a select menu of all the pieces this user may force into auction
                    await interaction.reply({
                        ephemeral: true,
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
            }
        } else if (interaction.isStringSelectMenu()) {
            switch (interaction.customId) {
                case 'game:sellSelect': {
                    // Validate that this user can do this
                    if (!this.mayPlayerSell(userId)) {
                        await interaction.reply({
                            ephemeral: true,
                            content: 'You can\'t do that right now! Perhaps you\'ve already chosen an action?'
                        });
                        return;
                    }
                    // Validate and set up the sale of this piece
                    const pieceId = interaction.values[0];
                    if (!this.hasPieceWithId(pieceId)) {
                        await interaction.reply({
                            ephemeral: true,
                            content: `Woah! Piece with ID \`${pieceId}\` doesn't exist... (see admin)`
                        });
                        return;
                    }
                    if (this.getPieceOwner(pieceId) !== userId) {
                        await interaction.reply({
                            ephemeral: true,
                            content: `You can't sell _"${this.getPieceName(pieceId)}"_, that piece belongs to **${this.getPieceOwnerString(pieceId)}**`
                        });
                        return;
                    }
                    // Update the state
                    this.getPiece(pieceId).toBeSold = true;
                    delete this.state.players[userId].maySell;
                    delete this.state.players[userId].mayForceAuction;
                    // Reply to the user confirming the sale
                    await interaction.reply({
                        ephemeral: true,
                        content: `Confirmed! _"${this.getPieceName(pieceId)}"_ will be sold to the museum Sunday morning for **$${this.getPieceValue(pieceId)}**`
                    });
                    void logger.log(`<@${userId}> has chosen to sell their piece _"${this.getPieceName(pieceId)}"_`);
                    break;
                }
                case 'game:forcePrivateAuctionSelect': {
                    // Validate that this user can do this
                    if (!this.mayPlayerForcePrivateAuction(userId)) {
                        await interaction.reply({
                            ephemeral: true,
                            content: 'You can\'t do that right now! Perhaps you\'ve already chosen an action?'
                        });
                        return;
                    }
                    // Validate and set up the forced auction
                    const pieceId = interaction.values[0];
                    if (!this.hasPieceWithId(pieceId)) {
                        await interaction.reply({
                            ephemeral: true,
                            content: `Woah! Piece with ID \`${pieceId}\` doesn't exist... (see admin)`
                        });
                        return;
                    }
                    if (this.getPieceOwner(pieceId) === userId) {
                        await interaction.reply({
                            ephemeral: true,
                            content: `You can't force _"${this.getPieceName(pieceId)}"_ into auction, that piece belongs to you!`
                        });
                        return;
                    }
                    // Update the state
                    this.state.auctions.private = {
                        pieceId,
                        bid: 0
                    };
                    delete this.state.players[userId].maySell;
                    delete this.state.players[userId].mayForceAuction;
                    // Reply to the user confirming the forced auction
                    await interaction.reply({
                        ephemeral: true,
                        content: `Confirmed! _"${this.getPieceName(pieceId)}"_ will be forced into a private auction on Saturday morning`
                    });
                    void logger.log(`<@${userId}> has chosen to force **${this.getPieceOwnerString(pieceId)}'s** piece _"${this.getPieceName(pieceId)}"_ into a private auction`);
                    break;
                }
            }
        }
    }

    private async handleBid(type: AuctionType, interaction: ButtonInteraction) {
        const userId = interaction.user.id;
        const auction = this.state.auctions[type];
        // Ensure the auction exists and is active
        if (!auction || !auction.active) {
            await interaction.reply({
                ephemeral: true,
                content: `You can't place a bid right now, as there's no active ${type} auction!`
            });
            return;
        }
        // The player cannot bid on the same piece twice in a row
        if (userId === auction.bidder) {
            await interaction.reply({
                ephemeral: true,
                content: 'You were the last one to bid! Wait until someone else bids, then try again...'
            });
            return;
        }
        // The player cannot bid on a piece they own (e.g. cannot bid on a piece stolen from you via private auction)
        if (userId === this.getPieceOwner(auction.pieceId)) {
            await interaction.reply({
                ephemeral: true,
                content: 'This is your piece, buddy. You can\'t bid on it! You must sit in the corner and watch as everyone bids on your own piece.'
            });
            return;
        }
        // Compute the target bid and validate whether the user can even place a bid
        const bidAmount = auction.bid + 1;
        const existingBidLiability = this.getPlayerBidLiability(userId);
        const totalLiability = bidAmount + existingBidLiability;
        if (totalLiability > this.getPoints(userId)) {
            await interaction.reply({
                ephemeral: true,
                content: `You can't place a **$${bidAmount}** bid, as you only have **$${this.getPoints(userId)}**!`
                    + (existingBidLiability > 0 ? ` (and you're currently bidding **$${existingBidLiability}** on other auctions)` : '')
            });
            return;
        }
        // Check and acquire the lock
        if (this.auctionLock) {
            await interaction.reply({
                ephemeral: true,
                content: 'Someone else is placing a bid at this exact moment, try again in half a second...'
            });
            return;
        }
        this.auctionLock = true;
        // Place the bid
        auction.bidder = userId;
        auction.bid = bidAmount;
        // Reply and notify the channel
        const pieceId = auction.pieceId;
        const pieceName = this.getPiece(pieceId).name;
        await interaction.reply({
            ephemeral: true,
            content: `You've placed a bid on _"${pieceName}"_!`
        });
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
                    custom_id: `game:${type}Bid`
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