import { Snowflake } from "discord.js";
import { getTodayDateString, prettyPrint, toFixed } from "evanw555.js";
import ActivityTracker from "./activity-tracker";
import AbstractGame from "./games/abstract-game";
import DungeonCrawler from "./games/dungeon";
import { Combo, DailyEvent, DailyEventType, DailyPlayerState, FullDate, GameState, PlayerState, RawGoodMorningState, Season } from "./types";

export default class GoodMorningState {
    private data: RawGoodMorningState;
    private game?: AbstractGame<GameState>;

    constructor(rawState: RawGoodMorningState) {
        this.data = rawState;
        // TODO: Is there a better way to construct the game instance?
        if (rawState.game) {
            switch(rawState.game.type) {
                case 'DUMMY_GAME_STATE':
                    // TODO: Handle this
                    break;
                case 'DUNGEON_GAME_STATE':
                    this.game = new DungeonCrawler(rawState.game);
                    break;
            }
        }
        // Temp logic to add/remove certain properties
        // ...
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
     * Returns an ordered list of user IDs sorted by their rank in the game.
     * For every player NOT in game, add them at the end ordered by points, then days since last good morning, then penalties.
     * @returns sorted list of user IDs
     */
    getOrderedPlayers(): Snowflake[] {
        const gameOrderedPlayers: Snowflake[] = this.getGame()?.getOrderedPlayers() ?? [];

        // The base ordering is purely based on points and participation (doesn't take the game into account)
        const baseOrderedPlayers: Snowflake[] = this.getPlayers().sort((x, y) =>
            // Points descending
            this.getPlayerPoints(y) - this.getPlayerPoints(x)
            // Days since last GM ascending
            || this.getPlayerDaysSinceLGM(x) - this.getPlayerDaysSinceLGM(y)
            // Deductions ascending
            || this.getPlayerDeductions(x) - this.getPlayerDeductions(y));

        // Else, use the game ordering and concat all players NOT in game at the end using the base ordering
        return gameOrderedPlayers.concat(baseOrderedPlayers.filter(userId => !gameOrderedPlayers.includes(userId)));
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

    /**
     * Add a daily activity value for some user.
     * @param userId user ID for whom to add an activity value
     * @param active the activity value
     * @returns true if the user just achieved a full streak with this operation
     */
    addPlayerActivity(userId: Snowflake, active: boolean): boolean {
        const tracker: ActivityTracker = new ActivityTracker(this.getOrCreatePlayer(userId)?.activity);
        const result: boolean = tracker.add(active);
        if (tracker.getActivityLevel() === 0) {
            delete this.getPlayer(userId).activity;
        } else {
            this.getPlayer(userId).activity = tracker.dump();
        }
        return result;
    }

    /**
     * Update all player activity trackers based on today's activity.
     * @returns list of all players who just achieved a full streak with this update
     */
    incrementPlayerActivities(): Snowflake[] {
        const newStreakUsers: Snowflake[] = [];
        this.getPlayers().forEach(userId => {
            const newStreak: boolean = this.addPlayerActivity(userId, this.getPointsEarnedToday(userId) > 0);
            if (newStreak) {
                newStreakUsers.push(userId);
            }
        });
        return newStreakUsers;
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
        // Only players who aren't the leader, yet are in the top 50%, and have said GM today
        return this.queryOrderedPlayers({ skipPlayers: 1, abovePercentile: 0.5, maxDays: 0 });
    }
    /**
     * @returns List of user IDs for players who are suitable to receive the magic word hint
     */
    getPotentialMagicWordRecipients(): Snowflake[] {
        return this.queryOrderedPlayers({ belowPercentile: 0.5, maxRelativePoints: 0.5, maxDays: 2 });
    }

    /**
     * Query the ordered (by score) list of players, but with the following parameters...
     * @param options parameters map
     * @param options.skipPlayers omit the top N players (e.g. 2 means omit the first-place and second-place players)
     * @param options.abovePercentile only include players above percentile P in terms of player ordering (after skipPlayers is applied)
     * @param options.belowPercentile only include players below percentile P in terms of player ordering (after skipPlayers is applied)
     * @param options.maxDays only include players who've said GM in the last N days
     * @param options.minDays only include players who haven't said GM in the last N-1 days
     * @param options.maxRelativePoints only include players with at most this relative points
     * @param options.minRelativePoints only include players with at least this relative points
     * @param options.minPoints only include player with at least so many points
     * @param options.n only return the first N players (after the previous filters have been applied)
     * @returns ordered and filtered list of user IDs
     */
    queryOrderedPlayers(options: {
        skipPlayers?: number,
        abovePercentile?: number,
        belowPercentile?: number,
        maxDays?: number,
        minDays?: number,
        maxRelativePoints?: number,
        minRelativePoints?: number,
        minPoints?: number,
        n?: number
    }): Snowflake[]{
        let result: Snowflake[] = this.getOrderedPlayers();

        if (options.skipPlayers !== undefined) {
            result = result.slice(options.skipPlayers);
        }

        if (options.abovePercentile !== undefined || options.belowPercentile !== undefined) {
            const startIndex = result.length - Math.floor((options.belowPercentile ?? 1) * result.length);
            const endIndex = result.length - Math.floor((options.abovePercentile ?? 0) * result.length);
            result = result.slice(startIndex, endIndex);
        }

        if (options.maxDays !== undefined) {
            result = result.filter(userId => this.getPlayerDaysSinceLGM(userId) <= options.maxDays)
        }

        if (options.minDays !== undefined) {
            result = result.filter(userId => this.getPlayerDaysSinceLGM(userId) >= options.minDays)
        }

        if (options.maxRelativePoints !== undefined) {
            result = result.filter(userId => this.getPlayerRelativePoints(userId) <= options.maxRelativePoints);
        }

        if (options.minRelativePoints !== undefined) {
            result = result.filter(userId => this.getPlayerRelativePoints(userId) >= options.minRelativePoints);
        }

        if (options.minPoints !== undefined) {
            result = result.filter(userId => this.getPlayerPoints(userId) >= options.minPoints);
        }

        if (options.n !== undefined) {
            result = result.slice(0, options.n);
        }

        return result;
    }

    /**
     * @returns The max total points of all players currently in play
     */
    getMaxPoints(): number {
        if (this.getNumPlayers() === 0) {
            return 0;
        }
        return Math.max(...Object.values(this.data.players).map(player => player.points));
    }

    /**
     * @returns The min total points of all players currently in play
     */
    getMinPoints(): number {
        if (this.getNumPlayers() === 0) {
            return 0;
        }
        return Math.min(...Object.values(this.data.players).map(player => player.points));
    }

    isSeasonGoalReached(): boolean {
        return this.hasGame() && this.getGame().isSeasonComplete();
    }

    /**
     * Returns a number in the range [0, 1] representing the approximate completion of the game.
     * If the season is complete, then the value should always be 1.
     * If there is no game, then the value should always be 0.
     */
    getSeasonCompletion(): number {
        if (this.hasGame()) {
            return this.getGame().getSeasonCompletion();
        }
        return 0;
    }

    /**
     * Returns a number in the range [0, 1] representing the points of a particular player relative to
     * the player with the highest points (e.g. 0.75 means 75% of the max points).
     * @returns The player's relative points
     */
    getPlayerRelativePoints(userId: Snowflake): number {
        return this.getPlayerPoints(userId) / this.getMaxPoints();
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

    setPlayerPoints(userId: Snowflake, points: number): void {
        this.getOrCreatePlayer(userId).points = toFixed(points);
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

    getMostRecentBaiter(): Snowflake | undefined {
        return this.data.mostRecentBaiter;
    }

    setMostRecentBaiter(userId: Snowflake): void {
        if (userId) {
            this.data.mostRecentBaiter = userId;
        } else {
            delete this.data.mostRecentBaiter;
        }
    }

    clearMostRecentBaiter(): void {
        this.setMostRecentBaiter(undefined);
    }

    toHistorySeasonEntry(): Season {
        return {
            season: this.data.season,
            startedOn: this.data.startedOn,
            finishedOn: getTodayDateString(),
            winners: this.getGame().getWinners()
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

    /**
     * @returns True if every user who has submitted something has either voted or submitted.
     */
    haveAllSubmittersVoted(): boolean {
        return this.getEventType() === DailyEventType.AnonymousSubmissions
            && this.getEvent().submissions !== undefined
            && this.getEvent().votes !== undefined
            && Object.keys(this.getEvent().submissions).every(userId => userId in this.getEvent().votes || this.hasUserForfeited(userId));
    }

    hasUserForfeited(userId: Snowflake): boolean {
        return (this.getEvent()?.forfeiters ?? []).includes(userId);
    }

    /**
     * Get the list of all users who have sent in a submission, yet haven't voted and haven't forfeited.
     */
    getSubmissionDeadbeats(): Snowflake[] {
        if (!this.getEvent()?.submissions) {
            return [];
        }
        return Object.keys(this.getEvent().submissions)
            // Users who haven't forfeited...
            .filter(userId => !this.hasUserForfeited(userId))
            // And who haven't voted...
            .filter(userId => !this.getEvent().votes[userId]);
    }

    getGame(): AbstractGame<GameState> | undefined {
        return this.game;
    }

    hasGame(): boolean {
        return this.game !== undefined;
    }

    setGame(game: AbstractGame<GameState>): void {
        this.game = game;
        this.data.game = game.getState();
    }

    /**
     * @returns True if the game has started and the user has joined
     */
    isPlayerInGame(userId: Snowflake): boolean {
        return this.hasGame() && this.getGame().hasPlayer(userId);
    }

    isAcceptingGameDecisions(): boolean {
        return this.data.acceptingGameDecisions ?? false;
    }

    setAcceptingGameDecisions(acceptingGameDecisions: boolean): void {
        if (acceptingGameDecisions) {
            this.data.acceptingGameDecisions = true;
        } else {
            delete this.data.acceptingGameDecisions;
        }
    }

    toJson(): string {
        return JSON.stringify(this.data, null, 2);
    }

    toSpecialJson(): string {
        return prettyPrint(this.data, {
            overrides: {
                'game': 'Game not printed',
                'dailyStatus': 'Daily status map'
            }
        });
    }
}