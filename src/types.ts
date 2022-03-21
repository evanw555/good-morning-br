import { Snowflake } from "discord-api-types";

export enum TimeoutType{
    NextGoodMorning = 'NEXT_GOOD_MORNING',
    NextPreNoon = 'NEXT_PRE_NOON',
    NextNoon = 'NEXT_NOON',
    // Non-standard events
    GuestReveilleFallback = 'GUEST_REVEILLE_FALLBACK',
    AnonymousSubmissionReveal = 'ANONYMOUS_SUBMISSION_REVEAL',
    AnonymousSubmissionVotingReminder = 'ANONYMOUS_SUBMISSION_VOTING_REMINDER',
    HomeStretchSurprise = 'HOME_STRETCH_SURPRISE'
}

/**
 * How to handle a timeout which is registered for sometime in the past.
 */
export enum PastTimeoutStrategy {
    Delete = 'DELETE',
    Invoke = 'INVOKE',
    IncrementHour = 'INCREMENT_HOUR',
    IncrementDay = 'INCREMENT_DAY'
}

export interface Timeout {
    type: TimeoutType,
    date: string,
    pastStrategy: PastTimeoutStrategy
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
    seasonGoal: number,
    goodMorningMessageProbability: number,
    replyViaReactionProbability: number,
    goodMorningReplyCount: number,
    awardsByRank: Record<string, number>,
    largeAwardsByRank: Record<string, number>,
    defaultAward: number,
    minimumComboDays: number,
    goodMorningMessageOverrides: Record<CalendarDate, string>,
    defaultGoodMorningEmoji: string,
    goodMorningEmojiOverrides: Record<CalendarDate, string[]>,
    downvoteEmoji: string
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

export interface PlayerState {
    displayName: string,
    points: number,
    activity?: string,
    multiplier?: number,
    // TODO: remove this after season 2
    penalties?: number,
    deductions?: number,
    daysSinceLastGoodMorning?: number,
    combosBroken?: number
}

export enum DailyEventType {
    RecapSunday = 'RECAP_SUNDAY',
    MonkeyFriday = 'MONKEY_FRIDAY',
    BeginHomeStretch = 'BEGIN_HOME_STRETCH',
    OverriddenMessage = 'OVERRIDDEN_MESSAGE',
    Beckoning = 'BECKONING',
    GrumpyMorning = 'GRUMPY_MORNING',
    SleepyMorning = 'SLEEPY_MORNING',
    WritersBlock = 'WRITERS_BLOCK',
    // Abnormal events (i.e. not the typical "wait-for-GM-then-say-GM" event)
    GuestReveille = 'GUEST_REVEILLE',
    ReverseGoodMorning = 'REVERSE_GOOD_MORNING',
    AnonymousSubmissions = 'ANONYMOUS_SUBMISSIONS'
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
    submissionOwnersByNumber?: Record<string, Snowflake>, // Map of submission number -> UserId
    votes?: Record<Snowflake, string[]>, // Map of UserId -> list of submission IDs
    votingMessage?: Snowflake, // MessageId
    // Used specifically for the "grumpy morning" event
    disabled?: boolean,
    // Used specifically for the "writer's block" event
    customMessage?: string,
    // Used specifically for the "begin home stretch" event
    homeStretchSurprises?: HomeStretchSurprise[]
}

export interface RawGoodMorningState {
    season: number,
    goal: number,
    startedOn: FullDate,
    isMorning: boolean,
    isGracePeriod?: boolean,
    isHomeStretch?: boolean,
    goodMorningEmoji: string | string[],
    magicWord?: string,
    currentLeader?: Snowflake,
    combo?: Combo,
    maxCombo?: Combo,
    event?: DailyEvent,
    nextEvent?: DailyEvent,
    dailyStatus: Record<Snowflake, DailyPlayerState>,
    players: Record<Snowflake, PlayerState>
}

export interface Season {
    season: number,
    startedOn: FullDate
    finishedOn: FullDate,
    points: Record<Snowflake, number>,
    goal: number
}

export interface Medals {
    gold?: number,
    silver?: number,
    bronze?: number,
    skull?: number
}

export interface GoodMorningHistory {
    seasons: Season[],
    medals: Record<Snowflake, Medals>
}