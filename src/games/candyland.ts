import { ActionRowData, APIButtonComponent, AttachmentBuilder, ButtonStyle, ComponentType, GuildMember, Interaction, MessageActionRowComponentData, Snowflake } from "discord.js";
import { GamePlayerAddition, MessengerPayload, PrizeType, DecisionProcessingResult, MessengerManifest } from "../types";
import AbstractGame from "./abstract-game";
import { CandyLandCardColor, CandyLandCardData, CandyLandBasicColor, CandyLandGameState, CandyLandPlayerState, CandyLandSpaceColor } from "./types";
import { chance, FileStorage, getRankString, getSortedKeys, mean, naturalJoin, randChoice, randInt, s, shuffle, toFixed } from "evanw555.js";
import { cropAroundPoints, resize, toCircle, withDropShadow } from "node-canvas-utils";
import { Canvas, ImageData, createCanvas } from "canvas";
import { generateRandomNonsequentialSequence, renderArrow, text, withAn } from "../util";

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
    colorMap: Record<CandyLandSpaceColor, PixelColor>,
    colorNames: Record<CandyLandCardColor, string>,
    variantNames: Record<number, string>,
    spaces: Coordinates[]
}

const BASIC_COLOR_MAP: Record<CandyLandBasicColor, true> = {
    B: true,
    G: true,
    K: true,
    O: true,
    P: true,
    R: true,
    W: true,
    Y: true
};

const ALL_BASIC_COLORS: CandyLandBasicColor[] = Object.keys(BASIC_COLOR_MAP) as CandyLandBasicColor[];

export default class CandyLandGame extends AbstractGame<CandyLandGameState> {
    private static config: CandyLandConfig = {
        colorMap: {
            START: { r: 128, g: 128, b: 128, a: 255 },
            R: { r: 196, g: 26, b: 26, a: 255 },
            O: { r: 230, g: 106, b: 18, a: 255 },
            Y: { r: 242, g: 190, b: 48, a: 255 },
            G: { r: 6, g: 140, b: 26, a: 255 },
            B: { r: 28, g: 59, b: 214, a: 255 },
            P: { r: 89, g: 40, b: 148, a: 255 },
            K: { r: 222, g: 84, b: 206, a: 255 },
            W: { r: 245, g: 245, b: 245, a: 255 },
            L: { r: 30, g: 30, b: 30, a: 255 },
            END: { r: 128, g: 128, b: 128, a: 255 },
        },
        colorNames: {
            R: 'Red',
            O: 'Orange',
            Y: 'Yellow',
            G: 'Green',
            B: 'Blue',
            P: 'Purple',
            K: 'Pink',
            W: 'White',
            L: 'Black',
            D: 'Dunce',
            X: 'Rainbow'
        },
        variantNames: {
            0: '',
            1: 'uncommon',
            2: 'rare',
            3: 'mythic'
        },
        spaces: [
            // 0
            { "x": 119, "y": 830 }, // Start
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
        const spaces: CandyLandSpaceColor[] = generateRandomNonsequentialSequence(ALL_BASIC_COLORS, 4, CandyLandGame.config.spaces.length);
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
        return 5;
    }

    private getCardDescriptor(card: CandyLandCardData): string {
        const clauses: string[] = [];
        // Add variant name first
        const variantName = CandyLandGame.config.variantNames[card.variant];
        if (variantName) {
            clauses.push(`_${variantName}_`);
        }
        // Add shiny
        if (card.shiny) {
            clauses.push('shiny');
        }
        // Add negative
        if (card.negative) {
            clauses.push('negative');
        }
        // Add actual color
        clauses.push(`**${CandyLandGame.config.colorNames[card.color]}**`);
        return withAn(clauses.join(' '));
    }

    private getPlayerCardDescriptor(userId: Snowflake): string {
        const weeklyCard = this.state.cards[userId];
        if (!weeklyCard) {
            return 'nothing';
        }
        return this.getCardDescriptor(weeklyCard.card);
    }

    private getCardTips(card: CandyLandCardData): string[] {
        const tips: string[] = [];
        if (card.shiny) {
            tips.push('"Shiny": Sends you to the next empty space if you land on another player.');
        }
        if (card.negative) {
            tips.push('"Negative": Inverts a card\'s actions (VERY BAD).');
        }
        if (card.color === 'X') {
            tips.push('"Rainbow": Sends you to the farthest non-black color.');
        }
        if (card.color === 'D') {
            tips.push('"Dunce": Takes you nowhere.');
        }
        if (card.color === 'L') {
            tips.push('"Black": Recolors your space to black, sends you to the next black space (if one exists).');
        }
        return tips;
    }

    private getColorStyle(color: CandyLandSpaceColor): string {
        const map = CandyLandGame.config.colorMap[color];
        return `rgb(${map.r}, ${map.g}, ${map.b})`;
    }

    private getNumSpaces(): number {
        return this.state.spaces.length;
    }

    private getSpaceColor(location: number): CandyLandSpaceColor {
        return this.state.spaces[location];
    }

    /**
     * Given some space and a distance parameter, return the list of colors of the given space and all the spaces within the specified distance.
     * @param location Some location on the board
     * @param distance Distance beyond and before the specified location
     */
    private getSpaceColorsAround(location: number, distance: number): CandyLandSpaceColor[] {
        const colors: CandyLandSpaceColor[] = [];
        for (let i = location - distance; i < location + distance; i++) {
            if (i >= 0 && i < this.getNumSpaces()) {
                colors.push(this.getSpaceColor(i));
            }
        }
        return colors;
    }

    private getSpaceCoordinates(location: number): Coordinates {
        return CandyLandGame.config.spaces[location];
    }

    private getStretchCoordinates(fromLocation: number, toLocation: number): Coordinates[] {
        const result: Coordinates[] = [];
        const minLocation = Math.min(fromLocation, toLocation);
        const maxLocation = Math.max(fromLocation, toLocation);
        for (let i = minLocation; i <= maxLocation; i++) {
            result.push(this.getSpaceCoordinates(i));
        }
        return result;
    }

    private drawRandomCardColor(): CandyLandCardColor {
        const availableSpecialColors: CandyLandCardColor[] = [];
        // Rainbows and blacks only appear starting on the second round of draws
        if (this.getTurn() >= 2) {
            availableSpecialColors.push('X', 'L');
        }
        // Dunces only appear starting on the third round of draws
        if (this.getTurn() >= 3) {
            availableSpecialColors.push('D');
        }
        // With a small random chance (8%), return a special color
        if (availableSpecialColors.length > 0 && chance(0.08)) {
            return randChoice(...availableSpecialColors);
        }
        // Otherwise, return a standard color
        return randChoice(...ALL_BASIC_COLORS);
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

    private drawRandomCard(): CandyLandCardData {
        return {
            // TODO: Add the possibility of drawing black
            color: this.drawRandomCardColor(),
            variant: this.getRandomCardVariant(),
            // Shinies only appear starting on the second round of draws
            shiny: (this.getTurn() >= 2 && chance(0.125)) ? true : undefined, // this.isTesting() ? 0.25 : 
            // Negatives only appear starting on the third round of draws
            negative: (this.getTurn() >= 3 && chance(0.075)) ? true : undefined // (this.isTesting() && this.getMaxPlayerLocation() > 20) ? 0.5 : 
        }
    }

    override async getIntroductionMessages(): Promise<MessengerPayload[]> {
        return [{
            content: 'Welcome to _Cute Scott\'s Candy Kingdom_!',
            files: [await this.renderStateAttachment()]
        },
        'The goal is hop merrily from space to space along the winding rainbow trail until you reach Cute Scott\'s Candy Keep!',
        'Each week, you\'ll be able to draw a random card that dictates how far you shall go. When you draw a card of a given color, '
            + 'you will hop to the next space of that color. You can use your hard-earned GMBR points to re-draw if your card is crud, '
            + 'or offer it to another player in a blind trade...',
        {
            content: 'Take note! For new features have been added this season:'
                + '\n- You can trade your drawn card with another player (the card is only shown once the trade is finalized...)'
                + '\n- Added _dunce_ as a new card color which results in no movement'
                + '\n- Added _rainbow_ as a new card color which sends you to the farthest color possible'
                + '\n- Cards may be _negative_, meaning that they\'ll send you backwards (this even applies to rainbows...)',
            files: [await this.renderRules()]
        }, {
            content: 'So what are you waiting for? Click here to draw your first card!',
            components: this.getDecisionActionRow()
        }];
    }

    override getInstructionsText(): string {
        return 'Click to draw a card!';
    }

    override getReminderText(): string {
        return 'Reminder! You have until tomorrow morning to draw a card';
    }

    override async onDecisionPreNoon(): Promise<MessengerManifest> {
        // On the first week, show the rules again
        if (this.getTurn() === 1) {
            return {
                public: [{
                    content: 'Good luck this season, here are the rules once again as decreed by the King of the Candy Kingdom, King Cute Scott 🍭👑',
                    files: [await this.renderRules()]
                }, {
                    content: 'Make sure to draw a card before tomorrow morning!',
                    components: this.getDecisionActionRow()
                }]
            };
        }
        // Otherwise, show state and generic reminder with draw button
        return {
            public: [{
                content: this.getReminderText(),
                files: [await this.renderStateAttachment()],
                components: this.getDecisionActionRow()
            }]
        };
    }

    getSeasonCompletion(): number {
        // Season completion is defined as the average of the top 3 players' board completion.
        // This way, completion reaches 100% only once the top 3 players have finished.
        // (Use average so the value is a little more fluid)
        return this.getAveragePodiumLocation() / (this.getNumSpaces() - 1);
    }

    getPlayers(): string[] {
        return Object.keys(this.state.players);
    }

    getOrderedPlayers(): string[] {
        // Sort by location (desc), then points (desc)
        return getSortedKeys(this.getPlayers(), [
            (id) => -this.getPlayerLocation(id),
            (id) => -this.getPoints(id)
        ]);
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
        delete this.state.cards[userId];
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

    override doesPlayerNeedHandicap(userId: Snowflake): boolean {
        // If the game is more than 20% done and this player is in the bottom half of players
        return this.hasPlayer(userId)
            && this.getSeasonCompletion() > 0.2
            && this.getOrderedPlayers().indexOf(userId) >= (this.getNumPlayers() * 0.5);
    }

    override doesPlayerNeedNerf(userId: Snowflake): boolean {
        // If the game is more than 50% done and this player is past the average podium location
        return this.getSeasonCompletion() > 0.5
            && this.getPlayerLocation(userId) > this.getAveragePodiumLocation();
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

    /**
     * @returns The average of the top 3 players' locations
     */
    private getAveragePodiumLocation(): number {
        const podiumUsers = this.getOrderedPlayers().slice(0, 3);
        if (podiumUsers.length === 0) {
            return 0;
        }
        return mean(podiumUsers.map(userId => this.getPlayerLocation(userId)));
    }

    private getMinPlayerLocation(): number {
        return Math.min(...this.getAllPlayerLocations());
    }

    private getPlayersAtLocation(location: number): Snowflake[] {
        return this.getPlayers().filter(userId => this.getPlayerLocation(userId) === location);
    }

    private getNumPlayersAtLocation(location: number): number {
        return this.getPlayersAtLocation(location).length;
    }

    private isSpaceOccupied(location: number): boolean {
        return this.getNumPlayersAtLocation(location) > 0;
    }

    private isPlayerAtEnd(userId: Snowflake): boolean {
        return this.getSpaceColor(this.getPlayerLocation(userId)) === 'END';
    }

    private hasPlayerCard(userId: Snowflake): boolean {
        return this.state.cards[userId] !== undefined;
    }

    private getPlayerCard(userId: Snowflake): CandyLandCardData {
        return this.state.cards[userId].card;
    }

    private getPlayerCardColor(userId: Snowflake): string {
        return this.state.cards[userId].card.color;
    }

    private getPlayerCardVariant(userId: Snowflake): number {
        return this.state.cards[userId].card.variant;
    }

    private getNumPlayerCards(): number {
        return Object.keys(this.state.cards).length;
    }

    private addToPlayerLog(userId: Snowflake, text: string) {
        return this.state.cards[userId].log.push(text);
    }

    private getTokenCoordinates(coordinates: Coordinates, n: number, options?: { horizontalSpacing?: number, verticalSpacing?: number }): Coordinates[] {
        const horizontalSpacing = options?.horizontalSpacing ?? 16;
        const verticalSpacing = options?.verticalSpacing ?? 16;
        if (n === 0) {
            return [];
        } else if (n === 1) {
            return [{ ...coordinates }];
        } else if (n < 13) {
            // Get a series of locations around the target coordinates
            const result: Coordinates[] = [];
            for (let i = 0; i < n; i++) {
                const angle = (i / n) * Math.PI * 2
                    // Add 45 degrees just to shift it diagonally
                    + (Math.PI / 4);
                result.push({
                    x: coordinates.x + Math.round(horizontalSpacing * Math.cos(angle)),
                    y: coordinates.y + Math.round(verticalSpacing * Math.sin(angle))
                });
            }
            // void logger.log(`Drawing ${n} concentric tokens at space: \`${JSON.stringify(result)}\``);
            return result;
        } else {
            // Else, just show them haphazardly
            const result: Coordinates[] = [];
            for (let i = 0; i < n; i++) {
                result.push({
                    x: randInt(coordinates.x - horizontalSpacing * 1.5, coordinates.x + horizontalSpacing * 1.5),
                    y: randInt(coordinates.y - verticalSpacing * 1.5, coordinates.y + verticalSpacing * 1.5)
                });
            }
            // void logger.log(`Drawing ${n} haphazard tokens at space: \`${JSON.stringify(result)}\``);
            return result;
        }
    }

    async renderCardDraw(card: CandyLandCardData): Promise<Canvas> {
        const cardImage = await imageLoader.loadImage(`assets/candyland/cards/${card.color}${card.variant}.png`);

        const canvas = createCanvas(cardImage.width, cardImage.height);
        const context = canvas.getContext('2d');

        // TODO: Should there be a background too?
        context.drawImage(cardImage, 0, 0);

        // If the card is shiny, draw the shiny graphic on top
        if (card.shiny) {
            const shiny = await imageLoader.loadImage('assets/candyland/shiny.png');
            context.drawImage(shiny, 0, 0);
        }

        // If the card is negative, invert then rotate the hue back to the original
        if (card.negative) {
            // This isn't implemented in node-canvas yet...
            // context.filter = 'invert(1) hue-rotate(180deg)';
            context.globalCompositeOperation = 'difference';
            context.fillStyle = 'white';
            context.fillRect(0, 0, canvas.width, canvas.height);
        }

        return canvas;
    }

    // WARNING: Use of "getImageData" may cause fatal errors on 32-bit systems (e.g. raspbian), DO NOT USE!
    private async renderSpaces(): Promise<Canvas> {
        // For each space, edit the color of that part of the image data
        // await logger.log('Loading board spaces image...');
        const boardSpaces = await imageLoader.loadImage('assets/candyland/board_spaces.png');
        const spaceCanvas = createCanvas(boardSpaces.width, boardSpaces.height);
        const spaceContext = spaceCanvas.getContext('2d');
        spaceContext.drawImage(boardSpaces, 0, 0);
        // await logger.log('Getting board spaces image data...');
        const spaceImageData = spaceContext.getImageData(0, 0, spaceCanvas.width, spaceCanvas.height);
        for (let i = 0; i < this.getNumSpaces(); i++) {
            const color = this.state.spaces[i];
            const coordinates = this.getSpaceCoordinates(i);
            if (color === 'START' || color === 'END') {
                continue;
            }
            // Adjust the color for this space
            CandyLandGame.floodColor(spaceImageData, coordinates, CandyLandGame.config.colorMap[color]);
        }
        // await logger.log('Putting board spaces image data...');
        spaceContext.putImageData(spaceImageData, 0, 0);
        // await logger.log('Drawing altered image data onto main context...');
        return spaceCanvas;
    }

    private async renderRules(): Promise<AttachmentBuilder> {
        return new AttachmentBuilder('assets/candyland/rules.png').setName('candyland-rules.png');
    }

    // TODO: This should be private (public for testing)
    async renderSpacesAttachment(): Promise<AttachmentBuilder> {
        return new AttachmentBuilder((await this.renderSpaces()).toBuffer()).setName('candy-land-spaces.png');
    }

    private async renderSpace(location: number): Promise<Canvas> {
        const color = this.state.spaces[location];
        const actualColor = CandyLandGame.config.colorMap[color];
        const spaceImage = await imageLoader.loadImage(`assets/candyland/spaces/${location}.png`);

        const coloredCanvas = createCanvas(spaceImage.width, spaceImage.height);
        const context = coloredCanvas.getContext('2d');

        // Draw in hue
        context.fillStyle = `rgb(${actualColor.r},${actualColor.g},${actualColor.b})`;
        context.fillRect(0, 0, coloredCanvas.width, coloredCanvas.height);

        // Draw in original image
        context.globalCompositeOperation = 'destination-in';
        context.drawImage(spaceImage, 0, 0);

        return coloredCanvas;
    }

    async renderBoard(options?: { from?: number, to?: number, intermediate?: number, card?: CandyLandCardData }): Promise<Buffer> {
        const boardBase = await imageLoader.loadImage('assets/candyland/board_base.png');

        const canvas = createCanvas(boardBase.width, boardBase.height);
        const context = canvas.getContext('2d');

        context.drawImage(boardBase, 0, 0);

        // Draw the dynamically colored spaces
        for (let i = 0; i < this.getNumSpaces(); i++) {
            const color = this.state.spaces[i];
            if (color === 'START' || color === 'END') {
                continue;
            }
            const coloredSpace = await this.renderSpace(i);
            context.drawImage(coloredSpace, 0, 0);
        }
        // context.drawImage(await this.renderSpaces(), 0, 0);
        // TODO: Temporarily coloring the spaces manually until the problem is fixed
        // const season14Spaces = await imageLoader.loadImage('assets/candyland/board_spaces_season14.png');
        // context.drawImage(season14Spaces, 0, 0);

        // For each space, draw all players on that space
        // await logger.log('Loading avatars...');
        for (let i = 0; i < this.getNumSpaces(); i++) {
            const isStart = this.getSpaceColor(i) === 'START';
            const coordinates = this.getSpaceCoordinates(i);
            const playersHere = this.getPlayersAtLocation(i);
            // Show all player tokens on this space
            const tokenCoordinates = this.getTokenCoordinates(coordinates, playersHere.length, { horizontalSpacing: isStart ? 54 : 14, verticalSpacing: isStart ? 42 : 14 });
            for (let j = 0; j < playersHere.length; j++) {
                const userId = playersHere[j];
                const { x, y } = tokenCoordinates[j];
                // TODO: Temporarily disabling to see if avatar loading is causing the crashes
                const avatar = withDropShadow(await this.getAvatarBall(userId), { expandCanvas: true });
                // const avatar = await imageLoader.loadAvatar(userId, 128);
                context.drawImage(avatar, x - 21, y - 21, 42, 42);
            }
        }

        // If to/from are specified, crop to all the spaces traversed
        if (options?.from !== undefined && options?.to !== undefined && options?.card !== undefined) {
            const stretchCoordinates = this.getStretchCoordinates(options.from, options.to);
            let arrowCenter: Coordinates;
            let arrowLength: number;
            // If there's an intermediate space different than the final location, draw 2 arrows
            if (options?.intermediate !== undefined && options.intermediate !== options.to) {
                const arrow = renderArrow(context, this.getSpaceCoordinates(options.from), this.getSpaceCoordinates(options.intermediate), { fillStyle: this.getColorStyle(this.getSpaceColor(options.intermediate)), thickness: 14, tailPadding: 12, tipPadding: 12 });
                const arrow2 = renderArrow(context, this.getSpaceCoordinates(options.intermediate), this.getSpaceCoordinates(options.to), { fillStyle: this.getColorStyle(this.getSpaceColor(options.to)), thickness: 14, tailPadding: 12, tipPadding: 12 });
                if (arrow.length > arrow2.length) {
                    arrowCenter = arrow.center;
                    arrowLength = arrow.length;
                } else {
                    arrowCenter = arrow2.center;
                    arrowLength = arrow2.length;
                }
            }
            // Otherwise, just draw one
            else {
                const arrow = renderArrow(context, this.getSpaceCoordinates(options.from), this.getSpaceCoordinates(options.to), { fillStyle: this.getColorStyle(this.getSpaceColor(options.to)), thickness: 14, tailPadding: 12, tipPadding: 12 });
                arrowCenter = arrow.center;
                arrowLength = arrow.length;
            }
            // Show the card if specified
            const cardImage = withDropShadow(resize(await this.renderCardDraw(options.card), { width: 80 }), { expandCanvas: true });
            // If the stretch is long enough, draw the card on the arrow
            const longArrow = arrowLength > 150;
            if (longArrow) {
                context.drawImage(cardImage, arrowCenter.x - (cardImage.width * 0.5), arrowCenter.y - (cardImage.height * 0.5), cardImage.width, cardImage.height);
            }
            // Otherwise, draw it above and add a new stretch point
            else {
                const cardX = arrowCenter.x;
                // Add the arrow center to ensure that at least one point is compared against for the next operation
                stretchCoordinates.push(arrowCenter);
                // Place the card right above the highest point (in horizontal proximity of it)
                const cardY = Math.min(...stretchCoordinates.filter(p => Math.abs(p.x - cardX) < 65).map(c => c.y)) - 80;
                stretchCoordinates.push({ x: cardX, y: cardY });
                context.drawImage(cardImage, cardX - (cardImage.width * 0.5), cardY - (cardImage.height * 0.5), cardImage.width, cardImage.height);
            }
            // Crop around all the spaces touched by this user (crop bigger if the card is being rendered above)
            const cropped = cropAroundPoints(canvas, stretchCoordinates, { margin: longArrow ? 55 : 70 });
            return cropped.toBuffer();
        }

        return canvas.toBuffer();
    }

    override async renderState(options?: { showPlayerDecision?: string | undefined; seasonOver?: boolean | undefined; admin?: boolean | undefined; } | undefined): Promise<Buffer> {
        return await this.renderBoard();
    }

    private static getPixelColor(imageData: ImageData, point: Coordinates): PixelColor {
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
    private static setPixelColor(imageData: ImageData, point: Coordinates, color: PixelColor) {
        const index = 4 * (point.y * imageData.width + point.x);
        imageData.data[index] = color.r;
        imageData.data[index + 1] = color.g;
        imageData.data[index + 2] = color.b;
    }

    private static copyPixel(toImageData: ImageData, fromImageData: ImageData, point: Coordinates) {
        const index = 4 * (point.y * fromImageData.width + point.x);
        toImageData.data[index] = fromImageData.data[index];
        toImageData.data[index + 1] = fromImageData.data[index + 1];
        toImageData.data[index + 2] = fromImageData.data[index + 2];
        toImageData.data[index + 3] = fromImageData.data[index + 3];
        // console.log(`Copying pixel ${point.x},${point.y} rgba(${fromImageData.data[index]},${fromImageData.data[index + 1]},${fromImageData.data[index + 2]},${fromImageData.data[index + 3]})`)
    }

    private static getAllContiguousPixelsWithPredicate(imageData: ImageData, source: Coordinates, predicate: (pixel: Coordinates) => boolean): Coordinates[] {
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

    private static getAllContiguousNonTranslucentPixels(imageData: ImageData, source: Coordinates): Coordinates[] {
        return this.getAllContiguousPixelsWithPredicate(imageData, source, (pixel: Coordinates) => {
            // If non-translucent
            const pixelColor = this.getPixelColor(imageData, pixel);
            return pixelColor.a > 0;
        });

    }

    private static getAllContiguousPixelsOfSameColor(imageData: ImageData, source: Coordinates): Coordinates[] {
        const sourceColor = this.getPixelColor(imageData, source);
        return this.getAllContiguousPixelsWithPredicate(imageData, source, (pixel: Coordinates) => {
            // If same color (ignoring alpha, but not opaque)
            const pixelColor = this.getPixelColor(imageData, pixel);
            return pixelColor.r === sourceColor.r && pixelColor.g === sourceColor.g && pixelColor.b === sourceColor.b && pixelColor.a > 0;
        });
    }

    private static floodColor(imageData: ImageData, point: Coordinates, color: PixelColor) {
        const pixelsToAlter = this.getAllContiguousNonTranslucentPixels(imageData, point);
        for (const pixel of pixelsToAlter) {
            this.setPixelColor(imageData, pixel, color);
        }
    }

    // TEMP: Utility function for splitting entire board sheet into individual spaces.
    static async writeNewBoardSpaces() {
        const storage = new FileStorage('./assets/candyland/spaces/');
        const boardSpaces = await imageLoader.loadImage('assets/candyland/board_spaces.png');
        const spaceCanvas = createCanvas(boardSpaces.width, boardSpaces.height);
        const spaceContext = spaceCanvas.getContext('2d');
        spaceContext.drawImage(boardSpaces, 0, 0);
        // await logger.log('Getting board spaces image data...');
        const spaceImageData = spaceContext.getImageData(0, 0, spaceCanvas.width, spaceCanvas.height);
        for (let i = 0; i < CandyLandGame.config.spaces.length; i++) {
            const coordinates = CandyLandGame.config.spaces[i];
            // Create new canvas for this space and draw the pixels manually
            const newCanvas = createCanvas(boardSpaces.width, boardSpaces.height);
            const newContext = newCanvas.getContext('2d');
            const pixelsToCopy = this.getAllContiguousNonTranslucentPixels(spaceImageData, coordinates);
            console.log(`Writing space ${i}/${CandyLandGame.config.spaces.length}... (${pixelsToCopy.length} pixels)`);
            const newImageData = newContext.getImageData(0, 0, newCanvas.width, newCanvas.height);
            for (const pixel of pixelsToCopy) {
                this.copyPixel(newImageData, spaceImageData, pixel);
            }
            newContext.putImageData(newImageData, 0, 0);
            // Write the new canvas to file
            await storage.writeBlob(`${i}.png`, newCanvas.toBuffer());
        }
    }

    // TODO: Refactor to somewhere else
    private async getAvatarBall(userId: Snowflake): Promise<Canvas> {
        const avatar = await imageLoader.loadAvatar(userId, 32);
        const ringWidth = 3;

        const canvas = createCanvas(32 + 2 * ringWidth, 32 + 2 * ringWidth);
        const context = canvas.getContext('2d');

        context.fillStyle = 'black';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(toCircle(avatar), ringWidth, ringWidth, 32, 32);

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
                this.state.cards[userId] = {
                    card,
                    log: [`drew ${this.getCardDescriptor(card)}`]
                };
            }
        }

        // Notify players about new cards in the rotation
        if (this.getTurn() === 2) {
            return ['Starting this week, _rainbow_ cards, _shiny_ cards, and _black_ cards can be drawn']
        } else if (this.getTurn() === 3) {
            return ['Starting this week, _dunce_ cards and _negative_ cards can be drawn. BEWARE!']
        }

        return [];
    }

    override autoFillPlayerDecisions() {
        for (const userId of this.getPlayers()) {
            const card = this.drawRandomCard();
            this.state.cards[userId] = {
                card,
                log: [`drew ${this.getCardDescriptor(card)}`]
            };
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

    awardPrize(userId: string, type: PrizeType, intro: string): MessengerPayload[] {
        // TODO: What should this actually do?
        return [];
    }

    private getNextLocationWithCard(location: number, card: CandyLandCardData): { intermediateLocation: number, finalLocation: number } {
        let intermediateLocation: number;
        // If rainbow, get farthest possible space
        if (card.color === 'X') {
            // If negative, get min of other possibilities
            if (card.negative) {
                intermediateLocation = Math.min(...ALL_BASIC_COLORS.map(c => this.getPreviousLocationWithColor(location, c)));
            }
            // Otherwise, get max of all other possibilities
            else {
                intermediateLocation = Math.max(...ALL_BASIC_COLORS.map(c => this.getNextLocationWithColor(location, c)));
            }
        }
        // If dunce, do nothing
        else if (card.color === 'D') {
            intermediateLocation = location;
        }
        // Otherwise, it's a normal color
        else {
            // If negative, get previous space with color
            if (card.negative) {
                intermediateLocation = this.getPreviousLocationWithColor(location, card.color);
            }
            // Otherwise, get next space with color
            else {
                intermediateLocation = this.getNextLocationWithColor(location, card.color);
            }
        }
        // If the card was black, reset the intermediate location if it's not ACTUALLY black
        if (card.color === 'L') {
            if (this.getSpaceColor(intermediateLocation) !== 'L') {
                intermediateLocation = location;
            }
        }
        // Next, determine the final location by applying any shiny skips
        let finalLocation: number = intermediateLocation;
        if (card.shiny) {
            // Ensure that the player is either at a new location, or there are multiple players on their space (prevents self-skipping)
            if (location !== finalLocation || this.getNumPlayersAtLocation(finalLocation) > 1) {
                // If negative, hop backwards until a free space is found
                if (card.negative) {
                    while (this.isSpaceOccupied(finalLocation) && finalLocation > 0) {
                        finalLocation--;
                    }
                }
                // Otherwise, hop forward
                else {
                    while (this.isSpaceOccupied(finalLocation) && finalLocation < this.getNumSpaces() - 1) {
                        finalLocation++;
                    }
                }
            }
        }
        return { intermediateLocation, finalLocation };
    }

    private getNextLocationWithColor(location: number, color: CandyLandSpaceColor): number {
        for (let i = location + 1; i < this.getNumSpaces(); i++) {
            if (this.getSpaceColor(i) === color) {
                return i;
            }
            // The "end" space functions as a catch-all
            else if (this.getSpaceColor(i) === 'END') {
                return i;
            }
        }
        // If we're starting from the end or past the end, return the end
        return this.getNumSpaces() - 1;
    }

    private getPreviousLocationWithColor(location: number, color: CandyLandSpaceColor): number {
        for (let i = location - 1; i >= 0; i--) {
            if (this.getSpaceColor(i) === color) {
                return i;
            }
            // The "start" space functions as a catch-all
            else if (this.getSpaceColor(i) === 'START') {
                return i;
            }
        }
        // If we're starting from the start or before the start, return the start
        return 0;
    }

    private getCardDrawOrder(): Snowflake[] {
        const userIds = shuffle(Object.keys(this.state.cards));
        // Sort primarily by variant, then by user points
        return getSortedKeys(userIds, [
            id => -this.getPlayerCardVariant(id),
            id => -this.getPoints(id)
        ]);
    }

    getCardDrawOrderDebugString(): string {
        return this.getCardDrawOrder()
            .map(id => `- **${this.getPlayerDisplayName(id)}**: v${this.getPlayerCardVariant(id)}, ${this.getPoints(id)}pts`)
            .join('\n');
    }

    override async processPlayerDecisions(): Promise<DecisionProcessingResult> {
        const playersToProcess = this.getCardDrawOrder();
        // Handle undefined case
        if (playersToProcess.length === 0) {
            return {
                continueProcessing: false,
                summary: 'Looks like there are no more cards left in the pile!'
            };
        }

        // Draw the first card from the draw order list
        const userId = playersToProcess[0];
        if (!this.hasPlayer(userId)) {
            delete this.state.cards[userId];
            void logger.log(`Tried to draw Candy Land card by nonexistent player <@${userId}>`);
            return {
                continueProcessing: this.getNumPlayerCards() > 0,
                summary: 'Looks like a card was drawn by a nonexistent player. Hmmmm I\'ll skip that one...'
            };
        }
        const { card, log } = this.state.cards[userId];
        delete this.state.cards[userId];

        const currentLocation = this.getPlayerLocation(userId);
        const { intermediateLocation, finalLocation: nextLocation } = this.getNextLocationWithCard(currentLocation, card);
        const diff = nextLocation - currentLocation;
        const steps = Math.abs(diff);
        const shinyHops = Math.abs(nextLocation - intermediateLocation);
        this.state.players[userId].location = nextLocation;

        // If this player reached the end, add them as a winner
        if (this.isPlayerAtEnd(userId)) {
            const added = this.addWinner(userId);
            if (added) {
                log.push(`reached the end for _${getRankString(this.getNumWinnersUncapped())}_ place`);
            }
        }

        let movementText = steps === 0
            ? randChoice('going nowhere', 'going absolutely nowhere', 'moving no spaces at all', 'staying totally put')
            : `${diff < 0 ? 'backtracking' : 'moving'} **${steps}** space${s(steps)}`;

        // If the card was black, handle color modifications
        if (card.color === 'L' && this.getSpaceColor(currentLocation) !== 'START' && this.getSpaceColor(currentLocation) !== 'END') {
            // If the card is negative, invert the effect
            if (card.negative) {
                // If the space was originally black, recolor it back to a basic color
                if (this.getSpaceColor(currentLocation) === 'L') {
                    const nearbyColors = this.getSpaceColorsAround(currentLocation, 2);
                    const newColor = randChoice(...ALL_BASIC_COLORS.filter(c => !nearbyColors.includes(c)));
                    this.state.spaces[currentLocation] = newColor;
                    movementText += ` and de-blackening their space to **${CandyLandGame.config.colorNames[newColor]}**`;
                }
            }
            // Else, recolor the space to black
            else {
                // Only add text if the space wasn't already black
                if (this.getSpaceColor(currentLocation) !== 'L') {
                    if (steps === 0) {
                        movementText += ' and enblackening the ground beneath their feet';
                    } else {
                        movementText += ' and enblackening the space as they step off it';
                    }
                }
                // Re-color the space
                this.state.spaces[currentLocation] = 'L';
            }
        }

        if (shinyHops > 0) {
            movementText += ` (shiny-hopped over **${shinyHops}** player${s(shinyHops)})`;
        }

        return {
            continueProcessing: this.getNumPlayerCards() > 0,
            summary: {
                content: `**${this.getPlayerDisplayName(userId)}** ${naturalJoin(log, { conjunction: 'then' })}, ${movementText}!`,
                files: this.shouldSkipRendering() ? undefined : [new AttachmentBuilder(await this.renderBoard({ from: currentLocation, to: nextLocation, intermediate: intermediateLocation, card })).setName(`game-week${this.getTurn()}.png`)]
            },
            delayMultiplier: 1.5
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
                // Validate the user hasn't already finished
                if (this.isPlayerAtEnd(userId)) {
                    throw new Error('You\'ve already reached the end, no need to trade!');
                }
                const [ rootId, subId, decision, offererId ] = interaction.customId.split(':');
                // Validate that there is a valid trade offer for this user from that user
                // TODO: These sorts of failed validations should result in the buttons being removed (create new "StaleComponentsError" and handle universally?)
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
                    throw new Error(`You don't have a card to trade. Go to the GM channel and draw a card, then come back to ${decision} the offer from **${this.getPlayerDisplayName(offererId)}**`);
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
                    const userCardDescriptor = this.getCardDescriptor(userCard.card);
                    this.state.cards[offererId] = {
                        card: userCard.card,
                        log: [...offererCard.log, `traded with **${this.getPlayerDisplayName(userId)}** for ${userCardDescriptor}`]
                    };
                    const offererCardDescriptor = this.getCardDescriptor(offererCard.card);
                    this.state.cards[userId] = {
                        card: offererCard.card,
                        log: [...userCard.log, `traded with **${this.getPlayerDisplayName(offererId)}** for ${offererCardDescriptor}`]
                    };
                    // Notify both users
                    await interaction.editReply({
                        content: `Accepted trade offer from **${this.getPlayerDisplayName(offererId)}**. You traded ${userCardDescriptor} for ${offererCardDescriptor}!`,
                        files: [new AttachmentBuilder((await this.renderCardDraw(offererCard.card)).toBuffer()).setName('trade.png')]
                    });
                    await logger.log(`**${this.getPlayerDisplayName(userId)}** accepted trade offer from **${this.getPlayerDisplayName(offererId)}**`);
                    return {
                        dms: {
                            [offererId]: [{
                                content: `**${this.getPlayerDisplayName(userId)}** accepted your trade offer. You traded ${offererCardDescriptor} for ${userCardDescriptor}!`,
                                files: [new AttachmentBuilder((await this.renderCardDraw(userCard.card)).toBuffer()).setName('trade.png')]
                            }]
                        }
                    };
                } else if (decision === 'decline') {
                    // Wipe the pending trade offer flag
                    delete offererCard.trade;
                    // Notify both users
                    await interaction.editReply(`Declined trade offer from **${this.getPlayerDisplayName(offererId)}**, they have been notified.`);
                    await logger.log(`**${this.getPlayerDisplayName(userId)}** declined trade offer from **${this.getPlayerDisplayName(offererId)}**`);
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
                    // Validate that this user is in the game
                    if (!this.hasPlayer(userId)) {
                        throw new Error('You can\'t draw a card yet, say _good morning_ and try again next week!');
                    }
                    // Validate the user hasn't already finished
                    if (this.isPlayerAtEnd(userId)) {
                        throw new Error('You\'ve already reached the end!');
                    }
                    // Handle the free draw
                    let content = '';
                    const files: AttachmentBuilder[] = [];
                    const buttons: APIButtonComponent[] = [{
                        type: ComponentType.Button,
                        style: ButtonStyle.Primary,
                        label: 'Trade',
                        custom_id: 'game:trade'
                    }];
                    if (this.hasPlayerCard(userId)) {
                        content = `You previously drew ${this.getPlayerCardDescriptor(userId)}. `;
                    } else {
                        // Actually draw a card and save it in the state
                        const card = this.drawRandomCard();
                        this.state.cards[userId] = {
                            card,
                            log: [`drew ${this.getCardDescriptor(card)}`]
                        };
                        content = `You've drawn ${this.getCardDescriptor(card)}! `;
                        files.push(new AttachmentBuilder((await this.renderCardDraw(card)).toBuffer()).setName('draw.png'));
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
                    // Add modifier tips
                    if (this.hasPlayerCard(userId)) {
                        content += '\n' + this.getCardTips(this.getPlayerCard(userId)).map(t => `- ${t}`).join('\n');
                    }
                    await interaction.editReply({
                        content,
                        files,
                        components: buttons.length > 0 ? [{
                            type: ComponentType.ActionRow,
                            components: buttons
                        }] : undefined
                    });
                    await logger.log(`**${this.getPlayerDisplayName(userId)}** drew a card`);
                    break;
                }
                case 'game:redraw': {
                    // Validate the user hasn't already finished
                    if (this.isPlayerAtEnd(userId)) {
                        throw new Error('You\'ve already reached the end!');
                    }
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
                    this.state.cards[userId].card = card;
                    this.addToPlayerLog(userId, `re-drew for ${this.getCardDescriptor(card)}`);
                    // TODO: Refactor the conditional re-draw code with the same logic above
                    // Add the option to replace if they can afford it
                    let content = `You've re-drawn ${this.getCardDescriptor(card)}. `;
                    const buttons: APIButtonComponent[] = [{
                        type: ComponentType.Button,
                        style: ButtonStyle.Primary,
                        label: 'Trade',
                        custom_id: 'game:trade'
                    }];
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
                    // Add modifier tips
                    content += '\n' + this.getCardTips(card).map(t => `- ${t}`).join('\n');
                    // TODO: Merge logic once a default trade button is added
                    await interaction.editReply({
                        content,
                        files: [new AttachmentBuilder((await this.renderCardDraw(card)).toBuffer()).setName('draw.png')],
                        components: buttons.length > 0 ? [{
                            type: ComponentType.ActionRow,
                            components: buttons
                        }] : undefined
                    });
                    await logger.log(`**${this.getPlayerDisplayName(userId)}** re-drew a card`);
                    break;
                }
                case 'game:trade': {
                    // Validate the user hasn't already finished
                    if (this.isPlayerAtEnd(userId)) {
                        throw new Error('You\'ve already reached the end, no need to trade!');
                    }
                    // Validate that the user actually has a card
                    if (!this.hasPlayerCard(userId)) {
                        throw new Error('You can\'t trade, you don\'t have a card to begin with!');
                    }
                    await interaction.editReply({
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
                case 'game:selectTradeUser': {
                    // Validate the user hasn't already finished
                    if (this.isPlayerAtEnd(userId)) {
                        throw new Error('You\'ve already reached the end, no need to trade!');
                    }
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
                    if (this.isPlayerAtEnd(targetUserId)) {
                        throw new Error(`**${this.getPlayerDisplayName(targetUserId)}** has already reached the end`);
                    }
                    if (this.state.cards[targetUserId]?.trade) {
                        throw new Error(`**${this.getPlayerDisplayName(targetUserId)}** is currently offering their card to someone else...`);
                    }
                    // Set the trade target in the state
                    this.state.cards[userId].trade = targetUserId;
                    // Extend the trade offer
                    await interaction.editReply(`Your trade offer has been sent to **${this.getPlayerDisplayName(targetUserId)}**!`);
                    await logger.log(`**${this.getPlayerDisplayName(userId)}** proposed a trade with **${this.getPlayerDisplayName(targetUserId)}**`);
                    // TODO: Instruct them how to accept
                    // TODO: If this offer overrides another offer, send the other user a DM saying that the previous offer has been cancelled
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
