import { Message, Snowflake } from "discord.js";
import { getTodayDateString, prettyPrint, toFixed } from "evanw555.js";
import ActivityTracker from "./activity-tracker";
import AbstractGame from "./games/abstract-game";
import ClassicGame from "./games/classic";
import MazeGame from "./games/maze";
import logger from "./logger";
import { Bait, Combo, DailyEvent, DailyEventType, DailyPlayerState, FullDate, PlayerState, RawAnonymousSubmissionsState, RawGoodMorningState, Season } from "./types";
import IslandGame from "./games/island";
import { AnonymousSubmissionsState } from "./submissions";
import ArenaGame from "./games/arena";
import MasterpieceGame from "./games/masterpiece";
import RiskGame from "./games/risk";
import CandyLandGame from "./games/candyland";
import { FocusGameState } from "./focus/types";
import { GameState } from "./games/types";

export default class GoodMorningState {
    private data: RawGoodMorningState;
    private game?: AbstractGame<GameState>;

    constructor(rawState: RawGoodMorningState) {
        this.data = rawState;
        // TODO: Is there a better way to construct the game instance?
        if (rawState.game) {
            switch(rawState.game.type) {
                case 'CLASSIC':
                    this.game = new ClassicGame(rawState.game);
                    break;
                case 'MAZE':
                    this.game = new MazeGame(rawState.game);
                    break;
                case 'ISLAND':
                    this.game = new IslandGame(rawState.game);
                    break;
                case 'ARENA':
                    this.game = new ArenaGame(rawState.game);
                    break;
                case 'MASTERPIECE':
                    this.game = new MasterpieceGame(rawState.game);
                    break;
                case 'RISK':
                    this.game = new RiskGame(rawState.game);
                    break;
                case 'CANDYLAND':
                    this.game = new CandyLandGame(rawState.game);
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

    getActivityOrderedPlayers(): Snowflake[] {
        return this.getPlayers().sort((x, y) => this.getPlayerActivity(y).getRating() - this.getPlayerActivity(x).getRating());
    }

    /**
     * Returns an ordered list of user IDs sorted by their rank in the game.
     * For every player NOT in game, add them at the end ordered by points, then days since last good morning, then penalties.
     * @returns sorted list of user IDs
     */
    getOrderedPlayers(): Snowflake[] {
        const gameOrderedPlayers: Snowflake[] = this.hasGame() ? this.getGame().getOrderedPlayers() : [];

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
     * Returns whether any of the following are true for a given player:
     * 1. Player has more deductions than half their cumulative points.
     * 2. Player has negative in-game points.
     * @returns list of delinquent user IDs
     */
    isPlayerDelinquent(userId: Snowflake): boolean {
        if (this.hasPlayer(userId)) {
            return this.getPlayerDeductions(userId) > 0.5 * this.getPlayerPoints(userId)
                || (this.hasGame() && this.getGame().getPoints(userId) < 0);
        }
        return false;
    }

    getDelinquentPlayers(): Snowflake[] {
        return this.getPlayers().filter(userId => this.isPlayerDelinquent(userId));
    }

    getMutedPlayers(): Snowflake[] {
        return this.getPlayers().filter(userId => this.isPlayerMuted(userId));
    }

    getPlayersOnVotingProbation(): Snowflake[] {
        return this.getPlayers().filter(userId => this.isPlayerOnVotingProbation(userId));
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
                cumulativePoints: 0
            };
        }

        return this.getPlayer(userId) as PlayerState;
    }

    removePlayer(userId: Snowflake): void {
        // Remove from core state
        delete this.data.players[userId];
        delete this.data.dailyStatus[userId];
        // Remove from game state
        if (this.hasGame()) {
            this.getGame().removePlayer(userId);
        }
    }

    hasPlayer(userId: Snowflake): boolean {
        return this.getPlayer(userId) !== undefined;
    }

    /**
     * @returns The user's display name if known, else return a user mention tag
     */
    getPlayerDisplayName(userId: Snowflake): string {
        return this.getPlayer(userId)?.displayName ?? `<@${userId}>`;
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
        return this.getPlayer(userId)?.cumulativePoints ?? 0;
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
        const playerState = this.getOrCreatePlayer(userId);
        const tracker: ActivityTracker = new ActivityTracker(playerState.activity);
        const result: boolean = tracker.add(active);
        if (tracker.getActivityLevel() === 0) {
            delete playerState.activity;
        } else {
            playerState.activity = tracker.dump();
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

    isPlayerMuted(userId: Snowflake): boolean {
        return this.getPlayer(userId)?.muted ?? false;
    }

    setPlayerMute(userId: Snowflake, muted: boolean): void {
        if (muted) {
            this.getOrCreatePlayer(userId).muted = true;
        } else {
            delete this.getOrCreatePlayer(userId).muted;
        }
    }

    isPlayerOnVotingProbation(userId: Snowflake): boolean {
        return this.getPlayer(userId)?.votingProbation ?? false;
    }

    setPlayerVotingProbation(userId: Snowflake, votingProbation: boolean) {
        if (votingProbation) {
            this.getOrCreatePlayer(userId).votingProbation = true;
        } else {
            delete this.getOrCreatePlayer(userId).votingProbation;
        }
    }

    getPlayerMultiplier(userId: Snowflake): number {
        return this.getPlayer(userId)?.multiplier ?? 1;
    }

    setPlayerMultiplier(userId: Snowflake, multiplier: number): void {
        this.getOrCreatePlayer(userId).multiplier = multiplier;
    }

    doesPlayerNeedHandicap(userId: Snowflake): boolean {
        return this.hasGame() && this.getGame().doesPlayerNeedHandicap(userId);
    }

    doesPlayerNeedNerf(userId: Snowflake): boolean {
        return this.hasGame() && this.getGame().doesPlayerNeedNerf(userId);
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
     * @returns Ordered list of user IDs for players who have a full activity streak
     */
    getFullActivityStreakPlayers(): Snowflake[] {
        return this.queryOrderedPlayers({ minActivityStreak: ActivityTracker.CAPACITY });
    }

    /**
     * Returns an ordered list of player user IDs for high-middle ranked players who have said Good Morning recently.
     * @returns List of user IDs for players who may serve as a potential reveiller
     */
    getPotentialReveillers(): Snowflake[] {
        // Only players who aren't the leader, yet have said GM 5+ days in the row
        return this.queryOrderedPlayers({ skipPlayers: 1, minActivityStreak: 5 });
    }
    /**
     * @returns List of user IDs for players who are suitable to receive the magic word hint
     */
    getPotentialMagicWordRecipients(): Snowflake[] {
        // Only give the hint to players who need a game-specific handicap, and ALSO have said GM for 3+ days in a row (so as not to bug less active players)
        return this.queryOrderedPlayers({ minActivityStreak: 3 })
            .filter(userId => this.doesPlayerNeedHandicap(userId));
    }

    /**
     * Query the ordered (by score) list of players, but with the following parameters...
     * @param options parameters map
     * @param options.skipPlayers omit the top N players (e.g. 2 means omit the first-place and second-place players)
     * @param options.abovePercentile only include players above percentile P in terms of player ordering (after skipPlayers is applied)
     * @param options.belowPercentile only include players below percentile P in terms of player ordering (after skipPlayers is applied)
     * @param options.maxDays only include players who've said GM in the last N days
     * @param options.minDays only include players who haven't said GM in the last N-1 days
     * @param options.maxActivityStreak only include players with an activity streak at most N days long
     * @param options.minActivityStreak only include players with an activity streak at least N days long
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
        maxActivityStreak?: number,
        minActivityStreak?: number,
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

        const maxDays = options.maxDays;
        if (maxDays !== undefined) {
            result = result.filter(userId => this.getPlayerDaysSinceLGM(userId) <= maxDays)
        }

        const minDays = options.minDays;
        if (minDays !== undefined) {
            result = result.filter(userId => this.getPlayerDaysSinceLGM(userId) >= minDays)
        }

        const maxActivityStreak = options.maxActivityStreak;
        if (maxActivityStreak !== undefined) {
            result = result.filter(userId => this.getPlayerActivity(userId).getStreak() <= maxActivityStreak)
        }

        const minActivityStreak = options.minActivityStreak;
        if (minActivityStreak !== undefined) {
            result = result.filter(userId => this.getPlayerActivity(userId).getStreak() >= minActivityStreak)
        }

        const maxRelativePoints = options.maxRelativePoints;
        if (maxRelativePoints !== undefined) {
            result = result.filter(userId => this.getPlayerRelativePoints(userId) <= maxRelativePoints);
        }

        const minRelativePoints = options.minRelativePoints;
        if (minRelativePoints !== undefined) {
            result = result.filter(userId => this.getPlayerRelativePoints(userId) >= minRelativePoints);
        }

        const minPoints = options.minPoints;
        if (minPoints !== undefined) {
            result = result.filter(userId => this.getPlayerPoints(userId) >= minPoints);
        }

        if (options.n !== undefined) {
            result = result.slice(0, options.n);
        }

        return result;
    }

    /**
     * @returns The max total cumulative points of all players currently in play
     */
    getMaxPoints(): number {
        if (this.getNumPlayers() === 0) {
            return 0;
        }
        return Math.max(...Object.values(this.data.players).map(player => player.cumulativePoints));
    }

    /**
     * @returns The min total cumulative points of all players currently in play
     */
    getMinPoints(): number {
        if (this.getNumPlayers() === 0) {
            return 0;
        }
        return Math.min(...Object.values(this.data.players).map(player => player.cumulativePoints));
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
     * the player with the highest cumulative points (e.g. 0.75 means 75% of the max points).
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

        return this.getDailyStatus(userId) as DailyPlayerState;
    }

    /**
     * @returns Actual number of points awarded
     */
    awardPoints(userId: Snowflake, points: number): number {
        if (points < 0 || isNaN(points)) {
            logger.log(`WARNING! Tried to award \`${points}\` points to **${this.getPlayerDisplayName(userId)}** (state)`);
            return this.awardPoints(userId, 0);
        }
        const actualPoints: number = points * this.getPlayerMultiplier(userId);
        this.getOrCreateDailyStatus(userId).pointsEarned = toFixed(this.getPointsEarnedToday(userId) + actualPoints);
        this.getOrCreatePlayer(userId).cumulativePoints = toFixed(this.getPlayerPoints(userId) + actualPoints);
        // Add these points to the game, if the game exists and the player is in it
        if (this.hasGame() && this.getGame().hasPlayer(userId)) {
            this.getGame().addPoints(userId, points);
        }
        return actualPoints;
    }

    deductPoints(userId: Snowflake, points: number): void {
        if (points < 0 || isNaN(points)) {
            logger.log(`WARNING! Tried to deduct \`${points}\` points from **${this.getPlayerDisplayName(userId)}** (state)`);
            return this.deductPoints(userId, 0);
        }
        // Update the daily "points lost" value
        this.getOrCreateDailyStatus(userId).pointsLost = toFixed(this.getPointsLostToday(userId) + points);
        // Deduct points from the player
        this.getOrCreatePlayer(userId).cumulativePoints = toFixed(this.getPlayerPoints(userId) - points);
        // Update the season total deductions count
        this.getOrCreatePlayer(userId).deductions = toFixed(this.getPlayerDeductions(userId) + points);
        // Deduct these points from the game, if the game exists and the player is in it
        if (this.hasGame() && this.getGame().hasPlayer(userId)) {
            this.getGame().addPoints(userId, -points);
        }
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

    getNextDailyBonusRank(): number {
        return Math.max(0, ...Object.values(this.data.dailyStatus).map(status => status.bonusRank ?? 0)) + 1;
    }

    hasDailyBonusRank(userId: Snowflake): boolean {
        return this.getDailyStatus(userId)?.bonusRank !== undefined;
    }

    setDailyBonusRank(userId: Snowflake, videoRank: number): void {
        this.getOrCreateDailyStatus(userId).bonusRank = videoRank;
    }

    doesAnyoneHaveDailyBonusRank(): boolean {
        return this.getPlayers().some(userId => this.hasDailyBonusRank(userId));
    }

    hasSaidHappyBirthday(userId: Snowflake): boolean {
        return this.getDailyStatus(userId)?.saidHappyBirthday ?? false;
    }

    setSaidHappyBirthday(userId: Snowflake, saidHappyBirthday: boolean) {
        this.getOrCreateDailyStatus(userId).saidHappyBirthday = saidHappyBirthday;
    }

    getCurrentLeader(): Snowflake | undefined {
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

    getMagicWords(): string[] {
        return this.data.magicWords ?? [];
    }

    hasMagicWords(): boolean {
        return this.data.magicWords !== undefined && this.data.magicWords.length > 0;
    }

    setMagicWords(words: string[]): void {
        this.data.magicWords = words;
    }

    clearMagicWords(): void {
        delete this.data.magicWords;
    }

    getCombo(): Combo | undefined {
        return this.data.combo;
    }

    hasCombo(): boolean {
        return this.data.combo !== undefined;
    }

    setCombo(combo: Combo): void {
        this.data.combo = combo;
    }

    getMaxCombo(): Combo | undefined {
        return this.data.maxCombo;
    }

    getMaxComboDays(): number {
        return this.data.maxCombo?.days ?? 0;
    }

    setMaxCombo(combo: Combo): void {
        this.data.maxCombo = combo;
    }

    isAcceptingBait(): boolean {
        return this.data.isAcceptingBait ?? false;
    }

    setAcceptingBait(isAcceptingBait: boolean): void {
        if (isAcceptingBait) {
            this.data.isAcceptingBait = true;
        } else {
            delete this.data.isAcceptingBait;
        }
    }

    getMostRecentBait(): Bait | undefined {
        return this.data.mostRecentBait;
    }

    getPreviousBait(): Bait | undefined {
        return this.data.previousBait;
    }

    setMostRecentBait(message: Message): void {
        if (!message) {
            logger.log('WARNING: Attempted to set mostRecentBait with a falsy message!');
            return;
        }
        // If there was an existing MRB, use it to set the previous bait
        if (this.data.mostRecentBait) {
            this.data.previousBait = this.data.mostRecentBait;
            // TODO: Temp logging to make sure this is working correctly
            logger.log(`Baiter **${this.getPlayerDisplayName(message.author.id)}** has replaced **${this.getPlayerDisplayName(this.data.previousBait.userId)}**`);
        }
        // Set the MRB
        this.data.mostRecentBait = {
            userId: message.author.id,
            messageId: message.id
        };
    }

    clearBaiters(): void {
        delete this.data.previousBait;
        delete this.data.mostRecentBait;
    }

    toHistorySeasonEntry(): Season {
        return {
            season: this.data.season,
            gameType: this.data.game?.type,
            startedOn: this.data.startedOn,
            finishedOn: getTodayDateString(),
            winners: this.hasGame() ? this.getGame().getWinners() : []
        };
    }

    getEventType(): DailyEventType | undefined {
        return this.data.event?.type;
    }

    getEvent(): DailyEvent {
        if (!this.data.event) {
            throw new Error('Cannot get event, there is no event!');
        }
        return this.data.event;
    }

    hasEvent(): boolean {
        return this.data.event !== undefined;
    }

    hasNextEvent(): boolean {
        return this.data.nextEvent !== undefined;
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
            // TODO: Allow magic words to be said on focus days once it's reworked
            || this.getEventType() === DailyEventType.HighFocus
            || this.getEventType() === DailyEventType.AnonymousSubmissions;
    }

    hasAnonymousSubmissions(): boolean {
        return this.data.anonymousSubmissions !== undefined;
    }

    getAnonymousSubmissions(): AnonymousSubmissionsState {
        if (!this.data.anonymousSubmissions) {
            throw new Error('There is no submissions data in the state!');
        }
        return new AnonymousSubmissionsState(this.data.anonymousSubmissions);
    }

    setAnonymousSubmissions(anonymousSubmissions: RawAnonymousSubmissionsState) {
        this.data.anonymousSubmissions = anonymousSubmissions;
    }

    clearAnonymousSubmissions() {
        delete this.data.anonymousSubmissions;
    }

    getRawAnonymousSubmissions(): RawAnonymousSubmissionsState | undefined {
        return this.data.anonymousSubmissions;
    }

    isAcceptingAnonymousSubmissions(): boolean {
        return this.hasAnonymousSubmissions() && this.getAnonymousSubmissions().isSubmissionsPhase();
    }

    isAcceptingAnonymousSubmissionVotes(): boolean {
        return this.hasAnonymousSubmissions() && this.getAnonymousSubmissions().isVotingPhase();
    }

    /**
     * @returns True if every user who has submitted something has either (1) voted, (2) forfeited, or (3) is on probation.
     */
    haveAllSubmittersVoted(): boolean {
        if (!this.hasAnonymousSubmissions()) {
            return false;
        }
        const anonymousSubmissions = this.getAnonymousSubmissions();
        return anonymousSubmissions.getSubmitters()
            .every(userId => anonymousSubmissions.hasUserVoted(userId) || anonymousSubmissions.hasUserForfeited(userId) || this.isPlayerOnVotingProbation(userId));
    }

    isLastSubmissionWinner(userId: Snowflake): boolean {
        return this.getLastSubmissionWinners().includes(userId);
    }

    getLastSubmissionWinners(): Snowflake[] {
        return this.data.lastSubmissionWinners ?? [];
    }

    setLastSubmissionWinners(lastSubmissionWinners: Snowflake[]) {
        if (lastSubmissionWinners && lastSubmissionWinners.length > 0) {
            this.data.lastSubmissionWinners = lastSubmissionWinners;
        } else {
            this.clearLastSubmissionWinners();
        }
    }

    clearLastSubmissionWinners() {
        delete this.data.lastSubmissionWinners;
    }

    getFocusGame(): FocusGameState {
        if (!this.data.event) {
            throw new Error('Cannot get focus game, there is no daily event!');
        }
        const focusGame = this.data.event.focusGame;
        if (!focusGame) {
            throw new Error('Cannot get focus game, it doesn\'t exist in the daily event!');
        }
        return focusGame;
    }

    hasFocusGame(): boolean {
        return this.data.event?.focusGame !== undefined;
    }

    getGame(): AbstractGame<GameState> {
        if (!this.game) {
            throw new Error('Cannot get game, there is no game!');
        }
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
        return this.hasGame() && this.getGame().isAcceptingDecisions();
    }

    setBirthdayBoys(birthdayBoys: Snowflake[]) {
        this.data.birthdayBoys = birthdayBoys;
    }

    getBirthdayBoys(): Snowflake[] {
        return this.data.birthdayBoys ?? [];
    }

    hasBirthdayBoys(): boolean {
        return this.getBirthdayBoys().length > 0;
    }

    toJson(): string {
        return JSON.stringify(this.data, null, 2);
    }

    toCompactJson(): string {
        return JSON.stringify(this.data);
    }

    toSpecialJson(): string {
        return prettyPrint(this.data, {
            overrides: {
                'game': 'Game not printed',
                'dailyStatus': 'Daily status map'
            }
        });
    }

    getRawState(): RawGoodMorningState {
        return this.data;
    }
}