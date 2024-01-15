import { MessageCreateOptions, Snowflake } from "discord.js"

export enum TimeoutType {
    NextGoodMorning = 'NEXT_GOOD_MORNING',
    NextPreNoon = 'NEXT_PRE_NOON',
    BaitingStart = 'BAITING_START',
    NextNoon = 'NEXT_NOON',
    // Non-standard events
    GuestReveilleFallback = 'GUEST_REVEILLE_FALLBACK',
    PopcornFallback = 'POPCORN_FALLBACK',
    WordleRestart = 'WORDLE_RESTART',
    AnonymousSubmissionReveal = 'ANONYMOUS_SUBMISSION_REVEAL',
    AnonymousSubmissionVotingReminder = 'ANONYMOUS_SUBMISSION_VOTING_REMINDER',
    AnonymousSubmissionTypePollStart = 'ANONYMOUS_SUBMISSION_TYPE_POLL_START',
    AnonymousSubmissionTypePollEnd = 'ANONYMOUS_SUBMISSION_TYPE_POLL_END',
    Nightmare = 'NIGHTMARE',
    HomeStretchSurprise = 'HOME_STRETCH_SURPRISE',
    // GMBR 2.0 events
    ProcessGameDecisions = 'PROCESS_GAME_DECISIONS',
    GameDecisionPhase = 'GAME_DECISION_PHASE',
    // Utilities
    ReplyToMessage = 'REPLY_TO_MESSAGE'
}

/**
 * Type representing message data that can be sent via the Discord messenger utility.
 */
export type MessengerPayload = string | MessageCreateOptions;

/**
 * A calendar date expressed as "{month}/{day}".
 */
export type CalendarDate = string

/**
 * A date expressed as "{month}/{day}/{year}".
 */
export type FullDate = string

export interface GoodMorningAuth {
    token: string,
    openAiKey: string
}

export interface GoodMorningConfig {
    goodMorningChannelId: Snowflake,
    goodMorningMessageProbability: number,
    replyViaReactionProbability: number,
    magicWordReactionProbability: number,
    goodMorningReplyCount: number,
    awardsByRank: Record<string, number>,
    grandContestAward: number,
    focusGameAward: number,
    miniGameAward: number,
    defaultAward: number,
    bonusAward: number,
    minimumComboDays: number,
    goodMorningMessageOverrides: Record<CalendarDate, string>,
    defaultGoodMorningEmoji: string,
    goodMorningEmojiOverrides: Record<CalendarDate, string[]>,
    downvoteEmoji: string,
    sungazers: {
        role: Snowflake,
        channel: Snowflake
    },
    testingChannelId: string,
    testing?: true
}

export interface ReplyToMessageData {
    channelId: Snowflake,
    /**
     * If no message ID is provided, then the message won't be a reply.
     */
    messageId?: Snowflake,
    content?: string
}

export interface DailyPlayerState {
    rank?: number,
    bonusRank?: number,
    pointsLost?: number,
    saidHappyBirthday?: boolean,
    pointsEarned: number
}

export interface Combo {
    user: Snowflake,
    days: number
}

export type PrizeType = 'submissions1' | 'submissions1-tied'
    | 'submissions2' | 'submissions2-tied'
    | 'submissions3' | 'submissions3-tied'
    | 'streak' | 'nightmare';

export interface PlayerState {
    displayName: string,
    cumulativePoints: number,
    muted?: true,
    votingProbation?: true,
    activity?: string,
    multiplier?: number,
    deductions?: number,
    daysSinceLastGoodMorning?: number,
    combosBroken?: number
}

export enum DailyEventType {
    RecapSunday = 'RECAP_SUNDAY',
    WishfulWednesday = 'WISHFUL_WEDNESDAY',
    MonkeyFriday = 'MONKEY_FRIDAY',
    ChimpOutFriday = 'CHIMP_OUT_FRIDAY',
    BeginHomeStretch = 'BEGIN_HOME_STRETCH',
    Beckoning = 'BECKONING',
    GrumpyMorning = 'GRUMPY_MORNING',
    EarlyMorning = 'EARLY_MORNING',
    SleepyMorning = 'SLEEPY_MORNING',
    WritersBlock = 'WRITERS_BLOCK',
    Nightmare = 'NIGHTMARE',
    EarlyEnd = 'EARLY_END',
    Popcorn = 'POPCORN',
    // Abnormal events (i.e. not the typical "wait-for-GM-then-say-GM" event)
    GuestReveille = 'GUEST_REVEILLE',
    ReverseGoodMorning = 'REVERSE_GOOD_MORNING',
    Wordle = 'WORDLE',
    AnonymousSubmissions = 'ANONYMOUS_SUBMISSIONS',
    // 2.0 events
    GameDecision = 'GAME_DECISION',
    GameUpdate = 'GAME_UPDATE'
}

export enum HomeStretchSurprise {
    Multipliers,
    LongestComboBonus,
    ComboBreakerBonus
}

export interface DailyEvent {
    type: DailyEventType,
    user?: Snowflake,
    // Used specifically for the "reverse GM" event
    reverseGMRanks?: Record<Snowflake, number>,
    // Used specifically for the "grumpy morning" / "nightmare" / "popcorn" events
    disabled?: boolean,
    // Used specifically for the "writer's block" event
    customMessage?: string,
    // Used specifically for the "begin home stretch" event
    homeStretchSurprises?: HomeStretchSurprise[],
    // Used specifically for the "early end" event
    minutesEarly?: number,
    // Used specifically for the "wishful wednesday" event
    wishesReceived?: Record<Snowflake, number>,
    // Used specifically for the "wordle" event
    wordle?: Wordle,
    wordleHiScores?: Record<Snowflake, number>,
    // Used specifically for the "popcorn" event
    messageId?: Snowflake,
    storySegments?: string[]
}

export interface MazeLocation {
    r: number,
    c: number
}

export type MazeItemName = 'trap' | 'boulder' | 'seal' | 'key' | 'star' | 'charge';

export interface MazeLine {
    from: MazeLocation,
    to: MazeLocation,
    /**
     * Render this line under players if falsy, over players if truthy.
     */
    over?: boolean,
    /**
     * The type of line to render.
     */
    special?: 'warp' | 'red' | 'rainbow'
}

export interface MazePlayerState {
    r: number,
    c: number,
    /**
     * Integer value representing the rank of this player.
     * Each player should have a unique value, and all values should be consecutive beginning at 1.
     */
    rank: number,
    displayName: string,
    points: number,
    multiplier?: number,
    items?: Partial<Record<MazeItemName, number>>,
    itemOffers?: MazeItemName[],
    finished?: boolean,
    stuns?: number,
    invincible?: boolean,
    originLocation?: MazeLocation,
    warped?: boolean
}

export interface DecisionProcessingResult {
    summary: MessengerPayload,
    extraSummaries?: MessengerPayload[],
    continueProcessing: boolean,
    // If specified, the delay for the subsequent update will be scaled by this amount.
    delayMultiplier?: number,
    // If specified, the next update will be scheduled for this particular time (as arguments of Date#setHours). Overrides the relative delay and multiplier system.
    nextUpdateTime?: [number, number, number]
}

export interface AbstractGameState<T> {
    readonly type: T,
    readonly season: number,
    readonly winners: Snowflake[],
    decisions: Record<Snowflake, string[]>,
    turn: number
}

export interface MazeGameState extends AbstractGameState<'MAZE_GAME_STATE'> {
    action: number,
    rows: number,
    columns: number
    map: number[][],
    goal: MazeLocation,
    homeStretch?: boolean,
    doorwayCosts: Record<string, number>,
    trapOwners: Record<string, Snowflake>,
    players: Record<Snowflake, MazePlayerState>,
    lines: MazeLine[],
    // TODO: Temp property to test features for next season
    usingBetaFeatures?: boolean
}

export interface IslandPlayerState {
    displayName: string,
    points: number,
    revealedTarget?: Snowflake,
    votes?: number,
    incomingVotes?: number,
    eliminated?: true,
    locked?: true,
    finalRank?: number,
    mayGrantImmunity?: true,
    // If the player granted immunity to themselves, this will be their own user ID
    immunityGrantedBy?: Snowflake
}

export interface IslandGameState extends AbstractGameState<'ISLAND_GAME_STATE'> {
    numToBeEliminated: number,
    players: Record<Snowflake, IslandPlayerState>
}

export interface ArenaGameState extends AbstractGameState<'ARENA_GAME_STATE'> {
    // TODO: Fill this in
}

export interface MasterpiecePlayerState {
    displayName: string,
    points: number,
    // If true, then this player can still choose one of these special actions
    maySell?: true,
    mayForceAuction?: true
}

export interface MasterpiecePieceState {
    value: number,
    name: string,
    // Snowflake -> owner ID, false -> unsold, true -> sold
    owner: Snowflake | boolean,
    // If true, this piece will be sold during the next game update
    toBeSold?: true
}

export interface MasterpieceAuctionState {
    pieceId: string,
    bid: number,
    bidder?: Snowflake,
    active?: true
}

export interface MasterpieceGameState extends AbstractGameState<'MASTERPIECE_GAME_STATE'> {
    readonly players: Record<Snowflake, MasterpiecePlayerState>,
    readonly pieces: Record<string, MasterpiecePieceState>,
    readonly auctions: {
        bank?: MasterpieceAuctionState,
        private?: MasterpieceAuctionState
    },
    // If true, all pieces should be sold off and revealed
    finalReveal?: true,
    // ID of the piece being offered in the "silent auction"
    silentAuctionPieceId?: string,
}

export interface RiskPlayerState {
    displayName: string,
    points: number,
    newTroops?: number,
    color?: string,
    troopIcon?: string,
    finalRank?: number,
    eliminator?: Snowflake,
    kills?: number,
    deaths?: number
}

export interface RiskTerritoryState {
    owner?: Snowflake,
    troops: number
}

export interface RiskMovementData {
    from: string,
    to: string,
    // Note that the quantity is only the target quantity of a conflict, it may not be the actual quantity used
    quantity: number
}

export interface RiskConflictAgentData {
    readonly userId: Snowflake,
    readonly territoryId: string,
    readonly initialTroops: number,
    troops: number
}

export interface RiskConflictState {
    // The attacker at the front of the list is the next one to be processed
    readonly attackers: RiskConflictAgentData[],
    // If omitted, then this conflict is a "circular" or "symmetric" conflict with no defenders
    defender?: RiskConflictAgentData
}

export interface RiskPlannedAttack {
    readonly id: string,
    readonly userId: Snowflake,
    readonly attack: RiskMovementData,
    actualQuantity: number
}

export interface RiskGameState extends AbstractGameState<'RISK_GAME_STATE'> {
    readonly players: Record<Snowflake, RiskPlayerState>,
    readonly territories: Record<string, RiskTerritoryState>,
    draft?: Record<Snowflake, { available?: true, timestamp: number}>,
    // The following are used for categorized decisions that can only be added via interactions
    addDecisions?: Record<Snowflake, string[]>,
    attackDecisions?: Record<Snowflake, RiskMovementData[]>,
    moveDecisions?: Record<Snowflake, RiskMovementData>,
    // At the beginning of the game update, the attack decisions are deleted and processed into one indexable map
    plannedAttacks?: Record<string, RiskPlannedAttack>,
    // This represents the current conflict being processed
    currentConflict?: RiskConflictState
}

export interface ClassicGameState extends AbstractGameState<'CLASSIC_GAME_STATE'> {
    halloween?: true,
    // Goal as determined by a point threshold
    goal: number,
    // Goal as determined by a defined end date e.g. "10/28/2023"
    endDate: string,
    points: Record<Snowflake, number>,
    actionPointDiffs: Record<Snowflake, number>,
    names: Record<Snowflake, string>,
    revealedActions: Record<Snowflake, string>,
}

export type GameState = MazeGameState | IslandGameState | ArenaGameState | MasterpieceGameState | RiskGameState | ClassicGameState;

export interface GamePlayerAddition {
    userId: Snowflake,
    displayName: string,
    points: number
}

export interface Bait {
    userId: Snowflake,
    messageId: Snowflake
}

export type AnonymousSubmissionsPhase = 'submissions' | 'reveal' | 'voting' | 'results';

export interface AnonymousSubmission {
    text?: string,
    url?: string
}

export interface RawAnonymousSubmissionsState {
    // Used specifically for the "anonymous submissions" event
    prompt: string,
    phase: AnonymousSubmissionsPhase,
    submissions: Record<Snowflake, AnonymousSubmission>, // Map of UserId -> submission text/url
    submissionOwnersByCode: Record<string, Snowflake>, // Map of submission code -> UserId
    votes: Record<Snowflake, string[]>, // Map of UserId -> list of submission codes
    forfeiters: Snowflake[], // List of UserIds
    rootSubmissionMessage?: Snowflake, // MessageId
    selectSubmissionMessage?: Snowflake // MessageId
}

export interface RawGoodMorningState {
    season: number,
    startedOn: FullDate,
    isMorning: boolean,
    isGracePeriod?: boolean,
    isHomeStretch?: boolean,
    goodMorningEmoji: string | string[],
    magicWords?: string[],
    currentLeader?: Snowflake,
    combo?: Combo,
    maxCombo?: Combo,
    isAcceptingBait?: true,
    mostRecentBait?: Bait,
    previousBait?: Bait
    event?: DailyEvent,
    nextEvent?: DailyEvent,
    anonymousSubmissions?: RawAnonymousSubmissionsState,
    lastSubmissionWinners?: Snowflake[],
    dailyStatus: Record<Snowflake, DailyPlayerState>,
    players: Record<Snowflake, PlayerState>,
    game?: GameState,
    acceptingGameDecisions?: boolean,
    birthdayBoys?: Snowflake[]
}

export interface Season {
    season: number,
    startedOn: FullDate
    finishedOn: FullDate,
    winners: Snowflake[]
}

export interface Medals {
    gold?: number,
    silver?: number,
    bronze?: number,
    skull?: number
}

export interface GoodMorningHistory {
    seasons: Season[],
    medals: Record<Snowflake, Medals>,
    // Keyed by UserId of sungazer councilmembers, value is the number of seasons they have remaining in their term
    sungazers: Record<Snowflake, number>
}

export interface Wordle {
    solution: string,
    guesses: string[],
    guessOwners: Snowflake[],
    blacklistedUserId?: Snowflake
}

export interface WordleRestartData {
    nextPuzzleLength: number,
    blacklistedUserId: Snowflake
}

export interface SubmissionPromptHistory {
    used: string[],
    unused: string[]
}