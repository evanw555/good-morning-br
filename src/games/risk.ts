import { APIActionRowComponent, APIMessageActionRowComponent, APISelectMenuOption, ActionRowData, AttachmentBuilder, ButtonStyle, ComponentType, GuildMember, Interaction, InteractionReplyOptions, MessageActionRowComponentData, MessageFlags, Snowflake } from "discord.js";
import { DecisionProcessingResult, MessengerPayload, PrizeType, RiskConflictState, RiskGameState, RiskMovementData, RiskPlannedAttack, RiskPlayerState, RiskTerritoryState } from "../types";
import AbstractGame from "./abstract-game";
import { Canvas, Image, createCanvas } from "canvas";
import { DiscordTimestampFormat, chance, fillBackground, findCycle, getDateBetween, getJoinedMentions, getRankString, joinCanvasesHorizontal, joinCanvasesVertically, naturalJoin, randChoice, randInt, shuffle, shuffleWithDependencies, toCircle, toDiscordTimestamp, toFixed } from "evanw555.js";

import logger from "../logger";
import imageLoader from "../image-loader";
import { getMinKey, getMaxKey, drawTextCentered, applyMask, getTextLabel, withDropShadow } from "../util";

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
    }>,
    colors: Record<string, string>
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
                name: 'The Castaways',
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
        },
        colors: {
            'rgb(250, 128, 114)': 'Salmon',
            'rgb(255, 0, 0)': 'Red',
            'rgb(139, 0, 0)': 'Dark Red',
            'rgb(255, 192, 203)': 'Pink',
            'rgb(255, 105, 180)': 'Hot Pink',
            'rgb(255, 69, 0)': 'Red Orange',
            'rgb(255, 140, 0)': 'Dark Orange',
            'rgb(255, 224, 51)': 'Yellow',
            'rgb(186, 186, 247)': 'Lavender',
            'rgb(147, 112, 219)': 'Medium Purple',
            'rgb(128, 0, 128)': 'Purple',
            'rgb(75, 0, 130)': 'Indigo',
            'rgb(173, 255, 47)': 'Chartreuse',
            'rgb(152, 251, 152)': 'Pale Green',
            'rgb(0, 255, 127)': 'Spring Green',
            'rgb(0, 128, 0)': 'Green',
            'rgb(128, 128, 0)': 'Olive',
            'rgb(32, 178, 170)': 'Light Sea Green',
            'rgb(6, 249, 249)': 'Cyan',
            'rgb(57, 106, 147)': 'Steel Blue',
            'rgb(4, 4, 174)': 'Dark Blue',
            'rgb(30, 144, 255)': 'Dodger Blue',
            'rgb(139, 69, 19)': 'Saddle Brown',
            'rgb(210, 180, 140)': 'Tan',
            'rgb(248, 248, 255)': 'Ghost White'
        }
    };

    private pendingColorSelections: Record<Snowflake, string>;
    private pendingAttackDecisions: Record<Snowflake, Partial<RiskMovementData>>;
    private pendingMoveDecisions: Record<Snowflake, Partial<RiskMovementData>>;

    constructor(state: RiskGameState) {
        super(state);
        this.pendingColorSelections = {};
        this.pendingAttackDecisions = {};
        this.pendingMoveDecisions = {};
    }

    static create(members: GuildMember[], season: number): RiskGame {
        // Construct the players map
        const players: Record<Snowflake, RiskPlayerState> = {};
        for (const member of members) {
            players[member.id] = {
                displayName: member.displayName,
                points: 0
            };
        }
        // Construct the territories map
        const territories: Record<string, RiskTerritoryState> = {};
        for (const territoryId of Object.keys(RiskGame.config.territories)) {
            territories[territoryId] = {
                troops: 0
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

    private getTerritoriesForPlayerTeam(userId: Snowflake): string[] {
        return this.getTerritoriesForPlayer(this.getPlayerTeam(userId));
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
     * Gets the player's team color, or gray if it hasn't been picked yet (or if the player doesn't exist).
     * If the player is on a team, the color is the color of the team leader. Else, it's their own color.
     */
    private getPlayerTeamColor(userId?: Snowflake): string {
        if (!userId) {
            return 'gray';
        }
        return this.state.players[this.getPlayerTeam(userId)]?.color ?? 'gray';
    }

    /**
     * Gets the color of a territory's owner, or gray if it doesn't have an owner (or if it hasn't been picked yet, or if the player doesn't exist).
     */
    private getTerritoryColor(territoryId: string): string {
        // TODO: This is sorta hacky, should we change this?
        return this.getPlayerTeamColor(this.getTerritoryOwner(territoryId) ?? '');
    }

    private isColorClaimed(color: string): boolean {
        return Object.values(this.state.players).some(p => p.color === color);
    }

    private getAvailableColors(): string[] {
        return Object.keys(RiskGame.config.colors).filter(color => !this.isColorClaimed(color));
    }

    private isPlayerEliminated(userId: Snowflake): boolean {
        // Player is considered "eliminated" if they have a final rank assigned to them
        return this.state.players[userId]?.finalRank !== undefined;
    }

    private getNumEliminatedPlayers(): number {
        return this.getPlayers().filter(userId => this.isPlayerEliminated(userId)).length;
    }

    private getNumRemainingPlayers(): number {
        return this.getNumPlayers() - this.getNumEliminatedPlayers();
    }

    private setPlayerFinalRank(userId: Snowflake, finalRank: number) {
        this.state.players[userId].finalRank = finalRank;
    }

    private getPlayerWithFinalRank(finalRank: number): Snowflake {
        return this.getPlayers().filter(userId => this.state.players[userId].finalRank === finalRank)[0];
    }

    /**
     * Gets the "team" of the player (if one is assigned) by traversing to the player's ultimate eliminator.
     * If this player has no eliminator, return their own ID.
     */
    private getPlayerTeam(userId: Snowflake): Snowflake {
        const player = this.state.players[userId];
        if (player && player.eliminator) {
            // Avoid infinite recursion, just in case...
            if (player.eliminator === userId) {
                return userId;
            }
            // Recursively find the ultimate team of this player
            return this.getPlayerTeam(player.eliminator);
        }
        return userId;
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
        // Add 3 NPCs
        const userIds: string[] = [];
        for (let i = 0; i < 3; i++) {
            const userId = `npc${i}`;
            userIds.push(userId);
            this.state.players[userId] = {
                displayName: `NPC ${i}`,
                points: 0,
                troopIcon: randChoice('king', 'queen', 'rook', 'davidbeers', 'sickf', 'soldier', 'knight', 'cat', undefined)
            };
            // Give them one territory
            if (this.getTurn() > 0) {
                const potentialTerritories = this.getOwnerlessTerritories();
                if (potentialTerritories.length > 0) {
                    const randomTerritoryId = randChoice(...potentialTerritories);
                    this.state.territories[randomTerritoryId].owner = userId;
                }
            }
        }
        if (this.getTurn() > 0) {
            // For each remaining territory, give it to one random NPC
            const remainingTerritories = this.getOwnerlessTerritories();
            for (const territoryId of remainingTerritories) {
                this.state.territories[territoryId].owner = randChoice(...userIds);
            }
            // Assign random colors to all players (even existing non-NPC players)
            const colors = shuffle(Object.keys(RiskGame.config.colors));
            for (const userId of this.getPlayers()) {
                this.state.players[userId].color = colors.pop();
            }
        }
    }

    private async renderRules(): Promise<AttachmentBuilder> {
        // TODO: Create real rules sheet
        return new AttachmentBuilder('assets/risk/map-with-background.png');
    }

    private async renderAvailableColors(userId: Snowflake): Promise<AttachmentBuilder> {
        const colors = this.getAvailableColors();

        const ROW_HEIGHT = 32;
        const MARGIN = 8;

        const panels: Canvas[][] = [[]];
        for (const color of colors) {
            // If the first panel list is full, append a new one
            if (panels[panels.length - 1].length >= 8) {
                panels.push([]);
            }
            const canvas = createCanvas(ROW_HEIGHT * 4 + MARGIN * 3, ROW_HEIGHT + 2 * MARGIN);
            const context = canvas.getContext('2d');
            const avatarImage = await this.getAvatar(userId, { colorOverride: color });
            context.drawImage(avatarImage, MARGIN, MARGIN, ROW_HEIGHT, ROW_HEIGHT);
            const textLabel = getTextLabel(RiskGame.config.colors[color], ROW_HEIGHT * 3, ROW_HEIGHT, { style: color });
            context.drawImage(textLabel, ROW_HEIGHT + 2 * MARGIN, MARGIN);
            panels[panels.length - 1].push(canvas);
        }

        // Merge all canvases in a grid
        const composite = withDropShadow(joinCanvasesHorizontal(panels.map(p => joinCanvasesVertically(p))));
        // Fill the background underneath everything
        const compositeContext = composite.getContext('2d');
        compositeContext.fillStyle = 'rgb(10,10,10)';
        compositeContext.globalCompositeOperation = 'destination-over';
        compositeContext.fillRect(0, 0, composite.width, composite.height);

        return new AttachmentBuilder(composite.toBuffer()).setName('risk-colors.png');
    }

    private async renderConflict(conflict: RiskConflictState, options: { attackerRolls: number[], defenderRolls: number[], attackersLost: number, defendersLost: number, rollWinners: ('attacker' | 'defender' | 'neither')[] }): Promise<AttachmentBuilder> {
        const { from, to } = conflict;
        const conflictId = [from, to].sort().join('');
        const conflictImage = await imageLoader.loadImage(`assets/risk/connections/${conflictId}.png`);

        const WIDTH = RiskGame.config.conflict.dimensions.width;
        const HEIGHT = RiskGame.config.conflict.dimensions.height;
        const canvas = createCanvas(WIDTH, HEIGHT);
        const context = canvas.getContext('2d');

        // Draw the attacker avatar
        if (conflict.attackerId) {
            const AVATAR_WIDTH = HEIGHT / 8;
            const x = HEIGHT * (1 / 12);
            const y = HEIGHT * (1 / 12);
            const attackerAvatarImage = await this.getAvatar(conflict.attackerId);
            context.drawImage(attackerAvatarImage, x - AVATAR_WIDTH / 2, y - AVATAR_WIDTH / 2, AVATAR_WIDTH, AVATAR_WIDTH);
        }

        // Draw the defender avatar
        if (conflict.defenderId) {
            const AVATAR_WIDTH = HEIGHT / 8;
            const x = WIDTH - HEIGHT * (1 / 12);
            const y = HEIGHT * (1 / 12);
            const defenderAvatarImage = await this.getAvatar(conflict.defenderId);
            context.drawImage(defenderAvatarImage, x - AVATAR_WIDTH / 2, y - AVATAR_WIDTH / 2, AVATAR_WIDTH, AVATAR_WIDTH);
        }

        // Draw the attacker troops
        const attackerTroopImage = await this.getTroopImage(conflict.attackerId);
        const crossOutImage = await imageLoader.loadImage('assets/common/crossout.png');
        for (let i = 0; i < conflict.initialAttackerTroops; i++) {
            const TROOP_WIDTH = HEIGHT / 8;
            const frontLine = i < 3;
            const x = WIDTH * ((frontLine ? 2 : 1) / 8);
            const y = HEIGHT * ((frontLine ? i : i - 3) + 2) / ((frontLine ? 3 : conflict.initialAttackerTroops - 3) + 3);
            const defeated = i >= conflict.attackerTroops;
            const newlyDefeated = defeated && i - conflict.attackerTroops < options.attackersLost;
            const previouslyDefeated = defeated && !newlyDefeated;
            context.globalAlpha = previouslyDefeated ? 0.1 : 1;
            context.drawImage(attackerTroopImage, x - TROOP_WIDTH / 2, y - TROOP_WIDTH / 2, TROOP_WIDTH, TROOP_WIDTH);
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
        for (let i = 0; i < options.rollWinners.length; i++) {
            const rollWinner = options.rollWinners[i];
            const ARROW_WIDTH = HEIGHT / 6;
            const ARROW_HEIGHT = HEIGHT / 8;
            const x = WIDTH * (4 / 8);
            const y = HEIGHT * ((2 + i) / 6);
            const left = { x: x - ARROW_WIDTH / 2, y };
            const right = { x: x + ARROW_WIDTH / 2, y };
            if (rollWinner === 'attacker') {
                this.renderArrow(context, left, right, { thickness: ARROW_HEIGHT / 2, fillStyle: this.getPlayerTeamColor(conflict.attackerId) });
                // const attackerArrowImage = await imageLoader.loadImage('assets/risk/attacker-arrow.png');
                // context.drawImage(attackerArrowImage, x - ARROW_WIDTH / 2, y - ARROW_HEIGHT / 2, ARROW_WIDTH, ARROW_HEIGHT);
            } else if (rollWinner === 'defender') {
                this.renderArrow(context, right, left, { thickness: ARROW_HEIGHT / 2, fillStyle: this.getPlayerTeamColor(conflict.defenderId) });
                // const defenderArrowImage = await imageLoader.loadImage('assets/risk/defender-arrow.png');
                // context.drawImage(defenderArrowImage, x - ARROW_WIDTH / 2, y - ARROW_HEIGHT / 2, ARROW_WIDTH, ARROW_HEIGHT);
            }
        }

        // Draw the defender dice rolls
        for (let i = 0; i < options.defenderRolls.length; i++) {
            const DIE_WIDTH = HEIGHT / 8;
            const x = WIDTH * (5 / 8);
            const y = HEIGHT * ((2 + i) / 6);
            const roll = options.defenderRolls[i];
            const dieImage = await imageLoader.loadImage(`assets/common/dice/${conflict.symmetrical ? 'r' : 'w'}${roll}.png`);
            context.drawImage(dieImage, x - DIE_WIDTH / 2, y - DIE_WIDTH / 2, DIE_WIDTH, DIE_WIDTH);
        }

        // Draw the defender troops
        const defenderTroopImage = await this.getTroopImage(conflict.defenderId);
        for (let i = 0; i < conflict.initialDefenderTroops; i++) {
            const TROOP_WIDTH = HEIGHT / 8;
            const frontLine = i < 3;
            const x = WIDTH * ((frontLine ? 6 : 7) / 8);
            const y = HEIGHT * ((frontLine ? i : i - 3) + 2) / ((frontLine ? 3 : conflict.initialDefenderTroops - 3) + 3);
            const defeated = i >= conflict.defenderTroops;
            const newlyDefeated = defeated && i - conflict.defenderTroops < options.defendersLost;
            const previouslyDefeated = defeated && !newlyDefeated;
            context.globalAlpha = previouslyDefeated ? 0.2 : 1;
            context.drawImage(defenderTroopImage, x - TROOP_WIDTH / 2, y - TROOP_WIDTH / 2, TROOP_WIDTH, TROOP_WIDTH);
            if (newlyDefeated) {
                context.drawImage(crossOutImage, x - TROOP_WIDTH / 2, y - TROOP_WIDTH / 2, TROOP_WIDTH, TROOP_WIDTH);
            }
            context.globalAlpha = 1;
        }

        // Draw the title
        const titleImage = getTextLabel(`Battle for ${this.getTerritoryName(conflict.to)}`, WIDTH * (5 / 8), HEIGHT / 8, {
            font: `italic bold ${HEIGHT / 12}px serif`
        });
        context.drawImage(titleImage, WIDTH * (3 / 16), (HEIGHT / 6) - (HEIGHT / 16));

        // Repost the entire canvas with a drop shadow on everything
        context.drawImage(withDropShadow(canvas), 0, 0);

        // Draw the conflict background
        context.globalCompositeOperation = 'destination-over';
        // Make it a little darker...
        context.globalAlpha = 0.3;
        context.fillStyle = 'black';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.globalAlpha = 1;
        // Draw the image itself
        context.drawImage(conflictImage, 0, 0, WIDTH, HEIGHT);

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

    private renderArrow(context: CanvasRenderingContext2D, from: Coordinates, to: Coordinates, options?: { thickness?: number, tipLength?: number, fillStyle?: string }) {
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

        context.fillStyle = options?.fillStyle ?? 'white';
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
            context.drawImage(await this.getAvatar(userId), baseX, 0, ROW_HEIGHT, ROW_HEIGHT);
            baseX += ROW_HEIGHT + MARGIN;
            // Draw the bar
            const barWidth = MAX_BAR_WIDTH * points / maxPoints;
            context.fillStyle = this.getPlayerTeamColor(userId);
            context.fillRect(baseX, 0, barWidth, ROW_HEIGHT);
            baseX += barWidth + MARGIN;
            // Draw the troop icons
            const troopImage = await this.getTroopImage(userId);
            for (let i = 0; i < troops; i++) {
                context.drawImage(troopImage, baseX, 0, ROW_HEIGHT, ROW_HEIGHT);
                baseX += ROW_HEIGHT / 2;
            }
            // Now, draw the extra troop formula
            baseX = WIDTH - ROW_HEIGHT * 3;
            context.fillStyle = 'white';
            context.fillText(`${this.getNumTerritoriesForPlayer(userId)}/3 = `, baseX, ROW_HEIGHT / 2);
            baseX += ROW_HEIGHT;
            for (let i = 0; i < extraTroops; i++) {
                context.drawImage(troopImage, baseX, 0, ROW_HEIGHT, ROW_HEIGHT);
                baseX += ROW_HEIGHT / 2;
            }
            renders.push(canvas);
        }
        return new AttachmentBuilder(joinCanvasesVertically(renders).toBuffer()).setName('risk-weekly.png');
    }

    private async renderRoster(height: number): Promise<Canvas> {
        const width = height / 4;
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');

        context.fillStyle = 'black';
        context.fillRect(0, 0, canvas.width, canvas.height);

        const n = this.getNumPlayers();
        const orderedPlayers = this.getOrderedPlayers();
        const ROW_HEIGHT = height / n;
        for (let i = 0; i < n; i++) {
            const userId = orderedPlayers[i];
            const y = i * ROW_HEIGHT;
            const avatarImage = await this.getAvatar(userId);
            context.drawImage(avatarImage, 0, y, width / 4, width / 4);
            context.font = '18px sans-serif';
            context.fillStyle = 'white';
            const text = this.isPlayerEliminated(userId)
                ? `${getRankString(this.state.players[userId].finalRank ?? 0)} +${this.getPlayerNewTroops(userId)}`
                : `${this.getNumTerritoriesForPlayer(userId)}/${this.getTroopsForPlayer(userId)} +${this.getPlayerNewTroops(userId)}`;
            context.fillText(text, width * 0.25, y + ROW_HEIGHT / 2);
        }

        return canvas;
    }

    private async renderMap(options?: { showRoster?: boolean, invasions?: RiskPlannedAttack[], additions?: Record<string, number>, movements?: RiskMovementData[] }): Promise<Canvas> {
        const mapImage = await imageLoader.loadImage('assets/risk/map.png');

        // Define the canvas
        const canvas = createCanvas(mapImage.width, mapImage.height);
        const context = canvas.getContext('2d');

        // Draw each territory cutout
        for (const territoryId of this.getTerritories()) {
            context.drawImage(await this.getTerritoryCutoutRender(territoryId), 0, 0);
        }

        // Draw the map template as the top layer
        context.drawImage(mapImage, 0, 0);

        // Draw the number of troops in each territory
        // const troopsImage = await imageLoader.loadImage('assets/risk/troops/1.png');
        // const newTroopsImage = await imageLoader.loadImage('assets/risk/troops/1new.png');
        // const invadingTroopsImage = await imageLoader.loadImage('assets/risk/troops/1invading.png');
        const troopsWidth = 24;
        for (const territoryId of this.getTerritories()) {
            // const troopsImage = await imageLoader.loadAvatar(this.getTerritoryOwner(territoryId) ?? '', 16);
            const numTroops = this.getTerritoryTroops(territoryId);
            const additions = (options?.additions ?? {})[territoryId] ?? 0;
            // TODO: Improve this logic
            const invadingTroops = options?.invasions?.filter(m => m.attack.from == territoryId)[0]?.actualQuantity ?? 0;
            const movedTroops = options?.movements?.filter(m => m.to === territoryId)[0]?.quantity ?? 0;
            const troopLocations = this.getRandomTerritoryTroopLocations(territoryId, numTroops);
            for (let i = 0; i < troopLocations.length; i++) {
                const { x, y } = troopLocations[i];
                const newAddition = troopLocations.length - i <= additions;
                const invading = troopLocations.length - i <= invadingTroops;
                const moved = troopLocations.length - i <= movedTroops;
                const troopImage = await this.getTroopImage(this.getTerritoryOwner(territoryId) ?? '', invading ? 'attacking' : (newAddition ? 'added' : (moved ? 'moved' : undefined)));
                context.drawImage(troopImage, x - troopsWidth / 2, y - troopsWidth / 2, troopsWidth, troopsWidth);
            }
        }

        // If invasions/movements are being rendered, render a shade everywhere not overlapping with the 2 territories
        const highlightedTerritories: Set<string> = new Set();
        // if (options?.additions) {
        //     for (const territoryId of Object.keys(options.additions)) {
        //         highlightedTerritories.add(territoryId);
        //     }
        // }
        if (options?.invasions) {
            for (const plannedAttack of options.invasions) {
                const { from, to } = plannedAttack.attack;
                highlightedTerritories.add(from);
                highlightedTerritories.add(to);
            }
        }
        if (options?.movements) {
            for (const { from, to } of options.movements) {
                highlightedTerritories.add(from);
                highlightedTerritories.add(to);
            }
        }
        if (highlightedTerritories.size > 0) {
            const inverseMask = await this.getInverseTerritoryCutoutMask(Array.from(highlightedTerritories));
            context.globalAlpha = 0.8;
            context.drawImage(inverseMask, 0, 0);
            context.globalAlpha = 1;
        }

        // If an invasion is specified, draw the invasion arrow(s)
        if (options?.invasions) {
            for (const plannedAttack of options.invasions) {
                const { from, to } = plannedAttack.attack;
                const fromCoordinates = RiskGame.config.territories[from].termini[to];
                const toCoordinates = RiskGame.config.territories[to].termini[from];
                this.renderArrow(context, fromCoordinates, toCoordinates);
            }
        }

        // If movements are specified, draw the movement arrows
        if (options?.movements) {
            for (const { from, to } of options.movements) {
                const fromCoordinates = RiskGame.config.territories[from].termini[to];
                const toCoordinates = RiskGame.config.territories[to].termini[from];
                this.renderArrow(context, fromCoordinates, toCoordinates);
            }
        }

        if (options?.showRoster) {
            return joinCanvasesHorizontal([canvas, await this.renderRoster(canvas.height)]);
        }

        return canvas;
    }

    private async renderAdditions(additions: Record<string, number>): Promise<AttachmentBuilder> {
        return new AttachmentBuilder((await this.renderMap({ additions })).toBuffer()).setName('risk-additions.png');
    }

    private async renderInvasion(invasions: RiskPlannedAttack[]): Promise<AttachmentBuilder> {
        return new AttachmentBuilder((await this.renderMap({ invasions })).toBuffer()).setName('risk-invasion.png');
    }

    private async renderMovements(movements: RiskMovementData[]): Promise<AttachmentBuilder> {
        return new AttachmentBuilder((await this.renderMap({ movements })).toBuffer()).setName('risk-movements.png');
    }

    async renderState(options?: { showPlayerDecision?: string | undefined; seasonOver?: boolean | undefined; admin?: boolean | undefined; } | undefined): Promise<Buffer> {
        return (await this.renderMap({ showRoster: true })).toBuffer();
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

    private async getInverseTerritoryCutoutMask(territoryIds: string[]): Promise<Canvas> {
        const maskImages = await Promise.all(territoryIds.map(async (territoryId) => imageLoader.loadImage(`assets/risk/territories/${territoryId.toLowerCase()}.png`)));

        const canvas = createCanvas(maskImages[0].width, maskImages[0].height);
        const context = canvas.getContext('2d');

        // First, draw each territory cutout
        for (const maskImage of maskImages) {
            context.drawImage(maskImage, 0, 0);
        }

        // Now, fill in everything everything not including these masks
        context.save();
        context.globalCompositeOperation = 'source-out';
        context.fillStyle = 'black';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.restore();

        return canvas;
    }

    private async getAvatar(userId: Snowflake, options?: { colorOverride?: string }): Promise<Canvas> {
        const avatar = await imageLoader.loadAvatar(userId, 64);
        const ringWidth = 6;

        const canvas = createCanvas(64 + 2 * ringWidth, 64 + 2 * ringWidth);
        const context = canvas.getContext('2d');

        context.fillStyle = options?.colorOverride ?? this.getPlayerTeamColor(userId);
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(toCircle(avatar), ringWidth, ringWidth, 64, 64);

        return toCircle(canvas);
    }

    private async getTroopImage(userId: Snowflake | undefined, modifier?: 'added' | 'moved' | 'attacking' | 'eliminated'): Promise<Canvas | Image> {
        // TODO: Refactor this to another method or something
        const troopIconName = userId ? (this.state.players[userId]?.troopIcon ?? 'default') : 'default';

        // Load up the 2 component images
        const baseImage = await imageLoader.loadImage(`assets/risk/troops/${troopIconName}.png`);
        const fillImage = await imageLoader.loadImage(`assets/risk/troops/${troopIconName}_fill.png`);

        // Initialize the canvas for the resulting troop image
        const canvas = createCanvas(baseImage.width, baseImage.height);
        const context = canvas.getContext('2d');
        context.save();

        // First, draw the fill image using different strategies
        context.drawImage(fillImage, 0, 0);
        context.globalCompositeOperation = 'source-in';
        switch (modifier) {
            case 'added':
                context.fillStyle = 'green';
                break;
            case 'moved':
                context.fillStyle = 'blue';
                break;
            case 'attacking':
                context.fillStyle = 'red';
                break;
            case 'eliminated':
                context.fillStyle = 'gray';
                break;
            case undefined:
                context.fillStyle = 'white';
                break;
        }
        context.fillRect(0, 0, canvas.width, canvas.height);

        // Then, draw the base image
        context.globalCompositeOperation = 'source-over';
        context.drawImage(baseImage, 0, 0);

        // Trim the outside
        // context.globalCompositeOperation = 'destination-in';
        // context.drawImage(baseImage, 0, 0);
        context.restore();

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

        // If we're on the first turn, abort now before handing out troops
        if (this.getTurn() === 1) {
            return [];
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
                // Choose additions (even if eliminated, player can still add to territories owned by team)
                const possibleAdditionTerritories = this.getTerritoriesForPlayerTeam(userId);
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
                        const targets = this.getTerritoryConnections(territoryId).filter(otherId => this.getTerritoryOwner(otherId) !== userId);
                        const target = targets[0]; // getMinKey(shuffle(targets), (territoryId) => this.getTerritoryTroops(territoryId));
                        const p = 1; // this.getTerritoryTroops(territoryId) > 5 ? 1 : (this.getTerritoryTroops(territoryId) >= this.getTerritoryTroops(target) ? 0.5 : 0.25);
                        if (chance(p)) {
                            attacks.push({
                                from: territoryId,
                                to: target,
                                quantity: randInt(1, this.getPromisedTerritoryTroops(territoryId))
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
                // Assign the territory to this user and give them a random color
                this.state.territories[randomTerritoryId].owner = randomUserId;
                this.state.territories[randomTerritoryId].troops = 1;
                this.state.players[randomUserId].color = randChoice(...this.getAvailableColors());
                // Mark the player as draft-complete
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
                    this.addPlayerNewTroops(userId, -1);
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
            // Validate that the attacker ID exists
            if (!attackerId) {
                delete this.state.currentConflict;
                return {
                    continueProcessing: true,
                    summary: 'Attempted to process conflict with no attacker territory owner... WTF??'
                };
            }
            // Now, roll all the dice
            const attackerDice = Math.min(3, conflict.attackerTroops);
            const defenderDice = Math.min(conflict.symmetrical ? 3 : 2, conflict.defenderTroops);
            const attackerRolls = this.getSortedDiceRolls(attackerDice);
            const defenderRolls = this.getSortedDiceRolls(defenderDice);
            const numComparisons = Math.min(attackerDice, defenderDice);
            let attackersLost = 0;
            let defendersLost = 0;
            // Compare each set
            let rollWinners: ('attacker' | 'defender' | 'neither')[] = [];
            for (let i = 0; i < numComparisons; i++) {
                if (attackerRolls[i] > defenderRolls[i]) {
                    conflict.defenderTroops--;
                    defendersLost++;
                    rollWinners.push('attacker');
                } else if (conflict.symmetrical && attackerRolls[i] === defenderRolls[i]) {
                    rollWinners.push('neither');
                } else {
                    conflict.attackerTroops--;
                    attackersLost++;
                    rollWinners.push('defender');
                }
            }
            // Say something interesting about this exchange
            // TODO: Add a lot more cool stuff here
            let summary = '';
            if (rollWinners.every(w => w === 'neither')) {
                summary += 'A total standstill as neither attacker overpowers the other!\n';
            } else if (rollWinners.length === 3) {
                if (rollWinners.every(w => w === 'attacker')) {
                    summary += 'Absolute bloodshed!\n';
                } else if (rollWinners.every(w => w === 'defender')) {
                    summary += 'A triple success by the defense!\n';
                } else {
                    summary += 'A little more triple action!\n';
                }
            } else if (conflict.defenderTroops === 1 && rollWinners.every(w => w === 'defender')) {
                summary += 'The defender makes a valiant last stand!\n';
            } else if (conflict.attackerTroops === 1 && rollWinners.every(w => w === 'attacker')) {
                summary += 'The last attacker standing continues the fight!\n';
            } else {
                summary += 'Stuff happened!\n';
            }
            // If the counter-attack is over...
            if (conflict.symmetrical && (conflict.attackerTroops === 0 || conflict.defenderTroops === 0)) {
                // Update the troop counts for both territories
                this.addTerritoryTroops(conflict.to, -conflict.initialDefenderTroops + conflict.defenderTroops);
                this.addTerritoryTroops(conflict.from, -conflict.initialAttackerTroops + conflict.attackerTroops);
                // Delete the current conflict
                delete this.state.currentConflict;
                // Send a message
                return {
                    continueProcessing: true,
                    summary: {
                        content: `${summary}The conflict has reached an end. No territories have changed hands.`,
                        files: [await this.renderConflict(conflict, { attackerRolls, defenderRolls, attackersLost, defendersLost, rollWinners })]
                    }
                };
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
                        content: `${summary}**${this.getPlayerDisplayName(defenderId)}** has successfully fended off **${this.getPlayerDisplayName(attackerId)}** at _${this.getTerritoryName(conflict.to)}_!`,
                        files: [await this.renderConflict(conflict, { attackerRolls, defenderRolls, attackersLost, defendersLost, rollWinners })]
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
                // Delete the conflict
                delete this.state.currentConflict;
                // Render the image now before the defender's color is possibly updated
                const render = await this.renderConflict(conflict, { attackerRolls, defenderRolls, attackersLost, defendersLost, rollWinners });
                // If the defender is now eliminated, handle that
                if (defenderId && this.getNumTerritoriesForPlayer(defenderId) === 0) {
                    // Mark them as eliminated and assign their final rank
                    const finalRank = this.getNumRemainingPlayers();
                    this.setPlayerFinalRank(defenderId, finalRank);
                    // If they're eliminated for 2nd, assign the final winners
                    if (finalRank === 2) {
                        this.addWinner(attackerId);
                        this.addWinner(defenderId);
                        // TODO: This is pretty hacky and seems flimsy. Can we add winners differently?
                        this.addWinner(this.getPlayerWithFinalRank(3));
                    }
                    // Delete their color and assign them to the attacker's team
                    delete this.state.players[defenderId].color;
                    this.state.players[defenderId].eliminator = attackerId;
                    // TODO: Send a proper message/image
                    summary += `**${this.getPlayerDisplayName(defenderId)}** has been eliminated, finishing at rank **${getRankString(finalRank)}**!\n`;
                }
                // Send a message
                return {
                    continueProcessing: true,
                    summary: {
                        content: `${summary}**${this.getPlayerDisplayName(attackerId)}** has defeated **${this.getPlayerDisplayName(defenderId)}** at _${this.getTerritoryName(conflict.to)}_!`,
                        files: [render]
                    }
                };
            }
            // Otherwise, provide an update of the conflict
            return {
                continueProcessing: true,
                summary: {
                    content: `${summary}**${conflict.attackerTroops}** attacker troops remaining vs **${conflict.defenderTroops}** defending...`,
                    files: [await this.renderConflict(conflict, { attackerRolls, defenderRolls, attackersLost, defendersLost, rollWinners })]
                }
            };
        }
        // If the attack decisions haven't been processed yet, process them
        if (this.state.attackDecisions) {
            // First, construct the processed attack data map
            this.state.plannedAttacks = {};
            let i = 0;
            for (const [ userId, attacks ] of Object.entries(this.state.attackDecisions)) {
                for (const attack of attacks) {
                    const id = `${i++}`;
                    this.state.plannedAttacks[id] = {
                        id,
                        userId,
                        attack,
                        actualQuantity: attack.quantity
                    };
                }
            }
            // Then, delete the unprocessed attack decisions from the state
            delete this.state.attackDecisions;
            // If for some reason there are no planned attacks, delete it now to avoid processing
            if (i === 0) {
                delete this.state.plannedAttacks;
            }
            // TODO: Temp message to show that this worked
            return {
                continueProcessing: true,
                summary: {
                    content: `Processed attack decisions into **${i}** attacks...`,
                    files: [await this.renderMovements(Object.values(this.state.plannedAttacks ?? {}).map(a => a.attack))]
                }
            };
        }
        // If there are any attack decisions, process them
        if (this.state.plannedAttacks) {
            // First, comb through the planned attacks and fix the actual quantity of the attack
            const plannedAttacks = this.state.plannedAttacks;
            for (const plannedAttack of Object.values(plannedAttacks)) {
                plannedAttack.actualQuantity = Math.min(plannedAttack.attack.quantity, this.getTerritoryTroops(plannedAttack.attack.from) - 1);
            }
            // Find any possible cyclical attacks
            let plannedAttack: RiskPlannedAttack;
            let symmetricAttack: RiskPlannedAttack | undefined = undefined;
            let summaryContent = '';
            const dependencies = this.getPlannedAttackDependencyMap();
            const cyclicalAttacks = findCycle(dependencies, { randomize: true })?.map(id => plannedAttacks[id]);
            if (cyclicalAttacks) {
                // Sort the cyclical attacks by quantity
                cyclicalAttacks.sort((a, b) => b.actualQuantity - a.actualQuantity);
                if (cyclicalAttacks.length === 2) {
                    // If there's a reciprocal attack, choose the biggest one...
                    plannedAttack = cyclicalAttacks[0];
                    const reciprocalAttack = cyclicalAttacks[1];
                    // The planned reciprocal attack must be discarded regardless of whether it will be symmetric
                    delete this.state.plannedAttacks[reciprocalAttack.id];
                    // Handle it depending on how the quantities compare...
                    if (plannedAttack.actualQuantity === reciprocalAttack.actualQuantity) {
                        // The attacks are of the same quantity, so initiate a symmetrical attack
                        symmetricAttack = reciprocalAttack;
                        summaryContent = `**${this.getPlayerDisplayName(plannedAttack.userId)}** and **${this.getPlayerDisplayName(symmetricAttack.userId)}** `
                            + `have launched attacks against each other with the same number of troops! A conflict will begin with two attackers no potential for territory capture...`;
                    } else {
                        // One attack is larger, so pick that one and leave the other discarded
                        // TODO: Construct a summary and render explaining this situation
                        summaryContent = `**${this.getPlayerDisplayName(reciprocalAttack.userId)}** tried to launch an attack `
                            + `from _${this.getTerritoryName(reciprocalAttack.attack.from)}_ to _${this.getTerritoryName(reciprocalAttack.attack.to)}_ `
                            + `with **${reciprocalAttack.actualQuantity}** troop(s), but **${this.getPlayerDisplayName(plannedAttack.userId)}** `
                            + `launched an even larger counter-attack with **${plannedAttack.actualQuantity}** troops!`;
                    }
                } else if (cyclicalAttacks.length > 2) {
                    // If there's a cycle of 3+ planned attacks, choose the largest attack to go first
                    plannedAttack = cyclicalAttacks[0];
                    // TODO: Construct a summary and render explaining this situation
                    if (cyclicalAttacks.filter(a => a.actualQuantity === plannedAttack.actualQuantity).length > 1) {
                        summaryContent = `**${cyclicalAttacks.length}** teams started a circular battle! `
                            + `**${this.getPlayerDisplayName(plannedAttack.userId)}'s** army at _${this.getTerritoryName(plannedAttack.attack.from)}_ has been randomly selected to begin the conflict...`;
                    } else {
                        summaryContent = `**${cyclicalAttacks.length}** teams started a circular battle! `
                            + `**${this.getPlayerDisplayName(plannedAttack.userId)}'s** army at _${this.getTerritoryName(plannedAttack.attack.from)}_ is the strongest, so it'll begin the first leg of the conflict...`;
                    }
                } else {
                    // Fallback just in case there's a 0/1-node cycle
                    return {
                        continueProcessing: true,
                        summary: `WTF! I found a cycle of planned attacks of length **${cyclicalAttacks.length}**. Admin?`
                    };
                }
            } else {
                // There are no cycles, so shuffle with dependencies and choose the first one
                try {
                    const orderedAttackIds = shuffleWithDependencies(Object.keys(dependencies), dependencies);
                    plannedAttack = plannedAttacks[orderedAttackIds[0]];
                } catch (err) {
                    void logger.log('Attack decisions still contain a cycle, so picking one at random!');
                    plannedAttack = randChoice(...Object.values(plannedAttacks));
                }
                summaryContent = `**${this.getPlayerDisplayName(plannedAttack.userId)}** has staged an attack from `
                    + `_${this.getTerritoryName(plannedAttack.attack.from)}_ to _${this.getTerritoryName(plannedAttack.attack.to)}_ with **${plannedAttack.actualQuantity}** troop(s)!`;
            }
            // Validate that the chosen planned attack actually exists
            if (!plannedAttack) {
                void logger.log(`Couldn't find next territory to attack. Planned attacks: \`${JSON.stringify(plannedAttacks)}\``);
                return {
                    continueProcessing: true,
                    summary: 'WTF! Couldn\'t find the next territory attack node to process...'
                };
            }
            const { id: attackId, userId: ownerId, attack: conflict, actualQuantity } = plannedAttack;
            if (conflict.quantity !== actualQuantity) {
                void logger.log(`<@${ownerId}> tried to attack _${this.getTerritoryName(conflict.to)}_ with **${conflict.quantity}** troop(s) `
                    + `but _${this.getTerritoryName(conflict.from)}_ only has **${this.getTerritoryTroops(conflict.from)}**, so only attacking with **${actualQuantity}**`);
            }
            // Delete this attack decision
            delete this.state.plannedAttacks[attackId];
            // Delete the planned attacks if there are none yet left
            if (Object.keys(this.state.plannedAttacks).length === 0) {
                delete this.state.plannedAttacks;
            }
            // Validation just in case this conflict isn't possible
            if (actualQuantity < 1) {
                return {
                    continueProcessing: true,
                    summary: `**${this.getPlayerDisplayName(ownerId)}** tried to launch an attack from _${this.getTerritoryName(conflict.from)}_ to _${this.getTerritoryName(conflict.to)}_, but couldn't due to a lack of troops...`
                };
            }
            if (plannedAttack.userId !== this.getTerritoryOwner(plannedAttack.attack.from)) {
                return {
                    continueProcessing: true,
                    summary: `**${this.getPlayerDisplayName(plannedAttack.userId)}** tried to launch an attack from _${this.getTerritoryName(conflict.from)}_ to _${this.getTerritoryName(conflict.to)}_, but that territory no longer belongs to him...`
                };
            }
            if (this.getTerritoryOwner(conflict.from) === this.getTerritoryOwner(conflict.to)) {
                return {
                    continueProcessing: true,
                    summary: `**${this.getPlayerDisplayName(ownerId)}** tried to launch an attack from _${this.getTerritoryName(conflict.from)}_ to _${this.getTerritoryName(conflict.to)}_, but called it off moments before firing on his own troops...`
                };
            }
            // Save this node as the current conflict
            // TODO: Validate this better, e.g. with logging...
            const initialDefenderTroops = symmetricAttack?.actualQuantity ?? this.getTerritoryTroops(conflict.to);
            this.state.currentConflict = {
                from: conflict.from,
                to: conflict.to,
                quantity: actualQuantity,
                attackerId: this.getTerritoryOwner(conflict.from),
                defenderId: this.getTerritoryOwner(conflict.to),
                initialAttackerTroops: actualQuantity,
                initialDefenderTroops,
                symmetrical: symmetricAttack ? true : undefined,
                attackerTroops: actualQuantity,
                defenderTroops: initialDefenderTroops
            };
            return {
                continueProcessing: true,
                summary: {
                    content: summaryContent,
                    files: [await this.renderInvasion(cyclicalAttacks ? cyclicalAttacks : [plannedAttack])]
                }
            };
        }
        // If there are any move decisions, process them last
        if (this.state.moveDecisions) {
            const moveDecisions = this.state.moveDecisions;
            const actualMovements: RiskMovementData[] = [];
            for (const [ userId, data ] of Object.entries(moveDecisions)) {
                // Validate that there are enough troops left, and that they still own both territories
                if (this.getTerritoryTroops(data.from) > 1 && this.getTerritoryOwner(data.from) === userId && this.getTerritoryOwner(data.to) === userId) {
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
            if (actualMovements.length === 0) {
                return {
                    continueProcessing: false,
                    summary: 'No troops were moved this week.'
                };
            } else {
                return {
                    continueProcessing: false,
                    summary: {
                        content: 'Troops were moved!',
                        files: [await this.renderMovements(actualMovements)]
                    }
                };
            }
        }
        // Last resort fallback, this should never happen
        return {
            continueProcessing: false,
            summary: 'That\'s all!'
        };
    }

    private getPlannedAttackDependencyMap(): Record<string, string[]> {
        if (!this.state.plannedAttacks) {
            return {};
        }
        const plannedAttacks = Object.values(this.state.plannedAttacks);
        const dependencies: Record<string, string[]> = {};
        for (const { id, attack } of plannedAttacks) {
            // Get the ID of each planned attack in this attack's target territory
            const dependencyIds = plannedAttacks.filter(a => a.attack.from === attack.to).map(a => a.id);
            dependencies[id] = [...(dependencies[id] ?? []), ...dependencyIds];
        }

        return dependencies;
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
                    // Respond with a prompt for the user to pick a color first
                    await interaction.reply({
                        ephemeral: true,
                        content: 'First, choose a color:',
                        files: [await this.renderAvailableColors(userId)],
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.StringSelect,
                                custom_id: 'game:selectColor',
                                min_values: 1,
                                max_values: 1,
                                options: this.getAvailableColorSelectOptions()
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
                case 'game:selectColor': {
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
                    // Validate the player's selected color
                    const color = interaction.values[0];
                    if (!color) {
                        throw new Error('You were supposed to choose a color! (see admin)');
                    }
                    if (this.isColorClaimed(color)) {
                        throw new Error(`**${RiskGame.config.colors[color] ?? 'That color'}** has already been claimed. Pick another color!`);
                    }
                    // Save the color as a pending color decision
                    this.pendingColorSelections[userId] = color;
                    // Now, prompt for them to choose a starting location
                    await interaction.reply({
                        ephemeral: true,
                        content: `You've selected **${RiskGame.config.colors[color] ?? color}**. Now, where would you like to start?`,
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
                        throw new Error('Ummmmm... you were supposed to select a territory...');
                    }
                    const existingOwnerId = this.getTerritoryOwner(territoryId);
                    if (existingOwnerId) {
                        throw new Error(`You can't select _${this.getTerritoryName(territoryId)}_, it's already been claimed by ${this.getPlayerDisplayName(existingOwnerId)}!`);
                    }
                    // Validate the pending selected color too, since it may have been claimed since the last interaction
                    const color = this.pendingColorSelections[userId];
                    if (!color) {
                        throw new Error('You were supposed to choose a color! (see admin)');
                    }
                    if (this.isColorClaimed(color)) {
                        throw new Error(`**${RiskGame.config.colors[color] ?? 'That color'}** has already been claimed. Go back and pick another color!`);
                    }
                    // Confirm the selected color and location
                    this.state.players[userId].color = color;
                    this.state.territories[territoryId].owner = userId;
                    this.state.territories[territoryId].troops = 1;
                    // Delete the pending color selection and mark this player as draft-complete
                    delete this.pendingColorSelections[userId];
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

    private getAvailableColorSelectOptions(): APISelectMenuOption[] {
        return this.getAvailableColors().map(color => ({
            label: RiskGame.config.colors[color] ?? color,
            value: color
        }));
    }
}
