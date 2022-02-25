import { Snowflake } from "discord.js";
import { Combo, DailyEvent, DailyEventType, DailyPlayerState, PlayerState, RawGoodMorningState, Season } from "./types.js";
import { getTodayDateString } from "./util.js";

export default class GoodMorningState {
    private data: RawGoodMorningState;
    private displayNameFetchFunction: (userId: Snowflake) => Promise<string>;

    constructor(rawState: RawGoodMorningState, displayNameFetchFunction: (userId: Snowflake) => Promise<string>) {
        this.data = rawState;
        this.displayNameFetchFunction = displayNameFetchFunction;
    }

    isMorning(): boolean {
        return this.data.isMorning;
    }

    setMorning(morning: boolean): void {
        this.data.isMorning = morning;
    }

    isGracePeriod(): boolean {
        return this.data.isGracePeriod;
    }

    setGracePeriod(gradePeriod: boolean): void {
        this.data.isGracePeriod = gradePeriod;
    }

    getSeasonStartedOn(): string {
        return this.data.startedOn;
    }

    resetDailyState(): void {
        this.data.dailyStatus = {};
    }

    getPlayers(): Snowflake[] {
        return Object.keys(this.data.players);
    }

    getNumPlayers(): number {
        return this.getPlayers().length;
    }

    getPlayer(userId: Snowflake): PlayerState {
        return this.data.players[userId];
    }

    hasPlayer(userId: Snowflake): boolean {
        return this.data.players[userId] !== undefined;
    }

    /**
     * Initialize the player state data for a given user, if it doesn't exist.
     */
    async initializePlayer(userId: Snowflake): Promise<PlayerState> {
        if (this.data.players[userId] === undefined) {
            this.data.players[userId] = {
                displayName: await this.displayNameFetchFunction(userId),
                points: 0
            }
        }
        return this.data.players[userId];
    };

    getPlayerDisplayName(userId: Snowflake): string {
        return this.getPlayer(userId)?.displayName ?? 'Unknown';
    }

    getPlayerPoints(userId: Snowflake): number {
        return this.getPlayer(userId)?.points ?? 0;
    }

    /**
     * @param userId User ID of the player
     * @returns Days since player's last Good Morning
     */
    getPlayerDaysSinceLGM(userId: Snowflake): number {
        return this.getPlayer(userId)?.daysSinceLastGoodMorning ?? 0;
    }

    getPlayerPenalties(userId: Snowflake): number {
        return this.getPlayer(userId)?.penalties ?? 0;
    }

    incrementPlayerPenalties(userId: Snowflake): void {
        this.getPlayer(userId).penalties = this.getPlayerPenalties(userId) + 1;
    }

    getPlayerCombosBroken(userId: Snowflake): number {
        return this.getPlayer(userId)?.combosBroken ?? 0;
    }

    incrementPlayerCombosBroken(userId: Snowflake): void {
        this.getPlayer(userId).combosBroken = this.getPlayerCombosBroken(userId) + 1;
    }

    /**
     * Returns an ordered list of user IDs sorted by points, then days since last good morning, then penalties.
     * @param players map of player state objects
     * @returns sorted list of user IDs
     */
    getOrderedPlayers(): Snowflake[] {
        return this.getPlayers().sort((x, y) =>
            // Points descending
            this.getPlayerPoints(y) - this.getPlayerPoints(x)
            // Days since last GM ascending
            || this.getPlayerDaysSinceLGM(x) - this.getPlayerDaysSinceLGM(y)
            // Penalties ascending
            || this.getPlayerPenalties(x) - this.getPlayerPenalties(y));
    }

    getTopPlayer(): Snowflake {
        return this.getOrderedPlayers()[0];
    }

    /**
     * TODO: Remove this eventually.
     * @deprecated THIS IS ONLY USED TO MAINTAIN COMPATIBILITY WITH SOME CODE
     * @returns Map from user ID to number of points
     */
    toPointsMap(): Record<Snowflake, number> {
        const result: Record<Snowflake, number> = {};
        this.getPlayers().forEach((userId) => {
            result[userId] = this.getPlayerPoints(userId);
        });
        return result;
    }

    /**
     * Returns a list of user IDs for all players who have said Good Morning in at most maxDays days (in ascending order).
     * @param minDays Minimum days-since-LGM threshold
     * @returns Ascending list of user IDs
     */
    getMostRecentPlayers(maxDays: number = 0): Snowflake[] {
        return this.getPlayers()
            .filter((userId) => this.getPlayerDaysSinceLGM(userId) <= maxDays)
            .sort((x, y) => this.getPlayerDaysSinceLGM(x) - this.getPlayerDaysSinceLGM(y));
    }

    /**
     * Returns a list of user IDs for all players who haven't said Good Morning in at least minDays days (in descending order).
     * @param minDays Minimum days-since-LGM threshold
     * @returns Descending list of user IDs
     */
    getLeastRecentPlayers(minDays: number = 0): Snowflake[] {
        return this.getPlayers()
            .filter((userId) => this.getPlayerDaysSinceLGM(userId) >= minDays)
            .sort((x, y) => this.getPlayerDaysSinceLGM(y) - this.getPlayerDaysSinceLGM(x));
    }

    /**
     * Returns an ordered list of player user IDs for high-middle ranked players who have said Good Morning recently.
     * @returns List of user IDs for players who may server as a potential reveiller
     */
    getPotentialReveillers(): Snowflake[] {
        const orderedPlayers: Snowflake[] = this.getOrderedPlayers();
        return orderedPlayers
            // The first-place player cannot be the guest reveiller (and neither can the bottom quarter of players)
            .slice(1, Math.floor(orderedPlayers.length * 0.75))
            // Only players who said good morning today can be reveillers
            .filter((userId) => this.getPlayerDaysSinceLGM(userId) === 0);
    }

    /**
     * @returns The max total point score of all players currently in play
     */
    getTopScore(): number {
        return Math.max(...Object.values(this.data.players).map(player => player.points));
    }

    getLowestScore(): number {
        return Math.min(...Object.values(this.data.players).map(player => player.points));
    }

    getSeasonGoal(): number {
        return this.data.goal;
    }

    isSeasonGoalReached(): boolean {
        return this.getTopScore() >= this.data.goal;
    }

    initializeDailyStatus(userId: Snowflake): DailyPlayerState {
        if (this.data.dailyStatus[userId] === undefined) {
            this.data.dailyStatus[userId] = {
                pointsEarned: 0
            };
        }
        return this.data.dailyStatus[userId];
    }

    awardPoints(userId: Snowflake, points: number): void {
        if (points < 0) {
            throw new Error('Can only award a non-negative number of points!');
        }
        this.initializeDailyStatus(userId);
        this.data.dailyStatus[userId].pointsEarned += points;
        this.initializePlayer(userId);
        this.getPlayer(userId).points += points;
    }

    deductPoints(userId: Snowflake, points: number): void {
        if (points < 0) {
            throw new Error('Can only deduct a non-negative number of points!');
        }
        this.initializeDailyStatus(userId);
        this.data.dailyStatus[userId].pointsLost = (this.data.dailyStatus[userId].pointsLost ?? 0) + points;
        this.initializePlayer(userId);
        this.getPlayer(userId).points -= points;
    }

    wasPlayerPenalizedToday(userId: Snowflake): boolean {
        return (this.data.dailyStatus[userId]?.pointsLost ?? 0) > 0;
    }

    incrementAllLGMs(): void {
        Object.values(this.data.players).forEach((player) => {
            player.daysSinceLastGoodMorning = (player.daysSinceLastGoodMorning ?? 0) + 1;
        });
    }

    resetDaysSinceLGM(userId: Snowflake): void {
        this.initializePlayer(userId);
        delete this.getPlayer(userId).daysSinceLastGoodMorning;
    }

    getNextDailyRank(): number {
        return Math.max(...Object.values(this.data.dailyStatus).map(status => status.rank ?? 0)) + 1;
    }

    hasDailyRank(userId: Snowflake): boolean {
        return this.data.dailyStatus[userId]?.rank !== undefined;
    }

    setDailyRank(userId: Snowflake, rank: number): void {
        this.initializeDailyStatus(userId);
        this.data.dailyStatus[userId].rank = rank;
    }

    getNextDailyVideoRank(): number {
        return Math.max(...Object.values(this.data.dailyStatus).map(status => status.videoRank ?? 0)) + 1;
    }

    hasDailyVideoRank(userId: Snowflake): boolean {
        return this.data.dailyStatus[userId]?.videoRank !== undefined;
    }

    setDailyVideoRank(userId: Snowflake, videoRank: number): void {
        this.initializeDailyStatus(userId);
        this.data.dailyStatus[userId].videoRank = videoRank;
    }

    getCurrentLeader(): Snowflake {
        return this.data.currentLeader;
    }

    /**
     * Update the "current leader" and return true if a change was made.
     * @returns true if the new leader is different from the previous leader
     */
    updateCurrentLeader(): boolean {
        const newLeader: Snowflake = this.getTopPlayer();
        // If there's no existing current leader, set it
        this.data.currentLeader = this.data.currentLeader ?? newLeader;
        // Update the current leader and return true if a change was made
        if (newLeader !== this.data.currentLeader) {
            this.data.currentLeader = newLeader;
            return true;
        }
        return false;
    }

    getSeasonNumber(): number {
        return this.data.season;
    }

    getGoodMorningEmoji(): string | string[] {
        return this.data.goodMorningEmoji;
    }

    setGoodMorningEmoji(emoji: string | string[]): void {
        this.data.goodMorningEmoji = emoji;
    }

    getCombo(): Combo {
        return this.data.combo;
    }

    hasCombo(): boolean {
        return this.data.combo !== undefined;
    }

    setCombo(combo: Combo): void {
        this.data.combo = combo;
    }

    toHistorySeasonEntry(): Season {
        return {
            season: this.data.season,
            startedOn: this.data.startedOn,
            finishedOn: getTodayDateString(),
            points: this.toPointsMap(),
            goal: this.data.goal
        };
    }

    getEventType(): DailyEventType {
        return this.data.event?.type;
    }

    getEvent(): DailyEvent {
        return this.data.event;
    }

    setNextEvent(nextEvent: DailyEvent): void {
        this.data.nextEvent = nextEvent;
    }

    dequeueNextEvent(): void {
        this.data.event = this.data.nextEvent;
        delete this.data.nextEvent;
    }

    toJson(): string {
        return JSON.stringify(this.data, null, 2);
    }
}