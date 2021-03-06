import { Snowflake } from "discord.js";
import ActivityTracker from "./activity-tracker.js";
import { Combo, DailyEvent, DailyEventType, DailyPlayerState, FullDate, PlayerState, RawGoodMorningState, Season } from "./types.js";
import { getTodayDateString, toFixed } from "./util.js";

export default class GoodMorningState {
    private data: RawGoodMorningState;

    constructor(rawState: RawGoodMorningState) {
        this.data = rawState;
    }

    isMorning(): boolean {
        return this.data.isMorning;
    }

    setMorning(morning: boolean): void {
        this.data.isMorning = morning;
    }

    isGracePeriod(): boolean {
        return this.data.isGracePeriod ?? false;
    }

    setGracePeriod(gracePeriod: boolean): void {
        if (gracePeriod) {
            this.data.isGracePeriod = true;
        } else {
            delete this.data.isGracePeriod;
        }
    }

    isHomeStretch(): boolean {
        return this.data.isHomeStretch ?? false;
    }

    setHomeStretch(homeStretch: boolean): void {
        if (homeStretch) {
            this.data.isHomeStretch = true;
        } else {
            delete this.data.isHomeStretch;
        }
    }

    getSeasonStartedOn(): FullDate {
        return this.data.startedOn;
    }

    setSeasonStartedOn(startedOn: FullDate): void {
        this.data.startedOn = startedOn;
    }

    /**
     * @returns Ordered list of player user IDs sorted by daily rank, then by daily points earned/lost.
     */
    getOrderedDailyPlayers(): Snowflake[] {
        return Object.keys(this.data.dailyStatus)
            .sort((x, y) => {
                // Sort by rank ascending (rankless last)
                return (this.getDailyRank(x) ?? Number.MAX_VALUE) - (this.getDailyRank(y) ?? Number.MAX_VALUE)
                    // Sort by points earned descending
                    || this.getPointsEarnedToday(y) - this.getPointsEarnedToday(x)
                    // Sort by points lost ascending
                    || this.getPointsLostToday(x) - this.getPointsLostToday(y);
            });
    }

    resetDailyState(): void {
        this.data.dailyStatus = {};
    }

    getPlayers(): Snowflake[] {
        return Object.keys(this.data.players);
    }

    /**
     * @returns List of user IDs of players with negative points.
     */
    getDelinquentPlayers(): Snowflake[] {
        return this.getPlayers().filter(userId => this.getPlayerPoints(userId) < 0);
    }

    getPlayerStates(): Record<Snowflake, PlayerState> {
        return this.data.players;
    }

    getNumPlayers(): number {
        return this.getPlayers().length;
    }

    getPlayer(userId: Snowflake): PlayerState | undefined {
        return this.data.players[userId];
    }

    getOrCreatePlayer(userId: Snowflake): PlayerState {
        // Ensures that this method NEVER returns undefined
        if (this.data.players[userId] === undefined) {
            this.data.players[userId] = {
                displayName: `User ${userId}`,
                points: 0
            }
        }

        return this.getPlayer(userId);
    }

    hasPlayer(userId: Snowflake): boolean {
        return this.getPlayer(userId) !== undefined;
    }

    getPlayerDisplayName(userId: Snowflake): string {
        return this.getPlayer(userId)?.displayName ?? 'Unknown';
    }

    getPlayerDisplayNameWithMultiplier(userId: Snowflake): string {
        if (this.getPlayerMultiplier(userId) === 1) {
            return this.getPlayerDisplayName(userId);
        } else {
            return this.getPlayerDisplayName(userId) + ` (${this.getPlayerMultiplier(userId)}x)`;
        }
    }

    setPlayerDisplayName(userId: Snowflake, displayName: string): void {
        this.getOrCreatePlayer(userId).displayName = displayName;
    }

    getPlayerPoints(userId: Snowflake): number {
        return this.getPlayer(userId)?.points ?? 0;
    }

    getPlayerActivity(userId: Snowflake): ActivityTracker {
        return new ActivityTracker(this.getPlayer(userId)?.activity);
    }

    addPlayerActivity(userId: Snowflake, active: boolean): void {
        const tracker: ActivityTracker = new ActivityTracker(this.getOrCreatePlayer(userId)?.activity);
        tracker.add(active);
        if (tracker.getActivityLevel() === 0) {
            delete this.getPlayer(userId).activity;
        } else {
            this.getPlayer(userId).activity = tracker.dump();
        }
    }

    incrementPlayerActivities(): void {
        this.getPlayers().forEach(userId => {
            this.addPlayerActivity(userId, this.getPointsEarnedToday(userId) > 0);
        });
    }

    getPlayerMultiplier(userId: Snowflake): number {
        return this.getPlayer(userId)?.multiplier ?? 1;
    }

    setPlayerMultiplier(userId: Snowflake, multiplier: number): void {
        this.getOrCreatePlayer(userId).multiplier = multiplier;
    }

    getPlayerDeductions(userId: Snowflake): number {
        return this.getPlayer(userId)?.deductions ?? 0;
    }

    /**
     * @param userId User ID of the player
     * @returns Days since player's last Good Morning
     */
    getPlayerDaysSinceLGM(userId: Snowflake): number {
        return this.getPlayer(userId)?.daysSinceLastGoodMorning ?? 0;
    }

    getPlayerCombosBroken(userId: Snowflake): number {
        return this.getPlayer(userId)?.combosBroken ?? 0;
    }

    incrementPlayerCombosBroken(userId: Snowflake): void {
        this.getOrCreatePlayer(userId).combosBroken = this.getPlayerCombosBroken(userId) + 1;
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
            // Deductions ascending
            || this.getPlayerDeductions(x) - this.getPlayerDeductions(y));
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
     * @returns List of user IDs for players who may serve as a potential reveiller
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
     * @returns List of user IDs for players who are suitable to receive the magic word hint
     */
    getPotentialMagicWordRecipients(): Snowflake[] {
        return this.queryOrderedPlayers({ skipPlayers: 3, maxDays: 2, maxRelativeCompletion: 0.8 });
    }

    /**
     * Query the ordered (by score) list of players, but with the following parameters:
     * - skipPlayers: omit the top N players (e.g. 2 means omit the first-place and second-place players)
     * - maxDays: only include players who've said GM in the last N days
     * - minDays: only include players who haven't said GM in the last N-1 days
     * - maxRelativeCompletion: only include players with at most this relative completion
     * - n: only return the first N players (after the previous filters have been applied)
     * @param options parameters map
     * @returns ordered and filtered list of user IDs
     */
    queryOrderedPlayers(options: { skipPlayers?: number, maxDays?: number, minDays?: number, maxRelativeCompletion?: number, n?: number }): Snowflake[] {
        let result: Snowflake[] = this.getOrderedPlayers();

        if (options.skipPlayers) {
            result = result.slice(options.skipPlayers);
        }

        if (options.maxDays) {
            result = result.filter((userId) => this.getPlayerDaysSinceLGM(userId) <= options.maxDays)
        }

        if (options.minDays) {
            result = result.filter((userId) => this.getPlayerDaysSinceLGM(userId) >= options.minDays)
        }

        if (options.maxRelativeCompletion) {
            result = result.filter((userId) => this.getPlayerRelativeCompletion(userId) <= options.maxRelativeCompletion);
        }

        if (options.n) {
            result = result.slice(0, options.n);
        }

        return result;
    }

    /**
     * @returns The max total point score of all players currently in play
     */
    getTopScore(): number {
        if (this.getNumPlayers() === 0) {
            return 0;
        }
        return Math.max(...Object.values(this.data.players).map(player => player.points));
    }

    getLowestScore(): number {
        if (this.getNumPlayers() === 0) {
            return 0;
        }
        return Math.min(...Object.values(this.data.players).map(player => player.points));
    }

    getSeasonGoal(): number {
        return this.data.goal;
    }

    isSeasonGoalReached(): boolean {
        return this.getTopScore() >= this.data.goal;
    }

    /**
     * @returns A number in the range [0, 1] representing the percentage completion of the current season (e.g. 0.5 means 50% complete)
     */
    getSeasonCompletion(): number {
        return this.getTopScore() / this.getSeasonGoal();
    }

    /**
     * @returns A number in the range [0, 1] representing the precentage completion of a particular player (e.g. 0.5 means 50% of the way to the goal)
     */
    getPlayerCompletion(userId: Snowflake): number {
        return Math.max(0, this.getPlayerPoints(userId)) / this.getSeasonGoal();
    }

    /**
     * Returns a number in the range [0, 1] representing the percentage completion of a particular player relative to
     * the player with the highest completion (e.g. 0.75 means 75% of the max player's score).
     * @returns The player's relative completion
     */
    getPlayerRelativeCompletion(userId: Snowflake): number {
        return this.getPlayerPoints(userId) / this.getTopScore();
    }

    /**
     * @returns The amount of points normalized to a season goal of 100
     */
    getNormalizedPoints(points: number): number {
        return 100 * points / this.getSeasonGoal();
    }

    getDailyStatus(userId: Snowflake): DailyPlayerState | undefined {
        return this.data.dailyStatus[userId];
    }

    getOrCreateDailyStatus(userId: Snowflake): DailyPlayerState {
        // Ensures that this method will NEVER return undefined
        if (this.data.dailyStatus[userId] === undefined) {
            this.data.dailyStatus[userId] = {
                pointsEarned: 0
            };
        }

        return this.getDailyStatus(userId);
    }

    /**
     * @returns Actual number of points awarded
     */
    awardPoints(userId: Snowflake, points: number): number {
        if (points < 0) {
            throw new Error('Can only award a non-negative number of points!');
        }
        const actualPoints: number = points * this.getPlayerMultiplier(userId);
        this.getOrCreateDailyStatus(userId).pointsEarned = toFixed(this.getPointsEarnedToday(userId) + actualPoints);
        this.getOrCreatePlayer(userId).points = toFixed(this.getPlayerPoints(userId) + actualPoints);
        return actualPoints;
    }

    deductPoints(userId: Snowflake, points: number): void {
        if (points < 0) {
            throw new Error('Can only deduct a non-negative number of points!');
        }
        // Update the daily "points lost" value
        this.getOrCreateDailyStatus(userId).pointsLost = toFixed(this.getPointsLostToday(userId) + points);
        // Deduct points from the player
        this.getOrCreatePlayer(userId).points = toFixed(this.getPlayerPoints(userId) - points);;
        // Update the season total deductions count
        this.getOrCreatePlayer(userId).deductions = toFixed(this.getPlayerDeductions(userId) + points);
    }

    getPointsEarnedToday(userId: Snowflake): number {
        return this.getDailyStatus(userId)?.pointsEarned ?? 0;
    }

    getPointsLostToday(userId: Snowflake): number {
        return this.getDailyStatus(userId)?.pointsLost ?? 0;
    }

    wasPlayerPenalizedToday(userId: Snowflake): boolean {
        return (this.getDailyStatus(userId)?.pointsLost ?? 0) > 0;
    }

    incrementAllLGMs(): void {
        Object.values(this.data.players).forEach((player) => {
            player.daysSinceLastGoodMorning = (player.daysSinceLastGoodMorning ?? 0) + 1;
        });
    }

    resetDaysSinceLGM(userId: Snowflake): void {
        delete this.getOrCreatePlayer(userId).daysSinceLastGoodMorning;
    }

    getNextDailyRank(): number {
        return Math.max(0, ...Object.values(this.data.dailyStatus).map(status => status.rank ?? 0)) + 1;
    }

    getDailyRank(userId: Snowflake): number | undefined {
        return this.getDailyStatus(userId)?.rank;
    }

    hasDailyRank(userId: Snowflake): boolean {
        return this.getDailyStatus(userId)?.rank !== undefined;
    }

    setDailyRank(userId: Snowflake, rank: number): void {
        this.getOrCreateDailyStatus(userId).rank = rank;
    }

    getNextDailyVideoRank(): number {
        return Math.max(0, ...Object.values(this.data.dailyStatus).map(status => status.videoRank ?? 0)) + 1;
    }

    hasDailyVideoRank(userId: Snowflake): boolean {
        return this.getDailyStatus(userId)?.videoRank !== undefined;
    }

    setDailyVideoRank(userId: Snowflake, videoRank: number): void {
        this.getOrCreateDailyStatus(userId).videoRank = videoRank;
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

    getMagicWord(): string {
        return this.data.magicWord;
    }

    hasMagicWord(): boolean {
        return this.data.magicWord !== undefined;
    }

    setMagicWord(word: string): void {
        this.data.magicWord = word;
    }

    clearMagicWord(): void {
        delete this.data.magicWord;
    }

    getNerfThreshold(): number {
        return this.data.nerfThreshold;
    }

    hasNerfThreshold(): boolean {
        return this.data.nerfThreshold !== undefined;
    }

    setNerfThreshold(nerfThreshold: number): void {
        this.data.nerfThreshold = nerfThreshold;
    }

    clearNerfThreshold(): void {
        delete this.data.nerfThreshold;
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

    getMaxCombo(): Combo {
        return this.data.maxCombo;
    }

    getMaxComboDays(): number {
        return this.data.maxCombo?.days ?? 0;
    }

    setMaxCombo(combo: Combo): void {
        this.data.maxCombo = combo;
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

    /**
     * Determine if today's event is "abnormal", meaning that it's not the typical "wait for GM then send message" type of event.
     * @returns True if today's event is "abnormal"
     */
    isEventAbnormal(): boolean {
        return this.getEventType() === DailyEventType.GuestReveille
            || this.getEventType() === DailyEventType.ReverseGoodMorning
            || this.getEventType() === DailyEventType.AnonymousSubmissions;
    }

    haveAllSubmittersVoted(): boolean {
        return this.getEventType() === DailyEventType.AnonymousSubmissions
            && this.getEvent().submissions !== undefined
            && this.getEvent().votes !== undefined
            && Object.keys(this.getEvent().submissions).every(userId => userId in this.getEvent().votes);
    }

    /**
     * TODO: Is this safe? Should we be checking for the right event?
     */
    getSubmissionNonVoters(): Snowflake[] {
        return Object.keys(this.getEvent().submissions).filter(userId => this.getEvent().votes[userId] === undefined);
    }

    toJson(): string {
        return JSON.stringify(this.data, null, 2);
    }
}