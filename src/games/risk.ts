import { APIActionRowComponent, APIMessageActionRowComponent, APISelectMenuOption, APIStringSelectComponent, ActionRowData, AttachmentBuilder, ButtonInteraction, ButtonStyle, ComponentType, GuildMember, Interaction, InteractionReplyOptions, Message, MessageActionRowComponentData, MessageCreateOptions, MessageFlags, MessageFlagsBitField, Snowflake, StringSelectMenuInteraction } from "discord.js";
import { DecisionProcessingResult, MessengerPayload, PrizeType, RiskGameState, RiskMovementData, RiskPlayerState, RiskTerritoryState } from "../types";
import AbstractGame from "./abstract-game";
import { Canvas, createCanvas } from "canvas";
import { DiscordTimestampFormat, getDateBetween, getJoinedMentions, naturalJoin, randChoice, randInt, toDiscordTimestamp, toFixed } from "evanw555.js";

import imageLoader from "../image-loader";
import logger from "../logger";

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

    private pendingAttackDecisions: Record<Snowflake, Partial<RiskMovementData>>;
    private pendingMoveDecisions: Record<Snowflake, Partial<RiskMovementData>>;

    constructor(state: RiskGameState) {
        super(state);
        this.pendingAttackDecisions = {};
        this.pendingMoveDecisions = {};
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

    private getTerritoryConnections(territoryId: string): string[] {
        return RiskGame.config.territories[territoryId]?.connections ?? [];
    }

    private getNumTerritoryConnections(territoryId: string): number {
        return this.getTerritoryConnections(territoryId).length;
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

    private getValidMovementSourceTerritoriesForPlayer(userId: Snowflake): string[] {
        // Get territories owned by this player...
        return this.getTerritoriesForPlayer(userId)
            // That have adjacent territories owned by this player
            .filter(territoryId => this.getTerritoryConnections(territoryId).some(otherId => this.getTerritoryOwner(otherId) === userId))
            // That have at least 2 troops
            // TODO: Account for pending additions too...
            .filter(territoryId => this.getTerritoryTroops(territoryId) >= 2);
    }

    private getValidAttackSourceTerritoriesForPlayer(userId: Snowflake): string[] {
        // Get territories owned by this player...
        return this.getTerritoriesForPlayer(userId)
            // That have adjacent territories owned by another player
            .filter(territoryId => this.getTerritoryConnections(territoryId).some(otherId => this.getTerritoryOwner(otherId) !== userId))
            // That have at least 2 troops
            // TODO: Account for pending additions too...
            .filter(territoryId => this.getTerritoryTroops(territoryId) >= 2);
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
            .reduce((a, b) => a + b, 0);
    }

    private getPlayerDisplayName(userId: Snowflake): string {
        return this.state.players[userId]?.displayName ?? `<@${userId}>`;
    }

    private getPlayerNewTroops(userId: Snowflake): number {
        return this.state.players[userId]?.newTroops ?? 0;
    }

    private addPlayerNewTroops(userId: Snowflake, quantity: number) {
        this.state.players[userId].newTroops = this.getPlayerNewTroops(userId) + quantity;
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
            // Initialize the decision maps to allow decisions
            this.state.addDecisions = {};
            this.state.attackDecisions = {};
            this.state.moveDecisions = {};
        }

        // TODO: Temp logic to give random new troops to players
        for (const userId of this.getPlayers()) {
            this.addPlayerNewTroops(userId, randInt(1, 4));
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
                // Assign the territory to this user and mark them as draft-complete
                this.state.territories[randomTerritoryId].owner = randomUserId;
                delete this.state.draft[randomUserId];
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

    override getDecisionActionRow(): ActionRowData<MessageActionRowComponentData>[] {
        return [{
            type: ComponentType.ActionRow,
            components: [{
                type: ComponentType.Button,
                label: 'Add Troops',
                style: ButtonStyle.Success,
                customId: 'game:add'
            }, {
                type: ComponentType.Button,
                label: 'Attack',
                style: ButtonStyle.Danger,
                customId: 'game:attack'
            }, {
                type: ComponentType.Button,
                label: 'Move Troops',
                style: ButtonStyle.Primary,
                customId: 'game:move'
            }]
        }]
    }

    override async handleGameInteraction(interaction: Interaction): Promise<MessengerPayload[] | undefined> {
        const userId = interaction.user.id;
        if (interaction.isButton()) {
            const customId = interaction.customId;
            switch (customId) {
                case 'game:pickStartingLocation': {
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
                                options: this.getTerritorySelectOptions(this.getOwnerlessTerritories())
                            }]
                        }]
                    });
                    break;
                }
                case 'game:add': {
                    // First, validate that add decisions are being accepted
                    if (!this.state.addDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _adding troops_ right now...');
                    }
                    // Reply with a prompt for them to make decisions
                    await interaction.reply(this.getAddDecisionReply(userId));
                    break;
                }
                case 'game:attack': {
                    // First, validate that attack decisions are being accepted
                    if (!this.state.attackDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _attacking_ right now...');
                    }
                    // Reply with a prompt for them to make decisions
                    await interaction.reply(this.getAttackDecisionReply(userId));
                    break;
                }
                case 'game:move': {
                    // First, validate that move decisions are being accepted
                    if (!this.state.moveDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _moving troops_ right now...');
                    }
                    // Reply with a prompt for them to make decisions
                    await interaction.reply(this.getMoveDecisionReply(userId));
                    break;
                }
                case 'game:clearAdd': {
                    // First, validate that add decisions are being accepted
                    if (!this.state.addDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _adding troops_ right now...');
                    }
                    // Clear this player's add decisions
                    delete this.state.addDecisions[userId];
                    // Reply with a prompt for them to make new decisions
                    await interaction.reply(this.getAddDecisionReply(userId));
                    break;
                }
                case 'game:clearMove': {
                    // First, validate that move decisions are being accepted
                    if (!this.state.moveDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _moving troops_ right now...');
                    }
                    // Clear this player's move decisions
                    delete this.pendingMoveDecisions[userId];
                    delete this.state.moveDecisions[userId];
                    // Reply with a prompt for them to make new decisions
                    await interaction.reply(this.getMoveDecisionReply(userId));
                    break;
                }
                case 'game:clearAttack': {
                    // First, validate that attack decisions are being accepted
                    if (!this.state.attackDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _attacking_ right now...');
                    }
                    // Clear this player's attack decisions
                    delete this.pendingAttackDecisions[userId];
                    delete this.state.attackDecisions[userId];
                    // Reply with a prompt for them to make new decisions
                    await interaction.reply(this.getAttackDecisionReply(userId));
                    break;
                }
                case 'game:reviewDecisions': {
                    const allDecisionStrings = [...this.getAddDecisionStrings(userId), ...this.getAttackDecisionStrings(userId), ...this.getMoveDecisionStrings(userId)];
                    if (allDecisionStrings.length > 0) {
                        await interaction.reply({
                            ephemeral: true,
                            content: 'You\'ve made the following decisions:\n' + allDecisionStrings.join('\n')
                        });
                    } else {
                        await interaction.reply({
                            ephemeral: true,
                            content: 'You don\'t have any actions lined up! Use the buttons in the channel to arrange some actions...'
                        });
                    }
                    break;
                }
            }
        } else if (interaction.isStringSelectMenu()) {
            const customId = interaction.customId;
            switch (customId) {
                case 'game:selectStartingLocation': {
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
                case 'game:selectAdd': {
                    // First, validate that add decisions are being accepted
                    if (!this.state.addDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _adding troops_ right now...');
                    }
                    // Validate the selected territory
                    const selectedTerritoryId = interaction.values[0];
                    if (this.getTerritoryOwner(selectedTerritoryId) !== userId) {
                        throw new Error(`You don't own _${this.getTerritoryName(selectedTerritoryId)}_!`);
                    }
                    // Add the pending decision
                    if (!this.state.addDecisions[userId]) {
                        this.state.addDecisions[userId] = [];
                    }
                    const pendingAdditions = this.state.addDecisions[userId];
                    pendingAdditions.push(selectedTerritoryId);
                    // Repond with a prompt to do more
                    await interaction.reply(this.getAddDecisionReply(userId));
                    break;
                }
                case 'game:selectMoveFrom': {
                    // First, validate that move decisions are being accepted
                    if (!this.state.moveDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _moving troops_ right now...');
                    }
                    // Instantiate the pending move if it's missing
                    if (!this.pendingMoveDecisions[userId]) {
                        this.pendingMoveDecisions[userId] = {};
                    }
                    // Validate the selected source territory
                    // TODO: Validate that the player can move any troops from this territory
                    const territoryId = interaction.values[0];
                    if (this.getTerritoryOwner(territoryId) !== userId) {
                        throw new Error(`You can't move troops from _${this.getTerritoryName(territoryId)}_, you don't own that territory!`);
                    }
                    // Add to the pending decision
                    const pendingMove = this.pendingMoveDecisions[userId];
                    pendingMove.from = territoryId;
                    // Delete the subsequent 2 properties to ensure it's not filled in backward
                    delete pendingMove.to;
                    delete pendingMove.quantity;
                    // Respond with a prompt to do more
                    await interaction.reply(this.getMoveDecisionReply(userId));
                    break;
                }
                case 'game:selectMoveTo': {
                    // First, validate that move decisions are being accepted
                    if (!this.state.moveDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _moving troops_ right now...');
                    }
                    // Instantiate the pending move if it's missing
                    if (!this.pendingMoveDecisions[userId]) {
                        this.pendingMoveDecisions[userId] = {};
                    }
                    // Validate the selected destination territory
                    const territoryId = interaction.values[0];
                    if (this.getTerritoryOwner(territoryId) !== userId) {
                        throw new Error(`You can't move troops to _${this.getTerritoryName(territoryId)}_, you don't own that territory!`);
                    }
                    // Add to the pending decision
                    const pendingMove = this.pendingMoveDecisions[userId];
                    pendingMove.to = territoryId;
                    // Delete the subsequent property to ensure it's not filled in backward
                    delete pendingMove.quantity;
                    // Respond with a prompt to do more
                    await interaction.reply(this.getMoveDecisionReply(userId));
                    break;
                }
                case 'game:selectMoveQuantity': {
                    // First, validate that move decisions are being accepted
                    if (!this.state.moveDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _moving troops_ right now...');
                    }
                    // Instantiate the pending move if it's missing
                    if (!this.pendingMoveDecisions[userId]) {
                        this.pendingMoveDecisions[userId] = {};
                    }
                    // Validate the selected quantity
                    // TODO: Validate that the quantity is possible with the selected source territory
                    const quantity = parseInt(interaction.values[0]);
                    if (isNaN(quantity) || quantity < 1) {
                        throw new Error(`\`${quantity}\` is an invalid quantity of troops!`);
                    }
                    // Add to the pending decision
                    const pendingMove = this.pendingMoveDecisions[userId];
                    pendingMove.quantity = quantity;
                    // Respond with a prompt to do more
                    await interaction.reply(this.getMoveDecisionReply(userId));
                    break;
                }
                case 'game:selectAttackFrom': {
                    // First, validate that attack decisions are being accepted
                    if (!this.state.attackDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _attacking_ right now...');
                    }
                    // Instantiate the pending attack if it's missing
                    if (!this.pendingAttackDecisions[userId]) {
                        this.pendingAttackDecisions[userId] = {};
                    }
                    // Validate the selected source territory
                    // TODO: Validate that the player can use any troops from this territory to attack
                    const territoryId = interaction.values[0];
                    if (this.getTerritoryOwner(territoryId) !== userId) {
                        throw new Error(`You can't use troops from _${this.getTerritoryName(territoryId)}_ to attack, you don't own that territory!`);
                    }
                    // Add to the pending decision
                    const pendingAttack = this.pendingAttackDecisions[userId];
                    pendingAttack.from = territoryId;
                    // Delete the subsequent 2 properties to ensure it's not filled in backward
                    delete pendingAttack.to;
                    delete pendingAttack.quantity;
                    // Respond with a prompt to do more
                    await interaction.reply(this.getAttackDecisionReply(userId));
                    break;
                }
                case 'game:selectAttackTo': {
                    // First, validate that attack decisions are being accepted
                    if (!this.state.attackDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _attacking_ right now...');
                    }
                    // Instantiate the pending attack if it's missing
                    if (!this.pendingAttackDecisions[userId]) {
                        this.pendingAttackDecisions[userId] = {};
                    }
                    // Validate the selected target territory
                    const territoryId = interaction.values[0];
                    if (this.getTerritoryOwner(territoryId) === userId) {
                        throw new Error(`You can't attack _${this.getTerritoryName(territoryId)}_, that's your own territory!`);
                    }
                    // Add to the pending decision
                    const pendingAttack = this.pendingAttackDecisions[userId];
                    pendingAttack.to = territoryId;
                    // Delete the subsequent property to ensure it's not filled in backward
                    delete pendingAttack.quantity;
                    // Respond with a prompt to do more
                    await interaction.reply(this.getAttackDecisionReply(userId));
                    break;
                }
                case 'game:selectAttackQuantity': {
                    // First, validate that attack decisions are being accepted
                    if (!this.state.attackDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _attacking_ right now...');
                    }
                    // Instantiate the pending attack if it's missing
                    if (!this.pendingAttackDecisions[userId]) {
                        this.pendingAttackDecisions[userId] = {};
                    }
                    // Validate the selected quantity
                    // TODO: Validate that the quantity is possible with the selected source territory
                    const quantity = parseInt(interaction.values[0]);
                    if (isNaN(quantity) || quantity < 1) {
                        throw new Error(`\`${quantity}\` is an invalid quantity of troops!`);
                    }
                    // Add to the pending decision
                    const pendingAttack = this.pendingAttackDecisions[userId];
                    pendingAttack.quantity = quantity;
                    // Respond with a prompt to do more
                    await interaction.reply(this.getAttackDecisionReply(userId));
                    break;
                    break;
                }
            }
        }
    }

    private getAddDecisionReply(userId: Snowflake): InteractionReplyOptions {
        if (!this.state.addDecisions) {
            throw new Error('I\'m not accepting any decisions related to _adding troops_ right now...');
        }
        const pendingAdditions = this.state.addDecisions[userId] ?? [];
        const newTroops = this.getPlayerNewTroops(userId);
        const additionsRemaining = newTroops - pendingAdditions.length;
        // Construct the message
        let content = `You have **${newTroops}** new troop(s) to deploy.`;
        if (pendingAdditions.length > 0) {
            content += ' You\'ve made the following placements:\n' + this.getAddDecisionStrings(userId).join('\n');
        }
        content += `\nYou can place **${additionsRemaining}** more.`
        // If the player has remaining troops to add, show a territory select
        const components: APIActionRowComponent<APIMessageActionRowComponent>[] = [];
        if (additionsRemaining > 0) {
            components.push({
                type: ComponentType.ActionRow,
                components: [{
                    type: ComponentType.StringSelect,
                    custom_id: 'game:selectAdd',
                    placeholder: 'Select territory...',
                    min_values: 1,
                    max_values: 1,
                    options: this.getTerritorySelectOptions(this.getTerritoriesForPlayer(userId))
                }]
            });
        }
        // Add action row for reviewing/clearing
        components.push({
            type: ComponentType.ActionRow,
            components: [{
                type: ComponentType.Button,
                custom_id: 'game:reviewDecisions',
                label: 'Review Decisions',
                style: ButtonStyle.Primary
            }, {
                type: ComponentType.Button,
                custom_id: 'game:clearAdd',
                label: 'Start Over',
                style: ButtonStyle.Danger
            }]
        });
        return {
            ephemeral: true,
            content,
            components
        };
    }

    private getMoveDecisionReply(userId: Snowflake): InteractionReplyOptions {
        if (!this.state.moveDecisions) {
            throw new Error('I\'m not accepting any decisions related to _moving troops_ right now...');
        }
        // Instantiate the move data if it's not there
        if (!this.pendingMoveDecisions[userId]) {
            this.pendingMoveDecisions[userId] = {};
        }
        const pendingMove = this.pendingMoveDecisions[userId];
        // If the source is missing, prompt them to fill it in
        if (!pendingMove.from) {
            // Construct the reply payload
            const validSources = this.getValidMovementSourceTerritoriesForPlayer(userId);
            if (validSources.length > 0) {
                return {
                    ephemeral: true,
                    content: 'From where would you like to move troops?',
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.StringSelect,
                            custom_id: 'game:selectMoveFrom',
                            placeholder: 'Select source territory...',
                            min_values: 1,
                            max_values: 1,
                            options: this.getTerritorySelectOptions(validSources)
                        }]
                    }]
                };
            } else {
                // Clear the pending move to avoid softlocking
                delete this.pendingMoveDecisions[userId];
                return {
                    ephemeral: true,
                    content: 'There are no territories from which you can move troops. Sorry...'
                };
            }
        }
        // If the destination is missing, prompt them to fill it in
        if (!pendingMove.to) {
            // Construct the reply payload
            const validDestinations = this.getTerritoryConnections(pendingMove.from)
                .filter(territoryId => this.getTerritoryOwner(territoryId) === userId);
            if (validDestinations.length > 0) {
                return {
                    ephemeral: true,
                    content: `Where should the troops from _${this.getTerritoryName(pendingMove.from)}_ move to?`,
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.StringSelect,
                            custom_id: 'game:selectMoveTo',
                            placeholder: 'Select destination territory...',
                            min_values: 1,
                            max_values: 1,
                            options: this.getTerritorySelectOptions(validDestinations)
                        }]
                    }]
                };
            } else {
                // Clear the pending move to avoid softlocking
                delete this.pendingMoveDecisions[userId];
                return {
                    ephemeral: true,
                    content: `There are no valid destinations near _${this.getTerritoryName(pendingMove.from)}_. Sorry...`
                };
            }
        }
        // If the quantity is missing, prompt them to fill it in
        if (!pendingMove.quantity) {
            const numTroops = this.getTerritoryTroops(pendingMove.from);
            const quantityValues: string[] = [];
            for (let i = 1; i < numTroops; i++) {
                quantityValues.push(`${i}`);
            }
            if (quantityValues.length > 0) {
                return {
                    ephemeral: true,
                    content: `How many troops would you like to move from _${this.getTerritoryName(pendingMove.from)}_ to _${this.getTerritoryName(pendingMove.to)}_?`,
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.StringSelect,
                            custom_id: 'game:selectMoveQuantity',
                            placeholder: 'Select quantity...',
                            min_values: 1,
                            max_values: 1,
                            options: quantityValues.map(x => ({
                                value: x,
                                label: x
                            }))
                        }]
                    }]
                };
            } else {
                // Clear the pending move to avoid softlocking
                delete this.pendingMoveDecisions[userId];
                return {
                    ephemeral: true,
                    content: `_${this.getTerritoryName(pendingMove.from)}_ doesn't have enough troops to move. Sorry...`
                };
            }
        }
        // If the pending decision is full, save it
        if (pendingMove.from && pendingMove.to && pendingMove.quantity) {
            this.state.moveDecisions[userId] = pendingMove as RiskMovementData;
            // Delete the pending move so it can't be filled out backward
            delete this.pendingMoveDecisions[userId];
        }
        // Now, show them their decision
        // TODO: Fill out
        return {
            ephemeral: true,
            content: 'You have chosen the following _move_ action:\n'
                + this.getMoveDecisionStrings(userId).join('\n')
                + '\nYou can use the "Start Over" button to delete or change this action.',
            components: [{
                type: ComponentType.ActionRow,
                components: [{
                    type: ComponentType.Button,
                    custom_id: 'game:reviewDecisions',
                    label: 'Review Decisions',
                    style: ButtonStyle.Primary
                }, {
                    type: ComponentType.Button,
                    custom_id: 'game:clearMove',
                    label: 'Start Over',
                    style: ButtonStyle.Danger
                }]
            }]
        };
    }

    private getAttackDecisionReply(userId: Snowflake): InteractionReplyOptions {
        if (!this.state.attackDecisions) {
            throw new Error('I\'m not accepting any decisions related to _attacking_ right now...');
        }
        // Instantiate the attack data if it's not there
        if (!this.pendingAttackDecisions[userId]) {
            this.pendingAttackDecisions[userId] = {};
        }
        const pendingAttack = this.pendingAttackDecisions[userId];
        // If the source is missing, prompt them to fill it in
        if (!pendingAttack.from) {
            // Construct the reply payload
            const validSources = this.getValidAttackSourceTerritoriesForPlayer(userId);
            if (validSources.length > 0) {
                return {
                    ephemeral: true,
                    content: 'Which troops will you use for the attack?',
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.StringSelect,
                            custom_id: 'game:selectAttackFrom',
                            placeholder: 'Select attacker territory...',
                            min_values: 1,
                            max_values: 1,
                            // TODO: Show correct territories
                            options: this.getTerritorySelectOptions(validSources)
                        }]
                    }]
                };
            } else {
                // Clear the pending attack to avoid softlocking
                delete this.pendingAttackDecisions[userId];
                return {
                    ephemeral: true,
                    content: 'There are no territories from which you can attack. Sorry...'
                };
            }
        }
        // If the target is missing, prompt them to fill it in
        if (!pendingAttack.to) {
            // Construct the reply payload
            const validTargets = this.getTerritoryConnections(pendingAttack.from)
                .filter(territoryId => this.getTerritoryOwner(territoryId) !== userId);
            if (validTargets.length > 0) {
                return {
                    ephemeral: true,
                    content: `Which territory will the troops from _${this.getTerritoryName(pendingAttack.from)}_ attacK?`,
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.StringSelect,
                            custom_id: 'game:selectAttackTo',
                            placeholder: 'Select target territory...',
                            min_values: 1,
                            max_values: 1,
                            options: this.getTerritorySelectOptions(validTargets)
                        }]
                    }]
                };
            } else {
                // Clear the pending attack to avoid softlocking
                delete this.pendingAttackDecisions[userId];
                return {
                    ephemeral: true,
                    content: `There are no territories that _${this.getTerritoryName(pendingAttack.from)}_ can attack. Sorry...`
                };
            }
        }
        // If the quantity is missing, prompt them to fill it in
        if (!pendingAttack.quantity) {
            const numTroops = this.getTerritoryTroops(pendingAttack.from);
            const quantityValues: string[] = [];
            for (let i = 1; i < numTroops; i++) {
                quantityValues.push(`${i}`);
            }
            if (quantityValues.length > 0) {
                return {
                    ephemeral: true,
                    content: `How many troops from _${this.getTerritoryName(pendingAttack.from)}_ will be attacking _${this.getTerritoryName(pendingAttack.to)}_? (one must be left behind)`,
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.StringSelect,
                            custom_id: 'game:selectAttackQuantity',
                            placeholder: 'Select quantity...',
                            min_values: 1,
                            max_values: 1,
                            options: quantityValues.map(x => ({
                                value: x,
                                label: x
                            }))
                        }]
                    }]
                };
            } else {
                // Clear the pending attack to avoid softlocking
                delete this.pendingAttackDecisions[userId];
                return {
                    ephemeral: true,
                    content: `_${this.getTerritoryName(pendingAttack.from)}_ doesn't have enough troops to stage an attack. Sorry...`
                };
            }
        }
        // If the pending decision is full, save it
        if (pendingAttack.from && pendingAttack.to && pendingAttack.quantity) {
            // Initialize this player's attack decisions map
            if (!this.state.attackDecisions[userId]) {
                this.state.attackDecisions[userId] = [];
            }
            this.state.attackDecisions[userId].push(pendingAttack as RiskMovementData);
            // Delete the pending attack so it can't be filled out backward
            delete this.pendingAttackDecisions[userId];
        }
        // Now, show them their decision
        // TODO: Fill out
        return {
            ephemeral: true,
            content: 'You have chosen the following _attack_ actions:\n'
                + this.getAttackDecisionStrings(userId).join('\n')
                + '\nYou can use the "Start Over" button to delete or change these actions.',
            components: [{
                type: ComponentType.ActionRow,
                components: [{
                    type: ComponentType.Button,
                    custom_id: 'game:attack',
                    label: randChoice('ANOTHER!', 'MORE!', 'AGAIN!', 'Attack More', 'More Bloodshed'),
                    style: ButtonStyle.Success
                }, {
                    type: ComponentType.Button,
                    custom_id: 'game:reviewDecisions',
                    label: 'Review Decisions',
                    style: ButtonStyle.Primary
                }, {
                    type: ComponentType.Button,
                    custom_id: 'game:clearAttack',
                    label: 'Start Over',
                    style: ButtonStyle.Danger
                }]
            }]
        };
    }

    private getAddDecisionStrings(userId: Snowflake): string[] {
        if (this.state.addDecisions) {
            const additions = {};
            for (const territoryId of (this.state.addDecisions[userId] ?? [])) {
                additions[territoryId] = (additions[territoryId] ?? 0) + 1;
            }
            return Object.keys(additions).map(territoryId => `- Place **${additions[territoryId]}** troop${additions[territoryId] === 1 ? '' : 's'} at _${this.getTerritoryName(territoryId)}_`);
        }
        return [];
    }

    private getAttackDecisionStrings(userId: Snowflake): string[] {
        if (this.state.attackDecisions) {
            const attacks = (this.state.attackDecisions[userId] ?? []);
            return attacks.map(a => `- Attack _${this.getTerritoryName(a.to)}_ with **${a.quantity}** troop(s) from _${this.getTerritoryName(a.from)}_`);
        }
        return [];
    }

    private getMoveDecisionStrings(userId: Snowflake): string[] {
        if (this.state.moveDecisions) {
            const moveData = this.state.moveDecisions[userId];
            if (moveData) {
                return [`- Move **${moveData.quantity}** troop(s) from _${this.getTerritoryName(moveData.from)}_ to _${this.getTerritoryName(moveData.to)}_`];
            }
        }
        return [];
    }

    private getTerritorySelectOptions(territoryIds: string[]): APISelectMenuOption[] {
        return territoryIds.map(territoryId => ({
            label: this.getTerritoryName(territoryId),
            value: territoryId,
            description: (() => {
                const result: string[] = [];
                const owner = this.getTerritoryOwner(territoryId);
                if (owner) {
                    result.push(`Owned by ${this.getPlayerDisplayName(owner)}`);
                }
                const troops = this.getTerritoryTroops(territoryId);
                if (troops) {
                    result.push(`${troops} troop(s)`);
                }
                result.push(`${this.getNumTerritoryConnections(territoryId)} neighbor(s)`);
                return result.join(', ');
            })()
        }));
    }
}
