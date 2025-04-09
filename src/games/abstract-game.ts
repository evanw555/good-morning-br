import { ActionRowData, AttachmentBuilder, GuildMember, Interaction, MessageActionRowComponentData, Snowflake } from "discord.js";
import { DecisionProcessingResult, GamePlayerAddition, MessengerManifest, MessengerPayload, PrizeType } from "../types";
import { text } from "../util";
import { getJoinedMentions } from "evanw555.js";
import { GameState } from "./types";

export default abstract class AbstractGame<T extends GameState> {
    protected readonly state: T;
    private testing: boolean;

    constructor(state: T) {
        this.state = state;
        this.testing = false;
    }

    isTesting(): boolean {
        return this.testing;
    }

    setTesting(testing: boolean) {
        this.testing = testing;
    }

    /**
     * @returns The season number of this game
     */
    getSeasonNumber(): number {
        return this.state.season;
    }

    isAcceptingDecisions(): boolean {
        return this.state.acceptingDecisions ?? false;
    }

    setAcceptingDecisions(acceptingDecisions: boolean): void {
        if (acceptingDecisions) {
            this.state.acceptingDecisions = true;
        } else {
            delete this.state.acceptingDecisions;
        }
    }

    /**
     * Text sent out to the channel before the very first game decision of the season.
     * @deprecated Use {@link getIntroductionMessages}
     */
    protected getIntroductionText(): string[] {
        return ['Welcome to a new game!'];
    }
    /**
     * Generates messenger payloads sent out to the channel before the very first game decision of the season.
     * This should also include any introduction or state image attachments that might be necessary at this time.
     */
    async getIntroductionMessages(): Promise<MessengerPayload[]> {
        const attachment = new AttachmentBuilder(await this.renderState()).setName(`game-introduction.png`);
        const introTexts = this.getIntroductionText();
        return introTexts.map((text, i) => {
            // By default, the first message will have the state render attached
            if (i === 0) {
                return {
                    content: text,
                    files: [attachment],
                    components: this.getDecisionActionRow()
                };
            }
            return text;
        });
    }
    /**
     * Text sent out to the channel at the beginning of the weekly game decision.
     */
    getInstructionsText(): string {
        return 'DM me "help" for help!';
    }
    /**
     * Text sent out to the channel at Saturday around noon to remind players to make a decision.
     */
    getReminderText(): string {
        return 'Reminder! You have until tomorrow morning to pick an action for this week...';
    }
    /**
     * Text sent directly to users who request help during the game decision phase.
     */
    getHelpText(): string {
        return this.getInstructionsText();
    }
    /**
     * Text describing the state of the game, possibly including decisions.
     */
    getDebugText(): string {
        return 'Debug text';
    }
    /**
     * A string describing the overall game at the time of game creation.
     */
    getDebugString(): string {
        return 'Debug string';
    }
    /**
     * @returns A list of decision phase events and their corresponding delay (in millis) after the initial message is sent out.
     */
    getDecisionPhases(): { key: string, millis: number }[] {
        return [];
    }
    /**
     * Invokes a particular decision phase, which happens sometime after the initial game decision message.
     * May update the state, and may return a sequence of messenger payloads to send back to the channel.
     * @param key The decision phase identifier
     * @returns Messenger payload objects
     */
    async onDecisionPhase(key: string): Promise<MessengerPayload[]> {
        return [];
    }
    /**
     * This is invoked at the end of the game decision pre-noon timeout.
     * @returns Messages to be sent to the good morning channel
     */
    async onDecisionPreNoon(): Promise<MessengerPayload[]> {
        // By default, just sent a decision reminder message
        return [{
            content: this.getReminderText(),
            components: this.getDecisionActionRow()
        }];
    }
    /**
     * Returns a number in the range [0, 1] representing the approximate completion of this game.
     * If the season is complete, then the value should always be 1.
     */
    abstract getSeasonCompletion(): number

    getNumPlayers(): number {
        return this.getPlayers().length;
    }

    abstract getPlayers(): Snowflake[]
    abstract getOrderedPlayers(): Snowflake[]

    getPlayersBehindPlayer(userId: Snowflake): Snowflake[] {
        const orderedPlayers = this.getOrderedPlayers();
        const index = orderedPlayers.indexOf(userId);
        if (index === -1) {
            return [];
        } else {
            return orderedPlayers.slice(index + 1);
        }
    }

    getPlayersAheadOfPlayer(userId: Snowflake): Snowflake[] {
        const orderedPlayers = this.getOrderedPlayers();
        const index = orderedPlayers.indexOf(userId);
        if (index === -1) {
            return [];
        } else {
            return orderedPlayers.slice(0, index);
        }
    }

    abstract hasPlayer(userId: Snowflake): boolean

    /**
     * Hook for adding players after the game has already started.
     * Note that this is called weekly before the "begin turn" hook, so note that the turn counter will show the previous week's number.
     * @param players List of players to add, ordered by points descending
     */
    abstract addLatePlayers(players: GamePlayerAddition[]): MessengerPayload[]

    abstract updatePlayer(member: GuildMember): void
    abstract removePlayer(userId: Snowflake): void

    protected getStandardWelcomeMessages(userIds: Snowflake[]): MessengerPayload[] {
        if (userIds.length === 1) {
            return [`Let's all give a warm welcome to ${getJoinedMentions(userIds)}, for this puppy is joining the game this week!`];
        } else if (userIds.length > 1) {
            return [`Let's all give a warm welcome to ${getJoinedMentions(userIds)}, for they are joining the game this week!`];
        } else {
            return [];
        }
    }

    addNPCs() {
        
    }

    /**
     * @returns True if the player needs a handicap (e.g. buffed contest award) for core GMBR activities.
     */
    doesPlayerNeedHandicap(userId: Snowflake): boolean {
        return false;
    }
    /**
     * @returns True if the player needs a nerf (e.g. min vs max daily activity points) for core GMBR activities.
     */
    doesPlayerNeedNerf(userId: Snowflake): boolean {
        return false;
    }

    /**
     * Render an image representing the state of the game.
     * @param options.showPlayerDecision If true, show information in the render relevant to the user's chosen decision
     * @param options.seasonOver If true, render an image to be presented as the final image of the season
     * @param options.admin If true, show information in the render relevant for the admin
     */
    abstract renderState(options?: { showPlayerDecision?: Snowflake, seasonOver?: boolean, admin?: boolean }): Promise<Buffer>

    /**
     * Wrapper method for rendering the state into an image attachment.
     */
    async renderStateAttachment(): Promise<AttachmentBuilder> {
        return new AttachmentBuilder(await this.renderState()).setName(`game-week${this.getTurn()}.png`)
    }
    /**
     * Wrapper method for rendering the season end state into an image attachment.
     */
    async renderSeasonEndStateAttachment(): Promise<AttachmentBuilder> {
        return new AttachmentBuilder(await this.renderState({ seasonOver: true })).setName(`game-final.png`);
    }

    abstract beginTurn(): Promise<MessengerPayload[]>

    /**
     * @returns List of messages to send before any game decisions are processed
     */
    async getPreProcessingMessages(): Promise<MessengerPayload[]> {
        return [{
            content: 'Good morning everyone! Here\'s where we\'re all starting from. In just a few minutes, we\'ll be seeing the outcome of this week\'s turn...',
            files: [new AttachmentBuilder(await this.renderState()).setName(`game-turn${this.getTurn()}-preprocessing.png`)]
        }];
    }

    /**
     * Triggers turn-end logic. This is run after the final round of decisions are processed.
     * @returns List of messages to send to the GM channel on turn-end
     */
    async endTurn(): Promise<MessengerPayload[]> {
        // By default, send this universal message with a generic state render
        return [{
            content: text('{!Well|Alright,} that\'s {!all|it} for this {!week|turn}! Are you all {!proud of your actions|happy with the outcome|optimistic|feeling good}?'),
            files: [new AttachmentBuilder(await this.renderState()).setName(`game-week${this.getTurn()}-end.png`)]
        }];
    }

    /**
     * Endpoint that's called daily at noon before the season end condition is checked.
     * This is primarily used to end the season on a specific day (even if it's a day other than saturday).
     * Also used to send out daily reminder texts during critical phases of the game.
     */
    async endDay(): Promise<MessengerPayload[]> {
        return [];
    }

    abstract getPoints(userId: Snowflake): number
    abstract addPoints(userId: Snowflake, points: number): void
    abstract awardPrize(userId: Snowflake, type: PrizeType, intro: string): MessengerPayload[]

    getMaxPoints(): number {
        return Math.max(0, ...this.getPlayers().map(userId => this.getPoints(userId)));
    }

    /**
     * Returns a mapping from user ID to text string for DMs that should be send to players on the morning of game decisions.
     */
    getWeeklyDecisionDMs(): Record<Snowflake, string> {
        return {};
    }

    /**
     * Adds a player's text-based decision and returns the response payload.
     * @param userId User submitting the decision
     * @param text The decision text being submitted
     * @returns The response payload if the decision was valid or null if the user should be ignored
     * @throws Error if the decision was invalid and the user should be notified
     */
    async addPlayerDecision(userId: Snowflake, text: string): Promise<MessengerPayload | null> {
        throw new Error('This game doesn\'t accept text-based decisions. Use the buttons!');
    }

    abstract processPlayerDecisions(): Promise<DecisionProcessingResult>

    /**
     * @deprecated This should be phased out into using better endpoints for returning decision/reminder messages
     */
    getDecisionActionRow(): ActionRowData<MessageActionRowComponentData>[] {
        return [];
    }

    async handleGameInteraction(interaction: Interaction): Promise<MessengerManifest | undefined> {
        return undefined;
    };

    /**
     * Hook for handling DMs from players during the window of time when decisions are not being processed.
     *
     * @param userId Player who sent the DM
     * @param text Contents of the DM received
     * @returns Sequence of replies to use to reply to the DM (empty list means this DM was ignored)
     */
    handleNonDecisionDM(userId: Snowflake, text: string): MessengerPayload[] {
        return [];
    }

    getState(): T {
        return this.state;
    }

    getTurn(): number {
        return this.state.turn;
    }

    isSeasonComplete(): boolean {
        return this.getWinners().length === 3;
    }

    /**
     * @returns Message(s) to be sent once the game is over
     */
    async getSeasonEndMessages(): Promise<MessengerPayload[]> {
        return [
            'Thanks to all those who have participated. You have made these mornings bright and joyous for not just me, but for everyone here 🌞',
            {
                content: `Congrats to the winner of this season, <@${this.getWinners()[0]}>!`,
                files: [await this.renderSeasonEndStateAttachment()]
            }
        ];
    }

    getWinners(): Snowflake[] {
        return this.state.winners.slice(0, 3);
    }

    getNumWinners(): number {
        return this.getWinners().length;
    }

    getNumWinnersUncapped(): number {
        return this.state.winners.length;
    }

    protected addWinner(userId: Snowflake): boolean {
        if (!this.state.winners.includes(userId)) {
            this.state.winners.push(userId);
            return true;
        }
        return false;
    }

    protected hasWinner(userId: Snowflake): boolean {
        return this.state.winners.includes(userId);
    }
}
