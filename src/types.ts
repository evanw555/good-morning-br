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
    goodMorningMessageOverrides: Record<string, string>
}

export interface DailyStatus {
    rank?: number,
    videoRank?: number,
    hasSaidGoodMorning?: boolean,
    hasSentVideo?: boolean,
    penalized?: boolean
}

export interface Combo {
    user: Snowflake,
    days: number
}

export interface GoodMorningState {
    season: number,
    isMorning: boolean,
    currentLeader?: Snowflake,
    combo?: Combo
    dailyStatus: Record<Snowflake, DailyStatus>,
    points: Record<Snowflake, number>,
    daysSinceLastGoodMorning: Record<Snowflake, number>
}

export interface Season {
    season: number,
    finishedAt: string,
    points: Record<Snowflake, number>
}

export interface GoodMorningHistory {
    seasons: Season[],
    dinners: Record<Snowflake, number>
}