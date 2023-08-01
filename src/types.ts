import { Snowflake } from "discord.js"

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
    ProcessGameDecisions = 'PROCESS_GAME_DECISIONS'
}

/**
 * A calendar date expressed as "{month}/{day}".
 */
export type CalendarDate = string

/**
 * A date expressed as "{month}/{day}/{year}".
 */
export type FullDate = string

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
    }
}

export interface DailyPlayerState {
    rank?: number,
    videoRank?: number,
    pointsLost?: number,
    saidHappyBirthday?: boolean,
    pointsEarned: number
}

export interface Combo {
    user: Snowflake,
    days: number
}

export type PrizeType = 'submissions1' | 'submissions2' | 'submissions3' | 'streak' | 'nightmare';

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
    BeginHomeStretch = 'BEGIN_HOME_STRETCH',
    Beckoning = 'BECKONING',
    GrumpyMorning = 'GRUMPY_MORNING',
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

export interface AnonymousSubmission {
    text?: string,
    url?: string
}

export interface DailyEvent {
    type: DailyEventType,
    user?: Snowflake,
    // Used specifically for the "reverse GM" event
    reverseGMRanks?: Record<Snowflake, number>,
    // Used specifically for the "anonymous submissions" event
    submissionType?: string,
    submissions?: Record<Snowflake, AnonymousSubmission>, // Map of UserId -> submission text/url
    submissionOwnersByCode?: Record<string, Snowflake>, // Map of submission code -> UserId
    votes?: Record<Snowflake, string[]>, // Map of UserId -> list of submission codes
    rootSubmissionMessage?: Snowflake, // MessageId
    selectSubmissionMessage?: Snowflake, // MessageId
    forfeiters?: Snowflake[], // List of UserIds
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
    wordleHiScores?: Record<Snowflake, number>
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
    summary: string,
    continueProcessing: boolean
}

export interface MazeGameState {
    type: 'MAZE_GAME_STATE',
    decisions: Record<Snowflake, string[]>,
    turn: number,
    winners: Snowflake[],
    // Custom properties below
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
    eliminated?: true,
    immunity?: true
}

export interface IslandGameState {
    type: 'ISLAND_GAME_STATE',
    decisions: Record<Snowflake, string[]>,
    turn: number,
    winners: Snowflake[],
    // Custom properties below
    players: Record<Snowflake, IslandPlayerState>
}

export interface ClassicGameState {
    type: 'CLASSIC_GAME_STATE',
    decisions: Record<Snowflake, string[]>,
    turn: number,
    winners: Snowflake[],
    // Custom properties below
    goal: number,
    points: Record<Snowflake, number>,
    actionPointDiffs: Record<Snowflake, number>,
    names: Record<Snowflake, string>,
    revealedActions: Record<Snowflake, string>
}

export type GameState = MazeGameState | IslandGameState | ClassicGameState;

export interface Bait {
    userId: Snowflake,
    messageId: Snowflake
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
    nextSubmissionPrompt?: string,
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
    guessOwners: Snowflake[]
}

export interface SubmissionPromptHistory {
    used: string[],
    unused: string[]
}