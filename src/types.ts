import { Snowflake } from "discord-api-types";

export enum TimeoutType{
    NextGoodMorning = 'NEXT_GOOD_MORNING',
    NextPreNoon = 'NEXT_PRE_NOON',
    NextNoon = 'NEXT_NOON',
    // Non-standard events
    AnonymousSubmissionReveal = 'ANONYMOUS_SUBMISSION_REVEAL'
}

export interface Timeout {
    type: TimeoutType,
    date: string
}

export type CalendarDate = string

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
    penalties?: number,
    daysSinceLastGoodMorning?: number,
    combosBroken?: number
}

export enum DailyEventType {
    RecapSunday = 'RECAP_SUNDAY',
    MonkeyFriday = 'MONKEY_FRIDAY',
    OverriddenMessage = 'OVERRIDDEN_MESSAGE',
    Beckoning = 'BECKONING',
    GuestReveille = 'GUEST_REVEILLE',
    ReverseGoodMorning = 'REVERSE_GOOD_MORNING',
    GrumpyMorning = 'GRUMPY_MORNING',
    AnonymousSubmissions = 'ANONYMOUS_SUBMISSIONS'
}

export interface DailyEvent {
    type: DailyEventType,
    beckoning?: Snowflake,
    reveiller?: Snowflake,
    reverseGMRanks?: Record<Snowflake, number>,
    // Used specifically for the "anonymous submissions" event
    submissionType?: string,
    submissions?: Record<Snowflake, string>,
    anonymousMessagesByOwner?: Record<Snowflake, Snowflake>, // Map of UserId -> MessageId
    // Used specifically for the "grumpy morning" event
    disabled?: boolean
}

export interface RawGoodMorningState {
    season: number,
    goal: number,
    startedOn: CalendarDate,
    isMorning: boolean,
    isGracePeriod: boolean,
    goodMorningEmoji: string | string[],
    currentLeader?: Snowflake,
    combo?: Combo,
    event?: DailyEvent,
    nextEvent?: DailyEvent,
    dailyStatus: Record<Snowflake, DailyPlayerState>,
    players: Record<Snowflake, PlayerState>
}

export interface Season {
    season: number,
    startedOn: CalendarDate
    finishedOn: CalendarDate,
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