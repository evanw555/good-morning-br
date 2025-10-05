import { ActionRowData, ButtonStyle, ComponentType, GuildMember, Interaction, MessageActionRowComponentData, MessageFlags, Snowflake } from "discord.js";
import canvas from 'canvas';
import { DecisionProcessingResult, GamePlayerAddition, MessengerManifest, MessengerPayload, PrizeType, SeasonEndResults } from "../types";
import AbstractGame from "./abstract-game";
import { getMaxKey, getMostSimilarByNormalizedEditDistance, getObjectSize, isObjectEmpty, naturalJoin, randChoice, shuffle, toFixed } from "evanw555.js";
import { IslandGameState, IslandPlayerState } from "./types";

import imageLoader from "../image-loader";
import logger from "../logger";

export default class IslandGame extends AbstractGame<IslandGameState> {
    /**
     * Map from immunity granter user ID to recipient user ID.
     * Used to ensure there's a confirmation step when granting immunity.
     */
    private pendingImmunityReceivers: Record<Snowflake, Snowflake>;

    constructor(state: IslandGameState) {
        super(state);
        this.pendingImmunityReceivers = {};
    }

    static create(members: GuildMember[], season: number): IslandGame {
        const players: Record<Snowflake, IslandPlayerState> = {};
        for (const member of members) {
            players[member.id] = {
                displayName: member.displayName,
                points: 0
            };
        }
        return new IslandGame({
            type: 'ISLAND',
            season,
            winners: [],
            decisions: {},
            lockedVotes: {},
            turn: 0,
            players,
            numToBeEliminated: 1
        });
    }

    override async getIntroductionMessages(): Promise<MessengerPayload[]> {
        return [
            {
                content: 'My dear dogs... welcome to the Island of Mournful Mornings! This season, you are all castaways on my island 😼',
                files: [await this.renderStateAttachment()]
            },
            'This game will be a true Battle Royale, and only those of you who have participated in the last week are eligible to win 🌞',
            'However, don\'t get too comfortable! Each week, some dogs will be voted off the island, killing their dreams of a sungazing victory ☠️',
            'Unlike other seasons, the points you earn each day are reset at the end of the week. Points are only used to determine how many votes you get, and to break ties in the weekly vote',
            'By default, you get _one_ vote each week, but top point earners will be told via DM that they have more votes',
            'We\'ve played this game before, so here are the differences from last time:'
                + '\n- If someone votes for you and you survive, you get **2x** _retaliation_ votes against them the following week'
                + '\n- If someone votes for you and you die, you get a permanent **+1** _revenge_ vote against them',
            {
                content: 'So let\'s get started, click here to cast your first vote!',
                components: this.getDecisionActionRow()
            }
        ];
    }

    getInstructionsText(): string {
        if (this.getTurn() === 1) {
            return 'Good luck!';
        }
        return 'Cast your votes!';
    }

    override getReminderText(): string {
        return 'Reminder! You have until tomorrow morning to vote someone off the island';
    }

    getHelpText(): string {
        return this.getInstructionsText();
    }

    getDebugText(): string {
        // TODO: Complete
        return '';
    }

    getDebugString(): string {
        // TODO: Complete
        return '';
    }

    override async onDecisionPreNoon(): Promise<MessengerManifest> {
        return {
            public: [{
                content: this.getReminderText(),
                files: [await this.renderStateAttachment()],
                components: this.getDecisionActionRow()
            }]
        };
    }

    getSeasonCompletion(): number {
        throw new Error("Method not implemented.");
    }

    getPlayers(): string[] {
        return Object.keys(this.state.players);
    }

    getOrderedPlayers(): string[] {
        // TODO: Complete this
        const comparator = (x: Snowflake, y: Snowflake) => {
            // First, their elimination status
            const elimination = Number(this.isPlayerEliminated(x)) - Number(this.isPlayerEliminated(y));
            if (elimination !== 0) {
                return elimination;
            }
            // If they're both eliminated, order by final rank
            if (this.isPlayerEliminated(x) && this.isPlayerEliminated(y)) {
                return this.getFinalRank(x) - this.getFinalRank(y);
            }
            // Else, compare by points
            return this.getPoints(y) - this.getPoints(x);
        };
        return this.getPlayers().sort((x, y) => comparator(x, y));
    }

    private getReverseOrderedPlayers(): Snowflake[] {
        return this.getOrderedPlayers().reverse();
    }

    private getFinalRankOrderedPlayers(): Snowflake[] {
        return this.getPlayers().sort((x, y) => {
            return this.getFinalRank(x) - this.getFinalRank(y);
        })
    }

    private getRenderOrderedPlayers(): Snowflake[] {
        // TODO: Complete this
        const comparator = (x: Snowflake, y: Snowflake) => {
            // First, their elimination status
            const elimination = Number(this.isPlayerEliminated(x)) - Number(this.isPlayerEliminated(y));
            if (elimination !== 0) {
                return elimination;
            }
            // If they're both eliminated, order by final rank
            if (this.isPlayerEliminated(x) && this.isPlayerEliminated(y)) {
                return this.getFinalRank(x) - this.getFinalRank(y);
            }
            // Else, compare alphabetically
            return this.getName(x).localeCompare(this.getName(y));
        };
        return this.getPlayers().sort((x, y) => comparator(x, y));
    }

    private getRemainingPlayers(): Snowflake[] {
        return this.getOrderedPlayers().filter(id => !this.isPlayerEliminated(id));
    }

    private getNumRemainingPlayers(): number {
        return this.getRemainingPlayers().length;
    }

    private getEliminatedPlayers(): Snowflake[] {
        return this.getOrderedPlayers().filter(id => this.isPlayerEliminated(id));
    }

    private getNumEliminatedPlayers(): number {
        return this.getEliminatedPlayers().length;
    }

    private getNumUnlockedPlayers(): number {
        return this.getOrderedPlayers().filter(id => !this.isPlayerLocked(id)).length;
    }

    hasPlayer(userId: string): boolean {
        return userId in this.state.players;
    }

    override addLatePlayers(players: GamePlayerAddition[]): MessengerPayload[] {
        for (const { userId, displayName, points } of players) {
            if (userId in this.state.players) {
                void logger.log(`Refusing to add **${displayName}** to the island, as they're already in it!`);
                continue;
            }
            this.state.players[userId] = {
                displayName,
                points,
                eliminated: true,
                // This player is joining late, so lock them (don't let them vote)
                locked: true,
                // Give them a terrible dummy rank that's necessarily larger than all other ranks
                finalRank: this.getNumPlayers() + 1
            };
            void logger.log(`Added **${displayName}** at final rank **${this.getFinalRank(userId)}**`);
        }
        // Never return any sort of message for new players
        return [];
    }

    updatePlayer(member: GuildMember): void {
        if (this.hasPlayer(member.id)) {
            this.state.players[member.id].displayName = member.displayName;
        }
    }

    removePlayer(userId: string): void {
        delete this.state.decisions[userId];
        delete this.state.players[userId];
        // TODO: Can remove this if-check once the map is for sure populated
        if (this.state.lockedVotes) {
            delete this.state.lockedVotes[userId];
        }
        if (this.state.revealedAudiencePick === userId) {
            delete this.state.revealedAudiencePick;
        }
        // Remove references to this player from other players' states
        for (const player of Object.values(this.state.players)) {
            if (player.revealedTarget === userId) {
                delete player.revealedTarget;
            }
            if (player.immunityGrantedBy === userId) {
                delete player.immunityGrantedBy;
            }
            // Remove from assailants list
            // TODO: Refactor list remove to common util
            if (player.assailants && player.assailants.includes(userId)) {
                player.assailants.splice(player.assailants.indexOf(userId), 1);
            }
            // Remove from last assailants list
            // TODO: Refactor list remove to common util
            if (player.lastAssailants && player.lastAssailants.includes(userId)) {
                player.lastAssailants.splice(player.lastAssailants.indexOf(userId), 1);
            }
        }
    }

    private getName(userId: Snowflake): string {
        return this.state.players[userId]?.displayName ?? userId;
    }

    private getJoinedNames(userIds: Snowflake[]): string {
        return naturalJoin(userIds.map(id => this.getName(id)), { bold: true });
    }

    private isPlayerEliminated(userId: Snowflake): boolean {
        return this.state.players[userId]?.eliminated ?? false;
    }

    private isPlayerLocked(userId: Snowflake): boolean {
        return this.state.players[userId]?.locked ?? false;
    }

    private isPlayerImmune(userId: Snowflake): boolean {
        return this.state.players[userId]?.immunityGrantedBy !== undefined;
    }

    private getPlayerImmunityGranter(userId: Snowflake): Snowflake {
        const immunityGrantedBy = this.state.players[userId]?.immunityGrantedBy;
        if (!immunityGrantedBy) {
            throw new Error(`Cannot get player immunity granter for \`${userId}\`, as they're not immune!`);
        }
        return immunityGrantedBy;
    }

    private mayPlayerGrantImmunity(userId: Snowflake): boolean {
        return this.state.players[userId]?.mayGrantImmunity ?? false;
    }

    private getNumBaseVotes(userId: Snowflake): number {
        return this.state.players[userId]?.baseVotes ?? 0;
    }

    private getNumActualVotes(userId: Snowflake, targetId: Snowflake): number {
        const baseVotes = this.getNumBaseVotes(userId);
        if (this.hasRetaliationVotesAgainst(userId, targetId)) {
            return baseVotes * 2;
        } else if (this.hasRevengeVotesAgainst(userId, targetId)) {
            return baseVotes + 1;
        }
        return baseVotes;
    }

    private getNumIncomingVotes(userId: Snowflake): number {
        return this.state.players[userId]?.incomingVotes ?? 0;
    }

    private hasLastAssailants(userId: Snowflake): boolean {
        return this.getLastAssailants(userId).length > 0;
    }

    private getLastAssailants(userId: Snowflake): Snowflake[] {
        return this.state.players[userId]?.lastAssailants ?? [];
    }

    private isLastAssailantOf(userId: Snowflake, otherId: Snowflake): boolean {
        return (this.state.players[otherId]?.lastAssailants ?? []).includes(userId);
    }

    private hasRetaliationVotesAgainst(userId: Snowflake, targetId: Snowflake): boolean {
        return !this.isPlayerEliminated(userId) && this.isLastAssailantOf(targetId, userId);
    }

    private hasRevengeVotesAgainst(userId: Snowflake, targetId: Snowflake): boolean {
        return this.isPlayerEliminated(userId) && this.isLastAssailantOf(targetId, userId);
    }

    private getFinalRank(userId: Snowflake): number {
        return this.state.players[userId]?.finalRank ?? Number.MAX_SAFE_INTEGER;
    }

    async renderState(options?: { showPlayerDecision?: string | undefined; admin?: boolean | undefined } | undefined): Promise<Buffer> {
        const MARGIN = 16;
        const HEADER_WIDTH = 750;
        const HEADER_HEIGHT = 50;
        const WIDTH = HEADER_WIDTH + MARGIN * 2;
        const AVATAR_HEIGHT = 32;
        const AVATAR_MARGIN = 4;

        // Load images
        const islandImage = await imageLoader.loadImage('assets/island.png');
        const rightArrowImage = await imageLoader.loadImage('assets/right-arrow.png');
        const skullImage = await imageLoader.loadImage('assets/skull.png');
        const sunIconImage = await imageLoader.loadImage('assets/sunicon.png');
        const clownIconImage = await imageLoader.loadImage('assets/clownicon.png');
        const slashIconImage = await imageLoader.loadImage('assets/slashicon.png');
        const audiencePickIconImage = await imageLoader.loadImage('assets/ranklast.png');

        const ROSTER_Y = 2 * MARGIN + HEADER_HEIGHT;
        const HORIZON_Y = ROSTER_Y + this.getNumRemainingPlayers() * (AVATAR_HEIGHT + AVATAR_MARGIN) - 0.5 * AVATAR_MARGIN;
        const ISLAND_Y = HORIZON_Y - islandImage.height * 0.6;
        // The total canvas height is the greater of...
        const HEIGHT = Math.max(
            // The bottom of the roster
            ROSTER_Y + this.getNumUnlockedPlayers() * (AVATAR_HEIGHT + AVATAR_MARGIN),
            // The bottom of the island
            ISLAND_Y + islandImage.height + MARGIN);
        const c = canvas.createCanvas(WIDTH, HEIGHT);
        const context = c.getContext('2d');

        // Fill the blue sky background
        context.fillStyle = 'rgba(100,157,250,1)';
        context.fillRect(0, 0, WIDTH, HEIGHT);

        // Fill the sea
        context.fillStyle = 'rgba(28,50,138,1)';
        context.fillRect(0, HORIZON_Y, WIDTH, HEIGHT - HORIZON_Y);

        // Draw the island image
        context.drawImage(islandImage, MARGIN, ISLAND_Y);

        const drawTextWithShadow = (text: string, x: number, y: number, maxWidth?: number) => {
            const savedStyle = context.fillStyle;
            context.fillStyle = 'rgba(0,0,0,0.6)';
            context.fillText(text, x + 2, y + 2, maxWidth);
            context.fillStyle = savedStyle;
            context.fillText(text, x, y, maxWidth);
        };

        // Write the header text
        context.fillStyle = 'rgb(221,231,239)';
        const TITLE_FONT_SIZE = Math.floor(HEADER_HEIGHT * 0.6);
        context.font = `${TITLE_FONT_SIZE}px sans-serif`;
        drawTextWithShadow(`${this.state.numToBeEliminated} dog${this.state.numToBeEliminated === 1 ? '' : 's'} will be eliminated this week... But who?`, MARGIN, MARGIN + TITLE_FONT_SIZE);

        // Determine if anyone has any votes to give out (to determine if all the votes have been wiped or not)
        const doesAnyoneHaveVotes = this.getPlayers().some(id => this.getNumBaseVotes(id) > 0);

        // Draw all players
        let playerY = ROSTER_Y;
        let eliminatedIndex = 0;
        for (const userId of this.getRenderOrderedPlayers()) {
            // First and foremost, if this player is locked then skip them altogether
            if (this.isPlayerLocked(userId)) {
                continue;
            }
            let playerX = islandImage.width + AVATAR_HEIGHT + MARGIN * 2;
            // Draw avatar
            const avatar = await imageLoader.loadAvatar(userId, 32);
            context.drawImage(avatar, playerX, playerY, AVATAR_HEIGHT, AVATAR_HEIGHT);
            // If the player has incoming votes...
            const numIncomingVotes = Math.round(this.getNumIncomingVotes(userId));
            if (numIncomingVotes > 0) {
                // Draw the black background for the incoming voter avatars
                context.fillStyle = 'black';
                const boxWidth = numIncomingVotes * (AVATAR_HEIGHT + AVATAR_MARGIN) + AVATAR_MARGIN;
                context.fillRect(playerX - boxWidth - (AVATAR_HEIGHT + AVATAR_MARGIN), playerY - AVATAR_MARGIN, boxWidth, AVATAR_HEIGHT + 2 * AVATAR_MARGIN);
                // Draw the arrow from the voter box to their avatar
                context.drawImage(rightArrowImage, playerX - (AVATAR_HEIGHT + AVATAR_MARGIN), playerY, AVATAR_HEIGHT, AVATAR_HEIGHT);
                // Draw who's voted for this player so far
                const voters = this.getPlayers().filter(id => this.state.players[id]?.revealedTarget === userId);
                let voterOffsetX = AVATAR_HEIGHT + AVATAR_MARGIN;
                for (const voterId of voters) {
                    const voterAvatar = await imageLoader.loadAvatar(voterId, 32);
                    // Draw one avatar for each vote
                    const numActualVotes = this.getNumActualVotes(voterId, userId);
                    for (let i = 0; i < numActualVotes; i++) {
                        voterOffsetX += AVATAR_HEIGHT + AVATAR_MARGIN;
                        context.drawImage(voterAvatar, playerX - voterOffsetX, playerY, AVATAR_HEIGHT, AVATAR_HEIGHT);
                    }
                }
                // If this player was picked by the audience, draw that
                if (this.state.revealedAudiencePick === userId) {
                    voterOffsetX += AVATAR_HEIGHT + AVATAR_MARGIN;
                    context.drawImage(audiencePickIconImage, playerX - voterOffsetX, playerY, AVATAR_HEIGHT, AVATAR_HEIGHT);
                }
            }
            // Draw modifier images after the avatar...
            if (this.isPlayerLocked(userId)) {
                // TODO: This will never happen since locked players are skipped, but keep it here in case we want it again
                // playerX += AVATAR_HEIGHT + AVATAR_MARGIN;
                // context.drawImage(slashIconImage, playerX, playerY, AVATAR_HEIGHT, AVATAR_HEIGHT);
            } else {
                // The following should only be drawn if the player is NOT locked (since it's redundant)
                if (this.isPlayerEliminated(userId)) {
                    playerX += AVATAR_HEIGHT + AVATAR_MARGIN;
                    context.drawImage(skullImage, playerX, playerY, AVATAR_HEIGHT, AVATAR_HEIGHT);
                }
                // Clown the player if they didn't get any votes this week (yet others did, in case all the votes have been wiped at the end of the turn)
                if (this.getNumBaseVotes(userId) === 0 && doesAnyoneHaveVotes) {
                    playerX += AVATAR_HEIGHT + AVATAR_MARGIN;
                    context.drawImage(clownIconImage, playerX, playerY, AVATAR_HEIGHT, AVATAR_HEIGHT);
                }
            }
            // Always draw immunity sun if immune
            if (this.isPlayerImmune(userId)) {
                playerX += AVATAR_HEIGHT + AVATAR_MARGIN;
                context.drawImage(sunIconImage, playerX, playerY, AVATAR_HEIGHT, AVATAR_HEIGHT);
            }

            // Draw name
            playerX += AVATAR_HEIGHT + MARGIN;
            // const textX = playerX + 3 * (AVATAR_HEIGHT + AVATAR_MARGIN) + MARGIN;
            const widthLimit = WIDTH - playerX - MARGIN;
            context.font = `${AVATAR_HEIGHT * 0.6}px BOLD SERIF`;
            // The "red" for eliminated players will get darker and darker
            context.fillStyle = this.isPlayerEliminated(userId) ? `hsl(0,100%,${Math.round(50 - (50 * (eliminatedIndex / this.getNumUnlockedPlayers())))}%)` : 'white';
            let nameText = this.getName(userId);
            // If viewing via the admin console, show more info
            if (options?.admin) {
                nameText += ` (${this.getNumBaseVotes(userId)}v, ${this.getNumIncomingVotes(userId)}iv)`;
            }
            drawTextWithShadow(nameText, playerX, playerY + AVATAR_HEIGHT * 0.75, widthLimit);
            // context.strokeText(`${player.pointSnapshot}pts ${this.getNumVotes(userId)} votes, ${this.getNumIncomingVotes(userId)} incoming, ${this.isPlayerEliminated(userId) ? '☠️' : ''}`,
            //     playerX + AVATAR_HEIGHT * 2 + MARGIN * 3,
            //     playerY + AVATAR_HEIGHT);
            if (this.isPlayerEliminated(userId)) {
                eliminatedIndex++;
                // Slowly make it look like their rows are lost in the water
                context.globalAlpha = 1 - (eliminatedIndex / this.getNumUnlockedPlayers());
            }
            playerY += AVATAR_MARGIN + AVATAR_HEIGHT;
        }

        // Write some admin properties
        if (options?.admin) {
            let baseAdminY = HORIZON_Y + AVATAR_HEIGHT;
            context.fillStyle = 'white';
            for (const userId of this.getOrderedPlayers()) {
                if (this.mayPlayerGrantImmunity(userId)) {
                    drawTextWithShadow(`${this.getName(userId)} may grant immunity`, MARGIN, baseAdminY);
                    baseAdminY += AVATAR_HEIGHT;
                }
                if (this.isPlayerImmune(userId)) {
                    drawTextWithShadow(`${this.getName(userId)} granted immunity by ${this.getName(this.getPlayerImmunityGranter(userId))}`, MARGIN, baseAdminY);
                    baseAdminY += AVATAR_HEIGHT;
                }
            }
        }

        return c.toBuffer();
    }

    override async beginTurn(): Promise<MessengerPayload[]> {
        const text: string[] = [];

        // Increment the turn counter
        this.state.turn++;

        // Clear the locked votes map
        this.state.lockedVotes = {};

        // For each immunity granter who still hasn't chosen anyone...
        for (const userId of this.getOrderedPlayers()) {
            if (this.mayPlayerGrantImmunity(userId)) {
                // If the player is remaining, automatically self-grant
                if (!this.isPlayerEliminated(userId)) {
                    this.state.players[userId].immunityGrantedBy = userId;
                }
                // Clear the property so they can't use it
                delete this.state.players[userId].mayGrantImmunity;
            }
        }

        // Determine how many will be eliminated this turn.
        // Use randomness in the middle of the "pathway pyramid" to ensure an equal chance of going down the 4-3-2-1 and 5-3-2-1 paths,
        // while still guaranteeing a deterministic number of turns from a given starting count (e.g. 16 will always take 6 turns).
        const numRemaining = this.getNumRemainingPlayers();
        let numToBeEliminated: number;
        if (numRemaining > 16) {
            numToBeEliminated = 5;
        } else if (numRemaining > 13) {
            numToBeEliminated = randChoice(4, 5);
        } else if (numRemaining > 11) {
            numToBeEliminated = 4;
        } else if (numRemaining > 9) {
            numToBeEliminated = randChoice(3, 4);
        } else if (numRemaining > 7) {
            numToBeEliminated = 3;
        } else if (numRemaining > 6) {
            numToBeEliminated = randChoice(2, 3);
        } else if (numRemaining > 4) {
            numToBeEliminated = 2;
        } else {
            numToBeEliminated = 1;
        }
        this.state.numToBeEliminated = numToBeEliminated;
        text.push(`This week, **${numToBeEliminated}** player${numToBeEliminated === 1 ? '' : 's'} will be voted off the island`);

        let aliveVotes = 3;
        let deadVotes = 3;
        let i = 0;
        const votelessPlayers: Snowflake[] = [];
        for (const userId of this.getOrderedPlayers()) {
            const player = this.state.players[userId];
            // Add fractional votes based on points to handle ties
            // NOTE: If there are 500 or more players, this fractional value may be rounded upward... which is bad
            player.incomingVotes = i++ * 0.001;
            // If this player is locked, skip them
            if (this.isPlayerLocked(userId)) {
                continue;
            }
            // Dole out votes to each player
            if (this.getPoints(userId) > 0) {
                if (this.isPlayerEliminated(userId)) {
                    player.baseVotes = Math.max(deadVotes--, 1);
                } else {
                    player.baseVotes = Math.max(aliveVotes--, 1);
                }
                // TODO: Temp logic for testing
                // this.state.decisions[userId] = [randChoice(...this.getRemainingPlayers())];
            } else {
                // Points are not net-positive, so this player can't vote
                player.baseVotes = 0;
                votelessPlayers.push(userId);
            }
        }

        // Add a log statement about immunity
        for (const userId of this.getOrderedPlayers()) {
            if (this.isPlayerImmune(userId)) {
                const granter = this.getPlayerImmunityGranter(userId);
                if (granter === userId) {
                    text.push(`**${this.getName(userId)}** has been granted immunity for winning this week's contest`);
                } else {
                    text.push(`**${this.getName(userId)}** has been granted immunity by **${this.getName(granter)}**`);
                }
            }
        }

        // Reset all player points
        for (const userId of this.getPlayers()) {
            this.state.players[userId].points = 0;
        }

        // If any players are voteless, add a message for that
        if (votelessPlayers.length > 0) {
            text.push(`${this.getJoinedNames(votelessPlayers)} cannot vote this week since they didn't earn any points`);
        }

        return text;
    }

    override async endTurn(): Promise<MessengerPayload[]> {
        const text: MessengerPayload[] = [];
        // Eliminate players! Order matters, the most voted-for players are eliminated first (and thus end with a worse final rank)
        const mostVotedForPlayers = this.getRemainingPlayers().sort((x, y) => this.getNumIncomingVotes(y) - this.getNumIncomingVotes(x));
        // Exclude immune players, then select only as many as needed
        const votedOff = mostVotedForPlayers
            .filter(id => !this.isPlayerImmune(id))
            .slice(0, this.state.numToBeEliminated);
        text.push(`${this.getJoinedNames(votedOff)} ${this.state.numToBeEliminated === 1 ? 'has' : 'have'} been voted off the island 🪦`);
        for (const userId of votedOff) {
            const rank = this.getNumRemainingPlayers();
            this.state.players[userId].eliminated = true;
            // Assign final rank
            this.state.players[userId].finalRank = rank;
        }
        // If one player remains, trigger the winning condition
        if (this.getNumRemainingPlayers() > 1) {
            text.push(`**${this.getNumRemainingPlayers()}** dear dogs remain...`);
        } else {
            // Assign final rank to the remaining player
            // TODO: What happens if there are no remaining players? Is that possible?
            if (this.getNumRemainingPlayers() === 1) {
                const winnerId = this.getRemainingPlayers()[0];
                this.state.players[winnerId].finalRank = 1;
            }
            // Add the winners based on final rank
            const winners = this.getFinalRankOrderedPlayers().slice(0, 3);
            for (const winner of winners) {
                this.addWinner(winner);
            }
            text.push(`**${this.getName(winners[0])}** has survived the island and is crowned champion! The late **${this.getName(winners[1])}** and **${this.getName(winners[2])}** podium at _2nd_ and _3rd_, respectively 🌞`);
        }
        // Clear all weekly player metadata
        for (const userId of this.getOrderedPlayers()) {
            const player = this.state.players[userId];
            // Reset immunity for all players
            delete player.immunityGrantedBy;
            delete player.mayGrantImmunity;
            // Clear num votes for all players
            delete player.baseVotes;
            delete player.incomingVotes;
            // Clear other metadata
            delete player.revealedTarget;
            // If there is a current assailants list, move it over to their last assailants list
            if (player.assailants) {
                player.lastAssailants = player.assailants;
                delete player.assailants;
            }
            // If no assailants yet they're still alive, clear the last list
            else if (!this.isPlayerEliminated(userId)) {
                delete player.assailants;
                delete player.lastAssailants;
            }
        }

        // Clear the weekly pending immunity granter data
        this.pendingImmunityReceivers = {};

        return text;
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
        // If player isn't in the game yet, do nothing
        if (!this.hasPlayer(userId)) {
            return [];
        }
        switch (type) {
            case 'submissions1':
            case 'submissions1-tied':
                // If the player is locked (joined late), do nothing
                if (this.isPlayerLocked(userId)) {
                    return [];
                }
                // If this award is from before the game started, grant immunity but don't notify
                if (this.getTurn() === 0) {
                    this.state.players[userId].immunityGrantedBy = userId;
                    return [];
                }
                // If we're in the final week, don't award anything but still notify them
                if (this.getNumRemainingPlayers() === 2) {
                    return [`${intro}, but it's the final week so I can't grant anyone immunity. Sorry bud!`];
                }
                // Else, award immunity and notify
                this.state.players[userId].mayGrantImmunity = true;
                // Return reply text catered to their elimination status
                if (this.isPlayerEliminated(userId)) {
                    return [{
                        content: `${intro}! If you so desire, you may choose one remaining player to grant immunity to`,
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.Button,
                                style: ButtonStyle.Secondary,
                                label: 'Choose',
                                custom_id: 'game:giveImmunity'
                            }]
                        }]
                    }];
                } else {
                    return [
                        `${intro}, you've been granted immunity this week! No one will be able to vote to eliminate you until next week`,
                        {
                            content: 'Alternatively, you can choose to give your immunity away to another player',
                            components: [{
                                type: ComponentType.ActionRow,
                                components: [{
                                    type: ComponentType.Button,
                                    style: ButtonStyle.Secondary,
                                    label: 'Keep',
                                    custom_id: 'game:keepImmunity'
                                }, {
                                    type: ComponentType.Button,
                                    style: ButtonStyle.Secondary,
                                    label: 'Give',
                                    custom_id: 'game:giveImmunity'
                                }]
                            }]
                        }
                    ];
                }
            default:
                return [];
        }
    }

    getWeeklyDecisionDMs(): Record<string, string> {
        const result: Record<Snowflake, string> = {};
        for (const userId of this.getPlayers()) {
            const numVotes = this.getNumBaseVotes(userId);
            // Let players know if they have multiple votes at their disposal
            if (numVotes > 1) {
                result[userId] = `Due your relative performance against other _${this.isPlayerEliminated(userId) ? 'eliminated' : 'remaining'}_ players this week, you have **${numVotes}** votes at your disposal 🌞`
                    + (this.hasLastAssailants(userId) ? ` (plus even more if you vote for ${this.getJoinedNames(this.getLastAssailants(userId))})` : '');
            }
            // Else, still let them know if they have retaliation votes
            else if (!this.isPlayerEliminated(userId) && this.hasLastAssailants(userId)) {
                result[userId] = `${this.getJoinedNames(this.getLastAssailants(userId))} voted against you last week, so you have **2x** _retaliation_ votes against them this week`;
            }
        }
        return result;
    }

    override async addPlayerDecision(userId: string, text: string): Promise<MessengerPayload> {
        const targetName = text;
        if (targetName) {
            const targetId = this.getClosestUserByName(targetName);
            if (targetId) {
                const replyText = this.setUserTarget(userId, targetId);
                return replyText;
            } else {
                throw new Error('I have no idea who you\'re trying to peek at, could you please be more specific?');
            }

        } else {
            throw new Error('You are you trying to vote for? For example, \`Dezryth\`');
        }
    }

    private setUserTarget(userId: Snowflake, targetId: Snowflake): string {
        // Validate the target user
        if (userId === targetId) {
            throw new Error('Are you trying to vote for yourself? Get it together, man...');
        }
        if (this.isPlayerEliminated(targetId)) {
            throw new Error(`**${this.getName(targetId)}** has already been eliminated, choose someone else!`);
        }
        if (!this.hasPlayer(targetId)) {
            throw new Error('That user isn\'t even in the game this season, choose someone else!');
        }
        if (this.isPlayerImmune(targetId)) {
            throw new Error(`**${this.getName(targetId)}** has immunity this turn, choose someone else!`);
        }
        // If the user is locked, allow them to participate in the audience vote
        if (this.isPlayerLocked(userId)) {
            // Set the target in the locked votes map
            this.state.lockedVotes[userId] = targetId;
            return `Since you joined the game late, your vote against **${this.getName(targetId)}** will be used for the collective audience vote`;
        }
        // Validate that the player has votes
        const baseVotes = this.getNumBaseVotes(userId);
        if (baseVotes < 1) {
            throw new Error('You don\'t have any votes to use this week, dummy!');
        }
        // Set the target in the state
        this.state.decisions[userId] = [targetId];
        // Reply with an appropriate response
        // TODO: Include info about multipliers and such once implemented
        const actualVotes = this.getNumActualVotes(userId, targetId);
        let replyText = `Ok, you will use your **${actualVotes}** vote${actualVotes === 1 ? '' : 's'} to eliminate **${this.getName(targetId)}** this week...`;
        if (this.hasRetaliationVotesAgainst(userId, targetId)) {
            replyText += ' (**2x** _retaliation_ votes against this player)';
        } else if (this.hasRevengeVotesAgainst(userId, targetId)) {
            replyText += ' (**+1** _vote_ against this player)';
        }
        return replyText;
    }

    override async processPlayerDecisions(): Promise<DecisionProcessingResult> {
        let summary = '';

        // If all the regular decisions have been processed, process the collective audience vote
        if (isObjectEmpty(this.state.decisions) && !isObjectEmpty(this.state.lockedVotes)) {
            // Compute who the audience is voting for
            const pickers = Object.keys(this.state.lockedVotes);
            const numAudiencePicks = getObjectSize(this.state.lockedVotes);
            const pickQuantities: Record<Snowflake, number> = {};
            for (const userId of Object.values(this.state.lockedVotes)) {
                // Ensure this player can actually be voted for
                if (this.hasPlayer(userId) && !this.isPlayerEliminated(userId) && !this.isPlayerImmune(userId)) {
                    pickQuantities[userId] = (pickQuantities[userId] ?? 0) + 1;
                }
            }
            // Pick the highest, treat ties as whatever since no one knows how this works under the hood
            // TODO: Can we break ties by looking at the rank of the target players?
            const pickedUserId = getMaxKey(Object.keys(pickQuantities), id => pickQuantities[id] ?? 0);
            // Add incoming vote
            const pickedPlayer = this.state.players[pickedUserId];
            pickedPlayer.incomingVotes = (pickedPlayer.incomingVotes ?? 0) + 1;
            this.state.revealedAudiencePick = pickedUserId;
            // Clear the locked vote map
            this.state.lockedVotes = {};
            return {
                summary: {
                    content: `${this.getJoinedNames(pickers)} (from the audience realm) ${numAudiencePicks === 1 ? '' : 'collectively '}cast a vote for **${this.getName(pickedUserId)}**`,
                    files: [await this.renderStateAttachment()],
                    flags: MessageFlags.SuppressNotifications
                },
                continueProcessing: false
            };
        }

        // Pick a random player, process their decision
        const remainingDecisionPlayers = Object.keys(this.state.decisions);
        shuffle(remainingDecisionPlayers);
        const userId = randChoice(...remainingDecisionPlayers);

        // Count their votes
        const targetId = this.state.decisions[userId][0];
        const numVotes = this.getNumActualVotes(userId, targetId);
        delete this.state.decisions[userId];

        // Validate that the target is valid
        if (!this.hasPlayer(targetId)) {
            summary = `**${this.getName(userId)}** tried to vote for <@${targetId}>, who isn't in the game...`;
        } else if (this.isPlayerImmune(targetId)) {
            summary = `**${this.getName(userId)}** tried to vote for **${this.getName(targetId)}**, who's immune...`;
        } else if (this.isPlayerEliminated(targetId)) {
            summary = `**${this.getName(userId)}** tried to vote for **${this.getName(targetId)}**, who's already been eliminated...`;
        } else if (numVotes < 1) {
            summary = `**${this.getName(userId)}** tried to vote for **${this.getName(targetId)}** without any votes...`;
        } else {
            // Target is valid, so add incoming votes
            const targetPlayer = this.state.players[targetId];
            targetPlayer.incomingVotes = (targetPlayer.incomingVotes ?? 0) + numVotes;
            this.state.players[userId].revealedTarget = targetId;
            // Add user to the list of the target's assailants (this should never happen if eliminated, but check just in case...)
            if (!this.isPlayerEliminated(targetId)) {
                if (!targetPlayer.assailants) {
                    targetPlayer.assailants = [];
                }
                targetPlayer.assailants.push(userId);
            }
            summary = `**${this.getName(userId)}** cast **${numVotes}** vote${numVotes === 1 ? '' : 's'} for **${this.getName(targetId)}**`;
            // Add extra text if extra votes
            if (this.hasRetaliationVotesAgainst(userId, targetId)) {
                summary += ' (**x2** _retaliation_ votes)';
            } else if (this.hasRevengeVotesAgainst(userId, targetId)) {
                summary += ' (**+1** _revenge_ vote)';
            }
        }

        // End the turn if there are no decisions left
        const endTurn = isObjectEmpty(this.state.decisions) && isObjectEmpty(this.state.lockedVotes);

        return {
            summary: {
                content: summary,
                files: [await this.renderStateAttachment()],
                flags: MessageFlags.SuppressNotifications
            },
            continueProcessing: !endTurn
        }
    }

    override getDecisionActionRow(): ActionRowData<MessageActionRowComponentData>[] {
        return [{
            type: ComponentType.ActionRow,
            components: [{
                type: ComponentType.UserSelect,
                customId: 'game:selectTargetUser',
                placeholder: 'Click to vote someone off the island',
                minValues: 1,
                maxValues: 1
            }]
        }];
    }

    override async handleGameInteraction(interaction: Interaction): Promise<MessengerManifest | undefined> {
        const userId = interaction.user.id;
        if (interaction.isMessageComponent()) {
            // TODO: Temp logging to see how this works
            void logger.log(`<@${userId}> game interaction: \`${interaction.customId}\``);
            const customId = interaction.customId;
            switch (customId) {
                case 'game:selectTargetUser': {
                    if (!interaction.isUserSelectMenu()) {
                        throw new Error('This should be a user select menu (see admin)');
                    }
                    const targetUserId = interaction.values[0];
                    // Set the target and reply
                    const replyText = this.setUserTarget(userId, targetUserId);
                    await interaction.editReply(replyText);
                    break;
                }
                case 'game:keepImmunity': {
                    if (!this.mayPlayerGrantImmunity(userId)) {
                        throw new Error('You\'re not eligible to grant immunity right now');
                    }
                    // They're choosing to keep immunity, so do nothing (just delete buttons)
                    await interaction.deleteReply();
                    await interaction.message.edit({ content: 'You have chosen to keep your immunity this week', components: [] });
                    break;
                }
                case 'game:giveImmunity': {
                    if (!this.mayPlayerGrantImmunity(userId)) {
                        throw new Error('You\'re not eligible to grant immunity right now');
                    }
                    await interaction.editReply({
                        content: 'Who would you like to grant immunity to?',
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.UserSelect,
                                customId: 'game:selectImmunityUser',
                                placeholder: 'Click to grant immunity to someone',
                                minValues: 1,
                                maxValues: 1
                            }]
                        }]
                    })
                    break;
                }
                case 'game:selectImmunityUser': {
                    // Validate the target
                    if (!interaction.isUserSelectMenu()) {
                        throw new Error('This should be a user select menu (see admin)');
                    }
                    const targetUserId = interaction.values[0];
                    this.validateImmunityTarget(userId, targetUserId);
                    // Set the pending receiver value so it can be confirmed
                    this.pendingImmunityReceivers[userId] = targetUserId;
                    await interaction.editReply({
                        content: `You're granting immunity to <@${targetUserId}>, either confirm that choice to start over to choose someone else`,
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.Button,
                                style: ButtonStyle.Secondary,
                                customId: 'game:confirmImmunity',
                                label: 'Confirm'
                            }]
                        }]
                    });
                    break;
                }
                case 'game:confirmImmunity': {
                    // Validate the pending target
                    const pendingImmunityReceiver = this.pendingImmunityReceivers[userId];
                    if (!pendingImmunityReceiver) {
                        throw new Error('Before you can confirm, you need to select who you\'re granting immunity to');
                    }
                    this.validateImmunityTarget(userId, pendingImmunityReceiver);
                    // TODO: What if this user doesn't exist? Can this happen?
                    this.state.players[pendingImmunityReceiver].immunityGrantedBy = userId;
                    // Clear the pending granter data to prevent further action
                    delete this.state.players[userId].mayGrantImmunity;
                    delete this.pendingImmunityReceivers[userId];
                    interaction.editReply(`Confirmed! You've granted immunity to **${this.getName(pendingImmunityReceiver)}**`);
                    break;
                }
            }
        }
        return undefined;
    }

    private validateImmunityTarget(userId: Snowflake, targetId: Snowflake) {
        if (!this.mayPlayerGrantImmunity(userId)) {
            throw new Error('You\'re not eligible to grant immunity right now');
        }
        if (!this.hasPlayer(targetId)) {
            throw new Error(`<@${targetId}> isn\'t in the game, choose someone else!`);
        }
        if (this.isPlayerEliminated(targetId)) {
            throw new Error(`<@${targetId}> has already been eliminated, you can't grant immunity to them. Try someone else!`);
        }
        if (this.isPlayerImmune(targetId)) {
            throw new Error(`<@${targetId}> is already immune, what are the odds?`);
        }
    }


    private getClosestUserByName(input: string): Snowflake | undefined {
        const userIds: Snowflake[] = this.getPlayers();
        const sanitizedDisplayNames: string[] = userIds.map(userId => this.getName(userId).toLocaleLowerCase().trim());
        const result = getMostSimilarByNormalizedEditDistance(input.toLowerCase().trim(), sanitizedDisplayNames);
        if (result) {
            return userIds[result.index];
        }
    }

    override handleNonDecisionDM(userId: Snowflake, text: string): MessengerPayload[] {
        // TODO: Would we ever want to re-enable this? Can we refactor it in with the interaction logic?
        // If this user has the power to grant immunity...
        // if (this.mayPlayerGrantImmunity(userId)) {
        //     // If the user is trying to confirm...
        //     if (text.toLowerCase().trim() === 'confirm') {
        //         void logger.log(`<@${userId}> is trying to confirm immunity: \`${text}\``);
        //         // If there's someone to confirm then finalize the immunity granting
        //         const pendingImmunityReceiver = this.pendingImmunityReceivers[userId];
        //         if (pendingImmunityReceiver) {
        //             // TODO: What if this user doesn't exist? Can this happen?
        //             this.state.players[pendingImmunityReceiver].immunityGrantedBy = userId;
        //             // Clear the pending granter data to prevent further action
        //             delete this.state.players[userId].mayGrantImmunity;
        //             delete this.pendingImmunityReceivers[userId];
        //             return [`Confirmed! You've granted immunity to **${this.getName(pendingImmunityReceiver)}**`];
        //         }
        //         // Else, tell them to grant first
        //         return ['Before you can confirm, you must choose who to grant immunity to by saying `grant [name]`'];
        //     }
        //     // If the user is trying to confirm a grant...
        //     else if (text.toLowerCase().startsWith('grant')) {
        //         void logger.log(`<@${userId}> is trying to grant immunity: \`${text}\``);
        //         // Handle granting the immunity
        //         const sanitizedText = text.toLowerCase().replace('grant', '').trim();
        //         const targetId = this.getClosestUserByName(sanitizedText);
        //         if (!targetId) {
        //             return ['I\'m not sure who you\'re trying to grant immunity to. Could you please try again?'];
        //         } else if (this.isPlayerEliminated(targetId)) {
        //             return [`<@${targetId}> has already been eliminated, you can\'t grant immunity to them. Try someone else!`];
        //         } else  {
        //             // Set the pending receiver value so it can be confirmed
        //             this.pendingImmunityReceivers[userId] = targetId;
        //             return [`You're granting immunity to <@${targetId}>, say \`confirm\` to confirm this or say \`grant [name]\` to choose someone else`];
        //         }
        //     }
        // }
        return [];
    }

    override getSeasonEndResults(cumulativePoints?: Record<Snowflake, number>): SeasonEndResults {
        if (cumulativePoints) {
            // TODO: Use sort-by-key from common library
            const cumulativeOrderedUsers = Object.keys(cumulativePoints).sort((x, y) => (cumulativeOrderedUsers[y] ?? 0) - (cumulativeOrderedUsers[x] ?? 0))
                // Filter out users who are actually winners
                // TODO: Is there any guarantee that there are only 3?
                .filter(id => !this.hasWinner(id));
            const topEliminatedUser = cumulativeOrderedUsers[0];
            if (topEliminatedUser) {
                return {
                    winners: this.getWinners(),
                    specialWinners: [{
                        userId: topEliminatedUser,
                        terms: 0.5,
                        description: 'being the top eliminated player by sheer number of participation points'
                    }]
                };
            } else {
                // TODO: Temp logging to make sure this works
                void logger.log('ERROR: Cannot identify top eliminated user!');
            }
        } else {
            // TODO: Temp logging to make sure this works
            void logger.log('ERROR: Cannot get Island season end results, no cumulative points provided!');
        }

        return super.getSeasonEndResults();
    }
}
