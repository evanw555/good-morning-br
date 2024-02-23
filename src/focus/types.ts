import { Snowflake } from "discord.js";

export interface Popcorn {
    readonly type: 'POPCORN',
    readonly storySegments: string[],
    readonly scores: Record<Snowflake, number>,
    userId?: Snowflake,
    messageId?: Snowflake,
    ended?: true
}

export interface WordlePuzzle {
    readonly solution: string,
    readonly guesses: string[],
    readonly guessOwners: Snowflake[]
}

export interface Wordle {
    readonly type: 'WORDLE',
    readonly scores: Record<Snowflake, number>,
    blacklistedUserId?: Snowflake,
    puzzle?: WordlePuzzle
}

export interface WheelOfFortuneRound {
    readonly solution: string,
    readonly category: string,
    readonly blacklistedUserIds: Snowflake[],
    readonly roundScores: Record<Snowflake, number>,
    usedLetters: string,
    userId?: Snowflake,
    // The value of the user's spin (negative is bankrupt, 0 is lose turn, positive is a cash value)
    // If present, the user is expected to provide a consonant
    spinValue?: number,
    // If true, the user has indicated that they are going to solve the puzzle
    solving?: true,
    solo?: true,
    tossUp?: {
        guessCounts: Record<Snowflake, number>,
        revealedIndices: number[]
    }
}

export interface WheelOfFortune {
    readonly type: 'WHEEL_OF_FORTUNE',
    readonly scores: Record<Snowflake, number>,
    round?: WheelOfFortuneRound
}

export type FocusGameState = Popcorn | Wordle | WheelOfFortune;
