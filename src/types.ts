import { Snowflake } from "discord.js"

export enum TimeoutType{
    NextGoodMorning = 'NEXT_GOOD_MORNING',
    NextPreNoon = 'NEXT_PRE_NOON',
    NextNoon = 'NEXT_NOON',
    // Non-standard events
    GuestReveilleFallback = 'GUEST_REVEILLE_FALLBACK',
    AnonymousSubmissionReveal = 'ANONYMOUS_SUBMISSION_REVEAL',
    AnonymousSubmissionVotingReminder = 'ANONYMOUS_SUBMISSION_VOTING_REMINDER',
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
    largeAwardsByRank: Record<string, number>,
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
    pointsEarned: number
}

export interface Combo {
    user: Snowflake,
    days: number
}

export type PrizeType = 'submissions1' | 'submissions2' | 'submissions3' | 'streak' | 'nightmare';

export interface PlayerState {
    displayName: string,
    points: number,
    activity?: string,
    multiplier?: number,
    deductions?: number,
    daysSinceLastGoodMorning?: number,
    combosBroken?: number
}

export enum DailyEventType {
    RecapSunday = 'RECAP_SUNDAY',
    MonkeyFriday = 'MONKEY_FRIDAY',
    BeginHomeStretch = 'BEGIN_HOME_STRETCH',
    Beckoning = 'BECKONING',
    GrumpyMorning = 'GRUMPY_MORNING',
    SleepyMorning = 'SLEEPY_MORNING',
    WritersBlock = 'WRITERS_BLOCK',
    Nightmare = 'NIGHTMARE',
    // Abnormal events (i.e. not the typical "wait-for-GM-then-say-GM" event)
    GuestReveille = 'GUEST_REVEILLE',
    ReverseGoodMorning = 'REVERSE_GOOD_MORNING',
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
    // Used specifically for the "anonymous submissions" event
    submissionType?: string,
    isAttachmentSubmission?: boolean,
    submissions?: Record<Snowflake, string>, // Map of UserId -> submission content/url
    submissionOwnersByCode?: Record<string, Snowflake>, // Map of submission code -> UserId
    votes?: Record<Snowflake, string[]>, // Map of UserId -> list of submission codes
    rootSubmissionMessage?: Snowflake, // MessageId
    forfeiters?: Snowflake[], // List of UserIds
    // Used specifically for the "grumpy morning" / "nightmare" events
    disabled?: boolean,
    // Used specifically for the "writer's block" event
    customMessage?: string,
    // Used specifically for the "begin home stretch" event
    homeStretchSurprises?: HomeStretchSurprise[]
}

export interface DungeonLocation {
    r: number,
    c: number
}
export interface DungeonPlayerState {
    r: number,
    c: number,
    avatarUrl: string,
    displayName: string,
    points: number,
    items?: {
        trap?: number,
        boulder?: number,
        seal?: number
    },
    finished?: boolean,
    knockedOut?: boolean,
    previousLocation?: DungeonLocation,
    originLocation?: DungeonLocation,
    warped?: boolean
}

export interface DungeonGameState {
    type: 'DUNGEON_GAME_STATE',
    decisions: Record<Snowflake, string[]>,
    turn: number,
    winners: Snowflake[],
    action: number,
    rows: number,
    columns: number
    map: number[][],
    goal: DungeonLocation,
    keyHoleCosts: Record<string, number>,
    trapOwners: Record<string, Snowflake>,
    players: Record<Snowflake, DungeonPlayerState>
}

export interface DummyGameState {
    type: 'DUMMY_GAME_STATE',
    decisions: Record<Snowflake, string>,
    turn: number,
    winners: Snowflake[]
}

export type GameState = DungeonGameState | DummyGameState;

export interface RawGoodMorningState {
    season: number,
    startedOn: FullDate,
    isMorning: boolean,
    isGracePeriod?: boolean,
    isHomeStretch?: boolean,
    goodMorningEmoji: string | string[],
    magicWord?: string,
    nerfThreshold?: number,
    currentLeader?: Snowflake,
    combo?: Combo,
    maxCombo?: Combo,
    mostRecentBaiter?: Snowflake,
    event?: DailyEvent,
    nextEvent?: DailyEvent,
    dailyStatus: Record<Snowflake, DailyPlayerState>,
    players: Record<Snowflake, PlayerState>,
    game?: GameState,
    acceptingGameDecisions?: boolean
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