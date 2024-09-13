import { ActionRowData, APIButtonComponent, AttachmentBuilder, ButtonStyle, ComponentType, GuildMember, Interaction, MessageActionRowComponentData, MessageEditOptions, Snowflake } from "discord.js";
import { GamePlayerAddition, MessengerPayload, PrizeType, DecisionProcessingResult, MessengerManifest } from "../types";
import AbstractGame from "./abstract-game";
import { CandyLandColor, CandyLandGameState, CandyLandPlayerState } from "./types";
import { chance, joinCanvasesHorizontal, joinCanvasesVertical, naturalJoin, randChoice, randInt, shuffle, toCircle, toFixed, withDropShadow } from "evanw555.js";
import { Canvas, ImageData, createCanvas } from "canvas";
import { cropAroundPoints, generateRandomNonsequentialSequence, renderArrow, withAn } from "../util";

import imageLoader from "../image-loader";
import logger from "../logger";

interface Coordinates {
    x: number,
    y: number
}

interface PixelColor {
    r: number,
    g: number,
    b: number,
    a: number
}

interface CandyLandConfig {
    colorMap: Record<CandyLandColor, PixelColor>,
    colorNames: Record<CandyLandColor, string>,
    variantNames: Record<number, string>,
    spaces: Coordinates[]
}

export default class CandyLandGame extends AbstractGame<CandyLandGameState> {
    private static config: CandyLandConfig = {
        colorMap: {
            START: { r: 0, g: 0, b: 0, a: 255 },
            R: { r: 196, g: 26, b: 26, a: 255 },
            O: { r: 230, g: 106, b: 18, a: 255 },
            Y: { r: 242, g: 190, b: 48, a: 255 },
            G: { r: 6, g: 140, b: 26, a: 255 },
            B: { r: 28, g: 59, b: 214, a: 255 },
            P: { r: 89, g: 40, b: 148, a: 255 },
            K: { r: 222, g: 84, b: 206, a: 255 },
            W: { r: 245, g: 245, b: 245, a: 255 },
            END: { r: 0, g: 0, b: 0, a: 255 },
        },
        colorNames: {
            START: 'Start',
            R: 'Red',
            O: 'Orange',
            Y: 'Yellow',
            G: 'Green',
            B: 'Blue',
            P: 'Purple',
            K: 'Pink',
            W: 'White',
            END: 'End'
        },
        variantNames: {
            0: '',
            1: 'uncommon',
            2: 'rare',
            3: 'mythic'
        },
        spaces: [
            // 0
            { "x": 98, "y": 820 }, // Start
            { "x": 243, "y": 815 },
            { "x": 297, "y": 836 },
            { "x": 347, "y": 859 },
            { "x": 403, "y": 869 },
            { "x": 460, "y": 860 },
            { "x": 503, "y": 826 },
            { "x": 533, "y": 778 },
            { "x": 559, "y": 727 },
            { "x": 591, "y": 682 },
            // 10
            { "x": 641, "y": 659 },
            { "x": 697, "y": 656 },
            { "x": 748, "y": 674 },
            { "x": 778, "y": 722 },
            { "x": 744, "y": 768 },
            { "x": 717, "y": 816 },
            { "x": 753, "y": 861 },
            { "x": 807, "y": 877 },
            { "x": 863, "y": 872 },
            { "x": 917, "y": 863 },
            // 20
            { "x": 967, "y": 838 },
            { "x": 990, "y": 787 },
            { "x": 995, "y": 731 },
            { "x": 972, "y": 680 },
            { "x": 932, "y": 640 },
            { "x": 906, "y": 591 },
            { "x": 903, "y": 536 },
            { "x": 904, "y": 481 },
            { "x": 920, "y": 428 },
            { "x": 944, "y": 378 },
            // 30
            { "x": 969, "y": 331 },
            { "x": 975, "y": 277 },
            { "x": 939, "y": 236 },
            { "x": 886, "y": 218 },
            { "x": 829, "y": 220 },
            { "x": 780, "y": 244 },
            { "x": 752, "y": 291 },
            { "x": 760, "y": 345 },
            { "x": 784, "y": 394 },
            { "x": 799, "y": 447 },
            // 40
            { "x": 793, "y": 501 },
            { "x": 764, "y": 546 },
            { "x": 713, "y": 569 },
            { "x": 659, "y": 575 },
            { "x": 610, "y": 551 },
            { "x": 561, "y": 528 },
            { "x": 507, "y": 538 },
            { "x": 478, "y": 582 },
            { "x": 490, "y": 635 },
            { "x": 476, "y": 687 },
            // 50
            { "x": 421, "y": 694 },
            { "x": 373, "y": 665 },
            { "x": 324, "y": 641 },
            { "x": 277, "y": 671 },
            { "x": 227, "y": 696 },
            { "x": 172, "y": 691 },
            { "x": 120, "y": 671 },
            { "x": 92, "y": 622 },
            { "x": 100, "y": 568 },
            { "x": 108, "y": 515 },
            // 60
            { "x": 98, "y": 461 },
            { "x": 77, "y": 409 },
            { "x": 59, "y": 359 },
            { "x": 63, "y": 304 },
            { "x": 87, "y": 255 },
            { "x": 133, "y": 231 },
            { "x": 187, "y": 234 },
            { "x": 235, "y": 259 },
            { "x": 259, "y": 306 },
            { "x": 257, "y": 361 },
            // 70
            { "x": 217, "y": 400 },
            { "x": 200, "y": 451 },
            { "x": 219, "y": 500 },
            { "x": 268, "y": 523 },
            { "x": 322, "y": 531 },
            { "x": 378, "y": 524 },
            { "x": 425, "y": 497 },
            { "x": 447, "y": 338 } // End
        ]
    };

    constructor(state: CandyLandGameState) {
        super(state);
    }

    static create(members: GuildMember[], season: number, halloween?: true): CandyLandGame {
        // Populate players
        const players: Record<Snowflake, CandyLandPlayerState> = {};
        for (const member of members) {
            players[member.id] = {
                displayName: member.displayName,
                points: 0,
                location: 0
            };
        }
        // Populate spaces
        const spaces: CandyLandColor[] = generateRandomNonsequentialSequence(['R', 'O', 'Y', 'G', 'B', 'P', 'K', 'W'] as CandyLandColor[], 4, CandyLandGame.config.spaces.length);
        spaces[0] = 'START';
        spaces[spaces.length - 1] = 'END';
        return new CandyLandGame({
            type: 'CANDYLAND',
            season,
            winners: [],
            decisions: {},
            turn: 0,
            players,
            cards: {},
            spaces
        })
    }

    private getReplacementCost(): number {
        // TODO: Make this dynamic?
        return 10;
    }

    private getRandomCardVariant(): number {
        // Lower variant numbers are more common
        const NUM_VARIANTS = 4;
        for (let i = 0; i < NUM_VARIANTS; i++) {
            if (chance(0.6)) {
                return i;
            }
        }
        return NUM_VARIANTS - 1;
    }

    private getCardDescriptor(color: CandyLandColor, variant: number): string {
        const variantName = CandyLandGame.config.variantNames[variant];
        if (!variantName) {
            return withAn(`**${CandyLandGame.config.colorNames[color]}**`);
        }
        return withAn(`_${variantName}_ **${CandyLandGame.config.colorNames[color]}**`);
    }

    private getPlayerCardDescriptor(userId: Snowflake): string {
        const weeklyCard = this.state.cards[userId];
        if (!weeklyCard) {
            return 'nothing';
        }
        return this.getCardDescriptor(weeklyCard.card, weeklyCard.variant);
    }

    private getColorStyle(color: CandyLandColor): string {
        const map = CandyLandGame.config.colorMap[color];
        return `rgb(${map.r}, ${map.g}, ${map.b})`;
    }

    private getNumSpaces(): number {
        return this.state.spaces.length;
    }

    private getSpaceColor(location: number): CandyLandColor {
        return this.state.spaces[location];
    }

    private getSpaceCoordinates(location: number): Coordinates {
        return CandyLandGame.config.spaces[location];
    }

    private getStretchCoordinates(fromLocation: number, toLocation: number): Coordinates[] {
        const result: Coordinates[] = [];
        for (let i = fromLocation; i <= toLocation; i++) {
            result.push(this.getSpaceCoordinates(i));
        }
        return result;
    }

    private drawRandomCard(): CandyLandColor {
        return randChoice('R', 'O', 'Y', 'G', 'B', 'P', 'K', 'W');
    }

    override async getIntroductionMessages(): Promise<MessengerPayload[]> {
        return [{
            content: 'Welcome to _Cute Scott\'s Candy Kingdom_!',
            files: [await this.renderStateAttachment()]
        }, 'The goal is hop merrily from space to space along the winding rainbow trail until you reach Cute Scott\'s Candy Keep!', {
            content: 'Each week, you\'ll be able to draw a random card that dictates how far you shall go. When you draw a card of a given color, '
                + 'you will hop to the next space of that color. You can use your hard-earned GMBR points to re-draw if your card is crud. '
                + 'Also, card trading will be supported in 2 weeks, so you can anticipate that...',
            components: this.getDecisionActionRow()
        }];
    }

    override getInstructionsText(): string {
        return 'Click to draw a card!';
    }

    override getReminderText(): string {
        return 'Reminder! You have until tomorrow morning to draw a card';
    }

    getSeasonCompletion(): number {
        return this.getMaxPlayerLocation() / this.getNumSpaces();
    }

    getPlayers(): string[] {
        return Object.keys(this.state.players);
    }

    getOrderedPlayers(): string[] {
        // TODO: Handle tie-breakers
        return this.getPlayers().sort((x, y) => this.getPlayerLocation(y) - this.getPlayerLocation(x));
    }

    hasPlayer(userId: string): boolean {
        return userId in this.state.players;
    }

    addLatePlayers(players: GamePlayerAddition[]): MessengerPayload[] {
        // Place all new players at the current worst player location
        const location = this.getMinPlayerLocation();
        for (const { userId, displayName, points } of players) {
            this.state.players[userId] = {
                displayName,
                points,
                location
            };
        }
        return this.getStandardWelcomeMessages(players.map(p => p.userId));
    }

    updatePlayer(member: GuildMember): void {
        if (this.hasPlayer(member.id)) {
            this.state.players[member.id].displayName = member.displayName;
        }
    }

    removePlayer(userId: string): void {
        delete this.state.players[userId];
        // TODO: Handle pending trades
    }

    override addNPCs(): void {
        // for (let i = 0; i < 10; i++) {
        //     const userId = `npc${i}`;
        //     this.state.players[userId] = {
        //         displayName: `NPC ${i}`,
        //         points: 0,
        //         location: 0
        //     };
        // }
    }

    private getPlayerDisplayName(userId: Snowflake): string {
        return this.state.players[userId]?.displayName ?? `<@${userId}>`;
    }

    private getPlayerLocation(userId: Snowflake): number {
        return this.state.players[userId]?.location ?? 0;
    }

    private getAllPlayerLocations(): number[] {
        return Object.values(this.state.players).map(p => p.location);
    }

    private getMaxPlayerLocation(): number {
        return Math.max(...this.getAllPlayerLocations());
    }

    private getMinPlayerLocation(): number {
        return Math.min(...this.getAllPlayerLocations());
    }

    private getPlayersAtLocation(location: number): Snowflake[] {
        return this.getPlayers().filter(userId => this.getPlayerLocation(userId) === location);
    }

    private hasPlayerCard(userId: Snowflake): boolean {
        return this.state.cards[userId] !== undefined;
    }

    private getPlayerCard(userId: Snowflake): string {
        return this.state.cards[userId].card;
    }

    private getPlayerCardVariant(userId: Snowflake): number {
        return this.state.cards[userId].variant;
    }

    private addToPlayerLog(userId: Snowflake, text: string) {
        return this.state.cards[userId].log.push(text);
    }

    private getTokenCoordinates(coordinates: Coordinates, n: number, options?: { spacing?: number }): Coordinates[] {
        const spacing = options?.spacing ?? 16;
        if (n === 0) {
            return [];
        } else if (n === 1) {
            return [{ ...coordinates }];
        } else if (n < 7) {
            // Get a series of locations around the target coordinates
            const result: Coordinates[] = [];
            for (let i = 0; i < n; i++) {
                const angle = (i / n) * Math.PI * 2
                    // Add 45 degrees just to shift it diagonally
                    + (Math.PI / 4);
                result.push({
                    x: coordinates.x + Math.round(spacing * Math.cos(angle)),
                    y: coordinates.y + Math.round(spacing * Math.sin(angle))
                });
            }
            // void logger.log(`Drawing ${n} concentric tokens at space: \`${JSON.stringify(result)}\``);
            return result;
        } else {
            // Else, just show them haphazardly
            const result: Coordinates[] = [];
            for (let i = 0; i < n; i++) {
                result.push({
                    x: randInt(coordinates.x - spacing * 2, coordinates.x + spacing * 2),
                    y: randInt(coordinates.y - spacing * 2, coordinates.y + spacing * 2)
                });
            }
            // void logger.log(`Drawing ${n} haphazard tokens at space: \`${JSON.stringify(result)}\``);
            return result;
        }
    }

    async renderCardDraw(color: CandyLandColor, variant: number): Promise<Canvas> {
        const cardImage = await imageLoader.loadImage(`assets/candyland/cards/${color}${variant}.png`);

        const canvas = createCanvas(cardImage.width, cardImage.height);
        const context = canvas.getContext('2d');

        // TODO: Should there be a background too?
        context.drawImage(cardImage, 0, 0);

        return canvas;
    }

    async renderBoard(options?: { from?: number, to?: number, card?: { card: CandyLandColor, variant: number } }): Promise<Buffer> {
        const boardBase = await imageLoader.loadImage('assets/candyland/board_base.png');

        const canvas = createCanvas(boardBase.width, boardBase.height);
        const context = canvas.getContext('2d');

        context.drawImage(boardBase, 0, 0);

        // For each space, edit the color of that part of the image data
        await logger.log('Loading board spaces image...');
        const boardSpaces = await imageLoader.loadImage('assets/candyland/board_spaces.png');
        const spaceCanvas = createCanvas(boardSpaces.width, boardSpaces.height);
        const spaceContext = spaceCanvas.getContext('2d');
        spaceContext.drawImage(boardSpaces, 0, 0);
        await logger.log('Getting board spaces image data...');
        const spaceImageData = spaceContext.getImageData(0, 0, spaceCanvas.width, spaceCanvas.height);
        for (let i = 0; i < this.getNumSpaces(); i++) {
            const color = this.state.spaces[i];
            const coordinates = this.getSpaceCoordinates(i);
            if (color === 'START' || color === 'END') {
                continue;
            }
            // Adjust the color for this space
            // TODO: Temporarily disabling to see if avatar loading is causing the crashes
            // this.floodColor(spaceImageData, coordinates, CandyLandGame.config.colorMap[color]);
        }
        await logger.log('Putting board spaces image data...');
        spaceContext.putImageData(spaceImageData, 0, 0);
        await logger.log('Drawing altered image data onto main context...');
        context.drawImage(spaceCanvas, 0, 0);

        // For each space, draw all players on that space
        await logger.log('Loading avatars...');
        for (let i = 0; i < this.getNumSpaces(); i++) {
            const coordinates = this.getSpaceCoordinates(i);
            const playersHere = this.getPlayersAtLocation(i);
            // Show all player tokens on this space
            const tokenCoordinates = this.getTokenCoordinates(coordinates, playersHere.length, { spacing: 14 });
            for (let j = 0; j < playersHere.length; j++) {
                const userId = playersHere[j];
                const { x, y } = tokenCoordinates[j];
                // const avatar = await this.getAvatarBall(userId);
                // TODO: Temporarily disabling to see if avatar loading is causing the crashes
                const avatar = await imageLoader.loadAvatar(userId, 128);
                context.drawImage(avatar, x - 21, y - 21, 42, 42);
            }
        }

        // If to/from are specified, crop to all the spaces traversed
        if (options?.from !== undefined && options?.to !== undefined && options?.card !== undefined) {
            const { center } = renderArrow(context, this.getSpaceCoordinates(options.from), this.getSpaceCoordinates(options.to), { fillStyle: this.getColorStyle(options.card.card), thickness: 14, tailPadding: 14, tipPadding: 14 });
            // Show the card if specified
            const cardImage = withDropShadow(await this.renderCardDraw(options.card.card, options.card.variant), { expandCanvas: true });
            // Show the card on the center of the arrow
            context.drawImage(cardImage, center.x - (cardImage.width * 0.175), center.y - (cardImage.height * 0.175), cardImage.width * 0.35, cardImage.height * 0.35);
            
            const cropped = cropAroundPoints(canvas, this.getStretchCoordinates(options.from, options.to), { margin: 42 });
            return cropped.toBuffer();
        }

        return canvas.toBuffer();
    }

    override async renderState(options?: { showPlayerDecision?: string | undefined; seasonOver?: boolean | undefined; admin?: boolean | undefined; } | undefined): Promise<Buffer> {
        return await this.renderBoard();
    }

    private getPixelColor(imageData: ImageData, point: Coordinates): PixelColor {
        const index = 4 * (point.y * imageData.width + point.x);
        const pixelData = imageData.data.slice(index, index + 4);
        return {
            r: pixelData[0],
            g: pixelData[1],
            b: pixelData[2],
            a: pixelData[3]
        };
    }

    // Doesn't set alpha
    private setPixelColor(imageData: ImageData, point: Coordinates, color: PixelColor) {
        const index = 4 * (point.y * imageData.width + point.x);
        imageData.data[index] = color.r;
        imageData.data[index + 1] = color.g;
        imageData.data[index + 2] = color.b;
    }

    private getAllContiguousPixelsWithPredicate(imageData: ImageData, source: Coordinates, predicate: (pixel: Coordinates) => boolean): Coordinates[] {
        const result: Coordinates[] = [];

        const check = (pixel: Coordinates) => {
            // If OOB, abort
            if (pixel.x < 0 || pixel.x >= imageData.width || pixel.y < 0 || pixel.y >= imageData.height) {
                return;
            }
            // If pixel satisfies predicate, add it to list and check its neighbors
            if (predicate(pixel)) {
                // If already on list, abort
                if (result.some(c => c.x === pixel.x && c.y === pixel.y)) {
                    return;
                }
                // Add it to list
                result.push(pixel);
                // Check adjacent pixels
                check({ x: pixel.x + 1, y: pixel.y });
                check({ x: pixel.x - 1, y: pixel.y });
                check({ x: pixel.x, y: pixel.y + 1 });
                check({ x: pixel.x, y: pixel.y - 1 });
            }
        };

        check(source);

        return result;
    }

    private getAllContiguousNonTranslucentPixels(imageData: ImageData, source: Coordinates): Coordinates[] {
        return this.getAllContiguousPixelsWithPredicate(imageData, source, (pixel: Coordinates) => {
            // If non-translucent
            const pixelColor = this.getPixelColor(imageData, pixel);
            return pixelColor.a > 0;
        });

    }

    private getAllContiguousPixelsOfSameColor(imageData: ImageData, source: Coordinates): Coordinates[] {
        const sourceColor = this.getPixelColor(imageData, source);
        return this.getAllContiguousPixelsWithPredicate(imageData, source, (pixel: Coordinates) => {
            // If same color (ignoring alpha, but not opaque)
            const pixelColor = this.getPixelColor(imageData, pixel);
            return pixelColor.r === sourceColor.r && pixelColor.g === sourceColor.g && pixelColor.b === sourceColor.b && pixelColor.a > 0;
        });
    }

    private floodColor(imageData: ImageData, point: Coordinates, color: PixelColor) {
        const pixelsToAlter = this.getAllContiguousNonTranslucentPixels(imageData, point);
        for (const pixel of pixelsToAlter) {
            this.setPixelColor(imageData, pixel, color);
        }
    }

    // TODO: Refactor to somewhere else
    private async getAvatarBall(userId: Snowflake): Promise<Canvas> {
        const avatar = await imageLoader.loadAvatar(userId, 128);
        const ringWidth = 12;

        const canvas = createCanvas(128 + 2 * ringWidth, 128 + 2 * ringWidth);
        const context = canvas.getContext('2d');

        context.fillStyle = 'black';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(toCircle(avatar), ringWidth, ringWidth, 128, 128);

        return toCircle(canvas);
    }

    override async beginTurn(): Promise<MessengerPayload[]> {
        this.state.turn++;

        // Wipe all turn-related data for every player
        this.state.cards = {};

        // If there are NPCs, choose actions for them
        for (const userId of this.getPlayers()) {
            if (userId.startsWith('npc')) {
                const card = this.drawRandomCard();
                const variant = this.getRandomCardVariant();
                this.state.cards[userId] = {
                    card,
                    log: [`drew ${this.getCardDescriptor(card, variant)}`],
                    variant
                };
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

    awardPrize(userId: string, type: PrizeType, intro: string): MessengerPayload[] {
        // TODO: What should this actually do?
        return [];
    }

    private getNextLocationWithColor(location: number, color: CandyLandColor): number {
        for (let i = location + 1; i < this.getNumSpaces(); i++) {
            if (this.getSpaceColor(i) === color) {
                return i;
            }
        }
        // Else, return the end space
        return this.getNumSpaces() - 1;
    }

    override async processPlayerDecisions(): Promise<DecisionProcessingResult> {
        const playersToProcess = shuffle(Object.keys(this.state.cards));
        // TODO: Handle undefined case
        const userId = randChoice(...playersToProcess);
        const { card, variant, log } = this.state.cards[userId];
        delete this.state.cards[userId];

        const currentLocation = this.getPlayerLocation(userId);
        const nextLocation = this.getNextLocationWithColor(currentLocation, card);
        const diff = nextLocation - currentLocation;
        this.state.players[userId].location = nextLocation;

        return {
            continueProcessing: Object.keys(this.state.cards).length > 0,
            summary: {
                content: `**${this.getPlayerDisplayName(userId)}** ${naturalJoin(log, { conjunction: 'then' })}, moving **${diff}** space(s)!`,
                files: [await new AttachmentBuilder(await this.renderBoard({ from: currentLocation, to: nextLocation, card: { card, variant } })).setName(`game-week${this.getTurn()}.png`)]
            }
        };
    }

    override getDecisionActionRow(): ActionRowData<MessageActionRowComponentData>[] {
        return [{
            type: ComponentType.ActionRow,
            components: [{
                type: ComponentType.Button,
                label: 'Draw Card',
                style: ButtonStyle.Success,
                customId: 'game:draw'
            }]
        }]
    }

    override async handleGameInteraction(interaction: Interaction): Promise<MessengerManifest | undefined> {
        const userId = interaction.user.id;
        // Don't allow any sort of game interactions if not accepting decisions
        if (!this.isAcceptingDecisions()) {
            throw new Error('I\'m not accepting game decisions right now');
        }
        if (interaction.isButton()) {
            // Handle trade handling specially since there's an argument
            if (interaction.customId.startsWith('game:handleTrade:')) {
                const [ rootId, subId, decision, offererId ] = interaction.customId.split(':');
                // Validate that there is a valid trade offer for this user from that user
                const offererCard = this.state.cards[offererId];
                if (!offererCard) {
                    throw new Error(`Can't ${decision} trade offer from **${this.getPlayerDisplayName(offererId)}**, as they don't have a card!`);
                }
                if (!offererCard.trade) {
                    throw new Error(`Can't ${decision} trade offer from **${this.getPlayerDisplayName(offererId)}**, as their card isn't being offered!`);
                }
                if (offererCard.trade !== userId) {
                    throw new Error(`Can't ${decision} trade offer from **${this.getPlayerDisplayName(offererId)}**, as they're not offering their card to you!`);
                }
                // Validate that this user's card state is acceptable
                const userCard = this.state.cards[userId];
                if (!userCard) {
                    throw new Error(`Can't ${decision} trade offer from **${this.getPlayerDisplayName(offererId)}**, as you don't have a card to trade!`);
                }
                if (userCard.trade) {
                    throw new Error(`Can't ${decision} trade offer from **${this.getPlayerDisplayName(offererId)}**, as you're offering your card to someone else!`);
                }
                // Remove buttons from original trade offer
                await interaction.message.edit({
                    components: []
                });
                // Handle the trade decision
                if (decision === 'accept') {
                    // Swap the cards in the state
                    const userCardDescriptor = this.getCardDescriptor(userCard.card, userCard.variant);
                    this.state.cards[offererId] = {
                        card: userCard.card,
                        variant: userCard.variant,
                        log: [...offererCard.log, `traded with **${this.getPlayerDisplayName(userId)}** for ${userCardDescriptor}`]
                    };
                    const offererCardDescriptor = this.getCardDescriptor(offererCard.card, offererCard.variant);
                    this.state.cards[userId] = {
                        card: offererCard.card,
                        variant: offererCard.variant,
                        log: [...userCard.log, `traded with **${this.getPlayerDisplayName(offererId)}** for ${offererCardDescriptor}`]
                    };
                    // Notify both users
                    await interaction.reply({
                        ephemeral: true,
                        content: `Accepted trade offer from **${this.getPlayerDisplayName(offererId)}**. You traded ${userCardDescriptor} for ${offererCardDescriptor}!`,
                        files: [new AttachmentBuilder((await this.renderCardDraw(offererCard.card, offererCard.variant)).toBuffer()).setName('trade.png')]
                    });
                    return {
                        dms: {
                            [offererId]: [{
                                content: `**${this.getPlayerDisplayName(userId)}** accepted your trade offer. You traded ${offererCardDescriptor} for ${userCardDescriptor}!`,
                                files: [new AttachmentBuilder((await this.renderCardDraw(userCard.card, userCard.variant)).toBuffer()).setName('trade.png')]
                            }]
                        }
                    };
                } else if (decision === 'decline') {
                    // Wipe the pending trade offer flag
                    delete offererCard.trade;
                    // Notify both users
                    await interaction.reply({
                        ephemeral: true,
                        content: `Declined trade offer from **${this.getPlayerDisplayName(offererId)}**, they have been notified.`
                    });
                    return {
                        dms: {
                            [offererId]: [`**${this.getPlayerDisplayName(userId)}** has declined your trade offer...`]
                        }
                    };
                } else {
                    throw new Error(`Unrecognized trade decision: \`${decision}\``);
                }
            }
            switch (interaction.customId) {
                case 'game:draw': {
                    // Handle the free draw
                    let content = '';
                    const files: AttachmentBuilder[] = [];
                    const buttons: APIButtonComponent[] = [];
                    // TODO: Enable once trading is implemented and tested
                    // const buttons: APIButtonComponent[] = [{
                    //     type: ComponentType.Button,
                    //     style: ButtonStyle.Primary,
                    //     label: 'Trade',
                    //     custom_id: 'game:trade'
                    // }];
                    if (this.hasPlayerCard(userId)) {
                        content = `You previously drew ${this.getPlayerCardDescriptor(userId)}. `;
                    } else {
                        // Actually draw a card and save it in the state
                        const card = this.drawRandomCard();
                        const variant = this.getRandomCardVariant();
                        this.state.cards[userId] = {
                            card,
                            variant,
                            log: [`drew ${this.getCardDescriptor(card, variant)}`]
                        };
                        content = `You've drawn ${this.getCardDescriptor(card, variant)}! `;
                        files.push(new AttachmentBuilder((await this.renderCardDraw(card, variant)).toBuffer()).setName('draw.png'));
                    }
                    // Add the option to replace if they can afford it
                    // TODO: Refactor the conditional re-draw code with the same logic below
                    if (this.getPoints(userId) >= this.getReplacementCost()) {
                        content += `You have **${this.getPoints(userId)}** points, so you can opt to re-draw at a cost of **${this.getReplacementCost()}** points`; // `. Alternatively, you can trade your card with another player`;
                        buttons.unshift({
                            type: ComponentType.Button,
                            style: ButtonStyle.Danger,
                            label: 'Re-Draw',
                            custom_id: 'game:redraw'
                        });
                    } else {
                        content += `You only have **${this.getPoints(userId)}** points, so you're stuck with this card`; // `either keep your card or trade it with someone else`;
                    }
                    await interaction.reply({
                        ephemeral: true,
                        content,
                        files,
                        components: buttons.length > 0 ? [{
                            type: ComponentType.ActionRow,
                            components: buttons
                        }] : undefined
                    });
                    break;
                }
                case 'game:redraw': {
                    // Validate that the user actually has a card
                    if (!this.hasPlayerCard(userId)) {
                        throw new Error('You can\'t re-draw, you don\'t have a card to begin with!');
                    }
                    // Validate that the player has enough points
                    if (this.getPoints(userId) < this.getReplacementCost()) {
                        throw new Error(`It costs **${this.getReplacementCost()}** points to re-draw, but you only have **${this.getPoints(userId)}**...`);
                    }
                    // Deduct points
                    this.addPoints(userId, -this.getReplacementCost());
                    // Re-draw a card
                    const card = this.drawRandomCard();
                    const variant = this.getRandomCardVariant();
                    this.state.cards[userId].card = card;
                    this.state.cards[userId].variant = variant;
                    this.addToPlayerLog(userId, `re-drew for ${this.getCardDescriptor(card, variant)}`);
                    // TODO: Refactor the conditional re-draw code with the same logic above
                    // Add the option to replace if they can afford it
                    let content = `You've re-drawn ${this.getCardDescriptor(card, variant)}. `;
                    const buttons: APIButtonComponent[] = [];
                    // TODO: Enable once trading is implemented and tested
                    // const buttons: APIButtonComponent[] = [{
                    //     type: ComponentType.Button,
                    //     style: ButtonStyle.Primary,
                    //     label: 'Trade',
                    //     custom_id: 'game:trade'
                    // }];
                    if (this.getPoints(userId) >= this.getReplacementCost()) {
                        content += `You have **${this.getPoints(userId)}** points, so you can opt to re-draw again at a cost of **${this.getReplacementCost()}** points`; // `. Alternatively, you can trade your card with another player`;
                        buttons.unshift({
                            type: ComponentType.Button,
                            style: ButtonStyle.Danger,
                            label: 'Re-Draw',
                            custom_id: 'game:redraw'
                        });
                    } else {
                        content += `You only have **${this.getPoints(userId)}** points, so you're stuck with this card`; // `either keep your card or trade it with someone else`;
                    }
                    // TODO: Merge logic once a default trade button is added
                    await interaction.reply({
                        ephemeral: true,
                        content,
                        files: [new AttachmentBuilder((await this.renderCardDraw(card, variant)).toBuffer()).setName('draw.png')],
                        components: buttons.length > 0 ? [{
                            type: ComponentType.ActionRow,
                            components: buttons
                        }] : undefined
                    });
                    break;
                }
                // TODO: Emergency stopgap to ensure this never gets triggered
                case 'ZZZgame:trade': {
                    // Validate that the user actually has a card
                    if (!this.hasPlayerCard(userId)) {
                        throw new Error('You can\'t trade, you don\'t have a card to begin with!');
                    }
                    await interaction.reply({
                        ephemeral: true,
                        content: 'Who would you like to trade with? When you select a user, a DM will be sent to them extending the offer _however_ the card being offered won\'t be revealed',
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.UserSelect,
                                custom_id: 'game:selectTradeUser',
                                min_values: 1,
                                max_values: 1
                            }]
                        }]
                    });
                    break;
                }
            }
        } else if (interaction.isUserSelectMenu()) {
            switch (interaction.customId) {
                // TODO: Emergency stopgap to ensure this never gets triggered
                case 'ZZZgame:selectTradeUser': {
                    // Validate that the user actually has a card
                    if (!this.hasPlayerCard(userId)) {
                        throw new Error('You can\'t trade, you don\'t have a card to begin with!');
                    }
                    // Validate that the user selected is valid
                    const targetUserId = interaction.values[0];
                    if (!targetUserId) {
                        throw new Error('You didn\'t select a user!');
                    }
                    if (!this.hasPlayer(targetUserId)) {
                        throw new Error('That player isn\'t in the game... Quit messing with me!');
                    }
                    if (!this.hasPlayerCard(targetUserId)) {
                        throw new Error(`**${this.getPlayerDisplayName(targetUserId)}** hasn't drawn a card yet, try again once they've done so`);
                    }
                    if (this.state.cards[targetUserId].trade) {
                        throw new Error(`**${this.getPlayerDisplayName(targetUserId)}** is currently offering their card to someone else...`);
                    }
                    // Set the trade target in the state
                    this.state.cards[userId].trade = targetUserId;
                    // Extend the trade offer
                    await interaction.reply({
                        ephemeral: true,
                        content: `Your trade offer has been sent to **${this.getPlayerDisplayName(targetUserId)}**!`
                    })
                    // TODO: Instruct them how to accept
                    return {
                        dms: {
                            [targetUserId]: [{
                                content: `**${this.getPlayerDisplayName(userId)}** has sent you a trade offer! You won't see what the card is until you accept`,
                                components: [{
                                    type: ComponentType.ActionRow,
                                    components: [{
                                        type: ComponentType.Button,
                                        style: ButtonStyle.Success,
                                        label: 'Accept',
                                        custom_id: `game:handleTrade:accept:${userId}`
                                    }, {
                                        type: ComponentType.Button,
                                        style: ButtonStyle.Danger,
                                        label: 'Decline',
                                        custom_id: `game:handleTrade:decline:${userId}`
                                    }]
                                }]
                            }]
                        }
                    };
                }
            }
        }
        return;
    }
}
