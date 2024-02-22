import { MessageCreateOptions, Snowflake } from "discord.js"
import { FocusGameState } from "./focus/types";
import { GameState } from "./games/types";

export enum TimeoutType {
    NextGoodMorning = 'NEXT_GOOD_MORNING',
    NextPreNoon = 'NEXT_PRE_NOON',
    BaitingStart = 'BAITING_START',
    NextNoon = 'NEXT_NOON',
    // Non-standard events
    GuestReveilleFallback = 'GUEST_REVEILLE_FALLBACK',
    FocusCustom = 'FOCUS_CUSTOM',
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
    ReplyToMessage = 'REPLY_TO_MESSAGE',
    RobertismShiftFallback = 'ROBERTISM_SHIFT_FALLBACK'
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
    readonly robertism?: {
        readonly role: Snowflake,
        readonly honoraryRole: Snowflake,
        readonly channel: Snowflake
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
    // Abnormal events (i.e. not the typical "wait-for-GM-then-say-GM" event)
    HighFocus = 'HIGH_FOCUS',
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
    // Used specifically for high-focus game events
    focusGame?: FocusGameState,
    // Used specifically for the "popcorn" event
    messageId?: Snowflake,
    storySegments?: string[]
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
    gameType?: string,
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
    sungazers: Record<Snowflake, number>,
    robertism?: {
        // UserId of the current "Honorary Robert"
        currentUser?: Snowflake,
        // UserId of the next HR after the current one's time has passed
        nextUser?: Snowflake
    }
}

export interface SubmissionPromptHistory {
    used: string[],
    unused: string[]
}