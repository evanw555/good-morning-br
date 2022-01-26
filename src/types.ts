import { Snowflake } from "discord-api-types";

export enum TimeoutType{
    NextGoodMorning = 'NEXT_GOOD_MORNING',
    NextNoon = 'NEXT_NOON'
}

export interface Timeout {
    type: TimeoutType,
    date: string
}

export interface GoodMorningConfig {
    goodMorningChannelId: Snowflake,
    seasonGoal: number,
    goodMorningMessageProbability: number,
    replyViaReactionProbability: number,
    goodMorningReplyCount: number,
    goodMorningMessageOverrides: Record<string, string>,
    defaultGoodMorningEmoji: string,
    goodMorningEmojiOverrides: Record<string, string[]>
}

export interface DailyPlayerState {
    rank?: number,
    videoRank?: number,
    hasSaidGoodMorning?: boolean,
    hasSentVideo?: boolean,
    penalized?: boolean,
    pointsEarned: number
}

export interface Combo {
    user: Snowflake,
    days: number
}

export interface PlayerState {
    displayName: string,
    points: number,
    penalties: number,
    daysSinceLastGoodMorning: number
}

export interface GoodMorningState {
    season: number,
    startedOn: string,
    isMorning: boolean,
    isGracePeriod: boolean,
    goodMorningEmoji: string | string[],
    currentLeader?: Snowflake,
    combo?: Combo
    dailyStatus: Record<Snowflake, DailyPlayerState>,
    players: Record<Snowflake, PlayerState>
}

export interface Season {
    season: number,
    startedOn: string
    finishedOn: string,
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