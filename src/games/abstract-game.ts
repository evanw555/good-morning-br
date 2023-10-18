import canvas from "canvas";
import { ActionRowData, GuildMember, Interaction, MessageActionRowComponentData, Snowflake } from "discord.js";
import { DecisionProcessingResult, GameState, PrizeType } from "../types";

export default abstract class AbstractGame<T extends GameState> {
    protected readonly state: T;
    private testing: boolean;

    constructor(state: T) {
        this.state = state;
        this.testing = false;

        // TODO (2.0): Temp logic to ensure the list exists after being loaded (remove this)
        if (this.state.winners === undefined) {
            this.state.winners = [];
        }
    }

    isTesting(): boolean {
        return this.testing;
    }

    setTesting(testing: boolean) {
        this.testing = testing;
    }

    /**
     * Text sent out to the channel before the very first game decision of the season.
     */
    getIntroductionText(): string[] {
        return ['Welcome to a new game!'];
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
    abstract addPlayer(member: GuildMember): string
    abstract updatePlayer(member: GuildMember): void
    abstract removePlayer(userId: Snowflake): void

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
     * @param options.season The number of the current season
     */
    abstract renderState(options?: { showPlayerDecision?: Snowflake, seasonOver?: boolean, admin?: boolean, season?: number }): Promise<Buffer>
    abstract beginTurn(): string[]

    /**
     * Triggers turn-end logic. This is run after the final round of decisions are processed.
     * @returns List of messages to send to the GM channel on turn-end
     */
    endTurn(): string[] {
        return [];
    }

    /**
     * Endpoint that's called daily at noon before the season end condition is checked.
     * This is primarily used to end the season on a specific day (even if it's a day other than saturday).
     */
    endDay() {

    }

    abstract getPoints(userId: Snowflake): number
    abstract addPoints(userId: Snowflake, points: number): void
    abstract awardPrize(userId: Snowflake, type: PrizeType, intro: string): string[]

    getMaxPoints(): number {
        return Math.max(0, ...this.getPlayers().map(userId => this.getPoints(userId)));
    }

    /**
     * Returns a mapping from user ID to text string for DMs that should be send to players on the morning of game decisions.
     */
    getWeeklyDecisionDMs(): Record<Snowflake, string> {
        return {};
    }

    abstract addPlayerDecision(userId: Snowflake, text: string): string
    abstract processPlayerDecisions(): DecisionProcessingResult

    getDecisionActionRow(): ActionRowData<MessageActionRowComponentData>[] {
        return [];
    }

    async handleGameInteraction(interaction: Interaction): Promise<void> {

    };

    /**
     * Hook for handling DMs from players during the window of time when decisions are not being processed.
     *
     * @param userId Player who sent the DM
     * @param text Contents of the DM received
     * @returns Sequence of replies to use to reply to the DM (empty list means this DM was ignored)
     */
    handleNonDecisionDM(userId: Snowflake, text: string): string[] {
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
    getSeasonEndText(): string[] {
        return [
            'Thanks to all those who have participated. You have made these mornings bright and joyous for not just me, but for everyone here 🌞',
            `Congrats to the winner of this season, <@${this.getWinners()[0]}>!`
        ];
    }

    getWinners(): Snowflake[] {
        return this.state.winners.slice(0, 3);
    }

    getNumWinners(): number {
        return this.getWinners().length;
    }

    protected addWinner(userId: Snowflake): boolean {
        if (!this.state.winners.includes(userId)) {
            this.state.winners.push(userId);
            return true;
        }
        return false;
    }
}
