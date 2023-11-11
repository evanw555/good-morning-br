import { AttachmentBuilder, GuildMember, MessageFlags, Snowflake } from "discord.js";
import canvas from 'canvas';
import { DecisionProcessingResult, IslandGameState, IslandPlayerState, MessengerPayload, PrizeType } from "../types";
import AbstractGame from "./abstract-game";
import { getMostSimilarByNormalizedEditDistance, naturalJoin, randChoice, shuffle, toFixed } from "evanw555.js";
import imageLoader from "../image-loader";

import logger from "../logger";

export default class IslandGame extends AbstractGame<IslandGameState> {
    private pendingImmunityReceiver?: Snowflake;

    constructor(state: IslandGameState) {
        super(state);
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
            type: 'ISLAND_GAME_STATE',
            season,
            winners: [],
            decisions: {},
            turn: 0,
            players,
            numToBeEliminated: 1
        });
    }

    getIntroductionText(): string[] {
        return [
            'My dear dogs... welcome to the Island of Mournful Mornings! This season, you are all castaways on my island 😼',
            'This game will be a true Battle Royale, and only those of you who have participated in the last week are eligible to win 🌞',
            'However, don\'t get too comfortable! Each week, some dogs will be voted off the island, killing their dreams of a sungazing victory ☠️',
            'Unlike other seasons, the points you earn each day are reset at the end of the week. Points are only used to determine how many votes you get, and to break ties in the weekly vote',
            'By default, you get _one_ vote each week, but top point earners will be told via DM that they have more votes'
        ];
    }

    getInstructionsText(): string {
        return 'Send me a DM letting me know who should be voted off the island this week!';
    }

    override getReminderText(): string {
        return 'Reminder! You have until tomorrow morning to vote someone off the island. Send me a DM with the name of who should be voted off...';
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

    hasPlayer(userId: string): boolean {
        return userId in this.state.players;
    }

    addPlayer(member: GuildMember): string {
        if (member.id in this.state.players) {
            void logger.log(`Refusing to add **${member.displayName}** to the island, as they're already in it!`);
            return `Cannot add **${member.displayName}** (already in-game)`;
        }
        this.state.players[member.id] = {
            displayName: member.displayName,
            points: 0,
            eliminated: true,
            // This player is joining late, so lock them (don't let them vote)
            locked: true,
            // Give them a terrible dummy rank that's necessarily larger than all other ranks
            finalRank: this.getNumPlayers() + 1
        };
        return `Added **${member.displayName}** at final rank **${this.getFinalRank(member.id)}**`;
    }

    updatePlayer(member: GuildMember): void {
        if (this.hasPlayer(member.id)) {
            this.state.players[member.id].displayName = member.displayName;
        }
    }

    removePlayer(userId: string): void {
        delete this.state.decisions[userId];
        delete this.state.players[userId];
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
        return this.state.immunityReceiver !== undefined && this.state.immunityReceiver === userId;
    }

    private getNumVotes(userId: Snowflake): number {
        return this.state.players[userId]?.votes ?? 0;
    }

    private getNumIncomingVotes(userId: Snowflake): number {
        return this.state.players[userId]?.incomingVotes ?? 0;
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

        const ROSTER_Y = 2 * MARGIN + HEADER_HEIGHT;
        const HORIZON_Y = ROSTER_Y + this.getNumRemainingPlayers() * (AVATAR_HEIGHT + AVATAR_MARGIN) - 0.5 * AVATAR_MARGIN;
        const ISLAND_Y = HORIZON_Y - islandImage.height * 0.6;
        // The total canvas height is the greater of...
        const HEIGHT = Math.max(
            // The bottom of the roster
            ROSTER_Y + this.getNumPlayers() * (AVATAR_HEIGHT + AVATAR_MARGIN),
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

        // Draw all players
        let playerY = ROSTER_Y;
        for (const userId of this.getRenderOrderedPlayers()) {
            const player = this.state.players[userId];
            let playerX = islandImage.width + AVATAR_HEIGHT + MARGIN * 2;
            // Draw avatar
            const avatar = await imageLoader.loadAvatar(userId, 32);
            context.drawImage(avatar, playerX, playerY, AVATAR_HEIGHT, AVATAR_HEIGHT);
            // If the player has incoming votes, draw the black background for the voter avatars
            const numIncomingVotes = Math.round(this.getNumIncomingVotes(userId));
            if (numIncomingVotes > 0) {
                context.fillStyle = 'black';
                const boxWidth = numIncomingVotes * (AVATAR_HEIGHT + AVATAR_MARGIN) + AVATAR_MARGIN;
                context.fillRect(playerX - boxWidth - (AVATAR_HEIGHT + AVATAR_MARGIN), playerY - AVATAR_MARGIN, boxWidth, AVATAR_HEIGHT + 2 * AVATAR_MARGIN);
            }
            // Draw who's voted for this player so far
            const voters = this.getPlayers().filter(id => this.state.players[id]?.revealedTarget === userId);
            let voterOffsetX = AVATAR_HEIGHT + AVATAR_MARGIN;
            for (const voterId of voters) {
                const voterAvatar = await imageLoader.loadAvatar(voterId, 32);
                // Draw one avatar for each vote
                for (let i = 0; i < this.getNumVotes(voterId); i++) {
                    voterOffsetX += AVATAR_HEIGHT + AVATAR_MARGIN;
                    context.drawImage(voterAvatar, playerX - voterOffsetX, playerY, AVATAR_HEIGHT, AVATAR_HEIGHT);
                }
            }
            // If anyone's voted for this player, draw the arrow
            if (voters.length > 0) {
                context.drawImage(rightArrowImage, playerX - (AVATAR_HEIGHT + AVATAR_MARGIN), playerY, AVATAR_HEIGHT, AVATAR_HEIGHT);
            }
            // Draw modifier images after the avatar...
            if (this.isPlayerLocked(userId)) {
                playerX += AVATAR_HEIGHT + AVATAR_MARGIN;
                context.drawImage(slashIconImage, playerX, playerY, AVATAR_HEIGHT, AVATAR_HEIGHT);
            } else {
                // The following should only be drawn if the player is NOT locked (since it's redundant)
                if (this.isPlayerEliminated(userId)) {
                    playerX += AVATAR_HEIGHT + AVATAR_MARGIN;
                    context.drawImage(skullImage, playerX, playerY, AVATAR_HEIGHT, AVATAR_HEIGHT);
                }
                if (this.getNumVotes(userId) === 0) {
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
            context.fillStyle = this.isPlayerEliminated(userId) ? 'red' : 'white';
            let nameText = this.getName(userId);
            // If viewing via the admin console, show more info
            if (options?.admin) {
                nameText += ` (${this.getNumVotes(userId)}v, ${this.getNumIncomingVotes(userId)}iv)`;
            }
            drawTextWithShadow(nameText, playerX, playerY + AVATAR_HEIGHT * 0.75, widthLimit);
            // context.strokeText(`${player.pointSnapshot}pts ${this.getNumVotes(userId)} votes, ${this.getNumIncomingVotes(userId)} incoming, ${this.isPlayerEliminated(userId) ? '☠️' : ''}`,
            //     playerX + AVATAR_HEIGHT * 2 + MARGIN * 3,
            //     playerY + AVATAR_HEIGHT);
            playerY += AVATAR_MARGIN + AVATAR_HEIGHT;
        }

        // Write some admin properties
        if (options?.admin) {
            context.fillStyle = 'white';
            drawTextWithShadow(`immunityGranter: ${this.getName(this.state.immunityGranter ?? 'N/A')}`, MARGIN, HORIZON_Y + AVATAR_HEIGHT);
            drawTextWithShadow(`immunityReceiver: ${this.getName(this.state.immunityReceiver ?? 'N/A')}`, MARGIN, HORIZON_Y + 2 * AVATAR_HEIGHT);
        }

        return c.toBuffer();
    }

    override beginTurn(): string[] {
        const text: string[] = [];

        // Increment the turn counter
        this.state.turn++;

        // If the immunity granter never chose anyone...
        if (this.state.immunityGranter && !this.state.immunityReceiver) {
            if (this.isPlayerEliminated(this.state.immunityGranter)) {
                // If they're eliminated, grant immunity to no one
                delete this.state.immunityGranter;
                delete this.state.immunityReceiver;
            } else {
                // If they're remaining, grant them immunity
                this.state.immunityReceiver = this.state.immunityGranter;
            }
        }

        // Determine how many will be eliminated this turn
        const numRemaining = this.getNumRemainingPlayers();
        const numToBeEliminated = numRemaining > 10 ? 3 : (numRemaining > 4 ? 2 : 1);
        this.state.numToBeEliminated = numToBeEliminated;
        text.push(`This week, **${numToBeEliminated}** player${numToBeEliminated === 1 ? '' : 's'} will be voted off the island`);

        let aliveVotes = 3;
        let deadVotes = 3;
        let i = 0;
        const votelessPlayers: Snowflake[] = [];
        for (const userId of this.getOrderedPlayers()) {
            const player = this.state.players[userId];
            // Add fractional votes based on points to handle ties
            player.incomingVotes = i++ * 0.01;
            // If this player is locked, skip them
            if (this.isPlayerLocked(userId)) {
                continue;
            }
            // Dole out votes to each player
            if (this.getPoints(userId) > 0) {
                if (this.isPlayerEliminated(userId)) {
                    player.votes = Math.max(deadVotes--, 1);
                } else {
                    player.votes = Math.max(aliveVotes--, 1);
                }
                // TODO: Temp logic for testing
                // this.state.decisions[userId] = [randChoice(...this.getRemainingPlayers())];
            } else {
                // Points are not net-positive, so this player can't vote
                player.votes = 0;
                votelessPlayers.push(userId);
            }
        }

        // Add a log statement about immunity
        if (this.state.immunityGranter && this.state.immunityReceiver) {
            if (this.state.immunityReceiver === this.state.immunityGranter) {
                text.push(`This week's contest winner, **${this.getName(this.state.immunityReceiver)}**, has been granted immunity`);
            } else {
                text.push(`This week's contest winner, **${this.getName(this.state.immunityGranter)}**, has granted immunity to **${this.getName(this.state.immunityReceiver)}**`);
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
        text.push(`${this.getJoinedNames(votedOff)} ${this.state.numToBeEliminated === 1 ? 'has' : 'have'} been voted off the island`);
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
            delete this.pendingImmunityReceiver;
            delete this.state.immunityGranter;
            delete this.state.immunityReceiver;
            // Clear num votes for all players
            delete player.votes;
            delete player.incomingVotes;
            // Clear other metadata
            delete player.revealedTarget;
        }

        // Add the universal turn-end message and state render
        text.push(...await super.endTurn());

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

    awardPrize(userId: string, type: PrizeType, intro: string): string[] {
        // If player isn't in the game yet, do nothing
        if (!this.hasPlayer(userId)) {
            return [];
        }
        switch (type) {
            case 'submissions1':
                // If the player is locked (joined late), do nothing
                if (this.isPlayerLocked(userId)) {
                    return [];
                }
                // If we're in the final week, don't award anything but still notify them
                if (this.getNumRemainingPlayers() === 2) {
                    return [`${intro}, but it's the final week so I can't grant anyone immunity. Sorry bud!`];
                }
                // Else, award immunity and notify
                this.state.immunityGranter = userId;
                // Return reply text catered to their elimination status
                if (this.isPlayerEliminated(userId)) {
                    return [`${intro}! If you so desire, you may choose one remaining player to grant immunity to (e.g. \`grant Robert\`)`];
                } else {
                    return [
                        `${intro}, you've been granted immunity this week! No one will be able to vote to eliminate you until next week`,
                        'Alternatively, you can choose to grant someone else immunity by sending me a DM (e.g. `grant Robert`), but doing so is irreversible'
                    ];
                }
            default:
                return [];
        }
    }

    getWeeklyDecisionDMs(): Record<string, string> {
        const result: Record<Snowflake, string> = {};
        for (const userId of this.getPlayers()) {
            const numVotes = this.getNumVotes(userId);
            if (numVotes > 1) {
                result[userId] = `Due your relative performance against other _${this.isPlayerEliminated(userId) ? 'eliminated' : 'remaining'}_ players this week, you have **${numVotes}** votes at your disposal 🌞`;
            }
        }
        return result;
    }

    override async addPlayerDecision(userId: string, text: string): Promise<MessengerPayload> {
        // Validate that they're not locked
        if (this.isPlayerLocked(userId)) {
            throw new Error('You joined the game too late to participate, sorry bud!');
        }
        // Validate that the player has votes
        const votes = this.getNumVotes(userId);
        if (votes < 1) {
            throw new Error('You don\'t have any votes to use this week, dummy!');
        }
        const targetName  = text;
        if (targetName) {
            const targetId = this.getClosestUserByName(targetName);
            if (targetId) {
                // Validate the target user
                if (userId === targetId) {
                    throw new Error('Are you trying to vote for yourself? Get it together, man...');
                }
                if (this.isPlayerEliminated(targetId)) {
                    throw new Error(`**${this.getName(targetId)}** has already been eliminated, choose someone else!`);
                }
                if (this.isPlayerImmune(targetId)) {
                    throw new Error(`**${this.getName(targetId)}** has immunity this turn, choose someone else!`);
                }
                this.state.decisions[userId] = [targetId];
                return `Ok, you will use your **${votes}** vote${votes === 1 ? '' : 's'} to eliminate **${this.getName(targetId)}** this week...`;
            } else {
                throw new Error('I have no idea who you\'re trying to peek at, could you please be more specific?');
            }
        } else {
            throw new Error('You are you trying to vote for? For example, \`Robert\`');
        }
    }

    override async processPlayerDecisions(): Promise<DecisionProcessingResult> {
        let summary = '';

        // Pick a random player, process their decision
        const remainingDecisionPlayers = Object.keys(this.state.decisions);
        shuffle(remainingDecisionPlayers);
        const userId = randChoice(...remainingDecisionPlayers);

        // Count their votes
        const numVotes = this.getNumVotes(userId);
        const targetId = this.state.decisions[userId][0];
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
            this.state.players[targetId].incomingVotes = (this.state.players[targetId].incomingVotes ?? 0) + numVotes;
            this.state.players[userId].revealedTarget = targetId;
            summary = `**${this.getName(userId)}** cast **${numVotes}** vote${numVotes === 1 ? '' : 's'} for **${this.getName(targetId)}**`;
        }

        // End the turn if there are no decisions left
        const endTurn = Object.keys(this.state.decisions).length === 0;

        return {
            summary: {
                content: summary,
                files: [await this.renderStateAttachment()],
                flags: MessageFlags.SuppressNotifications
            },
            continueProcessing: !endTurn
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

    override handleNonDecisionDM(userId: Snowflake, text: string): string[] {
        // If this user has the power to grant immunity...
        if (this.state.immunityGranter !== undefined && this.state.immunityGranter === userId) {
            // If the user is trying to confirm...
            if (text.toLowerCase().trim() === 'confirm') {
                void logger.log(`<@${userId}> is trying to confirm immunity: \`${text}\``);
                // If the immunity has already been granted, abort
                if (this.state.immunityReceiver) {
                    return [`It's too late to do that, immunity has already been granted to **${this.getName(this.state.immunityReceiver)}**`];
                }
                // Else, if there's someone to confirm then finalize the immunity granting
                if (this.pendingImmunityReceiver) {
                    this.state.immunityReceiver = this.pendingImmunityReceiver;
                    delete this.pendingImmunityReceiver;
                    return [`Confirmed! You've granted immunity to **${this.getName(userId)}**`];
                }
                // Else, tell them to grant first
                return ['Before you can confirm, you must choose who to grant immunity to by saying `grant [name]`'];
            }
            // If the user is trying to confirm a grant...
            else if (text.toLowerCase().startsWith('grant')) {
                void logger.log(`<@${userId}> is trying to grant immunity: \`${text}\``);
                // If the immunity has already been granted, abort
                if (this.state.immunityReceiver) {
                    return [`Sorry, you've already granted immunity to **${this.getName(this.state.immunityReceiver)}**!`];
                }
                // Else, handle granting the immunity
                const sanitizedText = text.toLowerCase().replace('grant', '').trim();
                const targetId = this.getClosestUserByName(sanitizedText);
                if (!targetId) {
                    return ['I\'m not sure who you\'re trying to grant immunity to. Could you please try again?'];
                } else if (this.isPlayerEliminated(targetId)) {
                    return [`<@${targetId}> has already been eliminated, you can\'t grant immunity to them. Try someone else!`];
                } else  {
                    // Set the pending receiver value so it can be confirmed
                    this.pendingImmunityReceiver = targetId;
                    return [`You're granting immunity to <@${targetId}>, say \`confirm\` to confirm this or say \`grant [name]\` to choose someone else`];
                }
            }
        }
        return [];
    }
}