import { APIActionRowComponent, APIMessageActionRowComponent, APISelectMenuOption, ActionRowData, AttachmentBuilder, ButtonStyle, ComponentType, GuildMember, Interaction, InteractionReplyOptions, MessageActionRowComponentData, MessageFlags, Snowflake } from "discord.js";
import { DecisionProcessingResult, MessengerPayload, PrizeType, RiskConflictState, RiskGameState, RiskMovementData, RiskPlayerState, RiskTerritoryState } from "../types";
import AbstractGame from "./abstract-game";
import { Canvas, createCanvas } from "canvas";
import { DiscordTimestampFormat, chance, getDateBetween, getJoinedMentions, joinCanvasesVertically, naturalJoin, randChoice, randInt, shuffleWithDependencies, toCircle, toDiscordTimestamp, toFixed } from "evanw555.js";

import logger from "../logger";
import imageLoader from "../image-loader";
import { getMinKey, getMaxKey, drawTextCentered } from "../util";

interface Coordinates {
    x: number,
    y: number
}

interface RiskConfig {
    map: {
        dimensions: {
            width: number,
            height: number
        }
    },
    conflict: {
        dimensions: {
            width: number,
            height: number
        }
    },
    territories: Record<string, {
        name: string,
        center: Coordinates,
        troopBounds: Coordinates[],
        connections: string[],
        termini: Record<string, Coordinates>
    }>
}

export default class RiskGame extends AbstractGame<RiskGameState> {
    private static config: RiskConfig = {
        map: {
            dimensions: {
                width: 762,
                height: 718
            }
        },
        conflict: {
            dimensions: {
                width: 600,
                height: 400
            }
        },
        territories: {
            A: {
                name: 'Fairview',
                center: { x: 313, y: 50 },
                troopBounds: [
                    { x: 171, y: 7 },
                    { x: 455, y: 7 },
                    { x: 221, y: 98 },
                    { x: 362, y: 122 },
                ],
                connections: ['B', 'D', 'E'],
                termini: {
                    B: { x: 417, y: 55 },
                    D: { x: 232, y: 99 },
                    E: { x: 360, y: 119 }
                }
            },
            B: {
                name: 'Santa Ana Heights',
                center: { x: 473, y: 106 },
                troopBounds: [
                    { x: 487, y: 9 },
                    { x: 618, y: 25 },
                    { x: 394, y: 119 },
                    { x: 486, y: 195 }
                ],
                connections: ['A', 'C', 'E', 'F'],
                termini: {
                    A: { x: 439, y: 71 },
                    C: { x: 516, y: 107 },
                    E: { x: 464, y: 165 },
                    F: { x: 488, y: 187 }
                }
            },
            C: {
                name: 'John Wayne',
                center: { x: 612, y: 104 },
                troopBounds: [
                    { x: 641, y: 11 },
                    { x: 755, y: 9 },
                    { x: 558, y: 136 },
                    { x: 756, y: 105 }
                ],
                connections: ['B', 'H'],
                termini: {
                    B: { x: 547, y: 104 },
                    H: { x: 706, y : 106 }
                }
            },
            D: {
                name: 'West Side Costa Mesa',
                center: { x: 222, y: 219 },
                troopBounds: [
                    { x: 176, y: 126 },
                    { x: 348, y: 142 },
                    { x: 130, y: 220 },
                    { x: 231, y: 327 }
                ],
                connections: ['A', 'E', 'I'],
                termini: {
                    A: { x: 231, y: 106 },
                    E: { x: 306, y: 191 },
                    I: { x: 226, y: 336 }
                }
            },
            E: {
                name: 'East Side Costa Mesa',
                center: { x: 380, y: 232 },
                troopBounds: [
                    { x: 383, y: 134 },
                    { x: 471, y: 206 },
                    { x: 298, y: 250 },
                    { x: 381, y: 318 }
                ],
                connections: ['A', 'B', 'D', 'F', 'I'],
                termini: {
                    A: { x: 382, y: 140 },
                    B: { x: 447, y: 186 },
                    D: { x: 332, y: 210 },
                    F: { x: 399, y: 280 },
                    I: { x: 348, y: 280 }
                }
            },
            F: {
                name: 'Dover',
                center: { x: 468, y: 304 },
                troopBounds: [
                    { x: 500, y: 212 },
                    { x: 515, y: 289 },
                    { x: 396, y: 329 },
                    { x: 467, y: 371 }
                ],
                connections: ['B', 'E', 'I', 'J'],
                termini: {
                    B: { x: 497, y: 216 },
                    E: { x: 427, y: 300 },
                    I: { x: 406, y: 329 },
                    J: { x: 461, y: 364 }
                }
            },
            G: {
                name: 'Eastbluff',
                center: { x: 606, y: 230 },
                troopBounds: [
                    { x: 581, y: 166 },
                    { x: 667, y: 180 },
                    { x: 538, y: 267 },
                    { x: 610, y: 319 }
                ],
                connections: ['H', 'L', 'N'],
                termini: {
                    H: { x: 658, y: 189 },
                    L: { x: 580, y: 295 },
                    N: { x: 614, y: 300 }
                }
            },
            H: {
                name: 'UCI',
                center: { x: 718, y: 232 },
                troopBounds: [
                    { x: 700, y: 141 },
                    { x: 757, y: 137 },
                    { x: 667, y: 283 },
                    { x: 751, y: 310 }
                ],
                connections: ['C', 'G', 'N'],
                termini: {
                    C: { x: 712, y: 141 },
                    G: { x: 695, y: 178 },
                    N: { x: 729, y: 299 }
                }
            },
            I: {
                name: 'Newport Heights',
                center: { x: 307, y: 354 },
                troopBounds: [
                    { x: 290, y: 269 },
                    { x: 395, y: 351 },
                    { x: 216, y: 387 },
                    { x: 362, y: 420 }
                ],
                connections: ['D', 'E', 'F', 'J', 'T', 'U'],
                termini: {
                    D: { x: 224, y: 369 },
                    E: { x: 328, y: 308 },
                    F: { x: 383, y: 351 },
                    J: { x: 370, y: 379 },
                    T: { x: 194, y: 383 },
                    U: { x: 225, y: 387 }
                }
            },
            J: {
                name: 'Castaways',
                center: { x: 411, y: 379 },
                troopBounds: [
                    { x: 409, y: 361 },
                    { x: 448, y: 382 },
                    { x: 355, y: 452 },
                    { x: 384, y: 446 }
                ],
                connections: ['F', 'I', 'K'],
                termini: {
                    F: { x: 430, y: 378 },
                    I: { x: 397, y: 404 },
                    K: { x: 389, y: 434 }
                }
            },
            K: {
                name: 'The Dunes',
                center: { x: 467, y: 429 },
                troopBounds: [
                    { x: 531, y: 390 },
                    { x: 557, y: 409 },
                    { x: 555, y: 452 },
                    { x: 432, y: 435 }
                ],
                connections: ['J', 'L', 'M', 'O'],
                termini: {
                    J: { x: 438, y: 430 },
                    L: { x: 532, y: 402 },
                    M: { x: 548, y: 425 },
                    O: { x: 532, y: 445 }
                }
            },
            L: {
                name: 'Park Newport',
                center: { x: 586, y: 345 },
                troopBounds: [
                    { x: 561, y: 314 },
                    { x: 607, y: 338 },
                    { x: 544, y: 379 },
                    { x: 605, y: 385 }
                ],
                connections: ['G', 'K', 'M', 'N'],
                termini: {
                    G: { x: 575, y: 325 },
                    K: { x: 555, y: 382 },
                    M: { x: 593, y: 373 },
                    N: { x: 596, y: 372 }
                }
            },
            M: {
                name: 'Fashion Island',
                center: { x: 633, y: 470 },
                troopBounds: [
                    { x: 619, y: 388 },
                    { x: 688, y: 469 },
                    { x: 568, y: 438 },
                    { x: 638, y: 535 }
                ],
                connections: ['K', 'L', 'N', 'O', 'P'],
                termini: {
                    K: { x: 576, y: 431 },
                    L: { x: 616, y: 401 },
                    N: { x: 650, y: 437 },
                    O: { x: 591, y: 471 },
                    P: { x: 639, y: 525 }
                }
            },
            N: {
                name: 'Bonita Canyon',
                center: { x: 711, y: 391 },
                troopBounds: [
                    { x: 651, y: 293 },
                    { x: 754, y: 347 },
                    { x: 622, y: 367 },
                    { x: 752, y: 508 }
                ],
                connections: ['G', 'H', 'L', 'M'],
                termini: {
                    G: { x: 647, y: 317 },
                    H: { x: 731, y: 339 },
                    L: { x: 630, y: 356 },
                    M: { x: 676, y: 412 }
                }
            },
            O: {
                name: 'Promontory',
                center: { x: 550, y: 486 },
                troopBounds: [
                    { x: 447, y: 448 },
                    { x: 550, y: 465 },
                    { x: 448, y: 490 },
                    { x: 588, y: 500 }
                ],
                connections: ['K', 'M', 'P', 'R'],
                termini: {
                    K: { x: 533, y: 472 },
                    M: { x: 573, y: 490 },
                    P: { x: 560, y: 507 },
                    R: { x: 519, y: 484 }
                }
            },
            P: {
                name: 'Corona del Mar',
                center: { x: 654, y: 609 },
                troopBounds: [
                    { x: 570, y: 527 },
                    { x: 693, y: 561 },
                    { x: 617, y: 640 },
                    { x: 673, y: 661 }
                ],
                connections: ['M', 'O'],
                termini: {
                    M: { x: 653, y: 557 },
                    O: { x: 577, y: 534 }
                }
            },
            Q: {
                name: 'Lido Isle',
                center: { x: 306, y: 470 },
                troopBounds: [
                    { x: 273, y: 441 },
                    { x: 370, y: 496 },
                    { x: 289, y: 475 }
                ],
                connections: ['U'],
                termini: {
                    U: { x: 287, y: 455 }
                }
            },
            R: {
                name: 'Balboa Island',
                center: { x: 493, y: 526 },
                troopBounds: [
                    { x: 453, y: 513 },
                    { x: 533, y: 515 },
                    { x: 465, y: 537 },
                    { x: 543, y: 539 }
                ],
                connections: ['O', 'W'],
                termini: {
                    O: { x: 514, y: 517 },
                    W: { x: 468, y: 530 }
                }
            },
            S: {
                name: 'Newport Shores',
                center: { x: 66, y: 337 },
                troopBounds: [
                    { x: 31, y: 313 },
                    { x: 82, y: 307 },
                    { x: 32, y: 339 },
                    { x: 92, y: 366 }
                ],
                connections: ['T'],
                termini: {
                    T: { x: 85, y: 354 }
                }
            },
            T: {
                name: '40th Street',
                center: { x: 144, y: 380 },
                troopBounds: [
                    { x: 105, y: 362 },
                    { x: 170, y: 379 },
                    { x: 187, y: 445 },
                    { x: 208, y: 436 }
                ],
                connections: ['I', 'S', 'U'],
                termini: {
                    I: { x: 160, y: 382 },
                    S: { x: 112, y: 366 },
                    U: { x: 188, y: 434 }
                }
            },
            U: {
                name: 'The Golden Mile',
                center: { x: 221, y: 460 },
                troopBounds: [
                    { x: 194, y: 454 },
                    { x: 225, y: 415 },
                    { x: 240, y: 517 },
                    { x: 265, y: 480 }
                ],
                connections: ['I', 'Q', 'T', 'V'],
                termini: {
                    I: { x: 225, y: 422 },
                    Q: { x: 239, y: 436 },
                    T: { x: 203, y: 457 },
                    V: { x: 237, y: 507 }
                }
            },
            V: {
                name: 'Mid-Peninsula',
                center: { x: 310, y: 530 },
                troopBounds: [
                    { x: 259, y: 507 },
                    { x: 370, y: 538 },
                    { x: 251, y: 525 },
                    { x: 364, y: 554 }
                ],
                connections: ['U', 'W'],
                termini: {
                    U: { x: 263, y: 518 },
                    W: { x: 357, y: 542 }
                }
            },
            W: {
                name: 'The Fun Zone',
                center: { x: 411, y: 553 },
                troopBounds: [
                    { x: 398, y: 534 },
                    { x: 463, y: 569 },
                    { x: 376, y: 556 },
                    { x: 457, y: 585 }
                ],
                connections: ['R', 'V', 'X', 'Y'],
                termini: {
                    R: { x: 432, y: 558 },
                    V: { x: 387, y: 550 },
                    Y: { x: 433, y: 570 },
                    X: { x: 451, y: 574 }
                }
            },
            X: {
                name: 'The Wedge',
                center: { x: 547, y: 607 },
                troopBounds: [
                    { x: 470, y: 583 },
                    { x: 544, y: 588 },
                    { x: 578, y: 635 },
                ],
                connections: ['W'],
                termini: {
                    W: { x: 478, y: 587 }
                }
            },
            Y: {
                name: 'Catalina Island',
                center: { x: 122, y: 661 },
                troopBounds: [
                    { x: 88, y: 619 },
                    { x: 141, y: 640 },
                    { x: 101, y: 686 },
                    { x: 177, y: 700 }
                ],
                connections: ['W'],
                termini: {
                    W: { x: 164, y: 686 }
                }
            }
        }
    };

    private pendingAttackDecisions: Record<Snowflake, Partial<RiskMovementData>>;
    private pendingMoveDecisions: Record<Snowflake, Partial<RiskMovementData>>;

    constructor(state: RiskGameState) {
        super(state);
        this.pendingAttackDecisions = {};
        this.pendingMoveDecisions = {};
    }

    static create(members: GuildMember[], season: number): RiskGame {
        // Construct the players map
        const players: Record<Snowflake, RiskPlayerState> = {};
        for (const member of members) {
            players[member.id] = {
                displayName: member.displayName,
                points: 0,
                color: `hsl(${randInt(0, 360)}, 40%, 60%)`
            };
        }
        // Construct the territories map
        const territories: Record<string, RiskTerritoryState> = {};
        for (const territoryId of Object.keys(RiskGame.config.territories)) {
            territories[territoryId] = {
                troops: 1
            };
        }
        // Return the constructed state
        return new RiskGame({
            type: 'RISK_GAME_STATE',
            season,
            winners: [],
            decisions: {},
            turn: 0,
            players,
            territories
        });
    }

    override async getIntroductionMessages(): Promise<MessengerPayload[]> {
        return [
            // 'Gather the troops and get ready to claim some territory! For a grand war is about to break out...',
            // {
            //     content: 'I hope you all are prepared for a bloody game of _Morningtime Risk_ right here in our very own stomping ground!',
            //     files: [await this.renderRules()]
            // }
            // TODO: Show rules are type more
        ];
    }

    override getInstructionsText(): string {
        // If draft data is present, let players know who's drafting when
        if (this.state.draft) {
            // TODO: Determine draft order
            return 'Later this morning, you will all be vying for a starting location on the map! Your draft order is determined by your weekly points:\n'
                + this.getSortedDraftEntries().map(entry => `- **${this.getPlayerDisplayName(entry.userId)}** ${toDiscordTimestamp(entry.date, DiscordTimestampFormat.ShortTime)}`).join('\n');
        }
        return 'Place your troops, attack your opponents, and fortify your defenses!';
    }

    override getDecisionPhases(): { key: string; millis: number; }[] {
        // If draft data is present, create decision phases using them
        if (this.getTurn() === 1) {
            return this.getSortedDraftEntries().map(entry => ({
                key: `draft:${entry.userId}`,
                millis: entry.date.getTime() - new Date().getTime()
            }));
        }
        return [];
    }

    private getSortedDraftEntries(): { userId: Snowflake, date: Date }[] {
        if (!this.state.draft) {
            return [];
        }
        const draft = this.state.draft;
        return Object.keys(draft)
            .sort((x, y) => draft[x].timestamp - draft[y].timestamp)
            .map(userId => ({
                userId,
                date: new Date(draft[userId].timestamp)
            }));
    }

    private getAvailableDraftPlayers(): Snowflake[] {
        const draft = this.state.draft;
        if (!draft) {
            return [];
        }
        return Object.keys(draft).filter(userId => draft[userId].available);
    }

    override async onDecisionPhase(key: string): Promise<MessengerPayload[]> {
        const [ root, arg ] = key.split(':');
        const draft = this.state.draft;
        if (root === 'draft' && arg && draft) {
            const userId = arg as Snowflake;
            // Mark the player as "available" for drafting
            draft[userId].available = true;
            // Reply with a button that the player can use to pick a location
            const otherAvailableUserIds = this.getAvailableDraftPlayers().filter(otherId => otherId !== userId);
            let content = `<@${userId}>, it's your turn to pick a starting location!`;
            if (otherAvailableUserIds.length > 0) {
                content += ` (${this.getJoinedDisplayNames(otherAvailableUserIds)} too)`;
            }
            return [{
                content,
                components: [{
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.Button,
                        style: ButtonStyle.Primary,
                        label: 'Pick Location',
                        customId: 'game:pickStartingLocation'
                    }]
                }]
            }];
        }
        return [`Oopsie, couldn\'t process decision phase \`${key}\``];
    }

    private getTerritories(): string[] {
        return Object.keys(this.state.territories);
    }

    private getTerritoryConnections(territoryId: string): string[] {
        return RiskGame.config.territories[territoryId]?.connections ?? [];
    }

    private getNumTerritoryConnections(territoryId: string): number {
        return this.getTerritoryConnections(territoryId).length;
    }

    /**
     * Gets a list of territory IDs with no owner.
     */
    private getOwnerlessTerritories(): string[] {
        return this.getTerritories().filter(territoryId => !this.getTerritoryOwner(territoryId));
    }

    /**
     * Gets a list of territory IDs owned by this player.
     */
    private getTerritoriesForPlayer(userId: Snowflake): string[] {
        return this.getTerritories().filter(territoryId => this.getTerritoryOwner(territoryId) === userId);
    }

    /**
     * Gets the total number of territories owned by a particular player.
     */
    private getNumTerritoriesForPlayer(userId: Snowflake): number {
        return this.getTerritoriesForPlayer(userId).length;
    }

    private getValidMovementSourceTerritoriesForPlayer(userId: Snowflake): string[] {
        // Get territories owned by this player...
        return this.getTerritoriesForPlayer(userId)
            // That have adjacent territories owned by this player
            .filter(territoryId => this.getTerritoryConnections(territoryId).some(otherId => this.getTerritoryOwner(otherId) === userId))
            // That have at least 2 troops (including ones to be added)
            .filter(territoryId => this.getPromisedTerritoryTroops(territoryId) >= 2);
    }

    private getValidAttackSourceTerritoriesForPlayer(userId: Snowflake): string[] {
        // Get territories owned by this player...
        return this.getTerritoriesForPlayer(userId)
            // That have adjacent territories owned by another player
            .filter(territoryId => this.getTerritoryConnections(territoryId).some(otherId => this.getTerritoryOwner(otherId) !== userId))
            // That have at least 2 troops (including ones to be added)
            .filter(territoryId => this.getPromisedTerritoryTroops(territoryId) >= 2);
    }

    /**
     * Gets the user ID of the player who owns this territory, or undefined if no one owns it (or if it doesn't exist).
     */
    private getTerritoryOwner(territoryId: string): Snowflake | undefined {
        return this.state.territories[territoryId]?.owner;
    }

    /**
     * Gets the number of troops in a particular territory (or 0 if it doesn't exist).
     */
    private getTerritoryTroops(territoryId: string): number {
        return this.state.territories[territoryId]?.troops ?? 0;
    }

    /**
     * Gets the number of troops that are presently scheduled to be added to some territory by any player.
     */
    private getTerritoryTroopsToBeAdded(territoryId: string): number {
        const addDecisions = this.state.addDecisions;
        if (!addDecisions) {
            return 0;
        }
        let count = 0;
        for (const territoryIds of Object.values(addDecisions)) {
            count += territoryIds.filter(id => id === territoryId).length;
        }
        return count;
    }

    /**
     * Gets the number of actual troops in a territory plus all the troops scheduled to be added to it.
     */
    private getPromisedTerritoryTroops(territoryId: string): number {
        return this.getTerritoryTroops(territoryId) + this.getTerritoryTroopsToBeAdded(territoryId);
    }

    private addTerritoryTroops(territoryId: string, quantity: number) {
        this.state.territories[territoryId].troops = this.getTerritoryTroops(territoryId) + quantity;
    }

    private setTerritoryTroops(territoryId: string, quantity: number) {
        this.state.territories[territoryId].troops = quantity;
    }

    private getTerritoryName(territoryId: string): string {
        return RiskGame.config.territories[territoryId]?.name ?? '???';
    }

    /**
     * For a given player, gets the total number of troops on the board in territories they own.
     */
    private getTroopsForPlayer(userId: Snowflake): number {
        return this.getTerritoriesForPlayer(userId)
            .map(territoryId => this.getTerritoryTroops(territoryId))
            .reduce((a, b) => a + b, 0);
    }

    private getPlayerDisplayName(userId: Snowflake | undefined): string {
        if (!userId) {
            return '???';
        }
        return this.state.players[userId]?.displayName ?? `<@${userId}>`;
    }

    private getPlayerNewTroops(userId: Snowflake): number {
        return this.state.players[userId]?.newTroops ?? 0;
    }

    private addPlayerNewTroops(userId: Snowflake, quantity: number) {
        this.state.players[userId].newTroops = this.getPlayerNewTroops(userId) + quantity;
    }

    private getJoinedDisplayNames(userIds: Snowflake[]): string {
        return naturalJoin(userIds.map(userId => this.getPlayerDisplayName(userId)), { bold: true });
    }

    /**
     * Gets the player's color, or gray if it hasn't been picked yet (or if the player doesn't exist).
     */
    private getPlayerColor(userId: Snowflake): string {
        return this.state.players[userId]?.color ?? 'gray';
    }

    /**
     * Gets the color of a territory's owner, or gray if it doesn't have an owner (or if it hasn't been picked yet, or if the player doesn't exist).
     */
    private getTerritoryColor(territoryId: string): string {
        // TODO: This is sorta hacky, should we change this?
        return this.getPlayerColor(this.getTerritoryOwner(territoryId) ?? '');
    }

    private isPlayerEliminated(userId: Snowflake): boolean {
        // Player is considered "eliminated" if they have a final rank assigned to them
        return this.state.players[userId]?.finalRank !== undefined;
    }

    private getNumEliminatedPlayers(): number {
        return this.getPlayers().filter(userId => this.isPlayerEliminated(userId)).length;
    }

    override async onDecisionPreNoon(): Promise<MessengerPayload[]> {
        // If there's an active draft, send a special message if anyone still needs to select a starting location
        if (this.state.draft) {
            const remainingAvailableUserIds = this.getAvailableDraftPlayers();
            if (remainingAvailableUserIds.length > 0) {
                return [{
                    content: `${getJoinedMentions(remainingAvailableUserIds)}, you still need to pick a starting location! If you don't choose by tomorrow morning, I'll have to choose for you`,
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.Button,
                            style: ButtonStyle.Primary,
                            label: 'Pick Location',
                            customId: 'game:pickStartingLocation'
                        }]
                    }]
                }];
            }
        }
        return super.onDecisionPreNoon();
    }

    getSeasonCompletion(): number {
        // Season completion is determined as percent of players eliminated
        return this.getNumEliminatedPlayers() / this.getNumPlayers();
    }

    getPlayers(): string[] {
        return Object.keys(this.state.players);
    }

    getOrderedPlayers(): string[] {
        // Order is determined by (1) number of territories owned, then (2) number of troops owned.
        const getSortValue = (userId) => {
            return 100 * this.getNumTerritoriesForPlayer(userId) + this.getTroopsForPlayer(userId);
        };
        return this.getPlayers().sort((x, y) => getSortValue(y) - getSortValue(x));
    }

    /**
     * Gets a list of all player IDs sorted by descending weekly points.
     */
    private getPointOrderedPlayers(): Snowflake[] {
        return this.getPlayers().sort((x, y) => this.getPoints(y) - this.getPoints(x));
    }

    hasPlayer(userId: string): boolean {
        return userId in this.state.players;
    }

    addPlayer(member: GuildMember): string {
        // TODO: If it's the first turn still (second week), allow them to join at a random spot
        // Late players get a terrible dummy rank that's necessarily larger than all other ranks
        const finalRank = this.getNumPlayers() + 1;
        this.state.players[member.id] = {
            displayName: member.displayName,
            points: 0,
            finalRank
        };
        return `Added **${member.displayName}** at final rank **${finalRank}**`;
    }

    updatePlayer(member: GuildMember): void {
        if (this.hasPlayer(member.id)) {
            this.state.players[member.id].displayName = member.displayName;
        }
    }

    removePlayer(userId: string): void {
        delete this.state.players[userId];
        delete this.state.decisions[userId];

        // Remove ownership from all owned territories
        // TODO: Should we somehow give ownership to an NPC player?
        for (const territoryId of this.getTerritoriesForPlayer(userId)) {
            delete this.state.territories[territoryId].owner;
        }
    }

    override addNPCs(): void {
        // Add 10 NPCs
        const userIds: string[] = [];
        for (let i = 0; i < 10; i++) {
            const userId = `npc${i}`;
            userIds.push(userId);
            this.state.players[userId] = {
                displayName: `NPC ${i}`,
                points: 0,
                color: `hsl(${Math.floor(i * 35)}, 30%, 60%)`
            };
            // Give them one territory
            const potentialTerritories = this.getOwnerlessTerritories();
            if (potentialTerritories.length > 0) {
                const randomTerritoryId = randChoice(...potentialTerritories);
                this.state.territories[randomTerritoryId].owner = userId;
            }
        }
        // For each remaining territory, give it to one random NPC
        const remainingTerritories = this.getOwnerlessTerritories();
        for (const territoryId of remainingTerritories) {
            this.state.territories[territoryId].owner = randChoice(...userIds);
        }
    }

    private async renderRules(): Promise<AttachmentBuilder> {
        // TODO: Create real rules sheet
        return new AttachmentBuilder('assets/risk/map-with-background.png');
    }

    private async renderConflict(conflict: RiskConflictState, options: { attackerRolls: number[], defenderRolls: number[], attackersLost: number, defendersLost: number }): Promise<AttachmentBuilder> {
        const { from, to } = conflict;
        const conflictId = [from, to].sort().join('');
        const conflictImage = await imageLoader.loadImage(`assets/risk/connections/${conflictId}.png`);

        const WIDTH = RiskGame.config.conflict.dimensions.width;
        const HEIGHT = RiskGame.config.conflict.dimensions.height;
        const canvas = createCanvas(WIDTH, HEIGHT);
        const context = canvas.getContext('2d');

        // Draw the conflict background
        context.drawImage(conflictImage, 0, 0, WIDTH, HEIGHT);

        // Draw the attacker avatar
        if (conflict.attackerId) {
            const AVATAR_WIDTH = HEIGHT / 8;
            const x = HEIGHT * (1 / 12);
            const y = HEIGHT * (1 / 12);
            const attackerAvatarImage = toCircle(await imageLoader.loadAvatar(conflict.attackerId, 128));
            context.drawImage(attackerAvatarImage, x - AVATAR_WIDTH / 2, y - AVATAR_WIDTH / 2, AVATAR_WIDTH, AVATAR_WIDTH);
        }

        // Draw the defender avatar
        if (conflict.defenderId) {
            const AVATAR_WIDTH = HEIGHT / 8;
            const x = WIDTH - HEIGHT * (1 / 12);
            const y = HEIGHT * (1 / 12);
            const defenderAvatarImage = toCircle(await imageLoader.loadAvatar(conflict.defenderId, 128));
            context.drawImage(defenderAvatarImage, x - AVATAR_WIDTH / 2, y - AVATAR_WIDTH / 2, AVATAR_WIDTH, AVATAR_WIDTH);
        }

        // Draw the attacker troops
        const troopImage = await imageLoader.loadImage('assets/risk/troops/1.png');
        const crossOutImage = await imageLoader.loadImage('assets/common/crossout.png');
        for (let i = 0; i < conflict.initialAttackerTroops; i++) {
            const TROOP_WIDTH = HEIGHT / 8;
            const frontLine = i < 3;
            const x = WIDTH * ((frontLine ? 2 : 1) / 8);
            const y = HEIGHT * ((frontLine ? i : i - 3) + 2) / ((frontLine ? 3 : conflict.initialAttackerTroops - 3) + 3);
            const defeated = i >= conflict.attackerTroops;
            const newlyDefeated = defeated && i - conflict.attackerTroops < options.attackersLost;
            const previouslyDefeated = defeated && !newlyDefeated;
            context.globalAlpha = previouslyDefeated ? 0.25 : 1;
            context.drawImage(troopImage, x - TROOP_WIDTH / 2, y - TROOP_WIDTH / 2, TROOP_WIDTH, TROOP_WIDTH);
            if (newlyDefeated) {
                context.drawImage(crossOutImage, x - TROOP_WIDTH / 2, y - TROOP_WIDTH / 2, TROOP_WIDTH, TROOP_WIDTH);
            }
            context.globalAlpha = 1;
        }

        // Draw the attacker dice rolls
        for (let i = 0; i < options.attackerRolls.length; i++) {
            const DIE_WIDTH = HEIGHT / 8;
            const x = WIDTH * (3 / 8);
            const y = HEIGHT * ((2 + i) / 6);
            const roll = options.attackerRolls[i];
            const dieImage = await imageLoader.loadImage(`assets/common/dice/r${roll}.png`);
            context.drawImage(dieImage, x - DIE_WIDTH / 2, y - DIE_WIDTH / 2, DIE_WIDTH, DIE_WIDTH);
        }

        // Draw the arrows in the center depending on the results
        const numRolls = Math.min(options.attackerRolls.length, options.defenderRolls.length);
        for (let i = 0; i < numRolls; i++) {
            const ARROW_WIDTH = HEIGHT / 6;
            const ARROW_HEIGHT = HEIGHT / 8;
            const x = WIDTH * (4 / 8);
            const y = HEIGHT * ((2 + i) / 6);
            if (options.attackerRolls[i] > options.defenderRolls[i]) {
                const attackerArrowImage = await imageLoader.loadImage('assets/risk/attacker-arrow.png');
                context.drawImage(attackerArrowImage, x - ARROW_WIDTH / 2, y - ARROW_HEIGHT / 2, ARROW_WIDTH, ARROW_HEIGHT);
            } else {
                const defenderArrowImage = await imageLoader.loadImage('assets/risk/defender-arrow.png');
                context.drawImage(defenderArrowImage, x - ARROW_WIDTH / 2, y - ARROW_HEIGHT / 2, ARROW_WIDTH, ARROW_HEIGHT);
            }
        }

        // Draw the defender dice rolls
        for (let i = 0; i < options.defenderRolls.length; i++) {
            const DIE_WIDTH = HEIGHT / 8;
            const x = WIDTH * (5 / 8);
            const y = HEIGHT * ((2 + i) / 6);
            const roll = options.defenderRolls[i];
            const dieImage = await imageLoader.loadImage(`assets/common/dice/w${roll}.png`);
            context.drawImage(dieImage, x - DIE_WIDTH / 2, y - DIE_WIDTH / 2, DIE_WIDTH, DIE_WIDTH);
        }

        // Draw the defender troops
        for (let i = 0; i < conflict.initialDefenderTroops; i++) {
            const TROOP_WIDTH = HEIGHT / 8;
            const frontLine = i < 3;
            const x = WIDTH * ((frontLine ? 6 : 7) / 8);
            const y = HEIGHT * ((frontLine ? i : i - 3) + 2) / ((frontLine ? 3 : conflict.initialDefenderTroops - 3) + 3);
            const defeated = i >= conflict.defenderTroops;
            const newlyDefeated = defeated && i - conflict.defenderTroops < options.defendersLost;
            const previouslyDefeated = defeated && !newlyDefeated;
            context.globalAlpha = previouslyDefeated ? 0.25 : 1;
            context.drawImage(troopImage, x - TROOP_WIDTH / 2, y - TROOP_WIDTH / 2, TROOP_WIDTH, TROOP_WIDTH);
            if (newlyDefeated) {
                context.drawImage(crossOutImage, x - TROOP_WIDTH / 2, y - TROOP_WIDTH / 2, TROOP_WIDTH, TROOP_WIDTH);
            }
            context.globalAlpha = 1;
        }

        // Draw the title
        context.font = `italic bold ${HEIGHT / 12}px serif`;
        context.fillStyle = 'white';
        drawTextCentered(context, `Battle for ${this.getTerritoryName(conflict.to)}`, WIDTH * (3 / 16), WIDTH * (13 / 16), HEIGHT / 6);

        return new AttachmentBuilder(canvas.toBuffer()).setName(`risk-conflict-${conflictId}.png`);
    }

    private getDistanceBetween(a: Coordinates, b: Coordinates): number {
        return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
    }

    private getRandomTerritoryTroopLocations(territoryId: string, n: number): Coordinates[] {
        const center = RiskGame.config.territories[territoryId].center;
        // const corners = RiskGame.config.territories[territoryId].troopBounds;
        const result: Coordinates[] = [];
        const getMinDistance = (location): number => {
            // TODO: Should corner repelling be re-enabled?
            const distToCorners = []; //corners.map(l => this.getDistanceBetween(location, l));
            const distToResults = result.map(l => this.getDistanceBetween(location, l));
            return Math.min(...distToCorners, ...distToResults);
        };
        while (result.length < n) {
            if (result.length === 0) {
                result.push({ ...center });
                continue;
            }
            const grid = this.getTerritoryCoordinateGrid(territoryId, 20);
            // Don't place troops more than 20 pixels away from the closest troop
            // const validGrid = grid.filter(l => result.length === 0 || getMinDistance(l) < 20);
            const idealLocations = grid.filter(l => getMinDistance(l) > 10 + this.getDistanceBetween(l, center) / 8);
            if (idealLocations.length > 0) {
                result.push(getMinKey(idealLocations, (l) => this.getDistanceBetween(l, center)));
                continue;
            }
            const maxMinDistanceLocation = getMaxKey(grid, (l) => getMinDistance(l));
            result.push(maxMinDistanceLocation);
        }
        return result.sort((a, b) => a.y - b.y);
    }

    private getPointAlong(a: Coordinates, b: Coordinates, along: number): Coordinates {
        return {
            x: Math.round(a.x + along * (b.x - a.x)),
            y: Math.round(a.y + along * (b.y - a.y))
        };
    }

    private getPointAlong2D(a: Coordinates, b: Coordinates, c: Coordinates, d: Coordinates, alongX: number, alongY: number): Coordinates {
        const t1 = this.getPointAlong(a, b, alongX);
        const t2 = this.getPointAlong(c, d, alongX);
        return this.getPointAlong(t1, t2, alongY);
    }

    private getTerritoryCoordinateGrid(territoryId: string, n: number): Coordinates[] {
        const troopBounds = RiskGame.config.territories[territoryId].troopBounds;

        // If there are fewer than 4 vertices, just duplicate the last one until there are 4
        const points = [...troopBounds];
        while (points.length < 4) {
            points.push(points[points.length - 1]);
        }

        const result: Coordinates[] = [];
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                result.push(this.getPointAlong2D(points[0], points[1], points[2], points[3], i / (n - 1), j / (n - 1)));
            }
        }
        return result;
    }

    private renderArrow(context: CanvasRenderingContext2D, from: Coordinates, to: Coordinates, options?: { thickness?: number, tipLength?: number }) {
        const getPointRelative = (point: Coordinates, distance: number, angle: number): Coordinates => {
            const { x, y } = point;
            const dx = distance * Math.cos(angle);
            const dy = distance * Math.sin(angle);
            return {
                x: x + dx,
                y: y + dy
            };
        };

        const t = options?.thickness ?? 10;
        const l = this.getDistanceBetween(from, to);
        const tl = options?.tipLength ?? t;
        const tt = t * 2;

        const theta = Math.atan2(to.y - from.y, to.x - from.x);
        const hpi = Math.PI / 2;

        const rear1 = getPointRelative(from, t / 2, theta + hpi);
        const rear2 = getPointRelative(from, t / 2, theta - hpi);
        const notch1 = getPointRelative(rear1, l - tl, theta);
        const notch2 = getPointRelative(rear2, l - tl, theta);
        const side1 = getPointRelative(notch1, (tt - t) / 2, theta + hpi);
        const side2 = getPointRelative(notch2, (tt - t) / 2, theta - hpi);
        const tip = to;

        context.beginPath();
        context.moveTo(rear1.x, rear1.y);
        context.lineTo(notch1.x, notch1.y);
        context.lineTo(side1.x, side1.y);
        context.lineTo(tip.x, tip.y);
        context.lineTo(side2.x, side2.y);
        context.lineTo(notch2.x, notch2.y);
        context.lineTo(rear2.x, rear2.y);
        context.lineTo(rear1.x, rear1.y);
        context.closePath();

        context.fillStyle = 'white';
        context.fill();
        context.strokeStyle = 'black';
        context.lineWidth = 2;
        context.stroke();
    }

    private async renderWeeklyPoints(entries: { userId: Snowflake, points: number, troops: number, extraTroops: number }[]): Promise<AttachmentBuilder> {
        const ROW_HEIGHT = 32;
        const MARGIN = 8;
        const MAX_BAR_WIDTH = 128;

        const maxPoints = Math.max(...entries.map(e => e.points));

        const renders: Canvas[] = [];

        // First, render the headline
        const WIDTH = 7 * ROW_HEIGHT + MAX_BAR_WIDTH + 5 * MARGIN;
        const HEIGHT = ROW_HEIGHT + MARGIN;
        const headerCanvas = createCanvas(WIDTH, 2 * HEIGHT);
        const headerContext = headerCanvas.getContext('2d');
        headerContext.fillStyle = 'black';
        headerContext.fillRect(0, 0, WIDTH, 2 * HEIGHT);
        headerContext.fillStyle = 'white';
        headerContext.font = '18px sans-serif';
        drawTextCentered(headerContext, `Week ${this.getTurn()} Reinforcements`, 0, WIDTH, ROW_HEIGHT * 0.75);
        headerContext.fillText('From Points', 0, ROW_HEIGHT * 1.75);
        headerContext.fillText('From Territories', WIDTH * 0.6, ROW_HEIGHT * 1.75);
        renders.push(headerCanvas);

        // Then, render each row
        for (const entry of entries) {
            const { userId, points, troops, extraTroops } = entry;
            const canvas = createCanvas(WIDTH, HEIGHT);
            const context = canvas.getContext('2d');
            context.fillStyle = 'black';
            context.fillRect(0, 0, WIDTH, HEIGHT);

            let baseX = MARGIN;
            // Draw the avatar
            context.drawImage(toCircle(await imageLoader.loadAvatar(userId)), baseX, 0, ROW_HEIGHT, ROW_HEIGHT);
            baseX += ROW_HEIGHT + MARGIN;
            // Draw the bar
            const barWidth = MAX_BAR_WIDTH * points / maxPoints;
            context.fillStyle = this.getPlayerColor(userId);
            context.fillRect(baseX, 0, barWidth, ROW_HEIGHT);
            baseX += barWidth + MARGIN;
            // Draw the troop icons
            const troopsImage = await imageLoader.loadImage('assets/risk/troops/1.png');
            for (let i = 0; i < troops; i++) {
                context.drawImage(troopsImage, baseX, 0, ROW_HEIGHT, ROW_HEIGHT);
                baseX += ROW_HEIGHT / 2;
            }
            // Now, draw the extra troop formula
            baseX = WIDTH - ROW_HEIGHT * 3;
            context.fillStyle = 'white';
            context.fillText(`${this.getNumTerritoriesForPlayer(userId)}/3 = `, baseX, ROW_HEIGHT / 2);
            baseX += ROW_HEIGHT;
            for (let i = 0; i < extraTroops; i++) {
                context.drawImage(troopsImage, baseX, 0, ROW_HEIGHT, ROW_HEIGHT);
                baseX += ROW_HEIGHT / 2;
            }
            renders.push(canvas);
        }
        return new AttachmentBuilder(joinCanvasesVertically(renders).toBuffer()).setName('risk-weekly.png');
    }

    private async renderMap(options?: { invasion?: RiskMovementData, additions?: Record<string, number>, movements?: RiskMovementData[] }): Promise<Canvas> {
        const mapImage = await imageLoader.loadImage('assets/risk/map.png');

        // Define the canvas
        const canvas = createCanvas(mapImage.width, mapImage.height);
        const context = canvas.getContext('2d');

        // Draw each territory cutout
        for (const territoryId of this.getTerritories()) {
            const invasion = options?.invasion;
            context.drawImage(await this.getTerritoryCutoutRender(territoryId), 0, 0);
            // If this isn't a part of the invasion being rendered, add a gray shade over it
            if (invasion && !(invasion.from === territoryId || invasion.to === territoryId)) {
                context.globalAlpha = 0.8;
                context.drawImage(await this.getTerritoryCutoutRender(territoryId, { grayedOut: true }), 0, 0);
                context.globalAlpha = 1;
            }
        }

        // Draw the map template as the top layer
        context.drawImage(mapImage, 0, 0);

        // Draw the number of troops in each territory
        const troopsImage = await imageLoader.loadImage('assets/risk/troops/1.png');
        const newTroopsImage = await imageLoader.loadImage('assets/risk/troops/1new.png');
        const invadingTroopsImage = await imageLoader.loadImage('assets/risk/troops/1invading.png');
        const troopsWidth = 24;
        for (const territoryId of this.getTerritories()) {
            // const troopsImage = await imageLoader.loadAvatar(this.getTerritoryOwner(territoryId) ?? '', 16);
            const numTroops = this.getTerritoryTroops(territoryId);
            const additions = (options?.additions ?? {})[territoryId] ?? 0;
            const invadingTroops = (options?.invasion?.from === territoryId) ? options.invasion.quantity : 0;
            const troopLocations = this.getRandomTerritoryTroopLocations(territoryId, numTroops);
            for (let i = 0; i < troopLocations.length; i++) {
                const { x, y } = troopLocations[i];
                const newAddition = troopLocations.length - i <= additions;
                const invading = troopLocations.length - i <= invadingTroops;
                context.drawImage(invading ? invadingTroopsImage : (newAddition ? newTroopsImage : troopsImage), x - troopsWidth / 2, y - troopsWidth / 2, troopsWidth, troopsWidth);
            }
        }

        // If an invasion is specified, draw the invasion arrow
        if (options?.invasion) {
            const { from, to } = options.invasion;
            const fromCoordinates = RiskGame.config.territories[from].termini[to];
            const toCoordinates = RiskGame.config.territories[to].termini[from];
            this.renderArrow(context, fromCoordinates, toCoordinates);
        }

        // If movements are specified, draw the movement arrows
        if (options?.movements) {
            for (const movement of options.movements) {
                const { from, to } = movement;
                const fromCoordinates = RiskGame.config.territories[from].termini[to];
                const toCoordinates = RiskGame.config.territories[to].termini[from];
                this.renderArrow(context, fromCoordinates, toCoordinates);
            }
        }

        return canvas;
    }

    private async renderAdditions(additions: Record<string, number>): Promise<AttachmentBuilder> {
        return new AttachmentBuilder((await this.renderMap({ additions })).toBuffer()).setName('risk-additions.png');
    }

    private async renderInvasion(invasion: RiskMovementData): Promise<AttachmentBuilder> {
        return new AttachmentBuilder((await this.renderMap({ invasion })).toBuffer()).setName('risk-invasion.png');
    }

    private async renderMovements(movements: RiskMovementData[]): Promise<AttachmentBuilder> {
        return new AttachmentBuilder((await this.renderMap({ movements })).toBuffer()).setName('risk-movements.png');
    }

    async renderState(options?: { showPlayerDecision?: string | undefined; seasonOver?: boolean | undefined; admin?: boolean | undefined; } | undefined): Promise<Buffer> {
        return (await this.renderMap()).toBuffer();
    }

    private async getTerritoryCutoutRender(territoryId: string, options?: { grayedOut?: true }): Promise<Canvas> {
        const maskImage = await imageLoader.loadImage(`assets/risk/territories/${territoryId.toLowerCase()}.png`);
        const canvas = createCanvas(maskImage.width, maskImage.height);
        const context = canvas.getContext('2d');

        // First, draw the territory image mask
        context.drawImage(maskImage, 0, 0);

        // Then, fill the entire canvas with the owner's color using the cutout as a mask
        context.globalCompositeOperation = 'source-in';
        context.fillStyle = options?.grayedOut ? 'rgb(35, 35, 35)' : this.getTerritoryColor(territoryId);
        context.fillRect(0, 0, canvas.width, canvas.height);

        return canvas;
    }

    override async beginTurn(): Promise<MessengerPayload[]> {
        this.state.turn++;

        // If we're on the first turn, determine the draft order
        if (this.state.turn === 1) {
            this.state.draft = this.constructDraftData();
        } else {
            // Just in case the draft data is still present, but this shouldn't happen...
            delete this.state.draft;
            // Initialize the decision maps to allow decisions
            this.state.addDecisions = {};
            this.state.attackDecisions = {};
            this.state.moveDecisions = {};
        }

        // Save a snapshot of weekly point-ordered players
        const weeklyPointOrderedPlayers = this.getPointOrderedPlayers();
        const weeklyPoints: Record<Snowflake, number> = {};
        const weeklyTroops: Record<Snowflake, number> = {};
        const weeklyExtraTroops: Record<Snowflake, number> = {};
        for (const userId of weeklyPointOrderedPlayers) {
            weeklyPoints[userId] = this.getPoints(userId);
            // Reset their weekly points
            this.resetPoints(userId);
        }
        const n = weeklyPointOrderedPlayers.length;
        for (let i = 0; i < n; i++) {
            const userId = weeklyPointOrderedPlayers[i];
            let troops = 0;
            if (weeklyPoints[userId] > 0) {
                troops++;
                if (i < n / 4) {
                    troops++;
                }
                if (i < n / 2) {
                    troops++;
                }
            }
            weeklyTroops[userId] = troops;
            this.addPlayerNewTroops(userId, troops);
            // Determine territory-based troop bonus
            const extraTroops = Math.floor(this.getNumTerritoriesForPlayer(userId) / 3);
            weeklyExtraTroops[userId] = extraTroops;
            this.addPlayerNewTroops(userId, extraTroops);
        }

        // If there are NPCs, choose actions for them
        for (const userId of this.getPlayers()) {
            if (userId.startsWith('npc')) {
                // Choose additions
                const possibleAdditionTerritories = this.getTerritoriesForPlayer(userId);
                if (this.state.addDecisions && possibleAdditionTerritories.length > 0) {
                    const additions: string[] = [];
                    for (let i = 0; i < this.getPlayerNewTroops(userId); i++) {
                        additions.push(randChoice(...possibleAdditionTerritories));
                    }
                    this.state.addDecisions[userId] = additions;
                }
                // Choose attacks
                const possibleAttackTerritories = this.getValidAttackSourceTerritoriesForPlayer(userId);
                if (this.state.attackDecisions && possibleAttackTerritories.length > 0) {
                    const attacks: RiskMovementData[] = [];
                    for (const territoryId of possibleAttackTerritories) {
                        const target = randChoice(...this.getTerritoryConnections(territoryId).filter(otherId => this.getTerritoryOwner(otherId) !== userId));
                        const p = this.getTerritoryTroops(territoryId) > this.getTerritoryTroops(target) ? 1 : 0.25;
                        if (chance(p)) {
                            attacks.push({
                                from: territoryId,
                                to: target,
                                quantity: randInt(1, this.getTerritoryTroops(territoryId))
                            });
                        }
                    }
                    this.state.attackDecisions[userId] = attacks;
                }
                // Choose movements
                const possibleMovementTerritories = this.getValidMovementSourceTerritoriesForPlayer(userId);
                if (this.state.moveDecisions && possibleMovementTerritories.length > 0) {
                    const source = randChoice(...possibleMovementTerritories);
                    const destination = randChoice(...this.getTerritoryConnections(source).filter(otherId => this.getTerritoryOwner(otherId) === userId));
                    this.state.moveDecisions[userId] = {
                        from: source,
                        to: destination,
                        quantity: randInt(1, this.getTerritoryTroops(source))
                    };
                }
            }
        }

        // Show a chart indicating how many troops were awarded this week
        return [{
            files: [await this.renderWeeklyPoints(weeklyPointOrderedPlayers.map(userId => ({ userId, points: weeklyPoints[userId], troops: weeklyTroops[userId], extraTroops: weeklyExtraTroops[userId] })))]
        }];
    }

    override async endTurn(): Promise<MessengerPayload[]> {
        // Clear all decision-related data
        delete this.state.addDecisions;
        delete this.state.attackDecisions;
        delete this.state.moveDecisions;

        // TODO: Return something meaningful
        return super.endTurn();
    }

    private constructDraftData(): Record<Snowflake, { timestamp: number }> {
        const minDate = new Date();
        minDate.setHours(10, 0, 0, 0);
        const maxDate = new Date();
        maxDate.setHours(11, 45, 0, 0);
        const userIds = this.getPointOrderedPlayers();
        const n = userIds.length;
        const result: Record<Snowflake, { timestamp: number }> = {};
        for (let i = 0; i < n; i++) {
            const userId = userIds[i];
            result[userId] = {
                timestamp: getDateBetween(minDate, maxDate, i / n).getTime()
            };
        }
        return result;
    }

    getPoints(userId: string): number {
        return this.state.players[userId]?.points ?? 0;
    }

    addPoints(userId: string, points: number): void {
        if (isNaN(points)) {
            throw new Error('Cannot award NaN points!');
        }
        if (!this.hasPlayer(userId)) {
            throw new Error(`Player ${userId} not in-game, can't award points!`);
        }
        this.state.players[userId].points = toFixed(this.getPoints(userId) + points);
    }

    private resetPoints(userId: Snowflake) {
        this.addPoints(userId, -this.getPoints(userId));
    }

    awardPrize(userId: string, type: PrizeType, intro: string): MessengerPayload[] {
        // TODO: Handle this
        return [];
    }

    async addPlayerDecision(userId: string, text: string): Promise<MessengerPayload> {
        // TODO: Handle this
        throw new Error('Can\'t accept decisions yet...');
    }

    async processPlayerDecisions(): Promise<DecisionProcessingResult> {
        // If the draft is active, handle this primarily
        if (this.state.draft) {
            // If there are any remaining players, pick a random location for them
            const remainingAvailableUserIds = this.getAvailableDraftPlayers();
            if (remainingAvailableUserIds.length > 0) {
                // Pick a random user and random available territory
                const randomUserId = randChoice(...remainingAvailableUserIds);
                const randomTerritoryId = randChoice(...this.getOwnerlessTerritories());
                // Assign the territory to this user and mark them as draft-complete
                this.state.territories[randomTerritoryId].owner = randomUserId;
                delete this.state.draft[randomUserId];
                // Send a payload about it and continue processing
                return {
                    continueProcessing: true,
                    summary: {
                        // TODO: add varying text
                        content: `**${this.getPlayerDisplayName(randomUserId)}** has been placed at _${this.getTerritoryName(randomTerritoryId)}_`,
                        files: [await this.renderState()],
                        flags: MessageFlags.SuppressNotifications
                    }
                };
            }
            // Else, wipe the draft data and end processing
            delete this.state.draft;
            return {
                continueProcessing: false,
                summary: 'Alright, everyone\'s settled in! See you all next week when the bloodshed begins...'
            };
        }
        // If there are pending add decisions, process them
        if (this.state.addDecisions) {
            const addDecisions = this.state.addDecisions;
            const additions: Record<string, number> = {};
            for (const userId of Object.keys(addDecisions)) {
                const territoryIds = addDecisions[userId];
                for (const territoryId of territoryIds) {
                    this.addTerritoryTroops(territoryId, 1);
                    additions[territoryId] = (additions[territoryId] ?? 0) + 1;
                }
            }
            // Delete the add decisions to prevent further processing on them
            delete this.state.addDecisions;
            return {
                continueProcessing: true,
                summary: {
                    content: 'Troops were added!',
                    files: [await this.renderAdditions(additions)]
                }
            };
        }
        // If there's an active conflict, process it
        if (this.state.currentConflict) {
            const conflict = this.state.currentConflict;
            const attackerId = this.getTerritoryOwner(conflict.from);
            const defenderId = this.getTerritoryOwner(conflict.to);
            // Now, roll all the dice
            const attackerDice = Math.min(3, conflict.attackerTroops);
            const defenderDice = Math.min(2, conflict.defenderTroops);
            const attackerRolls = this.getSortedDiceRolls(attackerDice);
            const defenderRolls = this.getSortedDiceRolls(defenderDice);
            const numComparisons = Math.min(2, attackerDice, defenderDice);
            let attackersLost = 0;
            let defendersLost = 0;
            // Compare the first set
            let summary = `Attacker rolls **${attackerRolls}**, defender rolls **${defenderRolls}**. `;
            if (attackerRolls[0] > defenderRolls[0]) {
                conflict.defenderTroops--;
                defendersLost++;
                summary += `Attacker's **${attackerRolls[0]}** beats **${defenderRolls[0]}**. `;
            } else {
                conflict.attackerTroops--;
                attackersLost++;
                summary += `Defender's **${defenderRolls[0]}** beats **${attackerRolls[0]}**. `;
            }
            // If there are enough dice, compare the second set
            if (numComparisons === 2) {
                if (attackerRolls[1] > defenderRolls[1]) {
                    conflict.defenderTroops--;
                    defendersLost++;
                    summary += `Attacker's **${attackerRolls[1]}** beats **${defenderRolls[1]}**. `;
                } else {
                    conflict.attackerTroops--;
                    attackersLost++;
                    summary += `Defender's **${defenderRolls[1]}** beats **${attackerRolls[1]}**. `;
                }
            }
            // If it's a defender victory...
            if (conflict.attackerTroops === 0) {
                // Update the source territory's troop count
                this.setTerritoryTroops(conflict.to, conflict.defenderTroops);
                this.addTerritoryTroops(conflict.from, -conflict.quantity);
                // Delete the conflict
                delete this.state.currentConflict;
                // Send a message
                return {
                    continueProcessing: true,
                    summary: {
                        content: `${summary}\n**${this.getPlayerDisplayName(defenderId)}** has successfully fended off **${this.getPlayerDisplayName(attackerId)}** at _${this.getTerritoryName(conflict.to)}_!`,
                        files: [await this.renderConflict(conflict, { attackerRolls, defenderRolls, attackersLost, defendersLost })]
                    }
                };
            }
            // If it's an attacker victory...
            if (conflict.defenderTroops === 0) {
                // Update the troop counts of both territories
                this.setTerritoryTroops(conflict.to, conflict.attackerTroops);
                this.addTerritoryTroops(conflict.from, -conflict.quantity);
                // Update the ownership of the target territory
                this.state.territories[conflict.to].owner = attackerId;
                // TODO: Handle player eliminations and such here...
                // Delete the conflict
                delete this.state.currentConflict;
                // Send a message
                return {
                    continueProcessing: true,
                    summary: {
                        content: `${summary}\n**${this.getPlayerDisplayName(attackerId)}** has defeated **${this.getPlayerDisplayName(defenderId)}** at _${this.getTerritoryName(conflict.to)}_!`,
                        files: [await this.renderConflict(conflict, { attackerRolls, defenderRolls, attackersLost, defendersLost })]
                    }
                };
            }
            // Otherwise, provide an update of the conflict
            return {
                continueProcessing: true,
                summary: {
                    content: `${summary}**${conflict.attackerTroops}** attacker troops remaining vs **${conflict.defenderTroops}** defending...`,
                    files: [await this.renderConflict(conflict, { attackerRolls, defenderRolls, attackersLost, defendersLost })]
                }
            };
        }
        // If there are any attack decisions, process them
        if (this.state.attackDecisions) {
            // First, determine the attack dependencies
            // TODO: This assumes each source only depends on one destination, can we guarantee this?
            const dependencies: Record<string, string> = {};
            for (const userId of Object.keys(this.state.attackDecisions)) {
                const attackDataEntries = this.state.attackDecisions[userId];
                for (const attackData of attackDataEntries) {
                    dependencies[attackData.from] = attackData.to;
                }
            }
            // Then, shuffle the list of attacking territories with these dependencies
            // TODO: Add a try-catch to handle cycles, in which case we should just choose a random territory
            const orderedTerritories = shuffleWithDependencies(Object.keys(dependencies), dependencies);
            // Get the first element from the shuffled list
            const territoryId = orderedTerritories[0];
            if (!territoryId) {
                return {
                    continueProcessing: true,
                    summary: `Couldn\'t find the next territory attack node to process... \`${JSON.stringify(this.state.attackDecisions)}\` \`${JSON.stringify(dependencies)}\``
                };
            }
            const ownerId = this.getTerritoryOwner(territoryId);
            if (!ownerId) {
                return {
                    continueProcessing: true,
                    summary: `Couldn't find the owner for territory _${this.getTerritoryName(territoryId)}_ staging an attack...`
                };
            }
            // TODO: This assumes each source only depends on one destination, can we guarantee this?
            const conflict = this.state.attackDecisions[ownerId].filter(x => x.from === territoryId)[0];
            if (!conflict) {
                return {
                    continueProcessing: true,
                    summary: `Couldn't find decision conflict for <@${ownerId}>'s territory _${this.getTerritoryName(territoryId)}_ staging an attack...`
                };
            }
            // Determine how many troops can actually be used
            const actualQuantity = Math.min(conflict.quantity, this.getTerritoryTroops(conflict.from) - 1);
            if (actualQuantity !== conflict.quantity) {
                void logger.log(`<@${ownerId}> tried to attack _${this.getTerritoryName(conflict.to)}_ with **${conflict.quantity}** troop(s) `
                    + `but _${this.getTerritoryName(conflict.from)}_ only has **${this.getTerritoryTroops(conflict.from)}**, so only attacking with **${actualQuantity}**`);
            }
            // Delete this attack decision
            // TODO: This assumes each source only depends on one destination, can we guarantee this?
            // TODO: Also, REALLY hacky. Can we index the conflicts by some sort of conflict ID?
            this.state.attackDecisions[ownerId] = this.state.attackDecisions[ownerId].filter(x => x.from !== conflict.from);
            // Delete this user's attack decisions if there are none left
            if (this.state.attackDecisions[ownerId].length === 0) {
                delete this.state.attackDecisions[ownerId];
            }
            // Delete the attack decision map if there are no decisions left from anyone
            if (Object.keys(this.state.attackDecisions).length === 0 || Object.values(this.state.attackDecisions).every(d => d.length === 0)) {
                delete this.state.attackDecisions;
            }
            // Validation just in case this conflict isn't possible
            if (actualQuantity < 1) {
                return {
                    continueProcessing: true,
                    summary: `**${this.getPlayerDisplayName(ownerId)}** tried to launch an attack from _${this.getTerritoryName(conflict.from)}_ to _${this.getTerritoryName(conflict.to)}_, but couldn't due to a lack of troops...`
                };
            }
            // Save this node as the current conflict
            this.state.currentConflict = {
                from: conflict.from,
                to: conflict.to,
                quantity: actualQuantity,
                attackerId: this.getTerritoryOwner(conflict.from),
                defenderId: this.getTerritoryOwner(conflict.to),
                initialAttackerTroops: actualQuantity,
                initialDefenderTroops: this.getTerritoryTroops(conflict.to),
                attackerTroops: actualQuantity,
                defenderTroops: this.getTerritoryTroops(conflict.to)
            };
            return {
                continueProcessing: true,
                summary: {
                    content: `**${this.getPlayerDisplayName(ownerId)}** has staged an attack from _${this.getTerritoryName(conflict.from)}_ to _${this.getTerritoryName(conflict.to)}_ with **${conflict.quantity}** troop(s)!`,
                    files: [await this.renderInvasion(conflict)]
                }
            };
        }
        // If there are any move decisions, process them last
        if (this.state.moveDecisions) {
            const moveDecisions = this.state.moveDecisions;
            const actualMovements: RiskMovementData[] = [];
            for (const [ userId, data ] of Object.entries(moveDecisions)) {
                // Validate that there are enough troops left, and that they still own the destination
                if (this.getTerritoryTroops(data.from) > 1 && this.getTerritoryOwner(data.to) === userId) {
                    // Since the territory may have lost troops during the attack phase, only move as many as is possible
                    const actualQuantity = Math.min(data.quantity, this.getTerritoryTroops(data.from) - 1);
                    if (actualQuantity !== data.quantity) {
                        void logger.log(`<@${userId}> tried to move **${data.quantity}** troop(s) from _${this.getTerritoryName(data.from)}_ to _${this.getTerritoryName(data.to)}_ `
                            + `but _${this.getTerritoryName(data.from)}_ only has **${this.getTerritoryTroops(data.from)}**, so only moving with **${actualQuantity}**`);
                    }
                    this.addTerritoryTroops(data.from, -actualQuantity);
                    this.addTerritoryTroops(data.to, actualQuantity);
                    // Add this to the list of actual movements to render
                    actualMovements.push(data);
                }
            }
            // Delete the decision map
            delete this.state.moveDecisions;
            return {
                continueProcessing: false,
                summary: {
                    content: 'Troops were moved!',
                    files: [await this.renderMovements(actualMovements)]
                }
            };
        }
        // Last resort fallback, this should never happen
        return {
            continueProcessing: false,
            summary: 'That\'s all!'
        };
    }

    private getSortedDiceRolls(n: number): number[] {
        const result: number[] = [];
        for (let i = 0; i < n; i++) {
            result.push(randInt(1, 7));
        }
        return result.sort().reverse();
    }

    override getDecisionActionRow(): ActionRowData<MessageActionRowComponentData>[] {
        return [{
            type: ComponentType.ActionRow,
            components: [{
                type: ComponentType.Button,
                label: 'Add Troops',
                style: ButtonStyle.Success,
                customId: 'game:add'
            }, {
                type: ComponentType.Button,
                label: 'Attack',
                style: ButtonStyle.Danger,
                customId: 'game:attack'
            }, {
                type: ComponentType.Button,
                label: 'Move Troops',
                style: ButtonStyle.Primary,
                customId: 'game:move'
            }]
        }]
    }

    override async handleGameInteraction(interaction: Interaction): Promise<MessengerPayload[] | undefined> {
        const userId = interaction.user.id;
        if (interaction.isButton()) {
            const customId = interaction.customId;
            switch (customId) {
                case 'game:pickStartingLocation': {
                    // Do basic validation before processing
                    const draft = this.state.draft;
                    if (!draft) {
                        throw new Error('The draft has already ended, why are you clicking this?');
                    }
                    const playerDraftInfo = draft[userId];
                    if (!playerDraftInfo) {
                        throw new Error('You\'re not in the game... yet?');
                    }
                    if (!playerDraftInfo.available) {
                        throw new Error('It\'s not your turn to draft, silly!');
                    }
                    // Respond with a prompt for the user to pick a location
                    await interaction.reply({
                        ephemeral: true,
                        content: 'Where would you like to start?',
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.StringSelect,
                                custom_id: 'game:selectStartingLocation',
                                min_values: 1,
                                max_values: 1,
                                options: this.getTerritorySelectOptions(this.getOwnerlessTerritories())
                            }]
                        }]
                    });
                    break;
                }
                case 'game:add': {
                    // First, validate that add decisions are being accepted
                    if (!this.state.addDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _adding troops_ right now...');
                    }
                    // Reply with a prompt for them to make decisions
                    await interaction.reply(this.getAddDecisionReply(userId));
                    break;
                }
                case 'game:attack': {
                    // First, validate that attack decisions are being accepted
                    if (!this.state.attackDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _attacking_ right now...');
                    }
                    // Reply with a prompt for them to make decisions
                    await interaction.reply(this.getAttackDecisionReply(userId));
                    break;
                }
                case 'game:move': {
                    // First, validate that move decisions are being accepted
                    if (!this.state.moveDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _moving troops_ right now...');
                    }
                    // Reply with a prompt for them to make decisions
                    await interaction.reply(this.getMoveDecisionReply(userId));
                    break;
                }
                case 'game:clearAdd': {
                    // First, validate that add decisions are being accepted
                    if (!this.state.addDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _adding troops_ right now...');
                    }
                    // Clear this player's add decisions
                    delete this.state.addDecisions[userId];
                    // Reply with a prompt for them to make new decisions
                    await interaction.reply(this.getAddDecisionReply(userId));
                    break;
                }
                case 'game:clearMove': {
                    // First, validate that move decisions are being accepted
                    if (!this.state.moveDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _moving troops_ right now...');
                    }
                    // Clear this player's move decisions
                    delete this.pendingMoveDecisions[userId];
                    delete this.state.moveDecisions[userId];
                    // Reply with a prompt for them to make new decisions
                    await interaction.reply(this.getMoveDecisionReply(userId));
                    break;
                }
                case 'game:clearAttack': {
                    // First, validate that attack decisions are being accepted
                    if (!this.state.attackDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _attacking_ right now...');
                    }
                    // Clear this player's attack decisions
                    delete this.pendingAttackDecisions[userId];
                    delete this.state.attackDecisions[userId];
                    // Reply with a prompt for them to make new decisions
                    await interaction.reply(this.getAttackDecisionReply(userId));
                    break;
                }
                case 'game:reviewDecisions': {
                    const allDecisionStrings = [...this.getAddDecisionStrings(userId), ...this.getAttackDecisionStrings(userId), ...this.getMoveDecisionStrings(userId)];
                    if (allDecisionStrings.length > 0) {
                        await interaction.reply({
                            ephemeral: true,
                            content: 'You\'ve made the following decisions:\n' + allDecisionStrings.join('\n')
                        });
                    } else {
                        await interaction.reply({
                            ephemeral: true,
                            content: 'You don\'t have any actions lined up! Use the buttons in the channel to arrange some actions...'
                        });
                    }
                    break;
                }
            }
        } else if (interaction.isStringSelectMenu()) {
            const customId = interaction.customId;
            switch (customId) {
                case 'game:selectStartingLocation': {
                    // Do basic validation before processing
                    const draft = this.state.draft;
                    if (!draft) {
                        throw new Error('The draft has already ended, why are you clicking this?');
                    }
                    const playerDraftInfo = draft[userId];
                    if (!playerDraftInfo) {
                        throw new Error('You\'re not in the game... yet?');
                    }
                    if (!playerDraftInfo.available) {
                        throw new Error('It\'s not your turn to draft, silly!');
                    }
                    // Validate the player's selected location
                    const territoryId = interaction.values[0];
                    if (!territoryId) {
                        await interaction.reply({
                            ephemeral: true,
                            content: 'Ummmmm... you were supposed to select a territory...'
                        });
                        return;
                    }
                    const existingOwnerId = this.getTerritoryOwner(territoryId);
                    if (existingOwnerId) {
                        await interaction.reply({
                            ephemeral: true,
                            content: `You can't select _${this.getTerritoryName(territoryId)}_, it's already been claimed by ${this.getPlayerDisplayName(existingOwnerId)}!`
                        });
                        return;
                    }
                    // Confirm the selected location
                    this.state.territories[territoryId].owner = userId;
                    delete draft[userId].available;
                    // Reply to the interaction
                    await interaction.reply({
                        ephemeral: true,
                        content: `You have selected _${this.getTerritoryName(territoryId)}_!`
                    });
                    // Reply for the entire channel to see
                    return [{
                        content: `<@${userId}> has set up camp at _${this.getTerritoryName(territoryId)}_!`,
                        files: [await this.renderState()]
                    }];
                }
                case 'game:selectAdd': {
                    // First, validate that add decisions are being accepted
                    if (!this.state.addDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _adding troops_ right now...');
                    }
                    // Validate the selected territory
                    const selectedTerritoryId = interaction.values[0];
                    if (this.getTerritoryOwner(selectedTerritoryId) !== userId) {
                        throw new Error(`You don't own _${this.getTerritoryName(selectedTerritoryId)}_!`);
                    }
                    // Add the pending decision
                    if (!this.state.addDecisions[userId]) {
                        this.state.addDecisions[userId] = [];
                    }
                    const pendingAdditions = this.state.addDecisions[userId];
                    pendingAdditions.push(selectedTerritoryId);
                    // Repond with a prompt to do more
                    await interaction.reply(this.getAddDecisionReply(userId));
                    break;
                }
                case 'game:selectMoveFrom': {
                    // First, validate that move decisions are being accepted
                    if (!this.state.moveDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _moving troops_ right now...');
                    }
                    // Instantiate the pending move if it's missing
                    if (!this.pendingMoveDecisions[userId]) {
                        this.pendingMoveDecisions[userId] = {};
                    }
                    // Validate the selected source territory
                    // TODO: Validate that the player can move any troops from this territory
                    const territoryId = interaction.values[0];
                    if (this.getTerritoryOwner(territoryId) !== userId) {
                        throw new Error(`You can't move troops from _${this.getTerritoryName(territoryId)}_, you don't own that territory!`);
                    }
                    // Add to the pending decision
                    const pendingMove = this.pendingMoveDecisions[userId];
                    pendingMove.from = territoryId;
                    // Delete the subsequent 2 properties to ensure it's not filled in backward
                    delete pendingMove.to;
                    delete pendingMove.quantity;
                    // Respond with a prompt to do more
                    await interaction.reply(this.getMoveDecisionReply(userId));
                    break;
                }
                case 'game:selectMoveTo': {
                    // First, validate that move decisions are being accepted
                    if (!this.state.moveDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _moving troops_ right now...');
                    }
                    // Instantiate the pending move if it's missing
                    if (!this.pendingMoveDecisions[userId]) {
                        this.pendingMoveDecisions[userId] = {};
                    }
                    // Validate the selected destination territory
                    const territoryId = interaction.values[0];
                    if (this.getTerritoryOwner(territoryId) !== userId) {
                        throw new Error(`You can't move troops to _${this.getTerritoryName(territoryId)}_, you don't own that territory!`);
                    }
                    // Add to the pending decision
                    const pendingMove = this.pendingMoveDecisions[userId];
                    pendingMove.to = territoryId;
                    // Delete the subsequent property to ensure it's not filled in backward
                    delete pendingMove.quantity;
                    // Respond with a prompt to do more
                    await interaction.reply(this.getMoveDecisionReply(userId));
                    break;
                }
                case 'game:selectMoveQuantity': {
                    // First, validate that move decisions are being accepted
                    if (!this.state.moveDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _moving troops_ right now...');
                    }
                    // Instantiate the pending move if it's missing
                    if (!this.pendingMoveDecisions[userId]) {
                        this.pendingMoveDecisions[userId] = {};
                    }
                    // Validate the selected quantity
                    // TODO: Validate that the quantity is possible with the selected source territory
                    const quantity = parseInt(interaction.values[0]);
                    if (isNaN(quantity) || quantity < 1) {
                        throw new Error(`\`${quantity}\` is an invalid quantity of troops!`);
                    }
                    // Add to the pending decision
                    const pendingMove = this.pendingMoveDecisions[userId];
                    pendingMove.quantity = quantity;
                    // Respond with a prompt to do more
                    await interaction.reply(this.getMoveDecisionReply(userId));
                    break;
                }
                case 'game:selectAttackFrom': {
                    // First, validate that attack decisions are being accepted
                    if (!this.state.attackDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _attacking_ right now...');
                    }
                    // Instantiate the pending attack if it's missing
                    if (!this.pendingAttackDecisions[userId]) {
                        this.pendingAttackDecisions[userId] = {};
                    }
                    // Validate the selected source territory
                    // TODO: Validate that the player can use any troops from this territory to attack
                    const territoryId = interaction.values[0];
                    if (this.getTerritoryOwner(territoryId) !== userId) {
                        throw new Error(`You can't use troops from _${this.getTerritoryName(territoryId)}_ to attack, you don't own that territory!`);
                    }
                    // Add to the pending decision
                    const pendingAttack = this.pendingAttackDecisions[userId];
                    pendingAttack.from = territoryId;
                    // Delete the subsequent 2 properties to ensure it's not filled in backward
                    delete pendingAttack.to;
                    delete pendingAttack.quantity;
                    // Respond with a prompt to do more
                    await interaction.reply(this.getAttackDecisionReply(userId));
                    break;
                }
                case 'game:selectAttackTo': {
                    // First, validate that attack decisions are being accepted
                    if (!this.state.attackDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _attacking_ right now...');
                    }
                    // Instantiate the pending attack if it's missing
                    if (!this.pendingAttackDecisions[userId]) {
                        this.pendingAttackDecisions[userId] = {};
                    }
                    // Validate the selected target territory
                    const territoryId = interaction.values[0];
                    if (this.getTerritoryOwner(territoryId) === userId) {
                        throw new Error(`You can't attack _${this.getTerritoryName(territoryId)}_, that's your own territory!`);
                    }
                    // Add to the pending decision
                    const pendingAttack = this.pendingAttackDecisions[userId];
                    pendingAttack.to = territoryId;
                    // Delete the subsequent property to ensure it's not filled in backward
                    delete pendingAttack.quantity;
                    // Respond with a prompt to do more
                    await interaction.reply(this.getAttackDecisionReply(userId));
                    break;
                }
                case 'game:selectAttackQuantity': {
                    // First, validate that attack decisions are being accepted
                    if (!this.state.attackDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _attacking_ right now...');
                    }
                    // Instantiate the pending attack if it's missing
                    if (!this.pendingAttackDecisions[userId]) {
                        this.pendingAttackDecisions[userId] = {};
                    }
                    // Validate the selected quantity
                    // TODO: Validate that the quantity is possible with the selected source territory
                    const quantity = parseInt(interaction.values[0]);
                    if (isNaN(quantity) || quantity < 1) {
                        throw new Error(`\`${quantity}\` is an invalid quantity of troops!`);
                    }
                    // Add to the pending decision
                    const pendingAttack = this.pendingAttackDecisions[userId];
                    pendingAttack.quantity = quantity;
                    // Respond with a prompt to do more
                    await interaction.reply(this.getAttackDecisionReply(userId));
                    break;
                    break;
                }
            }
        }
    }

    private getAddDecisionReply(userId: Snowflake): InteractionReplyOptions {
        if (!this.state.addDecisions) {
            throw new Error('I\'m not accepting any decisions related to _adding troops_ right now...');
        }
        const pendingAdditions = this.state.addDecisions[userId] ?? [];
        const newTroops = this.getPlayerNewTroops(userId);
        const additionsRemaining = newTroops - pendingAdditions.length;
        // Construct the message
        let content = `You have **${newTroops}** new troop(s) to deploy.`;
        if (pendingAdditions.length > 0) {
            content += ' You\'ve made the following placements:\n' + this.getAddDecisionStrings(userId).join('\n');
        }
        content += `\nYou can place **${additionsRemaining}** more.`
        // If the player has remaining troops to add, show a territory select
        const components: APIActionRowComponent<APIMessageActionRowComponent>[] = [];
        if (additionsRemaining > 0) {
            components.push({
                type: ComponentType.ActionRow,
                components: [{
                    type: ComponentType.StringSelect,
                    custom_id: 'game:selectAdd',
                    placeholder: 'Select territory...',
                    min_values: 1,
                    max_values: 1,
                    options: this.getOwnedTerritorySelectOptions(this.getTerritoriesForPlayer(userId))
                }]
            });
        }
        // Add action row for reviewing/clearing
        components.push({
            type: ComponentType.ActionRow,
            components: [{
                type: ComponentType.Button,
                custom_id: 'game:reviewDecisions',
                label: 'Review Decisions',
                style: ButtonStyle.Primary
            }, {
                type: ComponentType.Button,
                custom_id: 'game:clearAdd',
                label: 'Start Over',
                style: ButtonStyle.Danger
            }]
        });
        return {
            ephemeral: true,
            content,
            components
        };
    }

    private getMoveDecisionReply(userId: Snowflake): InteractionReplyOptions {
        if (!this.state.moveDecisions) {
            throw new Error('I\'m not accepting any decisions related to _moving troops_ right now...');
        }
        // Instantiate the move data if it's not there
        if (!this.pendingMoveDecisions[userId]) {
            this.pendingMoveDecisions[userId] = {};
        }
        const pendingMove = this.pendingMoveDecisions[userId];
        // If the source is missing, prompt them to fill it in
        if (!pendingMove.from) {
            // Construct the reply payload
            const validSources = this.getValidMovementSourceTerritoriesForPlayer(userId);
            if (validSources.length > 0) {
                return {
                    ephemeral: true,
                    content: 'From where would you like to move troops?',
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.StringSelect,
                            custom_id: 'game:selectMoveFrom',
                            placeholder: 'Select source territory...',
                            min_values: 1,
                            max_values: 1,
                            options: this.getOwnedTerritorySelectOptions(validSources)
                        }]
                    }]
                };
            } else {
                // Clear the pending move to avoid softlocking
                delete this.pendingMoveDecisions[userId];
                return {
                    ephemeral: true,
                    content: 'There are no territories from which you can move troops. Sorry...'
                };
            }
        }
        // If the destination is missing, prompt them to fill it in
        if (!pendingMove.to) {
            // Construct the reply payload
            const validDestinations = this.getTerritoryConnections(pendingMove.from)
                .filter(territoryId => this.getTerritoryOwner(territoryId) === userId);
            if (validDestinations.length > 0) {
                return {
                    ephemeral: true,
                    content: `Where should the troops from _${this.getTerritoryName(pendingMove.from)}_ move to?`,
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.StringSelect,
                            custom_id: 'game:selectMoveTo',
                            placeholder: 'Select destination territory...',
                            min_values: 1,
                            max_values: 1,
                            options: this.getTerritorySelectOptions(validDestinations)
                        }]
                    }]
                };
            } else {
                // Clear the pending move to avoid softlocking
                delete this.pendingMoveDecisions[userId];
                return {
                    ephemeral: true,
                    content: `There are no valid destinations near _${this.getTerritoryName(pendingMove.from)}_. Sorry...`
                };
            }
        }
        // If the quantity is missing, prompt them to fill it in
        if (!pendingMove.quantity) {
            // Consider how many troops are promised to be in a particular territory
            const numTroops = this.getPromisedTerritoryTroops(pendingMove.from);
            const quantityValues: string[] = [];
            for (let i = 1; i < numTroops; i++) {
                quantityValues.push(`${i}`);
            }
            if (quantityValues.length > 0) {
                return {
                    ephemeral: true,
                    content: `How many troops would you like to move from _${this.getTerritoryName(pendingMove.from)}_ to _${this.getTerritoryName(pendingMove.to)}_?`,
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.StringSelect,
                            custom_id: 'game:selectMoveQuantity',
                            placeholder: 'Select quantity...',
                            min_values: 1,
                            max_values: 1,
                            options: quantityValues.map(x => ({
                                value: x,
                                label: x
                            }))
                        }]
                    }]
                };
            } else {
                // Clear the pending move to avoid softlocking
                delete this.pendingMoveDecisions[userId];
                return {
                    ephemeral: true,
                    content: `_${this.getTerritoryName(pendingMove.from)}_ doesn't have enough troops to move. Sorry...`
                };
            }
        }
        // If the pending decision is full, save it
        if (pendingMove.from && pendingMove.to && pendingMove.quantity) {
            this.state.moveDecisions[userId] = pendingMove as RiskMovementData;
            // Delete the pending move so it can't be filled out backward
            delete this.pendingMoveDecisions[userId];
        }
        // Now, show them their decision
        // TODO: Fill out
        return {
            ephemeral: true,
            content: 'You have chosen the following _move_ action:\n'
                + this.getMoveDecisionStrings(userId).join('\n')
                + '\nYou can use the "Start Over" button to delete or change this action.',
            components: [{
                type: ComponentType.ActionRow,
                components: [{
                    type: ComponentType.Button,
                    custom_id: 'game:reviewDecisions',
                    label: 'Review Decisions',
                    style: ButtonStyle.Primary
                }, {
                    type: ComponentType.Button,
                    custom_id: 'game:clearMove',
                    label: 'Start Over',
                    style: ButtonStyle.Danger
                }]
            }]
        };
    }

    private getAttackDecisionReply(userId: Snowflake): InteractionReplyOptions {
        if (!this.state.attackDecisions) {
            throw new Error('I\'m not accepting any decisions related to _attacking_ right now...');
        }
        // Instantiate the attack data if it's not there
        if (!this.pendingAttackDecisions[userId]) {
            this.pendingAttackDecisions[userId] = {};
        }
        const pendingAttack = this.pendingAttackDecisions[userId];
        // If the source is missing, prompt them to fill it in
        if (!pendingAttack.from) {
            // Construct the reply payload
            const validSources = this.getValidAttackSourceTerritoriesForPlayer(userId);
            if (validSources.length > 0) {
                return {
                    ephemeral: true,
                    content: 'Which territory will launch the attack?',
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.StringSelect,
                            custom_id: 'game:selectAttackFrom',
                            placeholder: 'Select attacker territory...',
                            min_values: 1,
                            max_values: 1,
                            // TODO: Show correct territories
                            options: this.getOwnedTerritorySelectOptions(validSources)
                        }]
                    }]
                };
            } else {
                // Clear the pending attack to avoid softlocking
                delete this.pendingAttackDecisions[userId];
                return {
                    ephemeral: true,
                    content: 'There are no territories from which you can attack. Sorry...'
                };
            }
        }
        // If the target is missing, prompt them to fill it in
        if (!pendingAttack.to) {
            // Construct the reply payload
            const validTargets = this.getTerritoryConnections(pendingAttack.from)
                .filter(territoryId => this.getTerritoryOwner(territoryId) !== userId);
            if (validTargets.length > 0) {
                return {
                    ephemeral: true,
                    content: `Which territory will be attacked by _${this.getTerritoryName(pendingAttack.from)}_?`,
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.StringSelect,
                            custom_id: 'game:selectAttackTo',
                            placeholder: 'Select target territory...',
                            min_values: 1,
                            max_values: 1,
                            options: this.getTerritorySelectOptions(validTargets)
                        }]
                    }]
                };
            } else {
                // Clear the pending attack to avoid softlocking
                delete this.pendingAttackDecisions[userId];
                return {
                    ephemeral: true,
                    content: `There are no territories that _${this.getTerritoryName(pendingAttack.from)}_ can attack. Sorry...`
                };
            }
        }
        // If the quantity is missing, prompt them to fill it in
        if (!pendingAttack.quantity) {
            // Consider how many troops are promised to be in a particular territory
            const numTroops = this.getPromisedTerritoryTroops(pendingAttack.from);
            const quantityValues: string[] = [];
            for (let i = 1; i < numTroops; i++) {
                quantityValues.push(`${i}`);
            }
            if (quantityValues.length > 0) {
                return {
                    ephemeral: true,
                    content: `How many troops from _${this.getTerritoryName(pendingAttack.from)}_ will be attacking _${this.getTerritoryName(pendingAttack.to)}_? (one must be left behind)`,
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.StringSelect,
                            custom_id: 'game:selectAttackQuantity',
                            placeholder: 'Select quantity...',
                            min_values: 1,
                            max_values: 1,
                            options: quantityValues.map(x => ({
                                value: x,
                                label: x
                            }))
                        }]
                    }]
                };
            } else {
                // Clear the pending attack to avoid softlocking
                delete this.pendingAttackDecisions[userId];
                return {
                    ephemeral: true,
                    content: `_${this.getTerritoryName(pendingAttack.from)}_ doesn't have enough troops to stage an attack. Sorry...`
                };
            }
        }
        // If the pending decision is full, save it
        if (pendingAttack.from && pendingAttack.to && pendingAttack.quantity) {
            // Initialize this player's attack decisions map
            if (!this.state.attackDecisions[userId]) {
                this.state.attackDecisions[userId] = [];
            }
            this.state.attackDecisions[userId].push(pendingAttack as RiskMovementData);
            // Delete the pending attack so it can't be filled out backward
            delete this.pendingAttackDecisions[userId];
        }
        // Now, show them their decision
        // TODO: Fill out
        return {
            ephemeral: true,
            content: 'You have chosen the following _attack_ actions:\n'
                + this.getAttackDecisionStrings(userId).join('\n')
                + '\nYou can use the "Start Over" button to delete or change these actions.',
            components: [{
                type: ComponentType.ActionRow,
                components: [{
                    type: ComponentType.Button,
                    custom_id: 'game:attack',
                    label: randChoice('ANOTHER!', 'MORE!', 'AGAIN!', 'Attack More', 'More Bloodshed'),
                    style: ButtonStyle.Success
                }, {
                    type: ComponentType.Button,
                    custom_id: 'game:reviewDecisions',
                    label: 'Review Decisions',
                    style: ButtonStyle.Primary
                }, {
                    type: ComponentType.Button,
                    custom_id: 'game:clearAttack',
                    label: 'Start Over',
                    style: ButtonStyle.Danger
                }]
            }]
        };
    }

    private getAddDecisionStrings(userId: Snowflake): string[] {
        if (this.state.addDecisions) {
            const additions = {};
            for (const territoryId of (this.state.addDecisions[userId] ?? [])) {
                additions[territoryId] = (additions[territoryId] ?? 0) + 1;
            }
            return Object.keys(additions).map(territoryId => `- Place **${additions[territoryId]}** troop${additions[territoryId] === 1 ? '' : 's'} at _${this.getTerritoryName(territoryId)}_`);
        }
        return [];
    }

    private getAttackDecisionStrings(userId: Snowflake): string[] {
        if (this.state.attackDecisions) {
            const attacks = (this.state.attackDecisions[userId] ?? []);
            return attacks.map(a => `- Attack _${this.getTerritoryName(a.to)}_ with **${a.quantity}** troop(s) from _${this.getTerritoryName(a.from)}_`);
        }
        return [];
    }

    private getMoveDecisionStrings(userId: Snowflake): string[] {
        if (this.state.moveDecisions) {
            const moveData = this.state.moveDecisions[userId];
            if (moveData) {
                return [`- Move **${moveData.quantity}** troop(s) from _${this.getTerritoryName(moveData.from)}_ to _${this.getTerritoryName(moveData.to)}_`];
            }
        }
        return [];
    }

    private getTerritorySelectOptions(territoryIds: string[]): APISelectMenuOption[] {
        return territoryIds.map(territoryId => ({
            label: this.getTerritoryName(territoryId),
            value: territoryId,
            description: (() => {
                const result: string[] = [];
                const owner = this.getTerritoryOwner(territoryId);
                if (owner) {
                    result.push(`Owned by ${this.getPlayerDisplayName(owner)}`);
                }
                const troops = this.getTerritoryTroops(territoryId);
                if (troops) {
                    result.push(`${troops} troop(s)`);
                }
                result.push(`${this.getNumTerritoryConnections(territoryId)} neighbor(s)`);
                return result.join(', ');
            })()
        }));
    }

    private getOwnedTerritorySelectOptions(territoryIds: string[]): APISelectMenuOption[] {
        return territoryIds.map(territoryId => ({
            label: this.getTerritoryName(territoryId),
            value: territoryId,
            description: (() => {
                const result: string[] = [];
                const troops = this.getTerritoryTroops(territoryId);
                if (troops) {
                    result.push(`${troops} troop(s)`);
                }
                const troopsToBeAdded = this.getTerritoryTroopsToBeAdded(territoryId);
                if (troopsToBeAdded) {
                    result.push(`${troopsToBeAdded} to be added`)
                }
                result.push(`${this.getNumTerritoryConnections(territoryId)} neighbor(s)`);
                return result.join(', ');
            })()
        }));
    }
}
