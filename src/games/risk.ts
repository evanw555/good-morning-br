import { AttachmentBuilder, ButtonStyle, ComponentType, GuildMember, Interaction, Message, MessageFlags, MessageFlagsBitField, Snowflake } from "discord.js";
import { DecisionProcessingResult, MessengerPayload, PrizeType, RiskGameState, RiskPlayerState, RiskTerritoryState } from "../types";
import AbstractGame from "./abstract-game";

import imageLoader from "../image-loader";
import logger from "../logger";
import { Canvas, createCanvas } from "canvas";
import { DiscordTimestampFormat, getDateBetween, getJoinedMentions, naturalJoin, randChoice, randInt, toDiscordTimestamp, toFixed } from "evanw555.js";

interface RiskConfig {
    territories: Record<string, {
        name: string,
        connections: string[]
    }>
}

export default class RiskGame extends AbstractGame<RiskGameState> {
    private static config: RiskConfig = {
        territories: {
            A: {
                name: 'Fairview',
                connections: ['B', 'D', 'E']
            },
            B: {
                name: 'Santa Ana Heights',
                connections: ['A', 'C', 'E', 'F']
            },
            C: {
                name: 'John Wayne',
                connections: ['B', 'H']
            },
            D: {
                name: 'West Side Costa Mesa',
                connections: ['A', 'E', 'I']
            },
            E: {
                name: 'East Side Costa Mesa',
                connections: ['A', 'B', 'F', 'I']
            },
            F: {
                name: 'Dover',
                connections: ['B', 'E', 'I', 'J']
            },
            G: {
                name: 'Eastbluff',
                connections: ['H', 'L', 'N']
            },
            H: {
                name: 'UCI',
                connections: ['C', 'G', 'N']
            },
            I: {
                name: 'Newport Heights',
                connections: ['D', 'E', 'F', 'J', 'T', 'U']
            },
            J: {
                name: 'Castaways',
                connections: ['F', 'I', 'K']
            },
            K: {
                name: 'The Dunes',
                connections: ['J', 'L', 'M', 'O']
            },
            L: {
                name: 'Park Newport',
                connections: ['G', 'K', 'M', 'N']
            },
            M: {
                name: 'Fashion Island',
                connections: ['K', 'L', 'N', 'O', 'P']
            },
            N: {
                name: 'Bonita Canyon',
                connections: ['G', 'H', 'L', 'M']
            },
            O: {
                name: 'Promontory',
                connections: ['K', 'M', 'P', 'R']
            },
            P: {
                name: 'Corona del Mar',
                connections: ['M', 'O']
            },
            Q: {
                name: 'Lido Isle',
                connections: ['U']
            },
            R: {
                name: 'Balboa Island',
                connections: ['R', 'W']
            },
            S: {
                name: 'Newport Shores',
                connections: ['T']
            },
            T: {
                name: '40th Street',
                connections: ['I', 'S', 'U']
            },
            U: {
                name: 'Golden Mile',
                connections: ['I', 'T', 'V']
            },
            V: {
                name: 'Mid-Peninsula',
                connections: ['U', 'W']
            },
            W: {
                name: 'The Fun Zone',
                connections: ['V', 'X']
            },
            X: {
                name: 'The Wedge',
                connections: ['W']
            },
            Y: {
                name: 'Catalina Island',
                connections: ['W']
            }
        }
    };

    constructor(state: RiskGameState) {
        super(state);
    }

    static create(members: GuildMember[], season: number): RiskGame {
        // Construct the players map
        const players: Record<Snowflake, RiskPlayerState> = {};
        for (const member of members) {
            players[member.id] = {
                displayName: member.displayName,
                points: 0,
                color: `hsl(${randInt(0, 360)}, 40%, 60%)`
            };
        }
        // Construct the territories map
        const territories: Record<string, RiskTerritoryState> = {};
        for (const territoryId of Object.keys(RiskGame.config.territories)) {
            territories[territoryId] = {
                troops: 1
            };
        }
        // Return the constructed state
        return new RiskGame({
            type: 'RISK_GAME_STATE',
            season,
            winners: [],
            decisions: {},
            turn: 0,
            players,
            territories
        });
    }

    override async getIntroductionMessages(): Promise<MessengerPayload[]> {
        return [
            // 'Gather the troops and get ready to claim some territory! For a grand war is about to break out...',
            // {
            //     content: 'I hope you all are prepared for a bloody game of _Morningtime Risk_ right here in our very own stomping ground!',
            //     files: [await this.renderRules()]
            // }
            // TODO: Show rules are type more
        ];
    }

    override getInstructionsText(): string {
        // If draft data is present, let players know who's drafting when
        if (this.state.draft) {
            // TODO: Determine draft order
            return 'Later this morning, you will all be vying for a starting location on the map! Your draft order is determined by your weekly points:\n'
                + this.getSortedDraftEntries().map(entry => `- **${this.getPlayerDisplayName(entry.userId)}** ${toDiscordTimestamp(entry.date, DiscordTimestampFormat.ShortTime)}`).join('\n');
        }
        return 'Place your troops, attack your opponents, and fortify your defenses!';
    }

    override getDecisionPhases(): { key: string; millis: number; }[] {
        // If draft data is present, create decision phases using them
        if (this.getTurn() === 1) {
            return this.getSortedDraftEntries().map(entry => ({
                key: `draft:${entry.userId}`,
                millis: entry.date.getTime() - new Date().getTime()
            }));
        }
        return [];
    }

    private getSortedDraftEntries(): { userId: Snowflake, date: Date }[] {
        if (!this.state.draft) {
            return [];
        }
        const draft = this.state.draft;
        return Object.keys(draft)
            .sort((x, y) => draft[x].timestamp - draft[y].timestamp)
            .map(userId => ({
                userId,
                date: new Date(draft[userId].timestamp)
            }));
    }

    private getAvailableDraftPlayers(): Snowflake[] {
        const draft = this.state.draft;
        if (!draft) {
            return [];
        }
        return Object.keys(draft).filter(userId => draft[userId].available);
    }

    override async onDecisionPhase(key: string): Promise<MessengerPayload[]> {
        const [ root, arg ] = key.split(':');
        const draft = this.state.draft;
        if (root === 'draft' && arg && draft) {
            const userId = arg as Snowflake;
            // Mark the player as "available" for drafting
            draft[userId].available = true;
            // Reply with a button that the player can use to pick a location
            const otherAvailableUserIds = this.getAvailableDraftPlayers().filter(otherId => otherId !== userId);
            let content = `<@${userId}>, it's your turn to pick a starting location!`;
            if (otherAvailableUserIds.length > 0) {
                content += ` (${this.getJoinedDisplayNames(otherAvailableUserIds)} too)`;
            }
            return [{
                content,
                components: [{
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.Button,
                        style: ButtonStyle.Primary,
                        label: 'Pick Location',
                        customId: 'game:pickStartingLocation'
                    }]
                }]
            }];
        }
        return [`Oopsie, couldn\'t process decision phase \`${key}\``];
    }

    private getTerritories(): string[] {
        return Object.keys(this.state.territories);
    }

    /**
     * Gets a list of territory IDs with no owner.
     */
    private getOwnerlessTerritories(): string[] {
        return this.getTerritories().filter(territoryId => !this.getTerritoryOwner(territoryId));
    }

    /**
     * Gets a list of territory IDs owned by this player.
     */
    private getTerritoriesForPlayer(userId: Snowflake): string[] {
        return this.getTerritories().filter(territoryId => this.getTerritoryOwner(territoryId) === userId);
    }

    /**
     * Gets the total number of territories owned by a particular player.
     */
    private getNumTerritoriesForPlayer(userId: Snowflake): number {
        return this.getTerritoriesForPlayer(userId).length;
    }

    /**
     * Gets the user ID of the player who owns this territory, or undefined if no one owns it (or if it doesn't exist).
     */
    private getTerritoryOwner(territoryId: string): Snowflake | undefined {
        return this.state.territories[territoryId]?.owner;
    }

    /**
     * Gets the number of troops in a particular territory (or 0 if it doesn't exist).
     */
    private getTerritoryTroops(territoryId: string): number {
        return this.state.territories[territoryId]?.troops ?? 0;
    }

    private getTerritoryName(territoryId: string): string {
        return RiskGame.config.territories[territoryId]?.name ?? '???';
    }

    /**
     * For a given player, gets the total number of troops on the board in territories they own.
     */
    private getTroopsForPlayer(userId: Snowflake): number {
        return this.getTerritoriesForPlayer(userId)
            .map(territoryId => this.getTerritoryTroops(territoryId))
            .reduce((a, b) => a + b);
    }

    private getPlayerDisplayName(userId: Snowflake): string {
        return this.state.players[userId]?.displayName ?? `<@${userId}>`;
    }

    private getJoinedDisplayNames(userIds: Snowflake[]): string {
        return naturalJoin(userIds.map(userId => this.getPlayerDisplayName(userId)), { bold: true });
    }

    /**
     * Gets the player's color, or gray if it hasn't been picked yet (or if the player doesn't exist).
     */
    private getPlayerColor(userId: Snowflake): string {
        return this.state.players[userId]?.color ?? 'gray';
    }

    /**
     * Gets the color of a territory's owner, or gray if it doesn't have an owner (or if it hasn't been picked yet, or if the player doesn't exist).
     */
    private getTerritoryColor(territoryId: string): string {
        // TODO: This is sorta hacky, should we change this?
        return this.getPlayerColor(this.getTerritoryOwner(territoryId) ?? '');
    }

    private isPlayerEliminated(userId: Snowflake): boolean {
        // Player is considered "eliminated" if they have a final rank assigned to them
        return this.state.players[userId]?.finalRank !== undefined;
    }

    private getNumEliminatedPlayers(): number {
        return this.getPlayers().filter(userId => this.isPlayerEliminated(userId)).length;
    }

    override async onDecisionPreNoon(): Promise<MessengerPayload[]> {
        // If there's an active draft, send a special message if anyone still needs to select a starting location
        if (this.state.draft) {
            const remainingAvailableUserIds = this.getAvailableDraftPlayers();
            if (remainingAvailableUserIds.length > 0) {
                return [{
                    content: `${getJoinedMentions(remainingAvailableUserIds)}, you still need to pick a starting location! If you don't choose by tomorrow morning, I'll have to choose for you`,
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.Button,
                            style: ButtonStyle.Primary,
                            label: 'Pick Location',
                            customId: 'game:pickStartingLocation'
                        }]
                    }]
                }];
            }
        }
        return super.onDecisionPreNoon();
    }

    getSeasonCompletion(): number {
        // Season completion is determined as percent of players eliminated
        return this.getNumEliminatedPlayers() / this.getNumPlayers();
    }

    getPlayers(): string[] {
        return Object.keys(this.state.players);
    }

    getOrderedPlayers(): string[] {
        // Order is determined by (1) number of territories owned, then (2) number of troops owned.
        const getSortValue = (userId) => {
            return 100 * this.getNumTerritoriesForPlayer(userId) + this.getTroopsForPlayer(userId);
        };
        return this.getPlayers().sort((x, y) => getSortValue(y) - getSortValue(x));
    }

    /**
     * Gets a list of all player IDs sorted by descending weekly points.
     */
    private getPointOrderedPlayers(): Snowflake[] {
        return this.getPlayers().sort((x, y) => this.getPoints(y) - this.getPoints(x));
    }

    hasPlayer(userId: string): boolean {
        return userId in this.state.players;
    }

    addPlayer(member: GuildMember): string {
        // TODO: If it's the first turn still (second week), allow them to join at a random spot
        // Late players get a terrible dummy rank that's necessarily larger than all other ranks
        const finalRank = this.getNumPlayers() + 1;
        this.state.players[member.id] = {
            displayName: member.displayName,
            points: 0,
            finalRank
        };
        return `Added **${member.displayName}** at final rank **${finalRank}**`;
    }

    updatePlayer(member: GuildMember): void {
        if (this.hasPlayer(member.id)) {
            this.state.players[member.id].displayName = member.displayName;
        }
    }

    removePlayer(userId: string): void {
        delete this.state.players[userId];
        delete this.state.decisions[userId];

        // Remove ownership from all owned territories
        // TODO: Should we somehow give ownership to an NPC player?
        for (const territoryId of this.getTerritoriesForPlayer(userId)) {
            delete this.state.territories[territoryId].owner;
        }
    }

    private async renderRules(): Promise<AttachmentBuilder> {
        // TODO: Create real rules sheet
        return new AttachmentBuilder('assets/risk/map-with-background.png');
    }

    async renderState(options?: { showPlayerDecision?: string | undefined; seasonOver?: boolean | undefined; admin?: boolean | undefined; } | undefined): Promise<Buffer> {
        const mapImage = await imageLoader.loadImage('assets/risk/map.png');

        // Define the canvas
        const canvas = createCanvas(mapImage.width, mapImage.height);
        const context = canvas.getContext('2d');

        // Draw each territory cutout
        for (const territoryId of this.getTerritories()) {
            context.drawImage(await this.getTerritoryCutoutRender(territoryId), 0, 0);
        }

        // Draw the map template as the top layer
        context.drawImage(mapImage, 0, 0);
    
        return canvas.toBuffer();
    }

    private async getTerritoryCutoutRender(territoryId: string): Promise<Canvas> {
        const maskImage = await imageLoader.loadImage(`assets/risk/territories/${territoryId.toLowerCase()}.png`);
        const canvas = createCanvas(maskImage.width, maskImage.height);
        const context = canvas.getContext('2d');

        // First, draw the territory image mask
        context.drawImage(maskImage, 0, 0);

        // Then, fill the entire canvas with the owner's color using the cutout as a mask
        context.globalCompositeOperation = 'source-in';
        context.fillStyle = this.getTerritoryColor(territoryId);
        context.fillRect(0, 0, canvas.width, canvas.height);

        return canvas;
    }

    beginTurn(): string[] {
        this.state.turn++;

        // If we're on the first turn, determine the draft order
        if (this.state.turn === 1) {
            this.state.draft = this.constructDraftData();
        } else {
            // Just in case the draft data is still present, but this shouldn't happen...
            delete this.state.draft;
        }

        // TODO: Do more here...

        return [];
    }

    private constructDraftData(): Record<Snowflake, { timestamp: number }> {
        const minDate = new Date();
        minDate.setHours(10, 0, 0, 0);
        const maxDate = new Date();
        maxDate.setHours(11, 45, 0, 0);
        const userIds = this.getPointOrderedPlayers();
        const n = userIds.length;
        const result: Record<Snowflake, { timestamp: number }> = {};
        for (let i = 0; i < n; i++) {
            const userId = userIds[i];
            result[userId] = {
                timestamp: getDateBetween(minDate, maxDate, i / n).getTime()
            };
        }
        return result;
    }

    getPoints(userId: string): number {
        return this.state.players[userId]?.points ?? 0;
    }

    addPoints(userId: string, points: number): void {
        if (isNaN(points)) {
            throw new Error('Cannot award NaN points!');
        }
        if (!this.hasPlayer(userId)) {
            throw new Error(`Player ${userId} not in-game, can't award points!`);
        }
        this.state.players[userId].points = toFixed(this.getPoints(userId) + points);
    }

    awardPrize(userId: string, type: PrizeType, intro: string): MessengerPayload[] {
        // TODO: Handle this
        return [];
    }

    async addPlayerDecision(userId: string, text: string): Promise<MessengerPayload> {
        // TODO: Handle this
        throw new Error('Can\'t accept decisions yet...');
    }

    async processPlayerDecisions(): Promise<DecisionProcessingResult> {
        if (this.state.draft) {
            // If there are any remaining players, pick a random location for them
            const remainingAvailableUserIds = this.getAvailableDraftPlayers();
            if (remainingAvailableUserIds.length > 0) {
                // Pick a random user and random available territory
                const randomUserId = randChoice(...remainingAvailableUserIds);
                const randomTerritoryId = randChoice(...this.getOwnerlessTerritories());
                // Assign the territory to this user
                this.state.territories[randomTerritoryId].owner = randomUserId;
                // Send a payload about it and continue processing
                return {
                    continueProcessing: true,
                    summary: {
                        // TODO: add varying text
                        content: `**${this.getPlayerDisplayName(randomUserId)}** has been placed at _${this.getTerritoryName(randomTerritoryId)}_`,
                        files: [await this.renderState()],
                        flags: MessageFlags.SuppressNotifications
                    }
                };
            }
            // Else, wipe the draft data and end processing
            delete this.state.draft;
            return {
                continueProcessing: false,
                summary: 'Alright, everyone\'s settled in! See you all next week when the bloodshed begins...'
            };
        }
        // TODO: Handle this
        return {
            continueProcessing: false,
            summary: 'That\'s all!'
        };
    }

    override async handleGameInteraction(interaction: Interaction): Promise<MessengerPayload[] | undefined> {
        const userId = interaction.user.id;
        if (interaction.isButton()) {
            const customId = interaction.customId;
            if (customId === 'game:pickStartingLocation') {
                // Do basic validation before processing
                const draft = this.state.draft;
                if (!draft) {
                    throw new Error('The draft has already ended, why are you clicking this?');
                }
                const playerDraftInfo = draft[userId];
                if (!playerDraftInfo) {
                    throw new Error('You\'re not in the game... yet?');
                }
                if (!playerDraftInfo.available) {
                    throw new Error('It\'s not your turn to draft, silly!');
                }
                // Respond with a prompt for the user to pick a location
                await interaction.reply({
                    ephemeral: true,
                    content: 'Where would you like to start?',
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.StringSelect,
                            custom_id: 'game:selectStartingLocation',
                            min_values: 1,
                            max_values: 1,
                            options: this.getOwnerlessTerritories().map(territoryId => ({
                                label: this.getTerritoryName(territoryId),
                                value: territoryId
                            }))
                        }]
                    }]
                });
            }
        } else if (interaction.isStringSelectMenu()) {
            const customId = interaction.customId;
            if (customId === 'game:selectStartingLocation') {
                // Do basic validation before processing
                const draft = this.state.draft;
                if (!draft) {
                    throw new Error('The draft has already ended, why are you clicking this?');
                }
                const playerDraftInfo = draft[userId];
                if (!playerDraftInfo) {
                    throw new Error('You\'re not in the game... yet?');
                }
                if (!playerDraftInfo.available) {
                    throw new Error('It\'s not your turn to draft, silly!');
                }
                // Validate the player's selected location
                const territoryId = interaction.values[0];
                if (!territoryId) {
                    await interaction.reply({
                        ephemeral: true,
                        content: 'Ummmmm... you were supposed to select a territory...'
                    });
                    return;
                }
                const existingOwnerId = this.getTerritoryOwner(territoryId);
                if (existingOwnerId) {
                    await interaction.reply({
                        ephemeral: true,
                        content: `You can't select _${this.getTerritoryName(territoryId)}_, it's already been claimed by ${this.getPlayerDisplayName(existingOwnerId)}!`
                    });
                    return;
                }
                // Confirm the selected location
                this.state.territories[territoryId].owner = userId;
                delete draft[userId].available;
                // Reply to the interaction
                await interaction.reply({
                    ephemeral: true,
                    content: `You have selected _${this.getTerritoryName(territoryId)}_!`
                });
                // Reply for the entire channel to see
                return [{
                    content: `<@${userId}> has set up camp at _${this.getTerritoryName(territoryId)}_!`,
                    files: [await this.renderState()]
                }];
            }
        }
    }
}
