import canvas from "canvas";
import { GuildMember, Snowflake } from "discord.js";
import { DecisionProcessingResult, GameState, PrizeType } from "../types";

export default abstract class AbstractGame<T extends GameState> {
    protected readonly state: T;

    constructor(state: T) {
        this.state = state;

        // TODO (2.0): Temp logic to ensure the list exists after being loaded (remove this)
        if (this.state.winners === undefined) {
            this.state.winners = [];
        }
    }

    /**
     * Text sent out to the channel before the very first game decision of the season.
     */
    abstract getIntroductionText(): string[]
    /**
     * Text sent out to the channel at the beginning of the weekly game decision.
     */
    abstract getInstructionsText(): string
    /**
     * Text sent directly to users who request help during the game decision phase.
     */
    abstract getHelpText(): string
    /**
     * Text describing the state of the game, possibly including decisions.
     */
    abstract getDebugText(): string
    /**
     * A string describing the overall game at the time of game creation.
     */
    abstract getDebugString(): string
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

    abstract renderState(options?: { showPlayerDecision?: Snowflake, admin?: boolean, season?: number }): Promise<Buffer>
    abstract beginTurn(): string[]
    
    /**
     * Triggers turn-end logic. This is run after the final round of decisions are processed.
     * @returns List of messages to send to the GM channel on turn-end
     */
    endTurn(): string[] {
        return [];
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
    abstract getWeeklyDecisionDMs(): Record<Snowflake, string>
    abstract addPlayerDecision(userId: Snowflake, text: string): string
    abstract processPlayerDecisions(): DecisionProcessingResult

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
