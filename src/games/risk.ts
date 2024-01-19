import { APIActionRowComponent, APIMessageActionRowComponent, APISelectMenuOption, ActionRowData, AttachmentBuilder, ButtonStyle, ComponentType, GuildMember, Interaction, InteractionReplyOptions, MessageActionRowComponentData, MessageFlags, Snowflake } from "discord.js";
import { DecisionProcessingResult, GamePlayerAddition, MessengerPayload, PrizeType, RiskConflictAgentData, RiskConflictState, RiskGameState, RiskMovementData, RiskPlannedAttack, RiskPlayerState, RiskTerritoryState } from "../types";
import AbstractGame from "./abstract-game";
import { Canvas, Image, createCanvas } from "canvas";
import { DiscordTimestampFormat, chance, findCycle, getDateBetween, getJoinedMentions, getRankString, joinCanvasesHorizontal, joinCanvasesVertically, naturalJoin, randChoice, randInt, shuffle, shuffleWithDependencies, toCircle, toDiscordTimestamp, toFixed } from "evanw555.js";
import { getMinKey, getMaxKey, drawTextCentered, getTextLabel, withDropShadow, drawBackground, quantify } from "../util";

import logger from "../logger";
import imageLoader from "../image-loader";

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
    colors: Record<string, string>,
    defaultTroopIcon: string,
    customTroopIcons: string[]
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
                    A: { x: 231, y: 126 },
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
                    Y: { x: 389, y: 595 },
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
                    W: { x: 180, y: 657 }
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
        },
        defaultTroopIcon: 'default',
        customTroopIcons: [
            'cat',
            'davidbeers',
            'king',
            'knight',
            'queen',
            'rook',
            'sickf',
            'soldier'
        ]
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
        // Construct the territories map
        const territories: Record<string, RiskTerritoryState> = {};
        for (const territoryId of Object.keys(RiskGame.config.territories)) {
            territories[territoryId] = {
                troops: 0
            };
        }
        // Construct the players map (capped at 1 for each territory)
        const maxPlayers = Object.keys(territories).length;
        const players: Record<Snowflake, RiskPlayerState> = {};
        for (let i = 0; i < members.length; i++) {
            const member = members[i];
            if (i < maxPlayers) {
                players[member.id] = {
                    displayName: member.displayName,
                    points: 0
                };
            } else {
                void logger.log(`Refusing to add player **${member.displayName}** to initial game state (index **${i}**, max **${maxPlayers}** players)`);
            }
        }
        // Return the constructed state
        return new RiskGame({
            type: 'RISK',
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
            return 'Later this morning, you will all be vying for a starting location on the map! Your draft order is determined by your weekly points:\n'
                + this.getSortedDraftEntries().map(entry => `- ${toDiscordTimestamp(entry.date, DiscordTimestampFormat.ShortTime)} **${this.getPlayerDisplayName(entry.userId)}**`).join('\n');
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
     * Gets a list of territory IDs representing territories adjacent to a given territory that have a different owner.
     */
    private getHostileTerritoryConnections(territoryId: string): string[] {
        return this.getTerritoryConnections(territoryId).filter(otherId => this.getTerritoryOwner(otherId) !== this.getTerritoryOwner(territoryId));
    }

    private getNumHostileTerritoryConnections(territoryId: string): number {
        return this.getHostileTerritoryConnections(territoryId).length;
    }

    /**
     * Gets a list of territory IDs with no owner.
     */
    private getOwnerlessTerritories(): string[] {
        return this.getTerritories().filter(territoryId => !this.getTerritoryOwner(territoryId));
    }

    private getNumOwnerlessTerritories(): number {
        return this.getOwnerlessTerritories().length;
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

    private getPlayerKills(userId: Snowflake): number {
        return this.state.players[userId]?.kills ?? 0;
    }

    private addPlayerKills(userId: Snowflake, kills: number) {
        // Since conflicts may exist at "ownerless" territories
        if (!this.hasPlayer(userId)) {
            return;
        }
        this.state.players[userId].kills = this.getPlayerKills(userId) + kills;
    }

    private getPlayerDeaths(userId: Snowflake): number {
        return this.state.players[userId]?.deaths ?? 0;
    }

    private addPlayerDeaths(userId: Snowflake, deaths: number) {
        // Since conflicts may exist at "ownerless" territories
        if (!this.hasPlayer(userId)) {
            return;
        }
        this.state.players[userId].deaths = this.getPlayerDeaths(userId) + deaths;
    }

    private hasCustomTroopIcon(userId: Snowflake): boolean {
        return this.getPlayerTroopIcon(userId) !== RiskGame.config.defaultTroopIcon;
    }

    private getPlayerTroopIcon(userId: Snowflake | undefined): string {
        if (!userId) {
            return RiskGame.config.defaultTroopIcon;
        }
        return this.state.players[userId]?.troopIcon ?? RiskGame.config.defaultTroopIcon;
    }

    private setPlayerTroopIcon(userId: Snowflake, troopIcon: string) {
        this.state.players[userId].troopIcon = troopIcon;
    }

    private getJoinedDisplayNames(userIds: Snowflake[]): string {
        return naturalJoin(userIds.map(userId => this.getPlayerDisplayName(userId)), { bold: true });
    }

    private isTroopIconClaimed(troopIcon: string): boolean {
        return Object.values(this.state.players).some(p => p.troopIcon === troopIcon);
    }

    private getAvailableTroopIcons(): string[] {
        return RiskGame.config.customTroopIcons.filter(troopIcon => !this.isTroopIconClaimed(troopIcon));
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

    private getPlayerFinalRank(userId: Snowflake): number {
        return this.state.players[userId]?.finalRank ?? Number.POSITIVE_INFINITY;
    }

    private setPlayerFinalRank(userId: Snowflake, finalRank: number) {
        this.state.players[userId].finalRank = finalRank;
    }

    private getPlayerFinalRankString(userId: Snowflake): string {
        return getRankString(this.getPlayerFinalRank(userId));
    }

    private getPlayerWithFinalRank(finalRank: number): Snowflake {
        return this.getPlayers().filter(userId => this.getPlayerFinalRank(userId) === finalRank)[0];
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

    /**
     * Gets all players on a given player's team (other than the player himself).
     */
    private getPlayerVassals(userId: Snowflake): Snowflake[] {
        return this.getPlayers().filter(otherId => userId !== otherId && this.getPlayerTeam(otherId) === userId);
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
            } else {
                // Everyone has completed the draft, so no reminder message
                return [];
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
            // If the player is eliminated, sort by final rank ascending (negative to ensure this is ordered below remaining players)
            if (this.isPlayerEliminated(userId)) {
                return -this.getPlayerFinalRank(userId);
            }
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

    override addLatePlayers(players: GamePlayerAddition[]): MessengerPayload[] {
        const lateAdditions: string[] = [];
        // The players passed in are ordered by points, so the best late players get priority
        for (const { userId, displayName, points } of players) {
            // If adding right before the beginning of week 2 (during week 1), assign this player to a random free territory (if any exist)
            if (this.getTurn() === 1) {
                const ownerlessTerritoryIds = this.getOwnerlessTerritories();
                if (ownerlessTerritoryIds.length > 0) {
                    const color = randChoice(...this.getAvailableColors());
                    this.state.players[userId] = {
                        displayName,
                        points,
                        color
                    };
                    const territoryId = randChoice(...ownerlessTerritoryIds);
                    this.state.territories[territoryId].owner = userId;
                    this.state.territories[territoryId].troops = 1;
                    lateAdditions.push(`<@${userId}> at _${this.getTerritoryName(territoryId)}_`);
                    continue;
                }
            }
            // Else, refuse to add the player
            void logger.log(`Refusing to add late joiner **${displayName}**`);
        }
        if (lateAdditions.length > 0) {
            return [`We have a few new players joining the game just in time! They've been randomly placed as such: ${naturalJoin(lateAdditions)}`];
        }
        return [];
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
        // // Add 3 NPCs
        // const userIds: string[] = [];
        // for (let i = 0; i < 3; i++) {
        //     const userId = `npc${i}`;
        //     userIds.push(userId);
        //     this.state.players[userId] = {
        //         displayName: `NPC ${i}`,
        //         points: 0,
        //         troopIcon: randChoice('king', 'queen', 'rook', 'davidbeers', 'sickf', 'soldier', 'knight', 'cat', undefined)
        //     };
        //     // Give them one territory
        //     if (this.getTurn() > 0) {
        //         const potentialTerritories = this.getOwnerlessTerritories();
        //         if (potentialTerritories.length > 0) {
        //             const randomTerritoryId = randChoice(...potentialTerritories);
        //             this.state.territories[randomTerritoryId].owner = userId;
        //         }
        //     }
        // }
        // if (this.getTurn() > 0) {
        //     // For each remaining territory, give it to one random NPC
        //     const remainingTerritories = this.getOwnerlessTerritories();
        //     for (const territoryId of remainingTerritories) {
        //         this.state.territories[territoryId].owner = randChoice(...userIds);
        //     }
        //     // Assign random colors to all players (even existing non-NPC players)
        //     const colors = shuffle(Object.keys(RiskGame.config.colors));
        //     for (const userId of this.getPlayers()) {
        //         this.state.players[userId].color = colors.pop();
        //     }
        // }
    }

    private async renderRules(): Promise<AttachmentBuilder> {
        // TODO: Create real rules sheet
        return new AttachmentBuilder('assets/risk/map-with-background.png');
    }

    // TODO: Can this grid display logic be refactored into a common util?
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

    // TODO: Can this grid display logic be refactored into a common util?
    private async renderAvailableTroopIcons(): Promise<AttachmentBuilder> {
        const troopIcons = this.getAvailableTroopIcons();

        const ROW_HEIGHT = 32;
        const MARGIN = 8;

        const panels: Canvas[][] = [[]];
        for (const troopIcon of troopIcons) {
            // If the first panel list is full, append a new one
            if (panels[panels.length - 1].length >= 5) {
                panels.push([]);
            }
            const canvas = createCanvas(ROW_HEIGHT * 3 + MARGIN * 3, ROW_HEIGHT + 2 * MARGIN);
            const context = canvas.getContext('2d');
            const troopIconImage = await this.getSpecificTroopImage(troopIcon);
            context.drawImage(troopIconImage, MARGIN, MARGIN, ROW_HEIGHT, ROW_HEIGHT);
            const textLabel = getTextLabel(troopIcon, ROW_HEIGHT * 2, ROW_HEIGHT);
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

    private async renderElimination(eliminatedUserId: Snowflake, eliminatorUserId: Snowflake, inheritedVassals: Snowflake[]): Promise<AttachmentBuilder> {
        const WIDTH = 400;
        const HEIGHT = 400;
        const canvas = createCanvas(WIDTH, HEIGHT);
        const context = canvas.getContext('2d');

        // Fill black background
        context.fillStyle = 'black';
        context.fillRect(0, 0, WIDTH, HEIGHT);

        // Draw the eliminated player's avatar taking up half the height
        const eliminatedAvatar = await this.getAvatar(eliminatedUserId);
        const crossOutImage = await imageLoader.loadImage('assets/common/crossout.png');
        context.drawImage(eliminatedAvatar, HEIGHT / 4, 0, HEIGHT / 2, HEIGHT / 2);
        context.drawImage(crossOutImage, HEIGHT / 4, 0, HEIGHT / 2, HEIGHT / 2);

        // Draw the text labels in the third quarter
        context.fillStyle = 'white';
        const finalRankString = this.getPlayerFinalRankString(eliminatedUserId);
        const rankLabel = await getTextLabel(finalRankString, WIDTH / 2, HEIGHT / 8);
        context.drawImage(rankLabel, WIDTH / 4, HEIGHT / 2);
        const nameLabel = await getTextLabel(this.getPlayerDisplayName(eliminatedUserId), WIDTH, HEIGHT / 8);
        context.drawImage(nameLabel, 0, HEIGHT * (5 / 8));

        // Draw the inherited vassals in the bottom quarter
        // TODO: Render the vassals better here
        const vassalsToRender = [eliminatedUserId, ...inheritedVassals];
        const v = vassalsToRender.length;
        for (let i = v - 1; i >= 0; i--) {
            const vassalAvatar = await this.getAvatar(vassalsToRender[i]);
            const x = 0.2 * WIDTH - (i / v) * 0.2 * WIDTH;
            context.drawImage(vassalAvatar, x, HEIGHT * 0.75, WIDTH / 5, WIDTH / 5);
        }
        this.renderArrow(context, { x: WIDTH * 0.4, y: HEIGHT * (7 / 8) }, { x: WIDTH * 0.6, y: HEIGHT * (7 / 8)}, { thickness: HEIGHT / 12 });
        const eliminatorAvatar = await this.getAvatar(eliminatorUserId);
        context.drawImage(eliminatorAvatar, WIDTH * 0.6, HEIGHT * 0.75, WIDTH / 5, WIDTH / 5);

        return new AttachmentBuilder(canvas.toBuffer()).setName(`risk-elimination-${finalRankString}.png`);
    }

    private async renderCircularConflict(conflict: RiskConflictState, options: { attackerRolls: number[][], troopsLost: number[], rollWinners: ('attacker' | 'defender' | 'neither')[][] }): Promise<AttachmentBuilder> {
        // Get and validate attacker data
        const attackers = conflict.attackers;
        if (!attackers || attackers.length < 2) {
            return new AttachmentBuilder('Invalid circular conflict data').setName('error.txt');
        }

        const n = attackers.length;
        const numColumns = 3 * n;

        // Determine the priority of background images to load
        const backgroundImagePaths: string[] = [];
        if (conflict.attackers.length > 1) {
            // Just add each forward and reverse connection in order (attackers aren't rotated, so this shouldn't change)
            const an = conflict.attackers.length;
            for (let i = 0; i < an; i++) {
                const from = conflict.attackers[i].territoryId;
                const to = conflict.attackers[(i + 1) % an].territoryId;
                backgroundImagePaths.push(
                    `assets/risk/connections/${from}${to}.png`,
                    `assets/risk/connections/${to}${from}.png`
                );
            }
        } else {
            // This should never happen...
            backgroundImagePaths.push(`assets/risk/territories/${conflict.attackers[0].territoryId}.png`);
        }
        // Ultimate generic fallback...
        backgroundImagePaths.push('assets/risk/usa.png');
        // TODO: Can we somehow have cool cycle-specific images?
        const conflictImage = await imageLoader.loadImage(backgroundImagePaths[0], { fallbacks: backgroundImagePaths.slice(1) });

        const TYPICAL_WIDTH = RiskGame.config.conflict.dimensions.width;
        const COLUMN_WIDTH = TYPICAL_WIDTH / 7;
        const WIDTH = COLUMN_WIDTH * (numColumns - 1);
        const HEIGHT = RiskGame.config.conflict.dimensions.height;
        const canvas = createCanvas(WIDTH, HEIGHT);
        const context = canvas.getContext('2d');

        // Draw each attacker column
        const crossOutImage = await imageLoader.loadImage('assets/common/crossout.png');
        for (let j = 0; j < n; j++) {
            const attacker = attackers[j];
            const rolls = options.attackerRolls[j];
            const troopsLost = options.troopsLost[j];
            const rollWinners = options.rollWinners[j];
            // Draw the attacker troops in one column
            const attackerTroopImage = await this.getTroopImage(attacker.userId);
            for (let i = 0; i < attacker.initialTroops; i++) {
                const frontLine = i < 3;
                // In the special case that there are 4 total troops, render the one extra troop as full sized
                const TROOP_WIDTH = (frontLine || attacker.initialTroops === 4)
                    ? HEIGHT / 8
                    : HEIGHT / 12;
                const x = frontLine
                    ? WIDTH * ((1 + j * 3) / numColumns)
                    : WIDTH * (((Math.floor((i - 3) / 3) * 0.25) + 1 + j * 3) / numColumns);
                const y = frontLine
                    ? HEIGHT * (i + 2) / 6
                    : HEIGHT * (((i - 3) % 3) * 0.25 + 5) / 6;
                const previouslyDefeated = i >= attacker.troops + troopsLost;
                const newlyDefeated = options.rollWinners[(j + n - 1) % n][i] === 'attacker';
                context.globalAlpha = previouslyDefeated ? 0.1 : 1;
                context.drawImage(attackerTroopImage, x - TROOP_WIDTH / 2, y - TROOP_WIDTH / 2, TROOP_WIDTH, TROOP_WIDTH);
                if (newlyDefeated) {
                    context.drawImage(crossOutImage, x - TROOP_WIDTH / 2, y - TROOP_WIDTH / 2, TROOP_WIDTH, TROOP_WIDTH);
                }
                context.globalAlpha = 1;
            }
            // Draw the dice rolls in the next column
            const DIE_WIDTH = HEIGHT / 8;
            for (let i = 0; i < rolls.length; i++) {
                const x = WIDTH * ((2 + j * 3) / numColumns);
                const y = HEIGHT * ((2 + i) / 6);
                const roll = rolls[i];
                const dieImage = await imageLoader.loadImage(`assets/common/dice/r${roll}.png`);
                context.drawImage(dieImage, x - DIE_WIDTH / 2, y - DIE_WIDTH / 2, DIE_WIDTH, DIE_WIDTH);
            }
            // Draw the avatar above the dice column
            context.drawImage(await this.getAvatar(attacker.userId), WIDTH * ((1.5 + j * 3) / numColumns) - DIE_WIDTH / 2, HEIGHT * (1 / 6) - DIE_WIDTH / 2, DIE_WIDTH, DIE_WIDTH);
            // Draw the arrows in the next column
            const ARROW_WIDTH = HEIGHT / 6;
            const ARROW_HEIGHT = HEIGHT / 8;
            for (let i = 0; i < rollWinners.length; i++) {
                const x = WIDTH * ((3 + j * 3) / numColumns);
                const y = HEIGHT * ((2 + i) / 6);
                const rollWinner = rollWinners[i];
                const left = { x: x - ARROW_WIDTH / 2, y };
                const right = { x: x + ARROW_WIDTH / 2, y };
                if (rollWinner === 'attacker') {
                    this.renderArrow(context, left, right, { thickness: ARROW_HEIGHT / 2, fillStyle: this.getPlayerTeamColor(attacker.userId) });
                    // If this player is in the rightmost column, render an arrow on the far left too
                    if (j === n - 1) {
                        const otherLeft = { x: -ARROW_WIDTH / 2, y: left.y };
                        const otherRight = { x: ARROW_WIDTH / 2, y: right.y };
                        this.renderArrow(context, otherLeft, otherRight, { thickness: ARROW_HEIGHT / 2, fillStyle: this.getPlayerTeamColor(attacker.userId) });
                    }
                }
            }
        }

        // Draw the title
        // const title = n === 2 ? 'Symmetric Battle' : `${n}-Way Battle`;
        // const titleImage = getTextLabel(title, WIDTH * (5 / 8), HEIGHT / 8, {
        //     font: `italic bold ${HEIGHT / 12}px serif`
        // });
        // context.drawImage(titleImage, WIDTH * (3 / 16), (HEIGHT / 6) - (HEIGHT / 16));

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
        drawBackground(context, conflictImage);

        return new AttachmentBuilder(canvas.toBuffer()).setName('risk-conflict.png');
    }

    private async renderConflict(conflict: RiskConflictState, options: { attackerRolls: number[], defenderRolls: number[], attackersLost: number, defendersLost: number, rollWinners: ('attacker' | 'defender' | 'neither')[] }): Promise<AttachmentBuilder> {
        // Get and validate attacker and defender data
        const attacker = conflict.attackers[0];
        const defender = conflict.defender;
        if (!attacker || !defender) {
            return new AttachmentBuilder('Invalid conflict data').setName('error.txt');
        }

        const from = attacker.territoryId;
        const to = defender.territoryId;

        // Determine the priority of background images to load
        const backgroundImagePaths: string[] = [];
        if (conflict.attackers.length > 1) {
            // If there are multiple attackers, prioritize an image of just the defending territory
            backgroundImagePaths.push(`assets/risk/territories/${defender.territoryId}.png`);
        }
        backgroundImagePaths.push(
            // Then, prioritize an image in the proper direction, but fallback to the opposite if not possible
            `assets/risk/connections/${from}${to}.png`,
            `assets/risk/connections/${to}${from}.png`,
            // Ultimate generic fallback...
            'assets/risk/usa.png'
        );
        const conflictImage = await imageLoader.loadImage(backgroundImagePaths[0], { fallbacks: backgroundImagePaths.slice(1) });

        const WIDTH = RiskGame.config.conflict.dimensions.width;
        const HEIGHT = RiskGame.config.conflict.dimensions.height;
        const canvas = createCanvas(WIDTH, HEIGHT);
        const context = canvas.getContext('2d');

        // Draw the attacker troops
        const attackerTroopImage = await this.getTroopImage(attacker.userId);
        const crossOutImage = await imageLoader.loadImage('assets/common/crossout.png');
        for (let i = 0; i < attacker.initialTroops; i++) {
            const TROOP_WIDTH = HEIGHT / 8;
            const frontLine = i < 3;
            const x = WIDTH * ((frontLine ? 2 : 1) / 8);
            const y = HEIGHT * ((frontLine ? i : i - 3) + 2) / ((frontLine ? 3 : attacker.initialTroops - 3) + 3);
            const previouslyDefeated = i >= attacker.troops + options.attackersLost;
            const newlyDefeated = options.rollWinners[i] === 'defender';
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
                this.renderArrow(context, left, right, { thickness: ARROW_HEIGHT / 2, fillStyle: this.getPlayerTeamColor(attacker.userId) });
                // const attackerArrowImage = await imageLoader.loadImage('assets/risk/attacker-arrow.png');
                // context.drawImage(attackerArrowImage, x - ARROW_WIDTH / 2, y - ARROW_HEIGHT / 2, ARROW_WIDTH, ARROW_HEIGHT);
            } else if (rollWinner === 'defender') {
                this.renderArrow(context, right, left, { thickness: ARROW_HEIGHT / 2, fillStyle: this.getPlayerTeamColor(defender.userId) });
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
            const dieImage = await imageLoader.loadImage(`assets/common/dice/w${roll}.png`);
            context.drawImage(dieImage, x - DIE_WIDTH / 2, y - DIE_WIDTH / 2, DIE_WIDTH, DIE_WIDTH);
        }

        // Draw the defender troops
        const defenderTroopImage = await this.getTroopImage(defender.userId);
        for (let i = 0; i < defender.initialTroops; i++) {
            const TROOP_WIDTH = HEIGHT / 8;
            const frontLine = i < 3;
            const x = WIDTH * ((frontLine ? 6 : 7) / 8);
            const y = HEIGHT * ((frontLine ? i : i - 3) + 2) / ((frontLine ? 3 : defender.initialTroops - 3) + 3);
            const previouslyDefeated = i >= defender.troops + options.defendersLost;
            const newlyDefeated = options.rollWinners[i] === 'attacker';
            context.globalAlpha = previouslyDefeated ? 0.2 : 1;
            context.drawImage(defenderTroopImage, x - TROOP_WIDTH / 2, y - TROOP_WIDTH / 2, TROOP_WIDTH, TROOP_WIDTH);
            if (newlyDefeated) {
                context.drawImage(crossOutImage, x - TROOP_WIDTH / 2, y - TROOP_WIDTH / 2, TROOP_WIDTH, TROOP_WIDTH);
            }
            context.globalAlpha = 1;
        }

        // Draw the attacker avatars
        const AVATAR_WIDTH = HEIGHT / 8;
        const AVATAR_MARGIN = HEIGHT * (1 / 12) - (AVATAR_WIDTH / 2);
        let baseAttackerAvatarX = AVATAR_MARGIN;
        for (let i = 0; i < conflict.attackers.length; i++) {
            const queuedAttacker = conflict.attackers[i];
            const actualAvatarWidth = i === 0 ? AVATAR_WIDTH : (AVATAR_WIDTH / 2);
            const avatarImage = await this.getAvatar(queuedAttacker.userId);
            context.drawImage(avatarImage, baseAttackerAvatarX, AVATAR_MARGIN, actualAvatarWidth, actualAvatarWidth);
            // If this is a queued attacker, write their troop counts
            if (i > 0) {
                const counts = `${queuedAttacker.troops}/${queuedAttacker.initialTroops}`;
                const countsLabel = getTextLabel(counts, actualAvatarWidth, 0.75 * actualAvatarWidth);
                context.drawImage(countsLabel, baseAttackerAvatarX, AVATAR_MARGIN + actualAvatarWidth);
            }
            baseAttackerAvatarX += actualAvatarWidth + AVATAR_MARGIN;
        }

        // Draw the defender avatar
        if (defender.userId) {
            const AVATAR_WIDTH = HEIGHT / 8;
            const x = WIDTH - HEIGHT * (1 / 12);
            const y = HEIGHT * (1 / 12);
            const defenderAvatarImage = await this.getAvatar(defender.userId);
            context.drawImage(defenderAvatarImage, x - AVATAR_WIDTH / 2, y - AVATAR_WIDTH / 2, AVATAR_WIDTH, AVATAR_WIDTH);
        }

        // Draw the title
        const titleImage = getTextLabel(`Battle for ${this.getTerritoryName(to)}`, WIDTH * (5 / 8), HEIGHT / 8, {
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

        return new AttachmentBuilder(canvas.toBuffer()).setName('risk-conflict.png');
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

    private async renderRosterNameCard(userId: Snowflake): Promise<Canvas> {
        const MARGIN_WIDTH = 16;
        const BASE_HEIGHT = 64;
        const WIDTH = 256;

        const canvas = createCanvas(WIDTH, BASE_HEIGHT + MARGIN_WIDTH);
        const context = canvas.getContext('2d');

        // Draw the separator at the top
        context.strokeStyle = 'gray';
        context.lineWidth = MARGIN_WIDTH / 4;
        context.moveTo(MARGIN_WIDTH / 2 , MARGIN_WIDTH / 4);
        context.lineTo(WIDTH - MARGIN_WIDTH / 2, MARGIN_WIDTH / 4);
        context.stroke();

        const avatarImage = await this.getAvatar(userId);
        context.drawImage(avatarImage, 0, MARGIN_WIDTH, BASE_HEIGHT, BASE_HEIGHT);

        const nameLabel = getTextLabel(this.getPlayerDisplayName(userId), 0.75 * WIDTH, BASE_HEIGHT);
        context.drawImage(nameLabel, 0.25 * WIDTH, MARGIN_WIDTH, 0.75 * WIDTH, BASE_HEIGHT);

        return canvas;
    }

    private async renderRosterStatsCard(userId: Snowflake): Promise<Canvas> {
        const HEIGHT = 48;
        const WIDTH = 256;

        const canvas = createCanvas(WIDTH, HEIGHT);
        const context = canvas.getContext('2d');

        const ICON_WIDTH = WIDTH / 4;
        if (this.isPlayerEliminated(userId)) {
            // Avatar instead of num territories
            const avatarImage = await this.getAvatar(userId);
            context.drawImage(avatarImage, (WIDTH / 8) - (HEIGHT / 2), 0, HEIGHT, HEIGHT);
        } else {
            // Num territories
            context.drawImage(getTextLabel(this.getNumTerritoriesForPlayer(userId).toString(), ICON_WIDTH, HEIGHT), 0, 0, ICON_WIDTH, HEIGHT);
            // Num troops
            context.drawImage(getTextLabel(this.getTroopsForPlayer(userId).toString(), ICON_WIDTH, HEIGHT), ICON_WIDTH, 0, ICON_WIDTH, HEIGHT);
        }

        // Num new troops (show as faded if zero)
        const newTroops = this.getPlayerNewTroops(userId);
        context.save();
        context.globalAlpha = newTroops === 0 ? 0.25 : 1;
        context.drawImage(getTextLabel(newTroops.toString(), ICON_WIDTH, HEIGHT), 2 * ICON_WIDTH, 0, ICON_WIDTH, HEIGHT);
        context.restore();

        if (this.isPlayerEliminated(userId)) {
            // Final rank instead of K/D
            context.drawImage(getTextLabel(this.getPlayerFinalRankString(userId), ICON_WIDTH, HEIGHT), 3 * ICON_WIDTH, 0, ICON_WIDTH, HEIGHT);
        } else {
            // K/D
            context.drawImage(getTextLabel(`${this.getPlayerKills(userId)}/${this.getPlayerDeaths(userId)}`, ICON_WIDTH, HEIGHT), 3 * ICON_WIDTH, 0, ICON_WIDTH, HEIGHT);
        }

        return canvas;
    }

    private async renderRosterLegendCard(): Promise<Canvas> {
        const legendImage = await imageLoader.loadImage('assets/risk/rosterlegend.png');

        const canvas = createCanvas(legendImage.width, legendImage.height);
        const context = canvas.getContext('2d');

        context.drawImage(legendImage, 0, 0);

        return canvas;
    }

    private async renderRosterCard(userId: Snowflake): Promise<Canvas> {
        const canvases: Canvas[] = [
            await this.renderRosterNameCard(userId),
            await this.renderRosterStatsCard(userId)
        ];

        for (const vassal of this.getPlayerVassals(userId)) {
            canvases.push(await this.renderRosterStatsCard(vassal));
        }

        const joinedCanvas = joinCanvasesVertically(canvases);
        const context = joinedCanvas.getContext('2d');

        context.save();
        context.globalCompositeOperation = 'destination-over';
        context.fillStyle = 'black';
        context.fillRect(0, 0, joinedCanvas.width, joinedCanvas.height);
        context.restore();

        return joinedCanvas;
    }

    private async renderRoster(height: number): Promise<Canvas> {
        const width = height / 4;
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');

        context.fillStyle = 'black';
        context.fillRect(0, 0, canvas.width, canvas.height);

        const n = this.getNumPlayers();
        const orderedPlayers = this.getOrderedPlayers();

        const canvases: Canvas[] = [await this.renderRosterLegendCard()];
        for (const userId of orderedPlayers) {
            if (!this.isPlayerEliminated(userId)) {
                canvases.push(await this.renderRosterCard(userId));
            }
        }

        const compositeRosterCanvas = joinCanvasesVertically(canvases);

        // Resize it to match the target height
        const resizeFactor = height / compositeRosterCanvas.height;
        const newWidth = compositeRosterCanvas.width * resizeFactor;
        const finalCanvas = createCanvas(newWidth, height);
        const finalContext = finalCanvas.getContext('2d');

        finalContext.drawImage(compositeRosterCanvas, 0, 0, newWidth, height);

        return finalCanvas;
    }

    private async renderMap(options?: { showRoster?: boolean, invasion?: RiskConflictState, additions?: Record<string, number>, movements?: RiskMovementData[] }): Promise<Canvas> {
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
            const invadingTroops = options?.invasion?.attackers.filter(a => a.territoryId == territoryId)[0]?.initialTroops ?? 0;
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
        // Set all territories involved in the specified conflict to be highlighted
        if (options?.invasion) {
            const attackers = options.invasion.attackers;
            // If there is a defending territory, highlight it
            if (options?.invasion.defender) {
                highlightedTerritories.add(options?.invasion.defender.territoryId);
            }
            // Highlight each attacking territory
            for (const attacker of attackers) {
                highlightedTerritories.add(attacker.territoryId);
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
        if (options?.invasion) {
            const attackers = options.invasion.attackers;
            // If the invasion is non-circular, render the arrows from all attackers to all defenders
            if (options.invasion.defender) {
                const to = options.invasion.defender.territoryId;
                for (const attacker of attackers) {
                    const from = attacker.territoryId;
                    const fromCoordinates = RiskGame.config.territories[from].termini[to];
                    const toCoordinates = RiskGame.config.territories[to].termini[from];
                    this.renderArrow(context, fromCoordinates, toCoordinates);
                }
            }
            // Else if the cycle consists of 2 attackers, draw a two-headed arrow
            else if (attackers.length === 2) {
                const from = attackers[0].territoryId;
                const to = attackers[1].territoryId;
                const fromCoordinates = RiskGame.config.territories[from].termini[to];
                const toCoordinates = RiskGame.config.territories[to].termini[from];
                const midCoordinates = {
                    x: Math.round((fromCoordinates.x + toCoordinates.x) / 2),
                    y: Math.round((fromCoordinates.y + toCoordinates.y) / 2)
                };
                this.renderArrow(context, midCoordinates, fromCoordinates);
                this.renderArrow(context, midCoordinates, toCoordinates);
            }
            // Else, render the arrows between the 3+ attackers
            else {
                for (let i = 0; i < attackers.length; i++) {
                    // TODO: Validate that this is going in the correct order
                    const from = attackers[i].territoryId;
                    const to = attackers[(i + 1) % attackers.length].territoryId;
                    const fromCoordinates = RiskGame.config.territories[from].termini[to];
                    const toCoordinates = RiskGame.config.territories[to].termini[from];
                    this.renderArrow(context, fromCoordinates, toCoordinates);
                }
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

    private async renderInvasion(invasion: RiskConflictState): Promise<AttachmentBuilder> {
        return new AttachmentBuilder((await this.renderMap({ invasion })).toBuffer()).setName('risk-invasion.png');
    }

    private async renderMovements(movements: RiskMovementData[]): Promise<AttachmentBuilder> {
        return new AttachmentBuilder((await this.renderMap({ movements })).toBuffer()).setName('risk-movements.png');
    }

    private async renderBasicMap(): Promise<AttachmentBuilder> {
        return new AttachmentBuilder((await this.renderMap()).toBuffer()).setName('risk-map.png');
    }

    async renderState(options?: { showPlayerDecision?: string | undefined; seasonOver?: boolean | undefined; admin?: boolean | undefined; } | undefined): Promise<Buffer> {
        return (await this.renderMap({ showRoster: true })).toBuffer();
    }

    private async getTerritoryCutoutRender(territoryId: string, options?: { grayedOut?: true }): Promise<Canvas> {
        const maskImage = await imageLoader.loadImage(`assets/risk/cutouts/${territoryId.toLowerCase()}.png`);
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
        const maskImages = await Promise.all(territoryIds.map(async (territoryId) => imageLoader.loadImage(`assets/risk/cutouts/${territoryId.toLowerCase()}.png`)));

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
        const avatar = await imageLoader.loadAvatar(userId, 128);
        const ringWidth = 12;

        const canvas = createCanvas(128 + 2 * ringWidth, 128 + 2 * ringWidth);
        const context = canvas.getContext('2d');

        context.fillStyle = options?.colorOverride ?? this.getPlayerTeamColor(userId);
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(toCircle(avatar), ringWidth, ringWidth, 128, 128);

        return toCircle(canvas);
    }

    private async getSpecificTroopImage(troopIcon: string, modifier?: 'added' | 'moved' | 'attacking' | 'eliminated'): Promise<Image | Canvas> {
        // Load up the 2 component images
        const baseImage = await imageLoader.loadImage(`assets/risk/troops/${troopIcon}.png`);
        const fillImage = await imageLoader.loadImage(`assets/risk/troops/${troopIcon}_fill.png`);

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

    private async getTroopImage(userId: Snowflake | undefined, modifier?: 'added' | 'moved' | 'attacking' | 'eliminated'): Promise<Canvas | Image> {
        return this.getSpecificTroopImage(this.getPlayerTroopIcon(userId), modifier);
    }

    override async beginTurn(): Promise<MessengerPayload[]> {
        this.state.turn++;

        // If we're on the first turn, determine the draft order
        if (this.getTurn() === 1) {
            this.state.draft = this.constructDraftData();
        } else {
            // Just in case the draft data is still present, but this shouldn't happen...
            delete this.state.draft;
            // Initialize the decision maps to allow decisions
            this.state.addDecisions = {};
            this.state.attackDecisions = {};
            this.state.moveDecisions = {};
        }

        const messengerPayloads: MessengerPayload[] = [];

        // If starting the second turn, add troops to each remaining unclaimed territory so players can fight for it
        if (this.getTurn() === 2) {
            const DEFAULT_OWNERLESS_TROOPS = 3;
            const ownerlessTerritoryIds = this.getOwnerlessTerritories();
            // Add troops to the remaining ownerless ones
            for (const territoryId of ownerlessTerritoryIds) {
                this.addTerritoryTroops(territoryId, DEFAULT_OWNERLESS_TROOPS);
            }
            // If there were any ownerless ones, add a special message indicating this
            if (ownerlessTerritoryIds.length > 0) {
                messengerPayloads.push(`As for the remaining ${quantify(ownerlessTerritoryIds.length, 'territory', { adjective: 'unclaimed' })}, `
                    + `I've designated these as _NPC territories_ and given ${quantify(DEFAULT_OWNERLESS_TROOPS, 'troop')} to each!`);
            }
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
                    for (const from of possibleAttackTerritories) {
                        const targets = this.getTerritoryConnections(from).filter(otherId => this.getTerritoryOwner(otherId) !== userId);
                        const to = getMinKey(shuffle(targets), (territoryId) => this.getTerritoryTroops(territoryId));
                        const p = 0.5 * this.getTerritoryTroops(from) / this.getTerritoryTroops(to);
                        if (chance(p)) {
                            attacks.push({
                                from,
                                to,
                                quantity: randInt(1, this.getPromisedTerritoryTroops(from))
                            });
                        }
                    }
                    this.state.attackDecisions[userId] = attacks;
                }
                // Choose movements
                const possibleMovementTerritories = this.getValidMovementSourceTerritoriesForPlayer(userId);
                if (this.state.moveDecisions && possibleMovementTerritories.length > 0) {
                    const from = getMinKey(shuffle(possibleMovementTerritories), (territoryId) => this.getNumHostileTerritoryConnections(territoryId));
                    const possibleDestinations = this.getTerritoryConnections(from).filter(otherId => this.getTerritoryOwner(otherId) === userId);
                    const to = getMaxKey(shuffle(possibleDestinations), (territoryId) => this.getNumHostileTerritoryConnections(territoryId));
                    this.state.moveDecisions[userId] = {
                        from,
                        to,
                        quantity: randInt(1, this.getTerritoryTroops(from))
                    };
                }
            }
        }

        // Show a chart indicating how many troops were awarded this week
        messengerPayloads.push({
            files: [await this.renderWeeklyPoints(weeklyPointOrderedPlayers.map(userId => ({ userId, points: weeklyPoints[userId], troops: weeklyTroops[userId], extraTroops: weeklyExtraTroops[userId] })))]
        });

        return messengerPayloads;
    }

    override async endTurn(): Promise<MessengerPayload[]> {
        // Clear all decision-related data
        delete this.state.addDecisions;
        delete this.state.attackDecisions;
        delete this.state.moveDecisions;
        delete this.state.plannedAttacks;

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
        // If player isn't in the game yet, do nothing
        if (!this.hasPlayer(userId)) {
            return [];
        }
        switch (type) {
            case 'submissions1':
            case 'submissions1-tied':
                // Don't allow players to re-select custom troop icons
                if (this.hasCustomTroopIcon(userId)) {
                    return [];
                }
                // Set the flag allowing them to pick a custom troop icon
                this.state.players[userId].maySelectCustomTroopIcon = true;
                // Reply with a message prompting them to select a custom troop icon
                return [{
                    content: `${intro}! If you'd like, you can select a custom icon for your troops to replace the standard pawn pieces`
                        + (type === 'submissions1-tied' ? ' (but make haste, for you tied with someone this week and each icon can only be claimed once)' : ''),
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.Button,
                            style: ButtonStyle.Success,
                            label: 'Choose Custom Icon',
                            custom_id: 'game:chooseTroopIcon'
                        }]
                    }]
                }];
        }
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
            // If there are any remaining territories, let the players know they can still be claimed
            if (this.getNumOwnerlessTerritories() === 0) {
                return {
                    continueProcessing: false,
                    summary: 'Looks like everyone is settled in! Next week, the bloodshed will begin...'
                };
            } else {
                return {
                    continueProcessing: false,
                    // TODO: Pluralize this dynamically
                    summary: `Alright, everyone\'s settled in! There however are still **${this.getNumOwnerlessTerritories()}** unclaimed territories. `
                        + 'These will be doled out randomly to new players who participate before next weekend, when the bloodshed begins...'
                };
            }
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
            const attackers = conflict.attackers;
            const defender = conflict.defender;
            // If the conflict is a standard conflict...
            if (defender) {
                // The attacker at the head of the queue is the one attacking
                const attacker = attackers[0];
                // Now, roll all the dice
                const attackerDice = Math.min(3, attacker.troops);
                const defenderDice = Math.min(2, defender.troops);
                const attackerRolls = this.getSortedDiceRolls(attackerDice);
                const defenderRolls = this.getSortedDiceRolls(defenderDice);
                const numComparisons = Math.min(attackerDice, defenderDice);
                let attackersLost = 0;
                let defendersLost = 0;
                // Compare each set and update the conflict state
                let rollWinners: ('attacker' | 'defender' | 'neither')[] = [];
                for (let i = 0; i < numComparisons; i++) {
                    if (attackerRolls[i] > defenderRolls[i]) {
                        defender.troops--;
                        defendersLost++;
                        this.addPlayerKills(attacker.userId, 1);
                        this.addPlayerDeaths(defender.userId, 1);
                        rollWinners.push('attacker');
                    } else {
                        attacker.troops--;
                        attackersLost++;
                        this.addPlayerKills(defender.userId, 1);
                        this.addPlayerDeaths(attacker.userId, 1);
                        rollWinners.push('defender');
                    }
                }
                // Render the conflict state before altering the attacker queue
                const conflictRender = await this.renderConflict(conflict, { attackerRolls, defenderRolls, attackersLost, defendersLost, rollWinners });
                // Remove the current attacker from the front of the queue
                attackers.shift();
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
                } else if (defender.troops === 1 && rollWinners.every(w => w === 'defender')) {
                    summary += 'The defender makes a valiant last stand!\n';
                } else if (attacker.troops === 1 && rollWinners.every(w => w === 'attacker')) {
                    summary += 'The last attacker standing continues the fight!\n';
                } else {
                    summary += 'Stuff happened!\n';
                }
                // If the counter-attack is over...
                // if (conflict.symmetrical && (conflict.attackerTroops === 0 || conflict.defenderTroops === 0)) {
                //     // Update the troop counts for both territories
                //     this.addTerritoryTroops(conflict.to, -conflict.initialDefenderTroops + conflict.defenderTroops);
                //     this.addTerritoryTroops(conflict.from, -conflict.initialAttackerTroops + conflict.attackerTroops);
                //     // Delete the current conflict
                //     delete this.state.currentConflict;
                //     // Send a message
                //     return {
                //         continueProcessing: true,
                //         summary: {
                //             content: `${summary}The conflict has reached an end. No territories have changed hands.`,
                //             files: [conflictRender]
                //         }
                //     };
                // }
                // If it's a defender victory...
                if (attacker.troops === 0) {
                    // Update the attacker territory's troop count
                    this.addTerritoryTroops(attacker.territoryId, -attacker.initialTroops);
                    // If there are other remaining attackers, proceed with the conflict...
                    if (attackers.length > 0) {
                        return {
                            continueProcessing: true,
                            summary: {
                                content: `${summary}**${this.getPlayerDisplayName(defender.userId)}** has fended off the attacking army from _${this.getTerritoryName(attacker.territoryId)}_! `
                                    + quantify(attackers.length, 'army')
                                    + ` to go...`,
                                files: [conflictRender],
                                flags: MessageFlags.SuppressNotifications
                            }
                        };
                    }
                    // Otherwise, update the defending territory's troop count
                    this.setTerritoryTroops(defender.territoryId, defender.troops);
                    // Delete the conflict
                    delete this.state.currentConflict;
                    // Send a message
                    return {
                        continueProcessing: true,
                        summary: {
                            content: `${summary}**${this.getPlayerDisplayName(defender.userId)}** has successfully fended off **${this.getPlayerDisplayName(attacker.userId)}** at _${this.getTerritoryName(defender.territoryId)}_!`,
                            files: [conflictRender],
                            flags: MessageFlags.SuppressNotifications
                        }
                    };
                }
                // If it's an attacker victory...
                if (defender.troops === 0) {
                    // Update the troop counts of both territories
                    this.setTerritoryTroops(defender.territoryId, attacker.troops);
                    this.addTerritoryTroops(attacker.territoryId, -attacker.initialTroops);
                    // Update the ownership of the target territory
                    this.state.territories[defender.territoryId].owner = attacker.userId;
                    // If the defender is now eliminated, handle that
                    const extraSummaries: MessengerPayload[] = [];
                    // TODO: Can we somehow handle the NPC defender case more properly?
                    if (defender.userId && this.getNumTerritoriesForPlayer(defender.userId) === 0) {
                        // Mark them as eliminated and assign their final rank
                        const finalRank = this.getNumRemainingPlayers();
                        this.setPlayerFinalRank(defender.userId, finalRank);
                        // If they're eliminated for 2nd, assign the final winners
                        if (finalRank === 2) {
                            this.addWinner(attacker.userId);
                            this.addWinner(defender.userId);
                            // TODO: This is pretty hacky and seems flimsy. Can we add winners differently?
                            this.addWinner(this.getPlayerWithFinalRank(3));
                        }
                        // Before adjusting this player's eliminator/color, render the elimination image
                        const inheritedVassals = this.getPlayerVassals(defender.userId);
                        extraSummaries.push({
                            content: `**${this.getPlayerDisplayName(defender.userId)}** has been eliminated, finishing the season in **${getRankString(finalRank)}** place! `
                                + `This player is now a vassal of **${this.getPlayerDisplayName(attacker.userId)}**`
                                + (inheritedVassals.length === 0 ? '' : `, who hereby inherits their ${quantify(inheritedVassals.length, 'vassal')}`),
                            files: [await this.renderElimination(defender.userId, attacker.userId, inheritedVassals)]
                        });
                        // Delete their color and assign them to the attacker's team
                        delete this.state.players[defender.userId].color;
                        this.state.players[defender.userId].eliminator = attacker.userId;
                    }
                    // Remove any of the attacker's other armies from the attackers list
                    // TODO: This is a hacky way to filter elements from a readonly property, should we change this?
                    const nf = attackers.length;
                    for (let i = 0; i < nf; i++) {
                        const e = attackers.shift();
                        if (e && e.userId !== attacker.userId) {
                            attackers.push(e);
                        } else {
                            void logger.log(`Removed other attacker at _${this.getTerritoryName(e?.territoryId ?? '')}_ from the ongoing conflict (same owner?)`);
                        }
                    }
                    // If there are other remaining attackers, proceed with the conflict...
                    if (attackers.length > 0) {
                        // Set the winner as the new defender
                        conflict.defender = {
                            userId: attacker.userId,
                            territoryId: defender.territoryId,
                            initialTroops: attacker.troops,
                            troops: attacker.troops
                        };
                        // Add an extra summary showing the updated invasion
                        extraSummaries.push({
                            content: `Now, **${this.getPlayerDisplayName(attacker.userId)}** must fend off the other ${quantify(attackers.length, 'army', { adjective: 'attacking' })}...`,
                            files: [await this.renderInvasion(conflict)],
                            flags: MessageFlags.SuppressNotifications
                        });
                    }
                    // Otherwise, delete the conflict
                    else {
                        delete this.state.currentConflict;
                    }
                    // Send a message
                    return {
                        continueProcessing: true,
                        summary: {
                            content: `${summary}**${this.getPlayerDisplayName(attacker.userId)}** has defeated **${this.getPlayerDisplayName(defender.userId)}** at _${this.getTerritoryName(defender.territoryId)}_!`,
                            files: [conflictRender],
                            flags: MessageFlags.SuppressNotifications
                        },
                        extraSummaries
                    };
                }
                // Otherwise, the attacker is still engaged in this ongoing conflict so add them back to the queue
                attackers.push(attacker);
                // Provide an update of the conflict
                return {
                    continueProcessing: true,
                    summary: {
                        content: `${summary}${quantify(attacker.troops, 'troop', { adjective: 'attacker' })}** remaining vs **${defender.troops}** defending...`,
                        files: [conflictRender],
                        flags: MessageFlags.SuppressNotifications
                    }
                };
            }
            // Else, the conflict is a circular conflict...
            else {
                // Roll attacker dice for each attacker in the cycle
                const n = attackers.length;
                const attackerRolls: number[][] = [];
                for (let i = 0; i < n; i++) {
                    const attacker = attackers[i];
                    const dice = Math.min(3, attacker.troops);
                    const rolls = this.getSortedDiceRolls(dice);
                    attackerRolls[i] = rolls;
                }
                // Now compare each set of rolls with the set ahead
                const troopsLost: number[] = [];
                const rollWinners: ('attacker' | 'defender' | 'neither')[][] = [];
                for (let i = 0; i < n; i++) {
                    const attacker = attackers[i];
                    const targetIndex = (i + 1) % n;
                    // Prime the map to ensure to NaN operations
                    troopsLost[targetIndex] = troopsLost[targetIndex] ?? 0;
                    const target = attackers[targetIndex];
                    const sourceRolls = attackerRolls[i];
                    const targetRolls = attackerRolls[targetIndex];
                    const numComparisons = Math.min(sourceRolls.length, targetRolls.length);
                    rollWinners[i] = [];
                    for (let j = 0; j < numComparisons; j++) {
                        if (sourceRolls[j] > targetRolls[j]) {
                            target.troops--;
                            troopsLost[targetIndex]++;
                            this.addPlayerKills(attacker.userId, 1);
                            this.addPlayerDeaths(target.userId, 1);
                            rollWinners[i][j] = 'attacker';
                        } else {
                            rollWinners[i][j] = 'neither';
                        }
                    }
                }
                // Render the conflict state
                const conflictRender = await this.renderCircularConflict(conflict, { attackerRolls, rollWinners, troopsLost });
                // If any army has been reduced to zero troops, end the conflict
                if (attackers.some(a => a.troops === 0)) {
                    // Reduce the troop count of each territory
                    for (const attacker of attackers) {
                        this.addTerritoryTroops(attacker.territoryId, attacker.troops - attacker.initialTroops);
                    }
                    // Delete the conflict
                    delete this.state.currentConflict;
                    // Send a message
                    return {
                        continueProcessing: true,
                        summary: {
                            content: 'One army has been reduced to zero troops! The conflict is now over',
                            files: [conflictRender],
                            flags: MessageFlags.SuppressNotifications
                        }
                    };
                }
                // Otherwise, provide an update of the conflict
                return {
                    continueProcessing: true,
                    summary: {
                        content: 'The circular conflict rages on!',
                        files: [conflictRender],
                        flags: MessageFlags.SuppressNotifications
                    }
                };
            }
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
                    files: [await this.renderMovements(Object.values(this.state.plannedAttacks ?? {}).map(a => a.attack))],
                    flags: MessageFlags.SuppressNotifications
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
            const selectedAttacks: RiskPlannedAttack[] = [];
            let selectedDefender: RiskConflictAgentData | undefined;
            let summaryContent = '';
            const dependencies = this.getPlannedAttackDependencyMap();
            const cyclicalAttacks = findCycle(dependencies, { randomize: true })?.map(id => plannedAttacks[id]);
            if (cyclicalAttacks) {
                // Get the biggest attack
                const largestAttack = getMaxKey(cyclicalAttacks, a => a.actualQuantity);
                // Rotate the array such that the largest attack is at the front
                // TODO: Can we guarantee this is in the right order?
                while (cyclicalAttacks[0].id !== largestAttack.id) {
                    cyclicalAttacks.push(cyclicalAttacks.shift() as RiskPlannedAttack);
                }
                if (cyclicalAttacks.length === 2) {
                    // Consider the "reciprocal" attack to be the other (smaller) one
                    const reciprocalAttack = cyclicalAttacks[1];
                    // Handle it depending on how the quantities compare...
                    if (largestAttack.actualQuantity === reciprocalAttack.actualQuantity) {
                        // The attacks are of the same quantity, so initiate a circular attack between the two territories
                        selectedAttacks.push(...cyclicalAttacks);
                        // Construct summary
                        summaryContent = `**${this.getPlayerDisplayName(largestAttack.userId)}** and **${this.getPlayerDisplayName(reciprocalAttack.userId)}** `
                            + `have launched attacks against each other with the same number of troops! A conflict will begin with two attackers and no potential for territory capture...`;
                    } else {
                        // One attack is larger, so initiate a standard attack and consider the smaller army the "defender"
                        selectedAttacks.push(largestAttack);
                        selectedDefender = {
                           userId: reciprocalAttack.userId,
                           territoryId: reciprocalAttack.attack.from,
                           initialTroops: this.getTerritoryTroops(reciprocalAttack.attack.from) ,
                           troops: this.getTerritoryTroops(reciprocalAttack.attack.from)
                        };
                        // The planned reciprocal attack must be discarded because it's been converted to a "defense"
                        delete this.state.plannedAttacks[reciprocalAttack.id];
                        // Construct summary
                        summaryContent = `**${this.getPlayerDisplayName(reciprocalAttack.userId)}** tried to launch an attack `
                            + `from _${this.getTerritoryName(reciprocalAttack.attack.from)}_ to _${this.getTerritoryName(reciprocalAttack.attack.to)}_ `
                            + `with ${quantify(reciprocalAttack.actualQuantity, 'troop')}, but **${this.getPlayerDisplayName(largestAttack.userId)}** `
                            + `launched an even larger counter-attack with ${quantify(largestAttack.actualQuantity, 'troop')}!`;
                    }
                } else if (cyclicalAttacks.length > 2) {
                    // If there's a cycle of 3+ planned attacks, initiate a circular attack (the order of attacks must be maintained, but the largest will be at the front)
                    selectedAttacks.push(...cyclicalAttacks);
                    // Construct summary
                    summaryContent = `A circular battle has broken out between **${cyclicalAttacks.length}** territories!`;
                } else {
                    // Fallback just in case there's a 0/1-node cycle
                    return {
                        continueProcessing: true,
                        summary: `WTF! I found a cycle of planned attacks of length **${cyclicalAttacks.length}**. Admin?`
                    };
                }
            } else {
                // There are no cycles, so shuffle with dependencies and choose the first one
                let plannedAttack: RiskPlannedAttack;
                try {
                    const orderedAttackIds = shuffleWithDependencies(Object.keys(dependencies), dependencies);
                    plannedAttack = plannedAttacks[orderedAttackIds[0]];
                } catch (err) {
                    void logger.log('Attack decisions still contain a cycle, so picking one at random!');
                    plannedAttack = randChoice(...Object.values(plannedAttacks));
                }
                // Validate that one was actually chosen
                if (!plannedAttack) {
                    void logger.log(`Couldn't find next territory to attack. Planned attacks: \`${JSON.stringify(plannedAttacks)}\``);
                    return {
                        continueProcessing: true,
                        summary: 'WTF! Couldn\'t find the next territory attack node to process...'
                    };
                }
                // Construct the defender agent data
                const defenderTerritoryId = plannedAttack.attack.to;
                selectedDefender = {
                    // TODO: Is there a better way to support NPC defenders?
                    userId: this.getTerritoryOwner(defenderTerritoryId) ?? '',
                    territoryId: defenderTerritoryId,
                    initialTroops: this.getTerritoryTroops(defenderTerritoryId),
                    troops: this.getTerritoryTroops(defenderTerritoryId)
                };
                // Determine the total set of attacks targeting this territory
                const parallelAttacks = Object.values(this.state.plannedAttacks).filter(a => a.attack.to === defenderTerritoryId);
                // Sort the attacks such that the largest attacks go first
                parallelAttacks.sort((a, b) => b.actualQuantity - a.actualQuantity);
                // Set them all as attackers
                selectedAttacks.push(...parallelAttacks);
                // Construct a summary depending on how many attackers have targeted this territory
                const largestAttack = parallelAttacks[0];
                if (parallelAttacks.length === 1) {
                    // One single attack by one player
                    summaryContent = `**${this.getPlayerDisplayName(largestAttack.userId)}** has staged an attack from `
                        + `_${this.getTerritoryName(largestAttack.attack.from)}_ to _${this.getTerritoryName(largestAttack.attack.to)}_ with ${quantify(largestAttack.actualQuantity, 'troop')}!`;
                } else if (parallelAttacks.every(a => a.userId === largestAttack.userId)) {
                    // Special case where one user launches all the attacks
                    summaryContent += `**${this.getPlayerDisplayName(largestAttack.userId)}** has begun a **${parallelAttacks.length}**-pronged invasion of _${this.getTerritoryName(selectedDefender.territoryId)}_!`;
                } else if (parallelAttacks.length === 2) {
                    // Two parallel attacks by different players
                    summaryContent = `**${this.getPlayerDisplayName(parallelAttacks[0].userId)}** and **${this.getPlayerDisplayName(parallelAttacks[1].userId)}** `
                        + `have temporarily joined forces to squeeze **${this.getPlayerDisplayName(selectedDefender.userId)}** at _${this.getTerritoryName(selectedDefender.territoryId)}_!`;
                } else {
                    // Three or more parallel attacks by two or more players
                    summaryContent = `**${parallelAttacks.length}** territories have launched attacks against **${this.getPlayerDisplayName(selectedDefender.userId)}** at _${this.getTerritoryName(selectedDefender.territoryId)}_! `
                        + ` **${this.getPlayerDisplayName(largestAttack.userId)}** will go first, having the largest army of ${quantify(largestAttack.actualQuantity, 'troop')} from _${this.getTerritoryName(largestAttack.attack.from)}_`;
                }
            }
            // Validate that the chosen planned attacks actually exist
            if (selectedAttacks.length === 0) {
                void logger.log(`Couldn't find next territory to attack. Planned attacks: \`${JSON.stringify(plannedAttacks)}\``);
                return {
                    continueProcessing: true,
                    summary: 'WTF! Couldn\'t find the next territory attack node to process...'
                };
            }
            // Validate each individual attack decision and discard any that fail validation (leaving the remaining)
            for (const attack of selectedAttacks) {
                const { userId, actualQuantity } = attack;
                const { from, to, quantity } = attack.attack;
                // Log in the case of adjusted quantity
                if (quantity !== actualQuantity) {
                    void logger.log(`<@${userId}> tried to attack _${this.getTerritoryName(to)}_ with ${quantify(quantity, 'troop')} `
                        + `but _${this.getTerritoryName(from)}_ only has **${this.getTerritoryTroops(from)}**, so only attacking with **${actualQuantity}**`);
                }
                // Ensure there are enough troops to launch a valid attack
                if (attack.actualQuantity < 1) {
                    delete this.state.plannedAttacks[attack.id];
                    return {
                        continueProcessing: true,
                        summary: `**${this.getPlayerDisplayName(attack.userId)}** tried to launch an attack from _${this.getTerritoryName(from)}_ to _${this.getTerritoryName(to)}_, but couldn't due to a lack of troops...`
                    };
                }
                // Ensure the user still owns this territory
                if (attack.userId !== this.getTerritoryOwner(from)) {
                    delete this.state.plannedAttacks[attack.id];
                    return {
                        continueProcessing: true,
                        summary: `**${this.getPlayerDisplayName(attack.userId)}** tried to launch an attack from _${this.getTerritoryName(from)}_ to _${this.getTerritoryName(to)}_, but that territory no longer belongs to him...`
                    };
                }
                // Ensure the user isn't attacking their own territory 
                if (this.getTerritoryOwner(from) === this.getTerritoryOwner(to)) {
                    delete this.state.plannedAttacks[attack.id];
                    return {
                        continueProcessing: true,
                        summary: `**${this.getPlayerDisplayName(attack.userId)}** tried to launch an attack from _${this.getTerritoryName(from)}_ to _${this.getTerritoryName(to)}_, but called it off moments before firing on his own troops...`
                    };
                }
            }
            // Now that the conflict is confirmed valid, delete all related attack decisions
            for (const attack of selectedAttacks) {
                delete this.state.plannedAttacks[attack.id];
            }
            // Delete the planned attacks if there are none yet left
            if (Object.keys(this.state.plannedAttacks).length === 0) {
                delete this.state.plannedAttacks;
            }
            // Save this node as the current conflict
            // TODO: Validate this better, e.g. with logging...
            this.state.currentConflict = {
                attackers: selectedAttacks.map(a => ({
                    userId: a.userId,
                    territoryId: a.attack.from,
                    initialTroops: a.actualQuantity,
                    troops: a.actualQuantity
                })),
                defender: selectedDefender
            };
            return {
                continueProcessing: true,
                summary: {
                    content: summaryContent,
                    files: [await this.renderInvasion(this.state.currentConflict)],
                    flags: MessageFlags.SuppressNotifications
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
                        void logger.log(`<@${userId}> tried to move ${quantify(data.quantity, 'troop')} from _${this.getTerritoryName(data.from)}_ to _${this.getTerritoryName(data.to)}_ `
                            + `but _${this.getTerritoryName(data.from)}_ only has **${this.getTerritoryTroops(data.from)}**, so only moving with **${actualQuantity}**`);
                    }
                    this.addTerritoryTroops(data.from, -actualQuantity);
                    this.addTerritoryTroops(data.to, actualQuantity);
                    // Add this to the list of actual movements to render
                    actualMovements.push({
                        from: data.from,
                        to: data.to,
                        quantity: actualQuantity
                    });
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
                        files: [await this.renderMovements(actualMovements)],
                        flags: MessageFlags.SuppressNotifications
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
                case 'game:chooseTroopIcon': {
                    // Validate that the user is allowed to pick a custom icon
                    if (this.hasCustomTroopIcon(userId)) {
                        throw new Error(`You already have a custom troop icon! You picked the **${this.getPlayerTroopIcon(userId)}**`);
                    }
                    if (!this.state.players[userId]?.maySelectCustomTroopIcon) {
                        throw new Error('You don\'t have the privilege of picking a custom troop icon... how did you click this button?');
                    }
                    // Reply with a menu of all available troop icons
                    await interaction.reply({
                        ephemeral: true,
                        content: 'Please select from the following options (the selection is confirmed once you click the option in the drop-down, so be careful)',
                        files: [await this.renderAvailableTroopIcons()],
                        components: [{
                            type: ComponentType.ActionRow,
                            components: [{
                                type: ComponentType.StringSelect,
                                custom_id: 'game:selectTroopIcon',
                                min_values: 1,
                                max_values: 1,
                                options: this.getAvailableTroopIconSelectOptions()
                            }]
                        }]
                    });
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
                    const selectionPhrase = randChoice('has set up camp at', 'has selected', 'has posted up at', 'has set up shop at', 'chose', 'has chosen', 'is starting at');
                    return [{
                        content: `<@${userId}> ${selectionPhrase} _${this.getTerritoryName(territoryId)}_!`,
                        files: [await this.renderBasicMap()]
                    }];
                }
                case 'game:selectAdd': {
                    // First, validate that add decisions are being accepted
                    if (!this.state.addDecisions) {
                        throw new Error('I\'m not accepting any decisions related to _adding troops_ right now...');
                    }
                    // Validate that the selected territory belong's to this user's team
                    const selectedTerritoryId = interaction.values[0];
                    if (this.getTerritoryOwner(selectedTerritoryId) !== this.getPlayerTeam(userId)) {
                        if (this.isPlayerEliminated(userId)) {
                            throw new Error(`Your team doesn't own _${this.getTerritoryName(selectedTerritoryId)}_!`);
                        } else {
                            throw new Error(`You don't own _${this.getTerritoryName(selectedTerritoryId)}_!`);
                        }
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
                }
                case 'game:selectTroopIcon': {
                    // Validate that the user is allowed to select a custom icon
                    if (this.hasCustomTroopIcon(userId)) {
                        throw new Error(`You already have a custom troop icon! You picked the **${this.getPlayerTroopIcon(userId)}**`);
                    }
                    if (!this.state.players[userId]?.maySelectCustomTroopIcon) {
                        throw new Error('You don\'t have the privilege of selecting a custom troop icon... how did you find this menu?');
                    }
                    // Validate the value
                    const value = interaction.values[0];
                    if (!RiskGame.config.customTroopIcons.includes(value)) {
                        throw new Error(`**${value}** is not a valid option! (please see admin)`);
                    }
                    if (this.isTroopIconClaimed(value)) {
                        throw new Error(`**${value}** has already been claimed. Pick a different one!`);
                    }
                    // Update the state and wipe the flag
                    this.setPlayerTroopIcon(userId, value);
                    delete this.state.players[userId].maySelectCustomTroopIcon;
                    // Confirm the selection
                    await interaction.reply({
                        ephemeral: true,
                        content: `Confirmed! You have selected the **${this.getPlayerTroopIcon(userId)}** as your custom troop icon`
                    });
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
        let content = `You have ${quantify(newTroops, 'troop', { adjective: 'new' })} to deploy.`;
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
            return attacks.map(a => `- Attack _${this.getTerritoryName(a.to)}_ with ${quantify(a.quantity, 'troop')} from _${this.getTerritoryName(a.from)}_`);
        }
        return [];
    }

    private getMoveDecisionStrings(userId: Snowflake): string[] {
        if (this.state.moveDecisions) {
            const moveData = this.state.moveDecisions[userId];
            if (moveData) {
                return [`- Move ${quantify(moveData.quantity, 'troop')} from _${this.getTerritoryName(moveData.from)}_ to _${this.getTerritoryName(moveData.to)}_`];
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
                    result.push(quantify(troops, 'troop'));
                }
                result.push(quantify(this.getNumTerritoryConnections(territoryId), 'neighbor'));
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
                    result.push(quantify(troops, 'troop'));
                }
                const troopsToBeAdded = this.getTerritoryTroopsToBeAdded(territoryId);
                if (troopsToBeAdded) {
                    result.push(`${troopsToBeAdded} to be added`)
                }
                result.push(quantify(this.getNumTerritoryConnections(territoryId), 'neighbor'));
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

    private getAvailableTroopIconSelectOptions(): APISelectMenuOption[] {
        return this.getAvailableTroopIcons().map(troopIcon => ({
            label: troopIcon,
            value: troopIcon
        }));
    }
}
