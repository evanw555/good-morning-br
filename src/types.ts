import { Snowflake } from "discord-api-types";

export enum TimeoutType{
    NextGoodMorning = 'NEXT_GOOD_MORNING',
    NextNoon = 'NEXT_NOON'
}

export interface Timeout {
    type: TimeoutType,
    date: string
}

export interface DailyStatus {
    rank?: number,
    penalized?: boolean
}

export interface GoodMorningState {
    channelId: string,
    season: number,
    isMorning: boolean,
    dailyStatus: Record<Snowflake, DailyStatus>,
    points: Record<Snowflake, number>
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