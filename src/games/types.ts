import { Snowflake } from "discord.js";

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

export interface AbstractGameState<T extends GameType> {
    readonly type: T,
    readonly season: number,
    readonly winners: Snowflake[],
    acceptingDecisions?: true,
    decisions: Record<Snowflake, string[]>,
    turn: number
}

export interface MazeGameState extends AbstractGameState<'MAZE'> {
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

export interface IslandGameState extends AbstractGameState<'ISLAND'> {
    numToBeEliminated: number,
    players: Record<Snowflake, IslandPlayerState>
}

export interface ArenaGameState extends AbstractGameState<'ARENA'> {
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

export interface MasterpieceGameState extends AbstractGameState<'MASTERPIECE'> {
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

export type Masterpiece2ItemType = 'sneaky-peek' | 'random-peek';
export type Masterpiece2AbilityType = 'sell' | 'buy' | 'force';
export type Masterpiece2AuctionType = 'bank' | 'private';

export interface Masterpiece2PlayerState {
    displayName: string,
    points: number,
    // Items persist throughout the entire season
    items?: Partial<Record<Masterpiece2ItemType, number>>,
    // Abilities are wiped at the beginning of every game decision phase
    abilities?: Partial<Record<Masterpiece2AbilityType, number>>,
    // 
}

export interface Masterpiece2PieceState {
    value: number,
    name: string,
    // Path of the BLOB containing this file's image
    imagePath: string,
    // User ID of whoever uploaded this piece
    artist: Snowflake,
    // Snowflake -> owner ID, false -> unsold, true -> sold
    owner: Snowflake | boolean,
    // If true, this piece will be sold during the next game update
    toBeSold?: true
}

export interface Masterpiece2AuctionState {
    pieceId: string,
    // Description of this auction, NOT the title of the piece
    description: string,
    type: Masterpiece2AuctionType,
    bid: number,
    bidder?: Snowflake,
    previousBidder?: Snowflake,
    active?: true
}

export interface Masterpiece2GameState extends AbstractGameState<'MASTERPIECE_2'> {
    readonly players: Record<Snowflake, Masterpiece2PlayerState>,
    readonly pieces: Record<string, Masterpiece2PieceState>,
    readonly auctions: Masterpiece2AuctionState[],
    // If true, all pieces should be sold off and revealed
    finalReveal?: true,
    // ID of the piece being offered in the "silent auction"
    silentAuctionPieceId?: string,
    // Data for the first week initial setup phase, wiped once complete
    setup?: {
        // First step: Uploading pieces (without assigned values)
        pieces: Omit<Masterpiece2PieceState, 'value'>,
        // Second step: Vote on randomly assigned pieces
        voting?: Record<Snowflake, {
            // IDs of the pieces this user may vote on
            pieceIds: string[],
            // IDs of their favorite, second-favorite, and least-favorite pieces (if populated, this user has voted)
            picks?: [string, string, string]
        }>
    }
}

export interface RiskPlayerState {
    displayName: string,
    points: number,
    newTroops?: number,
    color?: string,
    troopIcon?: string,
    maySelectCustomTroopIcon?: true,
    // If true, this player won the weekly contest prize (processed and deleted at each turn start)
    weeklyPrize?: true,
    // If true, this player has successfully captured at least one territory since the beginning of the last turn
    captureBonus?: true,
    // Represents the order in which this player was eliminated (e.g. 0 = eliminated first)
    eliminationIndex?: number,
    eliminator?: Snowflake,
    kills?: number,
    deaths?: number
}

export interface RiskTerritoryState {
    owner?: Snowflake,
    troops: number,
    // How many deaths have occurred at this territory regardless of owner
    deaths?: number
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
    defender?: RiskConflictAgentData,
    // The number of attackers at the time of conflict creation (this shouldn't change even if attackers are removed)
    readonly initialProngs: number
}

export interface RiskPlannedAttack {
    readonly id: string,
    readonly userId: Snowflake,
    readonly attack: RiskMovementData,
    actualQuantity: number
}

export interface RiskGameState extends AbstractGameState<'RISK'> {
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

export type CandyLandColor = 'R' | 'O' | 'Y' | 'G' | 'B' | 'P' | 'K' | 'W' | 'START' | 'END';


export interface CandyLandPlayerState {
    displayName: string,
    points: number,
    /**
     * Index of the space this player is occupying.
     */
    location: number
}

export interface CandyLandWeeklyCard {
    card: CandyLandColor,
    variant: number,
    log: string[],
    trade?: Snowflake
}

export interface CandyLandGameState extends AbstractGameState<'CANDYLAND'> {
    readonly players: Record<Snowflake, CandyLandPlayerState>,
    // Turn-specific info
    cards: Record<Snowflake, CandyLandWeeklyCard>,
    spaces: CandyLandColor[]
}

export interface ClassicGameState extends AbstractGameState<'CLASSIC'> {
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

export type GameType = 'CLASSIC' | 'MAZE' | 'ISLAND' | 'MASTERPIECE' | 'MASTERPIECE_2' | 'RISK' | 'CANDYLAND' | 'ARENA';

export type GameState = ClassicGameState | MazeGameState | IslandGameState | MasterpieceGameState | Masterpiece2GameState | RiskGameState | CandyLandGameState | ArenaGameState;
