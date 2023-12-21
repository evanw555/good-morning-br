import canvas, { NodeCanvasRenderingContext2D } from 'canvas';
import { AttachmentBuilder, GuildMember, MessageFlags, Snowflake } from 'discord.js';
import { getRankString, getNumberBetween, naturalJoin, randInt, shuffle, toLetterId, fromLetterId, AStarPathFinder, shuffleWithDependencies, toFixed, collapseRedundantStrings, chance, randChoice } from 'evanw555.js';
import { DecisionProcessingResult, MazeGameState, MazeItemName, MazeLine, MazeLocation, MazePlayerState, MessengerPayload, PrizeType } from "../types";
import AbstractGame from "./abstract-game";

import logger from '../logger';
import imageLoader from '../image-loader';

enum TileType {
    INVALID = -1,
    EMPTY = 0,
    WALL = 1,
    DOORWAY = 2,
    OPENED_DOORWAY = 3,
    CHEST = 4,
    HIDDEN_TRAP = 5,
    TRAP = 6,
    BOULDER = 7,
    COIN = 8
}

type Direction = 'up' | 'down' | 'left' | 'right';

const OFFSETS_BY_DIRECTION: Record<Direction, [number, number]> = {
    up: [-1, 0],
    down: [1, 0],
    left: [0, -1],
    right: [0, 1]
};

type BasicActionName = Direction | 'pause' | 'unlock' | 'lock' | 'punch' | 'warp' | 'coin';
type ActionName = BasicActionName | MazeItemName;

const ITEM_NAME_RECORD: Record<MazeItemName, boolean> = {
    boulder: true,
    seal: true,
    trap: true,
    key: true,
    star: true,
    charge: true
};
const ITEM_NAMES: MazeItemName[] = Object.keys(ITEM_NAME_RECORD) as MazeItemName[];
const VALID_ITEMS: Set<string> = new Set(ITEM_NAMES);

const ACTION_SYMBOLS: Record<ActionName, string> = {
    up: '⬆️',
    down: '⬇️',
    left: '⬅️',
    right: '➡️',
    pause: '⏸️',
    unlock: '🔓',
    lock: '🔒',
    punch: '🥊',
    warp: '🎱',
    coin: '🪙',
    boulder: '🪨',
    seal: '🦭',
    trap: '🕳️',
    key: '🔑',
    star: '⭐',
    charge: '🏈'
};

interface PathingOptions {
    useDoorways?: boolean,
    addedOccupiedTileCost?: number,
    obstacles?: MazeLocation[]
}

export default class MazeGame extends AbstractGame<MazeGameState> {
    private static readonly TILE_SIZE: number = 24;
    private static readonly STARTER_POINTS: number = 3;

    private static readonly STYLE_SKY: string = 'hsl(217, 94%, 69%)';
    private static readonly STYLE_DARK_SKY: string = 'hsl(217, 90%, 64%)';
    private static readonly STYLE_LIGHT_SKY: string = 'hsl(217, 85%, 75%)';
    private static readonly STYLE_CLOUD: string = 'rgba(222, 222, 222, 1)';
    private static readonly STYLE_WARP_PATH: string = 'rgba(98, 11, 212, 0.5)';
    private static readonly STYLE_HEAVY_PATH: string = 'rgba(255, 0, 0, 0.75)';

    constructor(state: MazeGameState) {
        super(state);
        // TODO: Temp logic to remove removed properties
        if (state.players) {
            for (const userId of Object.keys(state.players)) {
                if ('avatarUrl' in state.players[userId]) {
                    delete state.players[userId]['avatarUrl'];
                }
            }
        }
    }

    static create(members: GuildMember[], season: number): MazeGame {
        // this.createBest(members, 20, 40);
        // this.createSectional(members, { sectionSize: 33, sectionsAcross: 1 }); // Before: size=11,across=3
        return this.createOrganicBest(members, season, { attempts: 20, rows: 33, columns: 19, minNaive: 80 });
    }

    getIntroductionText(): string[] {
        return [
            'My dear dogs... Welcome to the Clouded Labyrinth of the Shining Idol! '
                + 'This season, you will all be traversing this silver-lined dungeon in search of bright mornings. '
                + 'The first, second, and third pups to reach me at the end will be crowned victorious. '
                + 'Each Saturday, you will have all day to choose your moves, each costing some amount of points. '
                + 'Some moves are secret and can only be performed once unlocked. '
                + 'The next day (Sunday), your moves will be performed one-by-one.',
            // TODO: Add temp text indicating new features for this season
        ];
    }

    getInstructionsText(): string {
        if (this.state.homeStretch && this.getNumWinners() > 0) {
            const text = 'All players in _blue_ have a **2x** point multiplier for the next week';
            if (this.getNumWinners() === 1) {
                return `**${this.getDisplayName(this.getWinners()[0])}** has already reached the goal, so the race for 2nd and 3rd is on! ${text}`;
            } else {
                return `**${this.getDisplayName(this.getWinners()[0])}** and **${this.getDisplayName(this.getWinners()[1])}** have already reached the goal, so the race for 3rd is on! ${text}`;
            }
        }
        return 'Choose your moves by sending me a DM with your desired sequence of actions. You have until tomorrow morning to choose. DM me _"help"_ for more info.';
            // TODO: Temp message to notify players of changes, remove this after 4/22/23
            // + '\n**Changes since last week:**'
            // + '\n⭐ TODO';
    }

    getHelpText(): string {
        // TODO: Update this for the new season
        return 'Here are the possible actions you may take and their associated costs:\n'
                + '`up`, `down`, `left`, `right`: move one step in such direction. Costs `1`\n'
                + '`unlock`: open all doorways adjacent to you (or just one e.g. `unlock:b12`). Cost is denoted on each doorway, and is reduced with each unlock\n'
                + '`lock`: close all doorways adjacent to you (or just one e.g. `lock:b12`). Cost is denoted on each doorway\n'
                + '`punch`: 75% chance of knocking out any player adjacent to you, stunning them for `3` moves. Some of their money may fall onto the floor around them. Costs `2`\n'
                + '`warp`: warp to a random player. Costs `0.5` for each week that has elapsed\n'
                + '`pause`: do nothing. Free\n\n'
            + 'Misc Rules:\n'
                + '1. If you do not choose your actions, actions will be chosen for you (use `pause` to do nothing instead).\n'
                + '2. In a given turn, one action is processed from each player in a _semi-random_ order until all players have no actions left '
                + '("semi-random" = random, but your action is guaranteed to be after another player\'s if you\'re walking into them).\n'
                + '3. You cannot walk over/past other players unless they are KO\'ed or you are walking into each other head-on.\n'
                + '4. Players starting their turn with less than one point are KO\'ed the entire turn.\n'
                + '5. If you somehow walk into a wall, your turn is ended.\n'
                + '6. If you walk into another player and they have no more actions remaining, you will shove them forward. '
                    + 'If you cannot shove them forward, you will shove them to either side. '
                    + 'If neither side is vacant, you will auto-punch them for 2 points (if you have 4+ points). '
                    + 'If you cannot afford to auto-punch, your turn will be ended early.\n'
                + '7. If your turn is ended early due to any of these reasons, you will only lose points for each action taken.\n'
                + '8. If you warp, you will be KO\'ed at the end of your turn so that others can walk past you.\n'
                + '9. If you warp multiple times in one turn, all subsequent warps will only go through if it brings you closer to the goal.\n\n'
            + 'Send me a DM with your chosen actions e.g. `up right unlock right pause right punch lock:b12 down`';
    }

    getDebugText(): string {
        return `Week ${this.getTurn()}, Action ${this.state.action}, ${toFixed(this.getSeasonCompletion() * 100)}% Complete\n`
            + this.getOrderedPlayers()
                .filter(userId => userId in this.state.decisions)
                .map(userId => `**${this.getDisplayName(userId)}**: \`` + this.state.decisions[userId].map(decision => ACTION_SYMBOLS[decision.split(':')[0]]).join('') + '`')
                .join('\n')
    }

    getDebugString(): string {
        return this.getMapFairness().description;
    }

    getSeasonCompletion(): number {
        if (this.isSeasonComplete()) {
            return 1;
        }

        // Assume the unfinished player with the best rank has the lowest cost to goal
        const leadingUserId: Snowflake = this.getOrderedUnfinishedPlayers()[0];
        if (!leadingUserId) {
            return 0;
        }

        // TODO: Should we store the "spawn" point in the state rather than assuming?
        const spawnCost: number = this.approximateCostToGoal(0, 0);
        const lowestCost: number = this.approximateCostToGoalForPlayer(leadingUserId);

        return 1 - (lowestCost / spawnCost);
    }

    /**
     * @returns all players in no particular order
     */
    getPlayers(): Snowflake[] {
        return Object.keys(this.state.players);
    }

    getOrderedPlayers(): Snowflake[] {
        return this.getPlayers().sort((x, y) => this.state.players[x].rank - this.state.players[y].rank);
    }

    hasPlayer(userId: Snowflake): boolean {
        return userId in this.state.players;
    }

    addPlayer(member: GuildMember): string {
        if (member.id in this.state.players) {
            logger.log(`Refusing to add **${member.displayName}** to the maze, as they're already in it!`);
            return `Cannot add **${member.displayName}** (already in-game)`;
        }
        // Get the worst 33% of players based on location
        const playersClosestToGoal: Snowflake[] = this.getUnfinishedPlayersClosestToGoal();
        const worstPlayers = playersClosestToGoal.slice(-Math.floor(playersClosestToGoal.length / 3));
        // Choose a random vacant spawn location around any of these players
        const spawnLocation = this.getSpawnableLocationAroundPlayers(worstPlayers);
        // If there was no available spawn location, then just choose a random tile in the top row
        const spawnR = spawnLocation?.location.r ?? 0;
        const spawnC = spawnLocation?.location.c ?? randInt(0, this.state.columns);
        // This new player gets starter points (plus more if later in the game) as a balance
        const lateStarterPoints: number = MazeGame.STARTER_POINTS + this.getTurn();
        // Create the player at this spawn location
        this.state.players[member.id] = {
            r: spawnR,
            c: spawnC,
            rank: this.getNumPlayers() + 1,
            points: lateStarterPoints,
            displayName: member.displayName
        };
        // Refresh all player ranks
        this.refreshPlayerRanks();
        // Return log text describing this player being added
        const locationText: string = spawnLocation ? `near **${this.getDisplayName(spawnLocation.userId)}**` : `at \`${MazeGame.getLocationString(spawnR, spawnC)}\``;
        return `Added player **${member.displayName}** ${locationText} with **${lateStarterPoints}** starter points`;
    }

    updatePlayer(member: GuildMember): void {
        if (this.hasPlayer(member.id)) {
            const player = this.state.players[member.id];
            player.displayName = member.displayName;
        }
    }

    removePlayer(userId: Snowflake): void {
        const playerDisplayName = this.getDisplayName(userId);
        delete this.state.players[userId];
        delete this.state.decisions[userId];
        // Remove any owned traps
        for (const [ locationString, trapOwnerId ] of Object.entries(this.state.trapOwners)) {
            if (trapOwnerId === userId) {
                const location = MazeGame.parseLocationString(locationString);
                if (location) {
                    this.state.map[location.r][location.c] = TileType.EMPTY;
                    delete this.state.trapOwners[locationString];
                    logger.log(`Deleted trap at \`${locationString}\` for removed player **${playerDisplayName}**`);
                } else {
                    logger.log(`Couldn't remove trap at \`${locationString}\` for removed player **${playerDisplayName}** (invalid location!)`);
                }
            }
        }
        // TODO: Remove from winners too?
    }

    override doesPlayerNeedHandicap(userId: Snowflake): boolean {
        // True if this player is in the bottom half of players and has fewer than 20 points
        const player = this.state.players[userId];
        return player && player.rank > Math.floor(this.getNumPlayers() / 2) && player.points < 20;
    }

    override doesPlayerNeedNerf(userId: string): boolean {
        // Player needs nerf if we're 20% into the season and player is in the top 3 ranks
        return this.getSeasonCompletion() > 0.2 && this.getPlayerRank(userId) <= 3;
    }

    async renderState(options?: { showPlayerDecision?: Snowflake, admin?: boolean }): Promise<Buffer> {
        const WIDTH: number = this.state.columns * MazeGame.TILE_SIZE;
        const HEIGHT: number = this.state.rows * MazeGame.TILE_SIZE;
        const c = canvas.createCanvas(WIDTH, HEIGHT);
        const context = c.getContext('2d');
        const coinImage = await imageLoader.loadImage('assets/coin.png');

        // Fill the blue sky background
        context.fillStyle = MazeGame.STYLE_SKY;
        context.fillRect(0, 0, WIDTH, HEIGHT);

        // Draw the checkerboard pattern
        for (let r = 0; r < this.state.rows; r++) {
            for (let c = 0; c < this.state.columns; c++) {
                if ((r + c) % 2 == 0) {
                    context.fillStyle = MazeGame.STYLE_DARK_SKY;
                    context.fillRect(c * MazeGame.TILE_SIZE, r * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE, MazeGame.TILE_SIZE);
                }
            }
        }

        // Draw all the tiles
        for (let r = 0; r < this.state.rows; r++) {
            for (let c = 0; c < this.state.columns; c++) {
                if (this.isTileType(r, c, TileType.CHEST)) {
                    // Draw chests
                    context.fillStyle = 'yellow';
                    context.fillRect(c * MazeGame.TILE_SIZE, r * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE, MazeGame.TILE_SIZE);
                } else if (this.isTileType(r, c, TileType.TRAP)) {
                    // Draw revealed traps
                    context.fillStyle = 'black';
                    context.beginPath();
                    context.arc((c + .5) * MazeGame.TILE_SIZE, (r + .5) * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE / 4, 0, Math.PI * 2, false);
                    context.fill();
                } else if (this.isTileType(r, c, TileType.BOULDER)) {
                    context.fillStyle = 'dimgray';
                    context.strokeStyle = 'black';
                    context.lineWidth = 2;
                    context.setLineDash([]);
                    this.drawRandomPolygonOnTile(context, r, c);
                } else if (this.isTileType(r, c, TileType.COIN)) {
                    context.drawImage(coinImage, c * MazeGame.TILE_SIZE, r * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE, MazeGame.TILE_SIZE);
                } else if (this.isCloudy(r, c)) {
                    context.fillStyle = MazeGame.STYLE_CLOUD;
                    context.beginPath();
                    context.arc((c + .5) * MazeGame.TILE_SIZE, (r + .5) * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE / 2, 0, Math.PI * 2, false);
                    context.fill();
                    // Handle connections
                    if (this.isCloudy(r + 1, c)) {
                        const radius = randInt(MazeGame.TILE_SIZE * .4, MazeGame.TILE_SIZE * .6);
                        context.beginPath();
                        context.arc((c + .5) * MazeGame.TILE_SIZE, (r + 1) * MazeGame.TILE_SIZE, radius, 0, Math.PI * 2, false);
                        context.fill();
                    }
                    if (this.isCloudy(r, c + 1)) {
                        const radius = randInt(MazeGame.TILE_SIZE * .4, MazeGame.TILE_SIZE * .6);
                        context.beginPath();
                        context.arc((c + 1) * MazeGame.TILE_SIZE, (r + .5) * MazeGame.TILE_SIZE, radius, 0, Math.PI * 2, false);
                        context.fill();
                    }
                    // context.fillRect(c * MazeGame.TILE_SIZE, r * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE, MazeGame.TILE_SIZE);
                    if (this.isTileType(r, c, TileType.DOORWAY)) {
                        // Draw key hole cost
                        context.fillStyle = MazeGame.STYLE_LIGHT_SKY;
                        context.font = `${MazeGame.TILE_SIZE * .6}px sans-serif`;
                        this.fillTextOnTile(context, this.state.doorwayCosts[MazeGame.getLocationString(r, c)].toString(), r, c);
                        // context.fillRect((c + .4) * MazeGame.TILE_SIZE, (r + .3) * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE * .2, MazeGame.TILE_SIZE * .4);
                    } else if (this.isTileType(r, c, TileType.OPENED_DOORWAY)) {
                        context.fillStyle = MazeGame.STYLE_SKY;
                        if (this.isWalkable(r - 1, c) || this.isWalkable(r + 1, c)) {
                            context.fillRect((c + .1) * MazeGame.TILE_SIZE, r * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE * .8, MazeGame.TILE_SIZE);
                        }
                        if (this.isWalkable(r, c - 1) || this.isWalkable(r, c + 1)) {
                            context.fillRect(c * MazeGame.TILE_SIZE, (r + .1) * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE, MazeGame.TILE_SIZE * .8);
                        }
                        // Draw opened key hole cost
                        context.fillStyle = MazeGame.STYLE_CLOUD;
                        context.font = `${MazeGame.TILE_SIZE * .6}px sans-serif`;
                        this.fillTextOnTile(context, this.state.doorwayCosts[MazeGame.getLocationString(r, c)].toString(), r, c);
                    }
                } else {
                    context.fillStyle = 'black';
                }
            }
        }

        // Draw the sun at the center
        const sunImage = await imageLoader.loadImage('assets/sun4.png');
        context.drawImage(sunImage, (this.getGoalColumn() - .5) * MazeGame.TILE_SIZE, (this.getGoalRow() - .5) * MazeGame.TILE_SIZE, 2 * MazeGame.TILE_SIZE, 2 * MazeGame.TILE_SIZE);

        // Render all "standard" lines (e.g. player steps) before rendering the players themselves
        this.renderLines(context, this.state.lines.filter(line => !line.over));

        // Render all unfinished players (always render stunned players first so they're beneath others)
        const renderOrderedUserIds = this.getUnfinishedPlayers().sort((a, b) => (this.isPlayerStunned(b) ? 1 : 0) - (this.isPlayerStunned(a) ? 1 : 0));
        for (const userId of renderOrderedUserIds) {
            await this.renderPlayer(context, userId);
        }

        // Render all "special" lines (e.g. warps, charges, traps) after rendering the players themselves
        this.renderLines(context, this.state.lines.filter(line => line.over));

        // Render the player's actions if enabled
        if (options?.showPlayerDecision) {
            await this.renderPlayerDecision(context, options.showPlayerDecision);
        }

        // Render admin stuff
        if (options?.admin) {
            // Render trap owners
            context.font = `${MazeGame.TILE_SIZE * .35}px sans-serif`;
            context.fillStyle = 'black';
            for (const [ locationString, trapOwnerId ] of Object.entries(this.state.trapOwners)) {
                const location = MazeGame.parseLocationString(locationString);
                if (location) {
                    this.fillTextOnTile(context, this.getDisplayName(trapOwnerId), location.r, location.c);
                }
            }
            // Render all player decisions
            for (const userId of Object.keys(this.state.players)) {
                await this.renderPlayerDecision(context, userId);
            }
            // Render the overall shortest path from the start to the finish
            // TODO: Use the real "start" location when that data is defined
            const dummyStart: MazeLocation = { r: 0, c: Math.floor(this.state.columns / 2) };
            const actionsToGoal: Direction[] = this.searchToGoal(dummyStart.r, dummyStart.c).semanticSteps;
            const locationsToGoal: MazeLocation[] = MazeGame.getSequenceOfLocations(dummyStart, actionsToGoal);
            context.strokeStyle = 'green';
            context.lineWidth = 3;
            context.setLineDash([]);
            context.globalAlpha = 0.75;
            this.renderPath(context, locationsToGoal);
            context.globalAlpha = 1;
        }

        const SIDEBAR_WIDTH = MazeGame.TILE_SIZE * 11;
        const TOTAL_WIDTH = WIDTH + MazeGame.TILE_SIZE + SIDEBAR_WIDTH;
        const TOTAL_HEIGHT = HEIGHT + MazeGame.TILE_SIZE;
        const masterImage = canvas.createCanvas(TOTAL_WIDTH, TOTAL_HEIGHT);
        const c2 = masterImage.getContext('2d');

        // Render coordinate labels
        c2.font = `${MazeGame.TILE_SIZE * .6}px sans-serif`;
        c2.fillStyle = 'black';
        c2.fillRect(0, 0, TOTAL_WIDTH, TOTAL_HEIGHT);
        c2.drawImage(c, MazeGame.TILE_SIZE, MazeGame.TILE_SIZE);
        for (let r = 0; r < this.state.rows; r++) {
            const text = toLetterId(r);
            if (r % 2 === 0) {
                c2.fillStyle = 'rgb(50,50,50)';
                c2.fillRect(0, (r + 1) * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE, MazeGame.TILE_SIZE);
            }
            c2.fillStyle = 'white';
            c2.fillText(text, (MazeGame.TILE_SIZE - c2.measureText(text).width) / 2, (r + 1.75) * MazeGame.TILE_SIZE);
        }
        for (let c = 0; c < this.state.columns; c++) {
            const text = (c + 1).toString();
            if (c % 2 === 0) {
                c2.fillStyle = 'rgb(50,50,50)';
                c2.fillRect((c + 1) * MazeGame.TILE_SIZE, 0, MazeGame.TILE_SIZE, MazeGame.TILE_SIZE);
            }
            c2.fillStyle = 'white';
            c2.fillText(text, (c + 1) * MazeGame.TILE_SIZE + (MazeGame.TILE_SIZE - c2.measureText(text).width) / 2, MazeGame.TILE_SIZE * .75);
        }

        // Determine the number of rows of text we need to render in the sidebar and thus the height per row
        const rowsNeeded = this.getNumPlayers() + Object.keys(this.getChoices()).length + 6;
        const heightPerRow = Math.floor(MazeGame.TILE_SIZE * Math.min(1, this.state.rows / rowsNeeded));

        // Render usernames in order of location
        const MARGIN = 0.5 * MazeGame.TILE_SIZE;
        c2.font = `${heightPerRow * .75}px sans-serif`;
        let y = 2;
        c2.fillStyle = 'white';
        const leftTextX = WIDTH + MazeGame.TILE_SIZE + MARGIN;
        c2.fillText(`Season ${this.getSeasonNumber()}, Week ${this.state.turn}, Action ${this.state.action}`, leftTextX, MazeGame.TILE_SIZE);
        for (const userId of this.getOrganizedPlayers()) {
            y++;
            const player = this.state.players[userId];
            // Define helper for resetting the text color
            const resetTextColor = () => {
                if (this.isPlayerStunned(userId)) {
                    c2.fillStyle = 'hsl(360,50%,55%)';
                } else if (player.finished) {
                    c2.fillStyle = 'yellow';
                } else {
                    c2.fillStyle = `hsl(360,0%,${y % 2 === 0 ? 85 : 55}%)`;
                }
            };
            const textY = y * heightPerRow;
            // Draw the location
            resetTextColor();
            const leftTextWidth = 1.5 * MazeGame.TILE_SIZE;
            const locationText = player.finished ? ':)' : this.getPlayerLocationString(userId);
            c2.fillText(locationText, leftTextX, textY, leftTextWidth);
            // Set the text to blue just for the points if there's a multiplier
            if (this.playerHasMultiplier(userId)) {
                c2.fillStyle = 'blue';
            }
            // Draw the points
            const middleTextX = leftTextX + leftTextWidth + MARGIN;
            const middleTextWidth = 1.25 * MazeGame.TILE_SIZE;
            c2.fillText(`$${Math.floor(player.points)}`, middleTextX, textY, middleTextWidth);
            // Draw the username
            resetTextColor();
            const rightTextX = middleTextX + middleTextWidth + MARGIN;
            const rightTextWidth = TOTAL_WIDTH - rightTextX;
            c2.fillText(player.displayName, rightTextX, textY, rightTextWidth);
        }

        // Write extra text on the sidebar
        y += 2;
        c2.fillStyle = 'white';
        c2.fillText('Reach me at the end to win!\nDM me "help" for help', leftTextX, y * heightPerRow, TOTAL_WIDTH - leftTextX);

        // Draw potential actions
        y += 2;
        for (const [actionName, { cost, description }] of Object.entries(this.getChoices())) {
            y++;
            c2.fillStyle = `hsl(360,0%,${y % 2 === 0 ? 85 : 55}%)`;
            const textY = y * heightPerRow;
            // Draw the action name
            const leftTextWidth = 1.5 * MazeGame.TILE_SIZE;
            c2.fillText(actionName, leftTextX, textY, leftTextWidth);
            // Draw the cost
            const middleTextX = leftTextX + leftTextWidth + MARGIN;
            const middleTextWidth = 0.75 * MazeGame.TILE_SIZE;
            c2.fillText(`${cost}`, middleTextX, textY, middleTextWidth);
            // Draw the description
            const rightTextX = middleTextX + middleTextWidth + MARGIN;
            const rightTextWidth = TOTAL_WIDTH - rightTextX;
            c2.fillText(description, rightTextX, textY, rightTextWidth);
        }

        return masterImage.toBuffer();
    }

    private async renderPlayer(context: NodeCanvasRenderingContext2D, userId: Snowflake): Promise<void> {
        const player = this.state.players[userId];

        // Draw outline (rainbow if invincible, black otherwise)
        const outlineX = (player.c + .5) * MazeGame.TILE_SIZE;
        const outlineY = (player.r + .5) * MazeGame.TILE_SIZE;
        const outlineRadius = MazeGame.TILE_SIZE / 2 + 1;
        if (player.invincible) {
            const n = 32;
            const rotationOffset = randInt(0, n);
            context.lineWidth = 3;
            context.setLineDash([]);
            for (let i = 0; i < n; i++) {
                context.strokeStyle = `hsl(${Math.floor((i + rotationOffset) * 360 / n)},100%,50%)`;
                context.beginPath();
                context.arc(outlineX, outlineY, outlineRadius, (i * 2 / n) * Math.PI, ((i + 1) * 2 / n) * Math.PI);
                context.stroke();
            }
        } else {
            // Draw a blue outline if the player has a multiplier, else black
            context.fillStyle = this.playerHasMultiplier(userId) ? 'blue' : 'black';
            context.beginPath();
            context.arc(outlineX, outlineY, outlineRadius, 0, Math.PI * 2, false);
            context.fill();
        }

        // Draw inner stuff
        const avatarImage = await imageLoader.loadAvatar(userId);
        await this.drawImageAsCircle(context, avatarImage, this.isPlayerStunned(userId) ? 0.4 : 1, (player.c + .5) * MazeGame.TILE_SIZE, (player.r + .5) * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE / 2);

        // If the user is stunned, draw something to indicate this
        if (this.isPlayerStunned(userId)) {
            // If the player has pending decisions, show the stuns left; else just draw an X
            if (this.hasPendingDecisions(userId)) {
                context.font = `bold ${MazeGame.TILE_SIZE * .85}px arial`;
                context.fillStyle = 'red';
                this.fillTextOnTile(context,this.getPlayerStuns(userId).toString(), player.r, player.c);
            } else {
                context.strokeStyle = 'red';
                context.lineWidth = 2;
                context.setLineDash([]);
                context.beginPath();
                context.moveTo(player.c * MazeGame.TILE_SIZE, player.r * MazeGame.TILE_SIZE);
                context.lineTo((player.c + 1) * MazeGame.TILE_SIZE, (player.r + 1) * MazeGame.TILE_SIZE);
                context.moveTo((player.c + 1) * MazeGame.TILE_SIZE, player.r * MazeGame.TILE_SIZE);
                context.lineTo(player.c * MazeGame.TILE_SIZE, (player.r + 1) * MazeGame.TILE_SIZE);
                context.stroke();
            }
        }
    }

    private async drawImageAsCircle(context: NodeCanvasRenderingContext2D, image: canvas.Image, alpha: number, centerX: number, centerY: number, radius: number): Promise<void> {
        // Set the global alpha
        context.globalAlpha = alpha;

        // Save the context so we can undo the clipping region at a later time
        context.save();

        // Define the clipping region as an 360 degrees arc at point x and y
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2, false);

        // Clip!
        context.clip();

        // Draw the image at imageX, imageY
        context.drawImage(image, centerX - radius, centerY - radius, radius * 2, radius * 2);

        // Restore the context to undo the clipping
        context.restore();
        context.globalAlpha = 1;
    }

    private fillTextOnTile(context: NodeCanvasRenderingContext2D, text: string, r: number, c: number): void {
        const width = context.measureText(text).width;
        const baseX = c * MazeGame.TILE_SIZE;
        const horizontalMargin = (MazeGame.TILE_SIZE - width) / 2;
        const ascent = context.measureText(text).actualBoundingBoxAscent;
        const baseY = r * MazeGame.TILE_SIZE;
        const verticalMargin = (MazeGame.TILE_SIZE - ascent) / 2;
        context.fillText(text, baseX + horizontalMargin, baseY + verticalMargin + ascent);
    }

    private drawRandomPolygonOnTile(context: NodeCanvasRenderingContext2D, r: number, c: number, options?: { numVertices?: number, minRadius?: number, maxRadius?: number }): void {
        const numVertices = options?.numVertices ?? randInt(8, 16);
        const minRadius = options?.minRadius ?? 0.4;
        const maxRadius = options?.maxRadius ?? 0.55;

        // Randomly generate vertices
        const vertices: { angle: number, radius: number }[] = [];
        for (let i = 0; i < numVertices; i++) {
            vertices.push({
                angle: 2 * Math.PI * i / numVertices,
                radius: randInt(Math.floor(MazeGame.TILE_SIZE * minRadius), Math.floor(MazeGame.TILE_SIZE * maxRadius))
            });
        }

        const baseX = (c + 0.5) * MazeGame.TILE_SIZE;
        const baseY = (r + 0.5) * MazeGame.TILE_SIZE;

        const getVertexCoords = (vertex: { angle: number, radius: number }): { x: number, y: number } => {
            return {
                x: baseX + Math.cos(vertex.angle) * vertex.radius,
                y: baseY + Math.sin(vertex.angle) * vertex.radius
            }
        };

        // Prime the path with the last vertex to make sure it connects
        context.beginPath();
        const { x: primeX, y: primeY } = getVertexCoords(vertices[vertices.length - 1]);
        context.moveTo(primeX, primeY);

        // Move to all remaining vertices then stroke and fill
        for (const vertex of vertices) {
            const { x, y } = getVertexCoords(vertex);
            context.lineTo(x, y);
        }
        context.stroke();
        context.fill();
    }

    private renderLines(context: canvas.CanvasRenderingContext2D, lines: MazeLine[]): void {
        // Use a stateful counter for the hue angle between lines
        let theta = Math.random();

        for (const line of lines) {
            // Handle rainbow lines specially
            if (line.special === 'rainbow') {
                context.lineWidth = 3;
                context.setLineDash([]);
                const n = 12;
                for (let i = 0; i < n; i++) {
                    context.beginPath();
                    const r1 = getNumberBetween(line.from.r, line.to.r, i / n);
                    const c1 = getNumberBetween(line.from.c, line.to.c, i / n);
                    context.moveTo((c1 + .5) * MazeGame.TILE_SIZE, (r1 + .5) * MazeGame.TILE_SIZE);
                    const r2 = getNumberBetween(line.from.r, line.to.r, (i + 1) / n);
                    const c2 = getNumberBetween(line.from.c, line.to.c, (i + 1) / n);
                    context.lineTo((c2 + .5) * MazeGame.TILE_SIZE, (r2 + .5) * MazeGame.TILE_SIZE);
                    context.strokeStyle = `hsl(${Math.floor(theta * 360)},100%,50%)`;
                    theta = (theta + 0.02) % 1;
                    context.stroke();
                }
                continue;
            }
            // Dash lines should be an even fraction of the tile size so that they look continuous together
            // TODO: Rather than having types of "special" lines, should we just have the style be explicitly overridden?
            if (line.special) {
                context.lineWidth = 4;
                context.strokeStyle = (line.special === 'warp') ? MazeGame.STYLE_WARP_PATH : MazeGame.STYLE_HEAVY_PATH;
                context.setLineDash([Math.floor(MazeGame.TILE_SIZE / 4), Math.floor(MazeGame.TILE_SIZE / 4)]);
            } else {
                // Draw dashed movement lines
                context.lineWidth = 3;
                context.strokeStyle = MazeGame.STYLE_LIGHT_SKY;
                context.setLineDash([Math.floor(MazeGame.TILE_SIZE / 12), Math.floor(MazeGame.TILE_SIZE / 12)]);
            }
            context.beginPath();
            context.moveTo((line.from.c + .5) * MazeGame.TILE_SIZE, (line.from.r + .5) * MazeGame.TILE_SIZE);
            context.lineTo((line.to.c + .5) * MazeGame.TILE_SIZE, (line.to.r + .5) * MazeGame.TILE_SIZE);
            context.stroke();
        }
    }

    private async renderPlayerDecision(context: canvas.CanvasRenderingContext2D, userId: Snowflake) {
        const player = this.state.players[userId];
        const decisions: string[] = this.state.decisions[userId] ?? [];
        const tempLocation = { r: player.r, c: player.c };
        // Render the movement path
        const locations = MazeGame.getSequenceOfLocations(tempLocation, decisions as ActionName[]);
        context.strokeStyle = 'red';
        context.lineWidth = 2;
        context.setLineDash([Math.floor(MazeGame.TILE_SIZE * .25), Math.floor(MazeGame.TILE_SIZE * .25)]);
        this.renderPath(context, locations);
        // Show the final location
        const finalLocation = locations[locations.length - 1];
        if (finalLocation) {
            // Show a circle at the final location
            context.setLineDash([]);
            context.beginPath();
            context.arc((finalLocation.c + .5) * MazeGame.TILE_SIZE, (finalLocation.r + .5) * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE / 2 + 1, 0, Math.PI * 2, false);
            context.stroke();
            // Render the player's avatar faintly
            const avatarImage = await imageLoader.loadAvatar(userId);
            await this.drawImageAsCircle(context, avatarImage, 0.35, (finalLocation.c + .5) * MazeGame.TILE_SIZE, (finalLocation.r + .5) * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE / 2);
        }
        // Show attempted "placement" actions
        context.font = `${MazeGame.TILE_SIZE * .5}px sans-serif`;
        context.lineWidth = 1;
        context.fillStyle = 'red';
        context.setLineDash([]);
        for (const decision of decisions.filter(d => d.startsWith('trap:') || d.startsWith('boulder:') || d.startsWith('coin:'))) {
            const [ action, locationString ] = decision.split(':');
            const location = MazeGame.parseLocationString(locationString);
            if (location) {
                this.fillTextOnTile(context, action.toUpperCase(), location.r, location.c);
            }
        }
        // Show placed traps
        context.lineWidth = 1;
        context.strokeStyle = 'black';
        context.setLineDash([Math.floor(MazeGame.TILE_SIZE * .1), Math.floor(MazeGame.TILE_SIZE * .1)]);
        for (const location of this.getHiddenTrapsForPlayer(userId)) {
            context.beginPath();
            context.arc((location.c + .5) * MazeGame.TILE_SIZE, (location.r + .5) * MazeGame.TILE_SIZE, MazeGame.TILE_SIZE / 4, 0, Math.PI * 2, false);
            context.stroke();
        }
        context.setLineDash([]);
    }

    private renderPath(context: canvas.CanvasRenderingContext2D, locations: MazeLocation[]) {
        for (let i = 1; i < locations.length; i++) {
            const prev = locations[i - 1];
            const curr = locations[i];
            context.beginPath();
            context.moveTo((prev.c + .5) * MazeGame.TILE_SIZE, (prev.r + .5) * MazeGame.TILE_SIZE);
            context.lineTo((curr.c + .5) * MazeGame.TILE_SIZE, (curr.r + .5) * MazeGame.TILE_SIZE);
            context.stroke();
        }
    }

    private getChoices(): Partial<Record<ActionName, { cost: number | string, description: string }>> {
        return {
            'up': { cost: 1, description: 'Move up 1 tile' },
            'down': { cost: 1, description: 'Move down 1 tile' },
            'left': { cost: 1, description: 'Move left 1 tile' },
            'right': { cost: 1, description: 'Move right 1 tile' },
            'pause': { cost: 0, description: 'Do nothing' },
            'unlock': { cost: 'N', description: 'Open adjacent doorways' },
            'lock': { cost: 'N', description: 'Close adjacent doorways' },
            'punch': { cost: 2, description: 'Try to KO adjacent players' },
            'warp': { cost: this.getActionCost('warp'), description: 'Warp to a random player' }
        };
    }

    override beginTurn(): string[] {
        // Increment turn and reset action counter
        this.state.turn++;
        this.state.action = 0;
        this.state.decisions = {};

        // Clear all render lines (this is done before each action, but it must be done now so lines don't show up in the decision render)
        this.state.lines = [];

        // Refresh all player ranks
        this.refreshPlayerRanks();

        // If at least player has completed the maze, enable "home stretch" mode
        if (!this.state.homeStretch && this.getNumWinners() > 0) {
            this.state.homeStretch = true;
        }

        for (const userId of this.getPlayers()) {
            const player = this.state.players[userId];
            // Reset per-turn metadata and statuses
            player.originLocation = { r: player.r, c: player.c };
            delete player.stuns;
            delete player.invincible;
            delete player.warped;
            // Give the player a multiplier for this turn if it's the home stretch and they're in need of help
            delete player.multiplier;
            if (this.state.homeStretch && this.doesPlayerNeedHandicap(userId)) {
                player.multiplier = 2;
            }
            // If the user already finished, do nothing
            if (player.finished) {
                continue;
            }
            // If the player has one or more points, choose a default sequence of actions for the user
            if (this.getPoints(userId) >= 1) {
                const actions: Direction[] = this.getNextActionsTowardGoal(userId, Math.floor(player.points));
                if (actions.length > 0) {
                    this.state.decisions[userId] = actions;
                }
            } else {
                // Otherwise, knock them out
                player.stuns = 1;
            }
        }

        // Remove all dangling trap owners
        for (const location of this.getAllLocations()) {
            const locationString = MazeGame.getLocationString(location.r, location.c);
            const isTrapTile = this.isTileType(location.r, location.c, TileType.HIDDEN_TRAP) || this.isTileType(location.r, location.c, TileType.TRAP);
            const trapOwnerId = this.getTrapOwner(location);
            if (!isTrapTile && trapOwnerId) {
                delete this.state.trapOwners[locationString];
                logger.log(`(Trap validation) Deleted owner **${this.getDisplayName(trapOwnerId)}** for nonexistent trap at **${locationString}**`);
            }
        }

        // If far enough in the season, start adding coins
        if (this.getSeasonCompletion() > 0.25) {
            const topPlayerId = this.getTopUnfinishedPlayer();
            if (topPlayerId) {
                // Get some random vacant locations behind the top player (scale with season completion)
                const numCoins = Math.floor(this.getSeasonCompletion() * randInt(15, 35));
                const coinLocations = this.getRandomVacantLocationsBehindPlayer(topPlayerId, numCoins);
                // Add coins to all these locations
                for (const coinLocation of coinLocations) {
                    this.state.map[coinLocation.r][coinLocation.c] = TileType.COIN;
                }
            }
        }

        return [];
    }

    override async endTurn(): Promise<MessengerPayload[]> {
        // It's Sunday, so wipe all the item offers
        for (const userId of this.getPlayers()) {
            const player = this.state.players[userId];
            delete player.itemOffers;
        }

        // Add the universal turn-end message and state render
        return await super.endTurn();
    }

    getPoints(userId: Snowflake): number {
        return this.state.players[userId]?.points ?? 0;
    }

    addPoints(userId: Snowflake, points: number): void {
        if (isNaN(points)) {
            logger.log(`WARNING! Tried to award \`${points}\` points to **${this.getDisplayName(userId)}** (maze)`);
            return;
        }

        // Apply point multiplier (ONLY when adding positive points)
        const multiplier = (points > 0) ? this.getPlayerMultiplier(userId) : 1;

        // TODO: temp logging to see how this plays out
        // if (multiplier > 1) {
        //     logger.log(`Adding **${points}** points to **${this.getDisplayName(userId)}** with **${multiplier}x** multiplier (maze)`);
        // }

        this.state.players[userId].points = toFixed(this.getPoints(userId) + (points * multiplier));
    }

    getMaxPoints(): number {
        return Math.max(0, ...Object.values(this.state.players).map(player => player.points));
    }

    awardPrize(userId: Snowflake, type: PrizeType, intro: string): string[] {
        // If player isn't in the game yet, do nothing
        if (!this.hasPlayer(userId)) {
            return [];
        }
        // "Good" items are just any item that's not a trap (award boulders/traps if the player is finished)
        const goodItems: MazeItemName[] = this.isPlayerFinished(userId) ? ['boulder', 'trap'] : ITEM_NAMES.filter(item => item !== 'trap');
        switch (type) {
            case 'submissions1':
            case 'submissions1-tied':
                // For first place, let the user pick between two random "good" items
                return this.offerItems(userId, shuffle(goodItems).slice(0, 2), intro);
            case 'submissions2':
            case 'submissions2-tied':
                // For second place, award a random "good" item
                return this.awardItem(userId, randChoice(...goodItems), intro);
            case 'submissions3':
            case 'submissions3-tied':
            case 'streak':
            case 'nightmare':
                return this.awardItem(userId, 'trap', intro);
        }
    }

    private awardItem(userId: Snowflake, item: MazeItemName, intro: string): string[] {
        // If player isn't in the game yet, do nothing
        if (!this.hasPlayer(userId)) {
            return [];
        }
        // Add the item to the player's state
        this.addPlayerItem(userId, item);
        const numItems = this.getPlayerItemCount(userId, item);
        // Return the notification and instructions text
        logger.log(`Awarded **${item}** to **${this.getDisplayName(userId)}**`);
        return [`${intro}, you've just been awarded a **${item}**! Your inventory now contains **${numItems}**. ${MazeGame.getItemInstructions(item)}`];
    }

    private offerItems(userId: Snowflake, items: MazeItemName[], intro: string): string[] {
        // If player isn't in the game yet, do nothing
        if (!this.hasPlayer(userId)) {
            return [];
        }
        // Add the item offers to the player's state
        const player = this.state.players[userId];
        player.itemOffers = items;
        // Return text about this
        const texts = [`${intro}, as a reward you may pick one of the following items: ${naturalJoin(items, { bold: true, conjunction: 'or' })}. `
            + 'DM me to claim the item of your choice! (e.g. \`claim ITEM\`). This offer is valid until Sunday morning.'];
        for (const item of items) {
            texts.push(`**${item}:** ${MazeGame.getItemInstructions(item)}`);
        }
        logger.log(`Offered ${naturalJoin(items, { bold: true })} to **${this.getDisplayName(userId)}**`);
        return texts;
    }

    private static getItemInstructions(item: MazeItemName): string {
        const itemInstructions: Record<MazeItemName, string> = {
            trap: 'You can place a `trap` at a particular location as an action e.g. `trap:b12`. '
                + 'If a player ends their turn on a trap, they will be sent back to where they started that week\'s turn. '
                + 'Traps are invisible until triggered. Each time this trap is triggered, you will be given **1** point for each "step" back your victim has to travel.',
            boulder: 'You can place a `boulder` at a particular location as an action e.g. `boulder:b12`. '
                + 'The boulder will act as a immovable barrier that cannot be destroyed, unless it causes players to become permanently trapped.',
            seal: 'You can use `seal` as an action to permanently seal any locked/unlocked doorway in the 4 squares adjacent to you. '
                + 'Once a doorway is sealed, it is effectively a wall and cannot be unlocked. Optionally, seal one specific location e.g. `seal:b12`',
            star: 'You can use `star` as an action to make yourself invincible for the remainder of the week\'s turn. '
                + 'While invincible, walking into other players will knock them out (you won\'t bump into them). '
                + 'Also, you cannot be punched and you cannot fall into traps.',
            key: 'You can use `key` as an action to unlock all doorways in the 4 squares adjacent to you (at no cost), or optionally one specific location e.g. `key:b12`. '
                + 'If you use the key but no doorways are opened (e.g. door was already opened by someone else), then it will not be consumed. '
                + 'Any doorway you unlock using the key will thereafter be halved in cost, as with the standard `unlock` move.',
            charge: 'You can use `charge` to charge as far as you want in a particular direction in one single move '
                + '(e.g. `charge:b12` to charge to location `b:12`). Any players standing in the way will be knocked out and you will not bump into them. '
                + 'There must be a path to the target location and it must be directly up, down, left, or right from you.'
        };
        return itemInstructions[item] ?? 'Not sure what this item is, I don\'t recognize it. Please reach out to the admin!';
    }

    private static getLocationString(r: number, c: number): string {
        return `${toLetterId(r)}${c + 1}`;
    }

    private static parseLocationString(location: string): { r: number, c: number } | undefined {
        if (location) {
            const match = location.match(/^([a-zA-Z]+)([0-9]+)$/);
            if (match) {
                return {
                    r: fromLetterId(match[1]),
                    c: parseInt(match[2]) - 1
                }
            }
        }
    }

    private getPlayerLocation(userId: string): MazeLocation | undefined {
        if (userId in this.state.players) {
            return { r: this.state.players[userId].r, c: this.state.players[userId].c };
        }
    }

    private getPlayerLocationString(userId: string): string {
        return MazeGame.getLocationString(this.state.players[userId].r, this.state.players[userId].c);
    }

    private refreshPlayerRanks(): void {
        let i = 0;
        // For each winner (including those beyond the top 3), assign rank based on finish order
        // TODO: Should we change the winner field to be "finishers" to reduce ambiguity?
        for (const userId of this.state.winners) {
            this.state.players[userId].rank = ++i;
        }
        // For the remaining players, approximate the cost to goal
        const remainingPlayers: Snowflake[] = this.getUnfinishedPlayers();
        const costs: Record<Snowflake, number> = {};
        for (const userId of remainingPlayers) {
            costs[userId] = this.approximateCostToGoalForPlayer(userId);
        }
        // Sort first based on remaining cost to goal, then break ties using points
        remainingPlayers.sort((x, y) => (costs[x] - costs[y]) || (this.getPoints(y) - this.getPoints(x)));
        // Assign rank based on this sorting
        for (const userId of remainingPlayers) {
            this.state.players[userId].rank = ++i;
        }
    }

    /**
     * @returns all unfinished players in no particular order
     */
    getUnfinishedPlayers(): Snowflake[] {
        return Object.keys(this.state.players).filter(userId => !this.state.players[userId].finished);
    }

    /**
     * @returns all unfinished players ordered by rank
     */
    getOrderedUnfinishedPlayers(): Snowflake[] {
        return this.getOrderedPlayers().filter(userId => !this.state.players[userId].finished);
    }

    getTopUnfinishedPlayer(): Snowflake | undefined {
        return this.getOrderedUnfinishedPlayers()[0];
    }

    /**
     * @returns all players sorted in row-column order
     */
    getOrganizedPlayers(): Snowflake[] {
        const getLocationRank = (userId: Snowflake) => {
            return this.state.players[userId].r * this.state.columns + this.state.players[userId].c;
        }
        return Object.keys(this.state.players).sort((x, y) => getLocationRank(x) - getLocationRank(y));
    }

    /**
     * @returns all unfinished players ordered by number of steps to the goal ascending (i.e. best players first)
     */
    getUnfinishedPlayersClosestToGoal(): Snowflake[] {
        const costs: Record<Snowflake, number> = {};
        for (const userId of this.getUnfinishedPlayers()) {
            costs[userId] = this.approximateCostToGoalForPlayer(userId);
        }
        return Object.keys(this.state.players).sort((x, y) => costs[x] - costs[y]);
    }

    /**
     * @returns all players in random order
     */
    getShuffledPlayers(): Snowflake[] {
        return shuffle(Object.keys(this.state.players));
    }

    /**
     * @returns all players in a semi-random order, guaranteeing that a player following another will always go after that player
     */
    getDecisionShuffledPlayers(): Snowflake[] {
        // Compute player step dependency map
        const dependencies: Record<Snowflake, Snowflake> = {};
        // For each player...
        for (const userId of this.getPlayers()) {
            const nextDecision: string | undefined = this.getNextDecidedAction(userId);
            // If the next action is moving in a particular direction...
            if (nextDecision && nextDecision in OFFSETS_BY_DIRECTION) {
                const [ dr, dc ] = OFFSETS_BY_DIRECTION[nextDecision];
                const player = this.state.players[userId];
                // Check if there's a player blocking that direction...
                // TODO: Can we account for multiple players on a tile when constructing the dependencies map?
                const blockingUserId = this.getPlayersAtLocation({ r: player.r + dr, c: player.c + dc })[0];
                // If there's a blocking player, then the blocking player must be earlier in the list than this player
                // Also, only add this dependency if it doesn't create a cycle
                if (blockingUserId && dependencies[blockingUserId] !== userId) {
                    dependencies[userId] = blockingUserId;
                }
            }
        }
        return shuffleWithDependencies(this.getPlayers(), dependencies);
    }

    /**
     * @returns all players other than the one provided in no particular order
     */
    getOtherPlayers(userId: Snowflake): Snowflake[] {
        return Object.keys(this.state.players).filter(id => id !== userId);
    }

    getDisplayName(userId: Snowflake): string {
        if (userId in this.state.players) {
            return this.state.players[userId].displayName;
        }
        return userId || 'Unknown Player';
    }

    getDisplayNames(userIds: Snowflake[]): string[] {
        return userIds.map(userId => this.getDisplayName(userId));
    }

    private addRenderLine(from: MazeLocation, to: MazeLocation, special?: 'warp' | 'red' | 'rainbow'): void {
        const line: MazeLine = { from, to };
        if (special) {
            line.special = special;
            // TODO: This really needs to be a little more flexible and less hardcoded
            if (special === 'warp' || special === 'red') {
                line.over = true;
            }
        }
        this.state.lines.push(line);
    }

    private static getSequenceOfLocations(initialLocation: { r: number, c: number }, actions: ActionName[]): { r: number, c: number }[] {
        const result = [initialLocation];
        let previousLocation = initialLocation;
        for (const action of actions) {
            const newLocation = MazeGame.getNextLocation(previousLocation, action);
            if (newLocation.r !== previousLocation.r || newLocation.c !== previousLocation.c) {
                result.push(newLocation);
            }
            previousLocation = newLocation;
        }
        return result;
    }

    private static getNextLocation(location: { r: number, c: number }, action: ActionName): { r: number, c: number } {
        if (action === 'up') {
            return { r: location.r - 1, c: location.c };
        } else if (action === 'down') {
            return { r: location.r + 1, c: location.c };
        } else if (action === 'left') {
            return { r: location.r, c: location.c - 1};
        } else if (action === 'right') {
            return { r: location.r, c: location.c + 1 };
        } else if (action.startsWith('charge')) {
            const [actionName, arg] = action.split(':');
            return MazeGame.parseLocationString(arg) ?? location;
        } else {
            return location;
        }
    }

    private static getInitialLocationRadial(seq: number, rows: number, cols: number): [number, number] {
        const offset = Math.floor(seq / 4);
        const corner = seq % 4;
        const corners = [[0, 0], [0, cols - 1], [rows - 1, cols - 1], [rows - 1, 0]];
        const offsets = [[0, 6], [6, 0], [0, -6], [-6, 0]];
        return [corners[corner][0] + offsets[corner][0] * offset, corners[corner][1] + offsets[corner][1] * offset];
    }

    private static getInitialLocationRadialV2(seq: number, rows: number, cols: number): [number, number] {
        const basePositions: [number, number][] = [[0, Math.floor(cols / 2)], [Math.floor(rows / 2), cols - 1], [rows - 1, Math.floor(cols / 2)], [Math.floor(rows / 2), 0]];

        const side = seq % 4;
        const rankOnSide = Math.floor(seq / 4);
        const direction = rankOnSide % 2 === 0 ? 1 : -1;
        const magnitude = Math.floor((rankOnSide + 1) / 2);

        const offsets = [[0, 4], [4, 0], [0, -4], [-4, 0]];

        const basePosition = basePositions[side];

        return [basePosition[0] + offsets[side][0] * magnitude * direction, basePosition[1] + offsets[side][1] * magnitude * direction];
    }

    private static getInitialLocationSectional(seq: number, areaWidth: number): MazeLocation {
        let r = areaWidth - 1;
        let c = areaWidth - 1;
        let refC = r;
        let counter = 0;

        while (true) {
            // Emergency abort if we run out of spaces
            if (c < 0 && r < 0) {
                return { r: 0, c: 0 };
            }

            if (c >= areaWidth) {
                refC -= 2;
                c = refC;
                r = areaWidth - 1;
            }

            if (r >= 0 && c >= 0 && r < areaWidth && c < areaWidth) {
                if (counter === seq) {
                    return { r, c };
                }
                counter++;
            }

            r--;
            c++;
        }
    }

    private static getInitialLocationsAlongTop(seq: number, columns: number, spawnHeight: number): MazeLocation {
        let r = spawnHeight - 1;
        let c = Math.floor(columns / 2) + (r % 2);
        let dc = 0;
        for (let i = 0; i < seq; i++) {
            if (dc > 0) {
                dc += 2;
            } else {
                dc -= 2;
            }
            c += dc;
            dc *= -1;
            // If out of bounds, move up one row
            if (c < 0 || c >= columns) {
                r--;
                c = Math.floor(columns / 2) + (r % 2);
                dc = 0;
            }
        }
        return { r, c };
    }

    private static createSection(rows: number, columns: number, entrance: MazeLocation, exit: MazeLocation): { map: TileType[][], doorwayCosts: Record<string, number> } {
        // Initialize the map
        const map: number[][] = [];
        for (let r = 0; r < rows; r++) {
            map.push([]);
            for (let c = 0; c < columns; c++) {
                map[r][c] = TileType.WALL;
            }
        }
        const doorwayCosts = {};

        const getEuclideanDistanceFromCenter = (r: number, c: number): number => {
            return Math.sqrt(Math.pow((rows / 2) - r, 2) + Math.pow((columns / 2) - c, 2));
        };

        const isInBounds = (r: number, c: number): boolean => {
            return r >= 0 && c >= 0 && r < rows && c < columns;
        };

        const step = (r: number, c: number, prev: [number, number]) => {
            map[r][c] = 0;
            const l = shuffle(MazeGame.getCardinalOffsets(2));
            let pick = 0;
            while (l.length > 0) {
                const [dr, dc] = l.shift() as [number, number];
                // If looking in the same direction we just came from, skip this direction and come to it last
                if (prev[0] === dr && prev[1] === dc && chance(0.75)) {
                    l.push([dr, dc]);
                    continue;
                }
                pick++;
                const nr = r + dr;
                const nc = c + dc;
                const hnr = r + (dr / 2);
                const hnc = c + (dc / 2);
                // const dist = Math.sqrt(Math.pow(hnr - 20, 2) + Math.pow(hnc - 20, 2)) / 41;
                if (isInBounds(nr, nc)) {
                    if (map[nr][nc] === TileType.WALL) {
                        map[hnr][hnc] = TileType.EMPTY;
                        step(nr, nc, [dr, dc]);
                    } else if (map[hnr][hnc] === TileType.WALL) {
                        // If there's a wall between here and the next spot...
                        // if ((r === 0 || c === 0 || r === rows - 1 || c === columns - 1) && chance(0.25)) {
                        //     // If the current spot is on the edge, clear walls liberally
                        //     map[hnr][hnc] = TileType.EMPTY;
                        // } else
                        if (chance(0.03)) {
                            // With an even smaller chance, clear this wall
                            map[hnr][hnc] = TileType.EMPTY;
                        } else {
                            if (chance(0.2)) {
                                map[hnr][hnc] = TileType.DOORWAY;
                                // Make the cost more severe near the center of the section
                                const distanceFromCenter = getEuclideanDistanceFromCenter(hnr, hnc);
                                const sectionWidth = Math.min(rows, columns);
                                if (distanceFromCenter < 0.25 * sectionWidth) {
                                    doorwayCosts[MazeGame.getLocationString(hnr, hnc)] = Math.max(randInt(1, 16), randInt(1, 16), randInt(1, 16));
                                } else if (distanceFromCenter < 0.4 * sectionWidth) {
                                    doorwayCosts[MazeGame.getLocationString(hnr, hnc)] = Math.max(randInt(1, 16), randInt(1, 16));
                                } else {
                                    doorwayCosts[MazeGame.getLocationString(hnr, hnc)] = randInt(1, 16);
                                }
                            }
                        }
                    }
                }
            }
        };

        // Actually cut the path
        step(entrance.r, entrance.c, [-1, -1]);

        // Define helper for placing tiles with surrounding traps
        const placeFormation = (r: number, c: number, t: TileType) => {
            for (const dr of [-1, 0, 1]) {
                for (const dc of [-1, 0, 1]) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (isInBounds(nr, nc)) {
                        map[nr][nc] = chance(0.6) ? TileType.TRAP : TileType.EMPTY;
                    }
                }
            }
            map[r][c] = t;
        };

        // Remove single dot walls, replace with formations (if not near the border)
        const isWall = (r: number, c: number) => {
            return !isInBounds(r, c) || map[r][c] !== TileType.EMPTY;
        };
        for (let r = 1; r < rows - 1; r++) {
            for (let c = 1; c < columns - 1; c++) {
                if (isWall(r, c) && !isWall(r + 1, c) && !isWall(r - 1, c) && !isWall(r, c + 1) && !isWall(r, c - 1)) {
                    placeFormation(r, c, TileType.COIN);
                }
            }
        }

        // Place two formations in the corners
        placeFormation(rows - 2, 1, TileType.COIN);
        placeFormation(1, columns - 2, TileType.COIN);

        return { map, doorwayCosts };
    }

    static createSectional(members: GuildMember[], season: number, options: { sectionSize: number, sectionsAcross: number }): MazeGame {
        const columns = (options.sectionSize + 1) * options.sectionsAcross - 1;
        const rows = columns;

        // Initialize the map
        const map: number[][] = [];
        for (let r = 0; r < rows; r++) {
            map.push([]);
            for (let c = 0; c < columns; c++) {
                map[r][c] = TileType.WALL;
            }
        }
        const doorwayCosts = {};

        const placeDoorway = (_r: number, _c: number, cost: number) => {
            map[_r][_c] = TileType.DOORWAY;
            doorwayCosts[MazeGame.getLocationString(_r, _c)] = cost;
        };

        // Create the sections
        let goal = { r: rows - 1, c: columns - 1 };
        for (let sr = 0; sr < options.sectionsAcross; sr++) {
            for (let sc = 0; sc < options.sectionsAcross; sc++) {
                const section = MazeGame.createSection(options.sectionSize,
                    options.sectionSize,
                    { r: 0, c: 0 },
                    { r: options.sectionSize - 1, c: options.sectionSize - 1});
                // Apply section to map
                const baseR = (options.sectionSize + 1) * sr;
                const baseC = (options.sectionSize + 1) * sc;
                for (let r = 0; r < options.sectionSize; r++) {
                    for (let c = 0; c < options.sectionSize; c++) {
                        map[baseR + r][baseC + c] = section.map[r][c];
                    }
                }
                // Transform and apply each doorway cost
                for (const doorwayLocation of Object.keys(section.doorwayCosts)) {
                    const { r: keyR, c: keyC } = MazeGame.parseLocationString(doorwayLocation) as MazeLocation;
                    const transformedLocation = MazeGame.getLocationString(keyR + baseR, keyC + baseC);
                    doorwayCosts[transformedLocation] = section.doorwayCosts[doorwayLocation];
                }
                // Cut out walkways between each section
                const evenRow = sr % 2 === 0;
                const evenColumn = sc % 2 === 0;
                const onLeft = sc === 0;
                const onRight = sc === options.sectionsAcross - 1;
                const goDown = evenRow ? onRight : onLeft;
                const isLastSection = goDown && sr === options.sectionsAcross - 1;
                if (goDown) {
                    // If can't go down anymore, skip this step
                    if (!isLastSection) {
                        if (onRight) {
                            map[baseR + options.sectionSize][columns - 1] = TileType.EMPTY;
                        } else if (onLeft) {
                            map[baseR + options.sectionSize][0] = TileType.EMPTY;
                        }
                    }
                } else {
                    const randomCost = randInt(options.sectionSize, options.sectionSize * 2, 3);
                    if (evenRow) {
                        if (evenColumn) {
                            map[baseR + options.sectionSize - 1][baseC + options.sectionSize] = TileType.EMPTY;
                            placeDoorway(baseR, baseC + options.sectionSize, randomCost);
                        } else {
                            map[baseR][baseC + options.sectionSize] = TileType.EMPTY;
                            placeDoorway(baseR + options.sectionSize - 1, baseC + options.sectionSize, randomCost);
                        }
                    } else {
                        if (evenColumn) {
                            map[baseR + options.sectionSize - 1][baseC - 1] = TileType.EMPTY;
                            placeDoorway(baseR, baseC - 1, randomCost);
                        } else {
                            map[baseR][baseC - 1] = TileType.EMPTY;
                            placeDoorway(baseR + options.sectionSize - 1, baseC - 1, randomCost);
                        }
                    }
                }

                // If it's the last section, place the goal
                if (isLastSection) {
                    // TODO: We could place it in the center of the section, but let's place it in the bottom right for now
                    // goal = { r: baseR + Math.floor(options.sectionSize / 2), c: baseC + Math.floor(options.sectionSize / 2) };
                    goal = { r: baseR + options.sectionSize - 2, c: baseC + options.sectionSize - 2 };
                    for (let dr of [-1, 0, 1]) {
                        for (let dc of [-1, 0, 1]) {
                            map[goal.r + dr][goal.c + dc] = TileType.EMPTY;
                        }
                    }
                }
            }
        }

        // Clear spawn section
        const spawnWidth = Math.ceil(Math.sqrt(2 * (members.length - 0.5)));
        for (let r = 0; r < spawnWidth; r++) {
            for (let c = 0; c < spawnWidth; c++) {
                map[r][c] = TileType.EMPTY;
            }
        }

        // Remove all dangling doorway costs
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < columns; c++) {
                if (map[r][c] !== TileType.DOORWAY) {
                    delete doorwayCosts[MazeGame.getLocationString(r, c)];
                }
            }
        }

        // Initialize players
        const players: Record<Snowflake, MazePlayerState> = {};
        for (let j = 0; j < members.length; j++) {
            const member = members[j];
            const { r, c } = MazeGame.getInitialLocationSectional(j, spawnWidth);
            players[member.id] = {
                r,
                c,
                rank: j + 1,
                displayName: member.displayName,
                points: MazeGame.STARTER_POINTS
            };
        }

        const game = new MazeGame({
            type: 'MAZE_GAME_STATE',
            season,
            decisions: {},
            winners: [],
            turn: 0,
            action: 0,
            rows,
            columns,
            map,
            goal,
            doorwayCosts,
            trapOwners: {},
            players,
            lines: []
        });
        game.refreshPlayerRanks();

        return game;
    }

    static createOrganic(members: GuildMember[], season: number, rows: number, columns: number): MazeGame {
        while (true) {
            const attempt = MazeGame.tryCreateOrganic(members, season, rows, columns);
            // Only use this maze if the goal can be pathed to from all 3 non-goal corners
            if (attempt.searchToGoal(0, 0, { useDoorways: false }).success
                && attempt.searchToGoal(rows - 1, 0, { useDoorways: false }).success
                && attempt.searchToGoal(0, columns - 1, { useDoorways: false }).success) {
                return attempt;
            }
        }
    }

    private static tryCreateOrganic(members: GuildMember[], season: number ,rows: number, columns: number): MazeGame {
        const map = generateOrganicMaze(rows, columns);

        // Clear spawn section
        // TODO: Re-enable if we want to add them to the top left corner again
        // const spawnWidth = Math.ceil(Math.sqrt(2 * (members.length - 0.5)));
        // for (let r = 0; r < spawnWidth; r++) {
        //     for (let c = 0; c < spawnWidth; c++) {
        //         map[r][c] = TileType.EMPTY;
        //     }
        // }
        // The spawn area is along the top of the map
        const spawnHeight = Math.ceil(members.length * 2 / columns)
        for (let r = 0; r < spawnHeight; r++) {
            for (let c = 0; c < columns; c++) {
                map[r][c] = TileType.EMPTY;
            }
        }

        // Determine all doorway costs
        const doorwayCosts: Record<string, number> = {};
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < columns; c++) {
                if (map[r][c] === TileType.DOORWAY) {
                    // Since the map is tall, have doorway costs correspond to row number
                    doorwayCosts[MazeGame.getLocationString(r, c)] = randInt(1, r + 2);
                }
            }
        }

        // Carve out space for goal (at bottom center)
        const goal = {
            r: rows - 2,
            c: Math.floor(columns / 2)
        };
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                map[goal.r + dr][goal.c + dc] = TileType.EMPTY;
            }
        }

        // Initialize players
        const players: Record<Snowflake, MazePlayerState> = {};
        for (let j = 0; j < members.length; j++) {
            const member = members[j];
            // TODO: Re-enable to make the spawn area in the top-left again
            // const { r, c } = MazeGame.getInitialLocationSectional(j, spawnWidth);
            const { r, c } = MazeGame.getInitialLocationsAlongTop(j, columns, spawnHeight);
            players[member.id] = {
                r,
                c,
                rank: j + 1,
                displayName: member.displayName,
                points: MazeGame.STARTER_POINTS
            };
        }

        const game = new MazeGame({
            type: 'MAZE_GAME_STATE',
            season,
            winners: [],
            decisions: {},
            turn: 0,
            action: 0,
            rows,
            columns,
            map,
            goal,
            doorwayCosts,
            trapOwners: {},
            players,
            lines: []
        });
        game.refreshPlayerRanks();

        return game;
    }

    static createBest(members: GuildMember[], season: number, attempts: number, minSteps: number = 0): MazeGame {
        let maxFairness = { fairness: 0 };
        let bestMap: MazeGame | null = null;
        let validAttempts = 0;
        while (validAttempts < attempts) {
            const newGame = MazeGame.createSectional(members, season, {
                sectionsAcross: 1,
                sectionSize: 29
            });
            const fairness = newGame.getMapFairness();
            if (fairness.min >= minSteps) {
                validAttempts++;
                if (fairness.fairness > maxFairness.fairness) {
                    maxFairness = fairness;
                    bestMap = newGame;
                }
                console.log(`Attempt ${validAttempts}: ${fairness.description}`);
            }
        }
        return bestMap as MazeGame;
    }

    static createOrganicBest(members: GuildMember[], season: number, options?: { attempts?: number, rows?: number, columns?: number, minNaive?: number }): MazeGame {
        const attempts = options?.attempts ?? 1;
        const rows = options?.rows ?? 10;
        const columns = options?.columns ?? 10;
        const minNaive = options?.minNaive ?? 0;
        // Now, try to create the best organic map possible with the specified number of attempts and min naive cost
        let maxFairness = { fairness: 0 };
        let bestMap: MazeGame | null = null;
        let validAttempts = 0;
        while (validAttempts < attempts) {
            const newGame = MazeGame.createOrganic(members, season, rows, columns);
            const fairness = newGame.getMapFairness();
            if (fairness.naive >= minNaive) {
                validAttempts++;
                if (fairness.fairness > maxFairness.fairness) {
                    maxFairness = fairness;
                    bestMap = newGame;
                }
                console.log(`Attempt ${validAttempts}: ${fairness.description}`);
            }
        }
        return bestMap as MazeGame;
    }

    private getTileAtUser(userId: Snowflake): TileType {
        const player = this.state.players[userId];
        if (!this.isInBounds(player.r, player.c)) {
            return TileType.INVALID;
        }
        return this.state.map[player.r][player.c];
    }

    private isTileType(r: number, c: number, type: TileType): boolean {
        if (!this.isInBounds(r, c)) {
            return false;
        }
        return this.state.map[r][c] === type;
    }

    private isInBounds(r: number, c: number): boolean {
        return r >= 0 && c >= 0 && r < this.state.rows && c < this.state.columns;
    }

    private isWalkable(r: number, c: number): boolean {
        return this.isInBounds(r, c) && this.isWalkableTileType(this.state.map[r][c]);
    }

    private isWalkableTileType(t: TileType): boolean {
        return t === TileType.EMPTY || t === TileType.OPENED_DOORWAY || t === TileType.CHEST || t === TileType.HIDDEN_TRAP || t === TileType.TRAP || t === TileType.COIN;
    }

    private isSealable(r: number, c: number): boolean {
        return this.isTileType(r, c, TileType.DOORWAY) || this.isTileType(r, c, TileType.OPENED_DOORWAY);
    }

    private isPlaceable(r: number, c: number): boolean {
        // Users can only place tiles over empty spots, hidden traps, or coins
        return this.isTileType(r, c, TileType.EMPTY) || this.isTileType(r, c, TileType.HIDDEN_TRAP) || this.isTileType(r, c, TileType.COIN);
    }

    private isTrap(location: MazeLocation): boolean {
        return this.isTileType(location.r, location.c, TileType.TRAP) || this.isTileType(location.r, location.c, TileType.HIDDEN_TRAP);
    }

    /**
     * @returns True if this location is adjacent to a locked doorway, an unlocked doorway, or a sealed doorway.
     */
    private isNextToDoorway(location: MazeLocation): boolean {
        for (const { r, c } of this.getAdjacentLocations(location)) {
            if (this.isInBounds(r, c) && (MazeGame.getLocationString(r, c) in this.state.doorwayCosts)) {
                return true;
            }
        }
        return false;
    }

    /**
     * @returns True if this location is a locked doorway, an unlocked doorway, or a sealed doorway.
     */
    private isDoorway(location: MazeLocation): boolean {
        return this.isInBounds(location.r, location.c) && (MazeGame.getLocationString(location.r, location.c) in this.state.doorwayCosts);
    }

    private isCloudy(r: number, c: number): boolean {
        return this.isTileType(r, c, TileType.WALL) || this.isTileType(r, c, TileType.DOORWAY) || this.isTileType(r, c, TileType.OPENED_DOORWAY);
    }

    private setSurroundingTiles(location: MazeLocation, t: TileType): void {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr !== 0 || dc !== 0) {
                    const r = location.r + dr;
                    const c = location.c + dc;
                    if (this.isInBounds(r, c)) {
                        this.state.map[r][c] = t;
                    }
                }
            }
        }
    }

    private getHiddenTrapsForPlayer(userId: Snowflake): { r: number, c: number }[] {
        const locations: MazeLocation[] = [];
        for (const [locationString, ownerId] of Object.entries(this.state.trapOwners)) {
            if (ownerId === userId) {
                const location = MazeGame.parseLocationString(locationString);
                if (location && this.isTileType(location.r, location.c, TileType.HIDDEN_TRAP)) {
                    locations.push(location);
                }
            }
        }
        return locations;
    }

    private getTrapOwner(location: MazeLocation): Snowflake | undefined {
        const locationString = MazeGame.getLocationString(location.r, location.c);
        return this.state.trapOwners[locationString];
    }

    /**
     * @returns all unfinished players at the given location
     */
    private getPlayersAtLocation(location: MazeLocation): Snowflake[] {
        const result: Snowflake[] = [];
        // Exclude players who've already finished (since they effectively don't have a location)
        for (const userId of this.getUnfinishedPlayers()) {
            const player = this.state.players[userId];
            if (player.r === location.r && player.c === location.c) {
                result.push(userId);
            }
        }
        return result;
    }

    private isPlayerAtLocation(location: MazeLocation): boolean {
        return this.getPlayersAtLocation(location).length > 0;
    }

    /**
     * @param location Some location
     * @returns True if the given location is walkable and is not occupied by another player
     */
    private isLocationShovable(location: MazeLocation): boolean {
        return this.isWalkable(location.r, location.c) && !this.isPlayerAtLocation(location);
    }

    getWeeklyDecisionDMs(): Record<Snowflake, string> {
        const results: Record<Snowflake, string> = {};
        for (const userId of this.getPlayers()) {
            const statements: string[] = [];
            // If the player has at least 1 point and at least 1 of any item, construct a string informing them of their inventory
            if (this.getPoints(userId) >= 1 && this.playerHasAnyItem(userId)) {
                const items = this.getPlayerItems(userId);
                const inventoryText = naturalJoin(Object.keys(items).map(item => items[item] === 1 ? `a **${item}**` : `${items[item]} **${item}s**`));
                statements.push('your inventory contains ' + inventoryText);
            }
            // If the user has finished, let them know what they can do
            if (this.isPlayerFinished(userId)) {
                statements.push('since you\'ve completed the maze, all you can do place **traps**, **boulders**, and **coins** (e.g. `coin:b12`)');
            }
            // If any statements, add message
            if (statements.length > 0) {
                results[userId] = 'Good morning! Reminder: ' + naturalJoin(statements);
            }
        }
        return results;
    }

    override async addPlayerDecision(userId: Snowflake, text: string): Promise<MessengerPayload> {
        const commands: string[] = text.replace(/\s+/g, ' ').trim().split(' ').map(c => c.toLowerCase());
        const warnings: string[] = [];

        const player = this.state.players[userId];
        const newLocation = { r: player.r, c: player.c };
        const playerPoints: number = player.points;
        let cost: number = 0;

        // Abort if the player is already knocked out
        if (this.isPlayerStunned(userId)) {
            throw new Error('Don\'t you remember? You were knocked out for having no points! No action for you this week, my friend...');
        }

        // Abort if the player has negative points
        if (playerPoints < 0) {
            throw new Error('Oh dear... looks like you have negative points buddy, nice try...');
        }

        // Prevent pause-griefing
        if (commands.filter(c => c === 'pause').length > 3) {
            throw new Error('You can pause no more than 3 times per turn');
        }

        // Ensure that turns with warps only include only warps (delaying may give a better outcome)
        const isWarping: boolean = commands.includes('warp');
        if (isWarping) {
            const MAX_WARPS: number = 3;
            if (playerPoints > this.getActionCost('warp', newLocation) * (MAX_WARPS + 1)) {
                throw new Error('Don\'t you think you\'re a little rich to be warping? When I was your age, I WALKED all the way to the goal...');
            }
            if (!commands.every(c => c === 'warp')) {
                throw new Error('If you warp this turn, ALL your actions must be warps');
            }
            if (commands.length > MAX_WARPS) {
                throw new Error(`You may only warp at most ${MAX_WARPS} times per turn`);
            }
        }

        // Ensure that finished players can only trap/boulder/coin
        if (player.finished && !commands.every(c => c.startsWith('trap') || c.startsWith('boulder') || c.startsWith('coin'))) {
            throw new Error('You\'ve already finished, the only action you can take now is to place traps, boulders, and coins')
        }

        // For each known item type, ensure the player isn't using more than they currently own
        for (const itemName of ITEM_NAMES) {
            const numAvailable: number = this.getPlayerItemCount(userId, itemName);
            if (commands.filter(c => c.split(':')[0] === itemName).length > numAvailable) {
                throw new Error(`You're trying to use more **${itemName}** items than you currently have! You only have **${numAvailable}**`);
            }
        }

        // If using boulders, ensure placing them doesn't block anyone
        if (commands.some(c => c.startsWith('boulder:'))) {
            const boulderLocations = commands.filter(c => c.startsWith('boulder:'))
                .map(c => c.split(':')[1])
                .map(l => MazeGame.parseLocationString(l) as MazeLocation);
            if (!this.canAllPlayersReachGoal(boulderLocations)) {
                throw new Error('You can\'t place a boulder in a location that would permanently trap players! Please pick another location...');
            }
        }

        const validateDoorwayAction = (targetLocation: MazeLocation | undefined, action: ActionName) => {
            const newLocationString: string = MazeGame.getLocationString(newLocation.r, newLocation.c);
            // If there's a target location, validate that the target is a doorway and that it's adjacent to the current location
            if (targetLocation) {
                const targetLocationString: string = MazeGame.getLocationString(targetLocation.r, targetLocation.c);
                if (!this.isDoorway(targetLocation)) {
                    throw new Error(`You can't ${action} **${targetLocationString}**, as it's not a doorway!`);
                }
                if (!this.isAdjacent(newLocation, targetLocation)) {
                    throw new Error(`You can't ${action} **${targetLocationString}** from **${newLocationString}**, as those locations aren't adjacent!`);
                }
            }
            // In all cases, validate that there's at least one adjacent doorway
            if (!this.isNextToDoorway(newLocation)) {
                throw new Error(`You can't use "${action}" at **${newLocationString}**, as there'd be no doorway near you to ${action}!`);
            }
        };

        const validateMovementAction = (direction: Direction) => {
            const [ dr, dc ] = OFFSETS_BY_DIRECTION[direction];
            const nr = newLocation.r + dr;
            const nc = newLocation.c + dc;
            if (this.isTileType(nr, nc, TileType.DOORWAY)) {
                newLocation.r += dr;
                newLocation.c += dc;
                warnings.push(`⚠️ Doorway at **${MazeGame.getLocationString(nr, nc)}** must be unlocked, whether by you or someone else.`);
            } else if (this.isWalkable(nr, nc)) {
                newLocation.r += dr;
                newLocation.c += dc;
            } else {
                throw new Error('You cannot move there!');
            }
        };

        for (const command of commands) {
            const [c, arg] = command.split(':') as [ActionName, string];
            // Ensure that non-finished players aren't trying to use secret winner-only moves
            // TODO: Extend this logic to other possible winner-only actions
            if (!player.finished) {
                if (c === 'coin') {
                    throw new Error(`\`${c}\` is an invalid action!`);
                }
            }
            // Parse and validate the location param (if one was provided)
            const argLocation: MazeLocation | undefined = MazeGame.parseLocationString(arg);
            if (argLocation) {
                // If a location was specified, validate that it's not out of bounds
                if (!this.isInBounds(argLocation.r, argLocation.c)) {
                    throw new Error(`Location **${arg}** is out-of-bounds!`);
                }
            }
            cost += this.getActionCost(c, newLocation, arg);
            switch (c) {
                case 'up':
                case 'down':
                case 'left':
                case 'right':
                    validateMovementAction(c);
                    break;
                case 'unlock':
                case 'key':
                    validateDoorwayAction(argLocation, c);
                    warnings.push(`ℹ️ Doorways are halved in cost when unlocked, so subsequent actions taken on a doorway you unlock will be cheaper.`);
                    break;
                case 'lock':
                    validateDoorwayAction(argLocation, 'lock');
                    warnings.push(`ℹ️ Doorways are halved in cost when unlocked, so you may end up spending fewer points than expected.`);
                    break;
                case 'seal':
                    validateDoorwayAction(argLocation, 'seal');
                    // Ensure this action wouldn't softlock anyone
                    for (const { r, c } of this.getAdjacentLocationsOrOverride(newLocation, argLocation)) {
                        const sealableLocations: MazeLocation[] = [];
                        if (this.isSealable(r, c)) {
                            sealableLocations.push({ r, c })
                        }
                        if (!this.canAllPlayersReachGoal(sealableLocations)) {
                            throw new Error(`Using "seal" at **${MazeGame.getLocationString(newLocation.r, newLocation.c)}** would cause some players to become permanently trapped!`);
                        }
                    }
                    break;
                case 'trap':
                case 'boulder':
                case 'coin':
                    if (!argLocation) {
                        if (arg) {
                            throw new Error(`**${arg}** is not a valid location on the map!`);
                        } else {
                            throw new Error(`You must specify a location at which to place a ${c}! (e.g. \`${c}:b12\`)`);
                        }
                    }
                    if (this.isGoal(argLocation.r, argLocation.c)) {
                        throw new Error(`You can\'t place a ${c} on the goal!`);
                    }
                    if (this.isPlaceable(argLocation.r, argLocation.c)) {
                        // COOL
                    } else {
                        throw new Error(`Can't place a ${c} at **${arg}**, try a different spot.`);
                    }
                    break;
                case 'charge':
                    if (!argLocation) {
                        if (arg) {
                            throw new Error(`**${arg}** is not a valid location on the map!`);
                        } else {
                            throw new Error('You must specify a location to charge to! (e.g. `charge:b12`)');
                        }
                    }
                    // Validate that the location isn't the current location
                    if (argLocation.r === newLocation.r && argLocation.c === newLocation.c) {
                        throw new Error('You can\'t charge at yourself, you silly goose!');
                    }
                    // Validate that the location is in the same row or column
                    if (argLocation.r !== newLocation.r && argLocation.c !== newLocation.c) {
                        throw new Error('You must charge to a location in the same row or column at which you would use the charge!');
                    }
                    // Validate that it's a clear shot to this location
                    const intermediateLocations = this.getLocationsBetween(newLocation, argLocation);
                    for (const intermediateLocation of intermediateLocations) {
                        if (!this.isWalkable(intermediateLocation.r, intermediateLocation.c)) {
                            throw new Error(`You can't charge to **${arg}**, as obstacle at **${MazeGame.getLocationString(intermediateLocation.r, intermediateLocation.c)}** is in the way!`);
                        }
                    }
                    // Update the new temp location to the target location
                    newLocation.r = argLocation.r;
                    newLocation.c = argLocation.c;
                    break;
                case 'punch':
                case 'warp':
                case 'star':
                case 'pause':
                    // TODO: Do validation?
                    break;
                default:
                    throw new Error(`\`${command}\` is an invalid action!`);
            }
        }

        // Warn the player if they may run out of points
        if (cost > playerPoints) {
            warnings.push(`⚠️ You currently have **${Math.floor(playerPoints)}** points, yet these actions cost **${cost}**. Unless you collect points mid-turn, you'll be KO'ed when you run out of points.`);
        }

        this.state.decisions[userId] = commands;
        return {
            content: `Valid actions, your new location will be **${isWarping ? '???' : MazeGame.getLocationString(newLocation.r, newLocation.c)}**. `
                + `This will consume **${cost}** of your **${Math.floor(playerPoints)}** points if successful. `
                + (warnings.length > 0 ? ' _BUT PLEASE NOTE THE FOLLOWING:_\n' + warnings.join('\n') : ''),
            files: [new AttachmentBuilder(await this.renderState({ showPlayerDecision: userId })).setName(`game-turn${this.getTurn()}-confirmation.png`)]
        };
    }

    private getActionCost(action: ActionName, location?: MazeLocation, arg?: string): number {
        const argLocation: MazeLocation | undefined = arg ? MazeGame.parseLocationString(arg) : undefined;
        const actionCosts: Record<BasicActionName, () => number> = {
            'up': () => {
                return 1;
            },
            'down': () => {
                return 1;
            },
            'left': () => {
                return 1;
            },
            'right': () => {
                return 1;
            },
            'pause': () => {
                return 0;
            },
            'unlock': () => {
                let cost = 0;
                for (const { r, c } of this.getAdjacentLocationsOrOverride(location, argLocation)) {
                    if (this.isTileType(r, c, TileType.DOORWAY)) {
                        cost += this.state.doorwayCosts[MazeGame.getLocationString(r, c)];
                    }
                }
                return cost;
            },
            'lock': () => {
                let cost = 0;
                for (const { r, c } of this.getAdjacentLocationsOrOverride(location, argLocation)) {
                    if (this.isTileType(r, c, TileType.OPENED_DOORWAY)) {
                        cost += this.state.doorwayCosts[MazeGame.getLocationString(r, c)];
                    }
                }
                return cost;
            },
            'punch': () => {
                return 2;
            },
            'warp': () => {
                return Math.ceil(this.getTurn() / 2);
            },
            'coin': () => {
                return 4;
            }
        };
        if (action in actionCosts) {
            return actionCosts[action]();
        }
        // Emergency fallback, invalid actions should be handled elsewhere
        return 0;
    }

    override async processPlayerDecisions(): Promise<DecisionProcessingResult> {
        // Delete all render lines (this is not done in the inner method since we want to show long paths for multiple consecutive actions)
        this.state.lines = [];

        // Process one action for each player, and repeat so long as the inner method says it's ok
        const summaries: string[] = [];
        let processingResult: DecisionProcessingResult & { continueImmediately: boolean };
        do {
           processingResult = await this.processPlayerDecisionsOnce();
           // TODO: Is there a more graceful way to do this than extracting the strings from the payloads and dropping the images?
           summaries.push(typeof processingResult.summary === 'string' ? processingResult.summary : processingResult.summary.content ?? '');
        } while (processingResult.continueProcessing && processingResult.continueImmediately);

        // If more than one action was processed for each player, collapse action summaries to reduce redundant messages (e.g. "___ took a step")
        if (summaries.length === 1) {
            return processingResult;
        } else {
            return {
                summary: {
                    content: collapseRedundantStrings(summaries, (s, n) => n > 1 ? `${s} _(x${n})_` : s).join('\n'),
                    files: [await this.renderStateAttachment()],
                    flags: MessageFlags.SuppressNotifications
                },
                continueProcessing: processingResult.continueProcessing
            };
        }
    }

    /**
     * Process exactly one action for each player. Return extra information about whether we can run this procedure again with no delay.
     */
    private async processPlayerDecisionsOnce(): Promise<DecisionProcessingResult & { continueImmediately: boolean }> {
        this.state.action++;
        const summaryData = {
            consecutiveStepUsers: [] as Snowflake[],
            consecutiveBumpGoners: [] as Snowflake[],
            statements: [] as string[]
        };
        const flushCollapsableStatements = () => {
            // Flush step statements, if any
            if (summaryData.consecutiveStepUsers.length > 0) {
                if (summaryData.consecutiveStepUsers.length === 1) {
                    summaryData.statements.push(`**${summaryData.consecutiveStepUsers[0]}** took a step`);
                } else {
                    summaryData.statements.push(`**${summaryData.consecutiveStepUsers.length}** players took a step`);
                }
                summaryData.consecutiveStepUsers = [];
            }
            // Flush bump goner statements, if any
            if (summaryData.consecutiveBumpGoners.length > 0) {
                // TODO: Can we refactor the bold joining as an option of naturalJoin?
                summaryData.statements.push(`${naturalJoin(summaryData.consecutiveBumpGoners.map(userId => `**${this.getDisplayName(userId)}**`))} bumped into someone and gave up`);
                summaryData.consecutiveBumpGoners = [];
            }

        }
        const pushNonCollapsableStatement = (s) => {
            flushCollapsableStatements();
            summaryData.statements.push(s);
        };
        const movePlayerTo = (userId: Snowflake, location: MazeLocation) => {
            const player = this.state.players[userId]
            // If the player is finished, no movement actions should be processed on them
            if (!player || player.finished) {
                return;
            }
            // Move the player
            player.r = location.r;
            player.c = location.c;
            // Check to see if the player has collected any coins
            if (this.isTileType(player.r, player.c, TileType.COIN)) {
                // Set the tile back to empty
                this.state.map[player.r][player.c] = TileType.EMPTY;
                // Award the user and notify
                const coinValue = randChoice(1, 2, 2, 3, 3, 4);
                this.addPoints(userId, coinValue);
                pushNonCollapsableStatement(`**${this.getDisplayName(userId)}** collected a gold coin worth **$${coinValue}**`);
            }
            // Check if the player is at the goal
            if (this.isGoal(player.r, player.c)) {
                // Mark the player as finished
                player.finished = true;
                // Add to list of finished players
                this.addWinner(userId);
                // Add to log and end the turn
                pushNonCollapsableStatement(`**${this.getDisplayName(userId)}** reached the goal for _${getRankString(this.state.winners.length)} place_`);
                return;
            }
            // If this player's turn is already over...
            if (!this.hasPendingDecisions(userId)) {
                // Handle hidden traps if not invincible
                if (!player.invincible) {
                    let trapRevealed = false;
                    const trapOwnerId = this.getTrapOwner({ r: player.r, c: player.c });
                    const locationString = MazeGame.getLocationString(player.r, player.c);
                    // Reveal the trap if it's hidden
                    if (this.getTileAtUser(userId) === TileType.HIDDEN_TRAP) {
                        this.state.map[player.r][player.c] = TileType.TRAP;
                        trapRevealed = true;
                        if (trapOwnerId) {
                            pushNonCollapsableStatement(`**${player.displayName}** revealed a hidden trap placed by **${this.getDisplayName(trapOwnerId)}**`);
                        } else {
                            pushNonCollapsableStatement(`**${player.displayName}** revealed a hidden trap`);
                        }
                    }
                    // Handle revealed traps (this will trigger if the above condition is triggered)
                    if (this.getTileAtUser(userId) === TileType.TRAP) {
                        // Only trigger this trap if the user has an origin location which is different than their current location.
                        // This is prevent an infinite loop (and situations which don't make sense)
                        const trapDestination = player.originLocation;
                        if (trapDestination && !(player.r === trapDestination.r && player.c === trapDestination.c)) {
                            // Track how much "progress" was lost (steps back to the origin location)
                            const destinationString = MazeGame.getLocationString(trapDestination.r, trapDestination.c);
                            const progressLost = this.getNumStepsToLocation(trapDestination, player) || 1;
                            // Stun the player
                            player.stuns = 1;
                            // Add a statement about this trap being triggered
                            const trapText = !trapOwnerId ? 'a trap' : `**${this.getDisplayName(trapOwnerId)}'s** trap`;
                            logger.log(`\`${this.getDisplayName(userId)}\` triggered ${trapText} at \`${locationString}\` (progress lost: **${progressLost}**)`);
                            if (trapRevealed) {
                                pushNonCollapsableStatement(`was sent back to **${destinationString}**`);
                            } else {
                                pushNonCollapsableStatement(`**${player.displayName}** stepped on ${trapText} and was sent back to **${destinationString}**`);
                            }
                            // If the trap has an owner, reward the owner (1 point for each "step" back)
                            if (trapOwnerId) {
                                this.addPoints(trapOwnerId, progressLost);
                                pushNonCollapsableStatement(`**${this.getDisplayName(trapOwnerId)}** earned **$${progressLost}** for trapping`);
                            }
                            // We move the player last so that any resulting movement triggers are after the log statements are added
                            this.addRenderLine({ r: player.r, c: player.c }, trapDestination, 'red');
                            movePlayerTo(userId, trapDestination);
                        } else {
                            logger.log(`Unable to trigger trap for \`${this.getDisplayName(userId)}\` (origin=\`${JSON.stringify(player.originLocation)}\`)`);
                        }
                    }
                }
                // Finally, move to the best adjacent vacant spot (with no traps) if the turn ended on another player
                if (this.getPlayersAtLocation(player).length > 1) {
                    const someOtherPlayerId = this.getPlayersAtLocation(player).filter(id => id !== userId)[0];
                    const adjacentVacantLocation = this.getBestVacantAdjacentLocation(player);
                    if (adjacentVacantLocation) {
                        if (player.stuns) {
                            if (this.getPlayerStuns(someOtherPlayerId)) {
                                pushNonCollapsableStatement(`**${player.displayName}'s** corpse rolled off **${this.getDisplayName(someOtherPlayerId)}'s** and over to the side`);
                            } else {
                                pushNonCollapsableStatement(`**${this.getDisplayName(someOtherPlayerId)}** kicked **${player.displayName}'s** lifeless body over to the side`);
                            }
                        } else {
                            if (this.getPlayerStuns(someOtherPlayerId)) {
                                pushNonCollapsableStatement(`**${player.displayName}** got off **${this.getDisplayName(someOtherPlayerId)}'s** lifeless body and stepped aside`);
                            } else {
                                pushNonCollapsableStatement(`**${player.displayName}** got off the shoulders of **${this.getDisplayName(someOtherPlayerId)}** and stepped aside`);
                            }
                        }
                        movePlayerTo(userId, adjacentVacantLocation);
                    }
                }
            }
        };
        // First, tick down all stunned players who still have pending decisions
        const playersRegainingConsciousness: Snowflake[] = [];
        for (const userId of this.getUnfinishedPlayers()) {
            if (this.hasPendingDecisions(userId) && this.isPlayerStunned(userId)) {
                this.consumePlayerStun(userId);
                // If all stuns have been consumed, notify
                if (!this.isPlayerStunned(userId)) {
                    playersRegainingConsciousness.push(userId);
                }
            }
        }
        if (playersRegainingConsciousness.length > 0) {
            pushNonCollapsableStatement(`${naturalJoin(this.getDisplayNames(playersRegainingConsciousness), { bold: true })} regained consciousness`);
        }
        // Then, process one decision from each player
        const bumpers: Record<Snowflake, Snowflake> = {};
        let numPlayersProcessed: number = 0;
        for (const userId of this.getDecisionShuffledPlayers()) {
            const player = this.state.players[userId];
            const startedFinished = player.finished ?? false;
            if (this.hasPendingDecisions(userId)) {
                numPlayersProcessed++;
                let endTurn = false;
                const processStep = (dr: number, dc: number): boolean => {
                    const nr = player.r + dr;
                    const nc = player.c + dc;
                    const currentLocation = { r: player.r, c: player.c };
                    const newLocation = { r: nr, c: nc };
                    let skipStepMessage = false;
                    this.addRenderLine(currentLocation, newLocation, player.invincible ? 'rainbow' : undefined);
                    // Handle situations where another user is standing in the way
                    // TODO: What if multiple players are standing in the way?? HANDLE ALL PLAYERS!
                    const blockingUserId: Snowflake | undefined = this.getPlayersAtLocation(newLocation)[0];
                    if (blockingUserId) {
                        const blockingUser = this.state.players[blockingUserId];
                        if (player.invincible && !blockingUser.invincible) {
                            // If this player is invincible and the other isn't, stun them and continue walking
                            blockingUser.stuns = 3;
                            skipStepMessage = true;
                            pushNonCollapsableStatement(`**${player.displayName}** trampled **${blockingUser.displayName}**`);
                        } else {
                            // Otherwise, handle the blocking user as normal
                            bumpers[userId] = blockingUserId;
                            if (bumpers[blockingUserId] === userId) {
                                // If the other user previously bumped into this user, then allow him to pass by
                                skipStepMessage = true;
                                pushNonCollapsableStatement(`**${player.displayName}** walked past **${blockingUser.displayName}**`);
                            } else if (this.isPlayerStunned(blockingUserId)) {
                                // If the other user is stunned, walk past him
                                skipStepMessage = true;
                                pushNonCollapsableStatement(`**${player.displayName}** stepped over the knocked-out body of **${blockingUser.displayName}**`);
                            } else {
                                // Otherwise, deal with colliding into a non-stunned player
                                if (this.hasPendingDecisions(blockingUserId)) {
                                    // If they've got actions left, just bump and wait
                                    // TODO: Should this be re-enabled? It seemed to cause a lot of spam
                                    // pushNonCollapsableStatement(`**${player.displayName}** bumped into someone`);
                                    return false;
                                } else {
                                    // Otherwise, bumping into a player with no more actions...
                                    const shoveOffset = MazeGame.getNormalizedOffsetTo(currentLocation, newLocation);
                                    const shoveLocation = MazeGame.getOffsetLocation(newLocation, shoveOffset);
                                    const orthogonalShoveLocations = MazeGame.getOrthogonalOffsetLocations(newLocation, shoveOffset).filter(l => this.isLocationShovable(l));
                                    // TODO: This wouldn't handle shoving a player onto a KO'ed player
                                    // TODO: This should check if the shove location triggered a trap
                                    // First, if the blocking player can be shoved then shove them!
                                    if (this.isLocationShovable(shoveLocation)) {
                                        const shoveDirection = MazeGame.getDirectionByOffset(shoveOffset);
                                        skipStepMessage = true;
                                        pushNonCollapsableStatement(`**${player.displayName}** shoved **${blockingUser.displayName}** ${shoveDirection}ward`);
                                        // Move this player first so their location is accurate when the blocking player's movement triggers are processed
                                        movePlayerTo(userId, newLocation);
                                        movePlayerTo(blockingUserId, shoveLocation);
                                        return true;
                                    }
                                    // Else, if they can be shoved to either side then shove them to a random vacant side
                                    else if (orthogonalShoveLocations.length > 0) {
                                        shuffle(orthogonalShoveLocations);
                                        const sideLocation = orthogonalShoveLocations[0];
                                        pushNonCollapsableStatement(`**${player.displayName}** shoved **${blockingUser.displayName}** to the side`);
                                        // Move this player first so their location is accurate when the blocking player's movement triggers are processed
                                        movePlayerTo(userId, newLocation);
                                        movePlayerTo(blockingUserId, sideLocation);
                                        return true;
                                    }
                                    // Else, if the player has 4+ points, then auto-punch (threshold accounts for punching then walking fully past)
                                    // TODO: Should this be configurable? Can players opt-out? Should it be another price?
                                    else if (this.getPoints(userId) >= 4) {
                                        // Stun the other player (their turn is over so 1 is sufficient)
                                        blockingUser.stuns = 1;
                                        pushNonCollapsableStatement(`**${player.displayName}** slapped **${blockingUser.displayName}** onto the floor`);
                                        // Consume points
                                        this.addPoints(userId, -2);
                                        // Do NOT consume an action this turn
                                        return false;
                                    }
                                    // Otherwise, just bump and give up
                                    else {
                                        summaryData.consecutiveBumpGoners.push(userId);
                                        endTurn = true;
                                        return false;
                                    }
                                }
                            }
                        }
                    }
                    // If the logic hasn't returned by now, then attempt to walk to the new location
                    if (this.isWalkable(nr, nc)) {
                        if (!skipStepMessage) {
                            summaryData.consecutiveStepUsers.push(player.displayName);
                        }
                        movePlayerTo(userId, newLocation);
                        return true;
                    }
                    pushNonCollapsableStatement(`**${player.displayName}** walked into a wall and gave up`);
                    endTurn = true;
                    return false;
                };
                const doUnlock = (arg: string): number => {
                    const argLocation: MazeLocation| undefined = MazeGame.parseLocationString(arg);
                    let numDoorwaysUnlocked = 0;
                    for (const { r, c } of this.getAdjacentLocationsOrOverride({ r: player.r, c: player.c }, argLocation)) {
                        if (this.isTileType(r, c, TileType.DOORWAY)) {
                            this.state.map[r][c] = TileType.OPENED_DOORWAY;
                            numDoorwaysUnlocked++;
                            // Halve the cost of the doorway (bottoms out at 1)
                            const locationString = MazeGame.getLocationString(r, c);
                            this.state.doorwayCosts[locationString] = Math.max(1, Math.floor(this.state.doorwayCosts[locationString] / 2));
                        }
                    }
                    if (numDoorwaysUnlocked === 1) {
                        pushNonCollapsableStatement(`**${player.displayName}** unlocked a doorway`);
                    } else {
                        pushNonCollapsableStatement(`**${player.displayName}** unlocked **${numDoorwaysUnlocked}** doorways`);
                    }
                    return numDoorwaysUnlocked;
                };
                const commandActions: Record<ActionName, (arg: string) => boolean> = {
                    up: () => {
                        return processStep(-1, 0);
                    },
                    down: () => {
                        return processStep(1, 0);
                    },
                    left: () => {
                        return processStep(0, -1);
                    },
                    right: () => {
                        return processStep(0, 1);
                    },
                    pause: () => {
                        return true;
                    },
                    unlock: (arg) => {
                        doUnlock(arg);
                        return true;
                    },
                    lock: (arg) => {
                        const argLocation: MazeLocation | undefined = MazeGame.parseLocationString(arg);
                        let numDoorwaysLocked = 0;
                        for (const { r, c } of this.getAdjacentLocationsOrOverride({ r: player.r, c: player.c }, argLocation)) {
                            if (this.isTileType(r, c, TileType.OPENED_DOORWAY)) {
                                this.state.map[r][c] = TileType.DOORWAY;
                                numDoorwaysLocked++;
                            }
                        }
                        if (numDoorwaysLocked === 1) {
                            pushNonCollapsableStatement(`**${player.displayName}** locked a doorway`);
                        } else {
                            pushNonCollapsableStatement(`**${player.displayName}** locked **${numDoorwaysLocked}** doorways`);
                        }
                        return true;
                    },
                    punch: () => {
                        let nearPlayer = false;
                        // For each location adjacent to the player...
                        for (const adjacentLocation of this.getAdjacentLocations({ r: player.r, c: player.c })) {
                            const adjacentPlayerIds = this.getPlayersAtLocation(adjacentLocation);
                            // For each player in this adjacent location...
                            for (const otherPlayerId of adjacentPlayerIds) {
                                // If this player isn't currently stunned, attempt to punch them
                                if (!this.isPlayerStunned(otherPlayerId)) {
                                    nearPlayer = true;
                                    const otherPlayer = this.state.players[otherPlayerId];
                                    if (otherPlayer.invincible) {
                                        pushNonCollapsableStatement(`**${player.displayName}** threw fists at the invincible **${otherPlayer.displayName}** to no avail`);
                                    } else if (chance(0.75)) {
                                        // Stun the other player
                                        otherPlayer.stuns = 3;
                                        // Get a random number of coins to spawn limited by (1) the number of possible locations, and (2) the other player's points
                                        const possibleLocations = this.getAdjacentLocations(otherPlayer).filter(l => this.isTileType(l.r, l.c, TileType.EMPTY) && !this.isPlayerAtLocation(l));
                                        const maxNumCoins = Math.min(possibleLocations.length, Math.floor(this.getPoints(otherPlayerId)));
                                        // TODO: Is it OP to keep this at max? Uncomment the RNG if so
                                        const numCoins = maxNumCoins; // randInt(0, 1 + maxNumCoins);
                                        if (numCoins > 0) {
                                            // Place coins onto a random selection of those locations
                                            shuffle(possibleLocations);
                                            const coinSpawnLocations = possibleLocations.slice(0, numCoins);
                                            for (const location of coinSpawnLocations) {
                                                this.state.map[location.r][location.c] = TileType.COIN;
                                            }
                                            // Deduct points from the other player
                                            this.addPoints(otherPlayerId, -numCoins);
                                            pushNonCollapsableStatement(`**${player.displayName}** knocked out **${otherPlayer.displayName}** (shaking **$${numCoins}** from his pockets onto the floor)`);
                                        } else {
                                            pushNonCollapsableStatement(`**${player.displayName}** knocked out **${otherPlayer.displayName}**`);
                                        }
                                    } else {
                                        pushNonCollapsableStatement(`**${player.displayName}** tried to punch **${otherPlayer.displayName}** and missed`);
                                    }
                                }
                            }
                        }
                        if (!nearPlayer) {
                            pushNonCollapsableStatement(`**${player.displayName}** swung at the air`);
                        }
                        return true;
                    },
                    warp: () => {
                        const warpableLocation = this.getSpawnableLocationAroundPlayers(this.getOtherPlayers(userId));
                        // Emergency fallback (this shouldn't happen)
                        if (!warpableLocation) {
                            player.stuns = 1;
                            endTurn = true;
                            pushNonCollapsableStatement(`**${player.displayName}** tried to warp but forgot to jump into the wormhole because he was watching webMs`);
                            return false;
                        }
                        const { location: newLocation, userId: nearUserId } = warpableLocation;
                        const isFirstWarp: boolean = !player.warped;
                        const isCloser: boolean = this.approximateCostToGoal(newLocation.r, newLocation.c) < this.approximateCostToGoal(player.r, player.c);
                        // If it's the user's first warp of the turn or the warp is closer to the goal, do it
                        if (isFirstWarp || isCloser) {
                            this.addRenderLine({ r: player.r, c: player.c }, newLocation, 'warp');
                            player.warped = true;
                            pushNonCollapsableStatement(`**${player.displayName}** warped to **${this.getDisplayName(nearUserId)}**`);
                            movePlayerTo(userId, newLocation);
                        } else {
                            pushNonCollapsableStatement(`**${player.displayName}** avoided warping to **${this.getDisplayName(nearUserId)}**`);
                        }
                        return true;
                    },
                    coin: (arg) => {
                        const targetLocation = MazeGame.parseLocationString(arg);
                        // Emergency fallback (this shouldn't happen)
                        if (!targetLocation) {
                            player.stuns = 1;
                            endTurn = true;
                            pushNonCollapsableStatement(`**${player.displayName}** tried to place a coin but his coin jar was empty`);
                            return false;
                        }
                        // Place the coin if it doesn't cover any traps
                        if (!this.isTrap(targetLocation)) {
                            this.state.map[targetLocation.r][targetLocation.c] = TileType.COIN;
                            pushNonCollapsableStatement(`**${player.displayName}** placed a coin at **${arg.toUpperCase()}**`);
                        }
                        return true;
                    },
                    trap: (arg) => {
                        const targetLocation = MazeGame.parseLocationString(arg);
                        // Emergency fallback (this shouldn't happen)
                        if (!targetLocation) {
                            player.stuns = 1;
                            endTurn = true;
                            pushNonCollapsableStatement(`**${player.displayName}** tried to place a trap but he left his trap at home`);
                            return false;
                        }
                        this.state.map[targetLocation.r][targetLocation.c] = TileType.HIDDEN_TRAP;
                        this.state.trapOwners[arg.toUpperCase()] = userId;
                        this.consumePlayerItem(userId, 'trap');
                        return true;
                    },
                    boulder: (arg) => {
                        const targetLocation = MazeGame.parseLocationString(arg);
                        // Emergency fallback (this shouldn't happen)
                        if (!targetLocation) {
                            player.stuns = 1;
                            endTurn = true;
                            pushNonCollapsableStatement(`**${player.displayName}** tried to place a boulder but the boulder disintegrated in his hands`);
                            return false;
                        }
                        // If doing this will softlock the game, knock out the player
                        if (!this.canAllPlayersReachGoal([targetLocation])) {
                            player.stuns = 1;
                            endTurn = true;
                            pushNonCollapsableStatement(`**${player.displayName}** got knocked out trying to softlock the game (tried to place boulder at **${MazeGame.getLocationString(targetLocation.r, targetLocation.c)}**)`);
                            return false;
                        }
                        // Otherwise, place the boulder
                        this.state.map[targetLocation.r][targetLocation.c] = TileType.BOULDER;
                        this.consumePlayerItem(userId, 'boulder');
                        pushNonCollapsableStatement(`**${player.displayName}** placed a boulder at **${MazeGame.getLocationString(targetLocation.r, targetLocation.c)}**`);
                        return true;
                    },
                    seal: (arg) => {
                        const argLocation: MazeLocation | undefined = MazeGame.parseLocationString(arg);
                        const sealableLocations = this.getAdjacentLocationsOrOverride({ r: player.r, c: player.c }, argLocation).filter(l => this.isSealable(l.r, l.c));
                        // If doing this will softlock the game, knock out the player
                        if (!this.canAllPlayersReachGoal(sealableLocations)) {
                            player.stuns = 1;
                            endTurn = true;
                            pushNonCollapsableStatement(`**${player.displayName}** got knocked out trying to softlock the game (tried to permanently seal doorways)`);
                            return false;
                        }
                        // Otherwise, seal all the adjacent doorways
                        let numDoorwaysSealed = 0;
                        for (const { r, c } of sealableLocations) {
                            this.state.map[r][c] = TileType.WALL;
                            numDoorwaysSealed++;
                        }
                        if (numDoorwaysSealed === 1) {
                            pushNonCollapsableStatement(`**${player.displayName}** sealed a doorway`);
                        } else {
                            pushNonCollapsableStatement(`**${player.displayName}** sealed **${numDoorwaysSealed}** doorways`);
                        }
                        this.consumePlayerItem(userId, 'seal');
                        return true;
                    },
                    key: (arg) => {
                        const numDoorwaysUnlocked: number = doUnlock(arg);
                        // Only consume the key if any doorways were unlocked
                        if (numDoorwaysUnlocked > 0) {
                            this.consumePlayerItem(userId, 'key');
                        }
                        return true;
                    },
                    star: () => {
                        player.invincible = true;
                        this.consumePlayerItem(userId, 'star');
                        pushNonCollapsableStatement(`**${player.displayName}** used a star to become invincible`);
                        return true;
                    },
                    charge: (arg) => {
                        const argLocation: MazeLocation | undefined = MazeGame.parseLocationString(arg);
                        // Emergency fallback (this shouldn't happen)
                        if (!argLocation) {
                            player.stuns = 1;
                            endTurn = true;
                            pushNonCollapsableStatement(`**${player.displayName}** tried to charge like a madman but accidentally gave himself AIDS`);
                            return false;
                        }
                        const previousLocation = { r: player.r, c: player.c };
                        const direction = MazeGame.getDirectionTo({ r: player.r, c: player.c }, argLocation);
                        const intermediateLocations = this.getLocationsBetween({ r: player.r, c: player.c }, argLocation);
                        this.consumePlayerItem(userId, 'charge');
                        const trampledPlayers: Snowflake[] = [];
                        let spacesMoved = 0;
                        const getChargeText = (slammedIntoWall: boolean): string => {
                            let text = `**${player.displayName}** charged like a ${slammedIntoWall ? 'dumbass' : 'madman'} **${spacesMoved}** space${spacesMoved === 1 ? '' : 's'} ${direction}ward`;
                            if (slammedIntoWall) {
                                text += ' (slamming into a wall and knocking himself out)';
                            }
                            if (trampledPlayers.length > 0) {
                                text += `, trampling ${naturalJoin(this.getDisplayNames(trampledPlayers), { bold: true })}`;
                            }
                            return text;
                        };
                        for (const intermediateLocation of intermediateLocations) {
                            // If this location isn't walkable, knock the player out and end the charge
                            if (!this.isWalkable(intermediateLocation.r, intermediateLocation.c)) {
                                this.addRenderLine(previousLocation, { r: player.r, c: player.c }, 'red');
                                pushNonCollapsableStatement(getChargeText(true));
                                player.stuns = 1;
                                endTurn = true;
                                return true;
                            }
                            // Trample all other players in this location
                            const playersAtLocation = this.getPlayersAtLocation({ r: player.r, c: player.c });
                            for (const otherPlayerId of playersAtLocation) {
                                if (otherPlayerId !== userId) {
                                    const otherPlayer = this.state.players[otherPlayerId];
                                    otherPlayer.stuns = 3;
                                    trampledPlayers.push(otherPlayerId);
                                }
                            }
                            // Move to the new location
                            movePlayerTo(userId, intermediateLocation);
                            spacesMoved++;
                        }
                        this.addRenderLine(previousLocation, { r: player.r, c: player.c }, 'red');
                        pushNonCollapsableStatement(getChargeText(false));
                        return true;
                    }
                };

                if (this.isPlayerStunned(userId)) {
                    // Skip processing this player's decisions
                    continue;
                }

                // Unless this player's turn should end, process their next action
                if (!endTurn) {
                    // Get the next action for this user
                    const nextAction = this.state.decisions[userId][0];
                    const [actionName, actionArg] = nextAction.toLowerCase().split(':') as [ActionName, string];

                    // If the player can't afford this action, delete all their decisions and stun them (ending their turn)
                    const actionCost: number = this.getActionCost(actionName, { r: player.r, c: player.c }, actionArg);
                    if (actionCost > player.points) {
                        delete this.state.decisions[userId];
                        player.stuns = 1;
                        pushNonCollapsableStatement(`**${player.displayName}** ran out of action points and fainted`);
                        continue;
                    }

                    // Execute the action
                    const consumeAction: boolean = commandActions[actionName](actionArg);

                    // If the action was successful, remove this decision from the queue so any following ones can be processed
                    if (consumeAction) {
                        // Consume points
                        this.addPoints(userId, -actionCost);
                        // Remove the action
                        this.state.decisions[userId].shift();
                        // Delete the decision list if it's been exhausted
                        if (!this.hasPendingDecisions(userId)) {
                            delete this.state.decisions[userId];
                        }
                    }

                    // If the player started unfinished but is now finished, end their turn now
                    // TODO: Do we need to do this? Can we just skip-yet-consume certain actions for finished players?
                    if (!startedFinished && player.finished) {
                        endTurn = true;
                    }
                }

                // If this was a turn-ending action, delete the user's entire decision list
                if (endTurn) {
                    delete this.state.decisions[userId];
                }

                const turnIsOver = !this.hasPendingDecisions(userId);
                
                // Process end-of-turn events
                if (turnIsOver) {
                    // If the user warped, knock them out
                    if (player.warped) {
                        player.stuns = 1;
                    }
                    // Hack to handle end-of-turn movement triggers e.g. traps
                    // (since decisions aren't consumed until after the action is processed, so the final step didn't trigger this)
                    movePlayerTo(userId, player);
                }
            } else {
                // Emergency fallback just in case the player has an empty decision list
                delete this.state.decisions[userId];
            }
        }

        // Turn is over, flush all remaining step statements into the statement log
        flushCollapsableStatements();

        // Refresh all player ranks
        this.refreshPlayerRanks();

        // Only continue processing if there are no decisions left
        const continueProcessing: boolean = Object.keys(this.state.decisions).length > 0;

        // Only continue immediately if we should continue processing at all...
        const continueImmediately: boolean = continueProcessing
            // ...if 3 or fewer players were processed
            && numPlayersProcessed <= 3
            // ...if the summary text only has one statement which is for player(s) taking a step
            && summaryData.statements.length === 1
            && summaryData.statements[0].includes('took a step')
            // ...and if the next decisions are basic step moves
            && Object.values(this.state.decisions).every(actions => actions[0] in OFFSETS_BY_DIRECTION);

        // If there are no decisions left, end the turn
        return {
            summary: {
                content: naturalJoin(summaryData.statements, { conjunction: 'then' }) || 'Dogs sat around with their hands in their pockets...',
                files: [await this.renderStateAttachment()],
                flags: MessageFlags.SuppressNotifications
            },
            continueProcessing,
            continueImmediately
        };
    }

    hasPendingDecisions(userId: Snowflake): boolean {
        return userId in this.state.decisions && this.state.decisions[userId].length > 0;
    }

    getPendingDecisions(): Record<Snowflake, string[]> {
        return this.state.decisions;
    }

    /**
     * @returns The next action in some player's decision list if it exists, else undefined.
     */
    getNextDecidedAction(userId: Snowflake): string | undefined {
        if (this.state.decisions && userId in this.state.decisions && this.state.decisions[userId].length > 0) {
            return this.state.decisions[userId][0];
        }
        return undefined;
    }

    override handleNonDecisionDM(userId: Snowflake, text: string): string[] {
        if (!this.hasPlayer(userId)) {
            return [];
        }

        // If this player has any offers, process their claim
        const player = this.state.players[userId];
        if (player.itemOffers) {
            const sanitizedText = text.toLowerCase().trim();
            if (sanitizedText.startsWith('claim')) {
                const claimedItem = sanitizedText.replace('claim', '').trim();
                if (VALID_ITEMS.has(claimedItem)) {
                    // Clear offers and award the claimed item
                    delete player.itemOffers;
                    return this.awardItem(userId, claimedItem as MazeItemName, 'Nice choice');
                } else {
                    // Invalid item name, so let them know the exact options
                    return ['Invalid claim attempt bro, please say ' + naturalJoin(player.itemOffers.map(item => `\`claim ${item}\``), { conjunction: 'or' })];
                }
            }
        }

        return [];
    }

    /**
     * For a given player, returns a set of actions limited by what they can afford.
     * The actions are determined using a naive search (ignore doorways).
     */
    getNextActionsTowardGoal(userId: Snowflake, n: number = 1): Direction[] {
        if (!this.hasPlayer(userId)) {
            throw new Error(`Cannot get next actions toward goal for nonexistent player \`${userId}\``);
        }
        const player = this.state.players[userId];
        // Treat player-occupied tiles as very costly to create more distributed pathing
        return this.searchToGoal(player.r, player.c, { addedOccupiedTileCost: 4 }).semanticSteps.slice(0, n);
    }

    getNumStepsToLocation(from: MazeLocation, to: MazeLocation): number {
        return this.search(from, to, { useDoorways: true }).steps.length;
    }

    approximateCostToGoal(r: number, c: number): number {
        // Don't treat player-occupied tiles as too costly because it'll distort the cost too much
        return this.searchToGoal(r, c, { useDoorways: true, addedOccupiedTileCost: 1 }).cost;
    }

    approximateCostToGoalForPlayer(userId: Snowflake): number {
        if (!this.hasPlayer(userId)) {
            throw new Error(`Cannot approximate cost-to-goal for nonexistent player \`${userId}\``);
        }
        const player = this.state.players[userId];
        return this.approximateCostToGoal(player.r, player.c);
    }

    searchToGoal(r: number, c: number, options?: PathingOptions) {
        return this.search({ r, c }, { r: this.getGoalRow(), c: this.getGoalColumn() }, options);
    }

    search(start: MazeLocation, goal: MazeLocation, options?: PathingOptions) {
        const finder = new AStarPathFinder(this.toWeightMap(options));
        const result = finder.search({
            start,
            goal,
            heuristic: 'manhattan',
            randomize: true
        });
        return result;
    }

    private toWeightMap(options?: PathingOptions): (number | null)[][] {
        return this.state.map.map((row, r) => row.map((tile, c) => {
            // If simulating an obstacle at this location, treat this location as unwalkable
            if (options?.obstacles && options.obstacles.some(o => r === o.r && c === o.c)) {
                return null;
            }
            // Else, do a more calculation of the realistic cost
            const locationString = MazeGame.getLocationString(r, c);
            if (options?.useDoorways && tile === TileType.DOORWAY && locationString in this.state.doorwayCosts) {
                // Multiply doorway cost by 2 since it's risky
                return this.state.doorwayCosts[locationString] * 2;
            }
            if (this.isWalkableTileType(tile)) {
                if (options?.addedOccupiedTileCost && this.isPlayerAtLocation({r, c})) {
                    // Increase cost of player-occupied tiles because it's risky
                    return 1 + options.addedOccupiedTileCost;
                }
                return 1;
            }
            return null;
        }));
    }

    private static getCardinalOffsets(n: number = 1): [[number, number], [number, number], [number, number], [number, number]] {
        return [[-n, 0], [n, 0], [0, -n], [0, n]];
    }

    private static getNormalizedOffsetTo(from: MazeLocation, to: MazeLocation): [number, number] {
        if (from.r !== to.r && from.c === to.c) {
            if (from.r < to.r) {
                return [1, 0];
            } else {
                return [-1, 0];
            }
        } else if (from.r === to.r && from.c !== to.c) {
            if (from.c < to.c) {
                return [0, 1];
            } else {
                return [0, -1];
            }
        }
        // TODO: What about same row and column?
        throw new Error(`Cannot compute normalized offset from ${from} to ${to}, as they're not in the same row or column`);
    }

    private static getDirectionByOffset(offset: [number, number]): Direction {
        for (const [direction, otherOffset] of Object.entries(OFFSETS_BY_DIRECTION)) {
            if (offset[0] === otherOffset[0] && offset[1] === otherOffset[1]) {
                return direction as Direction;
            }
        }
        throw new Error(`Offset ${offset} cannot be mapped to a cardinal direction!`);
    }

    private static getOffsetLocation(location: MazeLocation, offset: [number, number]): MazeLocation {
        return {
            r: location.r + offset[0],
            c: location.c + offset[1]
        };
    }

    private static getOrthogonalOffsetLocations(location: MazeLocation, offset: [number, number]): MazeLocation[] {
        return [{
            r: location.r + offset[1],
            c: location.c - offset[0]
        }, {
            r: location.r - offset[1],
            c: location.c + offset[0]
        }]
    }

    private static getDirectionTo(from: MazeLocation, to: MazeLocation): Direction {
        if (from.r > to.r) {
            return 'up';
        } else if (from.r < to.r) {
            return 'down';
        } else if (from.c < to.c) {
            return 'right';
        } else if (from.c > to.c) {
            return 'left';
        }
        throw new Error(`Cannot get cardinal direction from ${from} to ${to}`);
    }

    private static locationEquals(a: MazeLocation, b: MazeLocation): boolean {
        return a.r === b.r && a.c === b.c;
    }

    private getLocationsBetween(from: MazeLocation, to: MazeLocation): MazeLocation[] {
        if (from.r !== to.r && from.c !== to.c) {
            throw new Error(`Cannot compute locations between ${from} and ${to}, as they're not in the same row or column`);
        }
        if (!this.isInBounds(from.r, from.c)) {
            throw new Error(`Cannot compute locations between ${from} and ${to}, as ${from} is out of bound`);
        }
        if (!this.isInBounds(to.r, to.c)) {
            throw new Error(`Cannot compute locations between ${from} and ${to}, as ${to} is out of bound`);
        }
        let row = from.r;
        let col = from.c;
        const result = [{ r: row, c: col }];
        const offset = MazeGame.getNormalizedOffsetTo(from, to);
        while (this.isInBounds(row, col)) {
            row += offset[0];
            col += offset[1];
            result.push({ r: row, c: col });
            if (row === to.r && col === to.c) {
                return result;
            }
        }
        throw new Error(`Cannot compute locations between ${from} and ${to}, as the computation somehow went out of bounds`);
    }

    /**
     * @returns a list of all in-bound locations adjacent to the given location
     */
    private getAdjacentLocations(location: MazeLocation | undefined): MazeLocation[] {
        // Emergency fallback
        if (!location) {
            return [];
        }
        const result: MazeLocation[] = [];
        for (const [dr, dc] of MazeGame.getCardinalOffsets()) {
            const nr = location.r + dr;
            const nc = location.c + dc;
            if (this.isInBounds(nr, nc)) {
                result.push({ r: nr, c: nc });
            }
        }
        return result;
    }

    /**
     * @returns a list containing just the override location, if it exists; else all in-bound locations adjacent to the given location
     */
    private getAdjacentLocationsOrOverride(location: MazeLocation | undefined, override: MazeLocation | undefined): MazeLocation[] {
        // Emergency fallback
        if (!location) {
            return [];
        }
        if (override) {
            return [override];
        }
        return this.getAdjacentLocations(location);
    }

    /**
     * @returns The adjacent walkable, vacant, and trapless location with the lowest cost to the goal (if it exists)
     */
    private getBestVacantAdjacentLocation(location: MazeLocation | undefined): MazeLocation | undefined {
        // Emergency fallback
        if (!location) {
            return undefined;
        }
        let bestLocation: MazeLocation | undefined = undefined;
        let lowestCostToGoal: number = Number.POSITIVE_INFINITY;
        for (const adjacentLocation of this.getAdjacentLocations(location)) {
            // Only consider locations that are walkable, vacant, and not traps (because that would be unfair...)
            if (this.isLocationShovable(adjacentLocation) && !this.isTrap(adjacentLocation)) {
                // If the cost is the lowest so far, use it...
                const costToGoal = this.approximateCostToGoal(adjacentLocation.r, adjacentLocation.c);
                if (costToGoal < lowestCostToGoal) {
                    bestLocation = adjacentLocation;
                    lowestCostToGoal = costToGoal;
                }
            }
        }
        return bestLocation;
    }

    private isAdjacent(l1: MazeLocation, l2: MazeLocation): boolean {
        return this.getAdjacentLocations(l1).some(la => la.r === l2.r && la.c === l2.c);
    }

    getMapFairness(): { min: number, max: number, naive: number, fairness: number, description: string } {
        let min = Number.MAX_SAFE_INTEGER;
        let max = -1;
        for (const userId of this.getPlayers()) {
            const cost = this.approximateCostToGoalForPlayer(userId);
            max = Math.max(max, cost);
            min = Math.min(min, cost);
        }
        // TODO: Use the real "start" location when that data is defined
        const dummyStart: MazeLocation = { r: 0, c: Math.floor(this.state.columns / 2) };
        const naive = this.searchToGoal(dummyStart.r, dummyStart.c).cost;
        return { min, max, naive, fairness: min / max, description: `[${min}, ${max}] = ${(100 * min / max).toFixed(1)}% [naive ${naive}]` };
    }

    canAllPlayersReachGoal(obstacles: MazeLocation[] = []): boolean {
        const simulatedWeightMap = this.toWeightMap({ obstacles, useDoorways: true });
        const finder = new AStarPathFinder(simulatedWeightMap);
        for (const userId of this.getUnfinishedPlayers()) {
            // TOOD: can we somehow reuse the existing APIs but add more options?
            const player = this.state.players[userId];
            const result = finder.search({
                start: { r: player.r, c: player.c },
                goal: { r: this.getGoalRow(), c: this.getGoalColumn() },
                heuristic: 'manhattan'
            });
            if (!result.success) {
                return false;
            }
        }
        return true;
    }

    getGoalRow(): number {
        return this.state.goal.r;
    }

    getGoalColumn(): number {
        return this.state.goal.c;
    }

    isGoal(r: number, c: number): boolean {
        return r === this.getGoalRow() && c === this.getGoalColumn();
    }

    getEuclideanDistanceToGoal(r: number, c: number): number {
        return Math.sqrt(Math.pow(this.getGoalRow() - r, 2) + Math.pow(this.getGoalColumn() - c, 2));
    }

    /**
     * In a 3x3 box around the given player, return a random location that a user may spawn in (is walkable, isn't occupied by another user, and isn't the goal).
     * If no such tile exists, return nothing.
     */
    getSpawnableLocationAroundPlayer(userId: Snowflake): { r: number, c: number } | undefined {
        const offsets = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        shuffle(offsets);
        const player = this.state.players[userId];
        // If this player already finished, they effectively have no location
        if (player.finished) {
            return undefined;
        }
        for (const [dr, dc] of offsets) {
            const nr = player.r + dr;
            const nc = player.c + dc;
            if (this.isWalkable(nr, nc) && !this.isPlayerAtLocation({ r: nr, c: nc }) && !this.isGoal(nr, nc)) {
                return { r: nr, c: nc };
            }
        }
    }

    getAllLocations(): MazeLocation[] {
        const results: MazeLocation[] = [];
        for (let r = 0; r < this.state.rows; r++) {
            for (let c = 0; c < this.state.columns; c++) {
                results.push({ r, c });
            }
        }
        return results;
    }

    /**
     * Given a list of players, return a random location that a user may spawn in in a 3x3 box around any of the players.
     * If no such tile exists for any of the players, return nothing.
     */
    getSpawnableLocationAroundPlayers(userIds: Snowflake[]): { location: MazeLocation, userId: Snowflake } | undefined {
        // Make sure to clone it first
        const shuffledUserIds: Snowflake[] = userIds.slice();
        shuffle(shuffledUserIds);
        for (const userId of shuffledUserIds) {
            const location = this.getSpawnableLocationAroundPlayer(userId);
            if (location) {
                return { location, userId };
            }
        }
    }

    getRandomVacantLocationsBehindPlayer(userId: Snowflake, n: number): MazeLocation[] {
        // Start by getting all vacant locations (even those in front of the player)
        const vacantLocations = this.getAllLocations().filter(l => this.isTileType(l.r, l.c, TileType.EMPTY) && !this.isPlayerAtLocation(l));

        // Shuffle all the vacant locations
        shuffle(vacantLocations);

        // Deterine the total spawn-to-goal cost
        // TODO: Use an actual spawn location, not a hardcoded one
        const totalCost = this.approximateCostToGoal(0, 0);

        // Determine the cost-from-spawn of the player
        const playerCostFromSpawn = totalCost - this.approximateCostToGoalForPlayer(userId);
        const costThreshold = Math.floor(playerCostFromSpawn * 0.75);

        const results: MazeLocation[] = [];
        while (vacantLocations.length > 0 && results.length < n) {
            // Get the next vacant location and compute its cost-to-goal
            const nextLocation = vacantLocations.pop();
            if (nextLocation) {
                const locationCostFromSpawn = totalCost - this.approximateCostToGoal(nextLocation.r, nextLocation.c);
    
                // If this location is less than 75% of the way to the player's location, use it
                if (locationCostFromSpawn < costThreshold) {
                    results.push(nextLocation);
                }
            }
        }

        return results;
    }

    isPlayerFinished(userId: Snowflake): boolean {
        return this.state.players[userId]?.finished ?? false;
    }

    getPlayerRank(userId: Snowflake): number {
        return this.state.players[userId]?.rank ?? Number.MAX_SAFE_INTEGER;
    }

    getPlayerStuns(userId: Snowflake): number {
        return this.state.players[userId]?.stuns ?? 0;
    }

    isPlayerStunned(userId: Snowflake): boolean {
        return this.getPlayerStuns(userId) > 0;
    }

    consumePlayerStun(userId: Snowflake): void {
        if (this.hasPlayer(userId)) {
            const player = this.state.players[userId];
            player.stuns = this.getPlayerStuns(userId) - 1;
            if (player.stuns === 0) {
                delete player.stuns;
            }
        }
    }

    getPlayerMultiplier(userId: Snowflake): number {
        return this.state.players[userId]?.multiplier ?? 1;
    }

    playerHasMultiplier(userId: Snowflake): boolean {
        return this.getPlayerMultiplier(userId) > 1;
    }

    playerHasAnyItem(userId: Snowflake): boolean {
        return ITEM_NAMES.some(item => this.playerHasItem(userId, item));
    }

    playerHasItem(userId: Snowflake, item: MazeItemName): boolean {
        return this.getPlayerItemCount(userId, item) > 0;
    }

    getPlayerItemCount(userId: Snowflake, item: MazeItemName): number {
        return this.getPlayerItems(userId)[item] ?? 0;
    }

    getPlayerItems(userId: Snowflake): Partial<Record<MazeItemName, number>> {
        return this.state.players[userId]?.items ?? {};
    }

    addPlayerItem(userId: Snowflake, item: MazeItemName, num: number = 1): void {
        const player = this.state.players[userId];

        if (player.items === undefined) {
            player.items = {};
        }

        player.items[item] = (player.items[item] ?? 0) + num;
    }

    consumePlayerItem(userId: Snowflake, item: MazeItemName): void {
        const player = this.state.players[userId];

        if (!player.items || !this.playerHasItem(userId, item)) {
            return;
        }

        const newItemCount = (player.items[item] ?? 0) - 1;
        player.items[item] = newItemCount;

        if (newItemCount <= 0) {
            delete player.items[item];
        }

        if (Object.keys(player.items).length === 0) {
            delete player.items;
        }
    }

    isUsingBetaFeatures(): boolean {
        return this.state.usingBetaFeatures ?? false;
    }

    setUsingBetaFeatures(usingBetaFeatures: boolean): void {
        this.state.usingBetaFeatures = usingBetaFeatures;
    }
}

// TODO: Below is a messy utility for the new organic maze generation

const generateOrganicMaze = (rows: number, columns: number): TileType[][] => {
    const map: TileType[][] = [];

    const getCornerOffsets = () => {
        return [[-1, -1], [1, 1], [-1, 1], [1, -1]];
    };
    const getRandomCardinalOffsets = () => {
        return shuffle([[-1, 0], [1, 0], [0, -1], [0, 1]]);
    };
    const inBounds = (r: number, c: number): boolean => {
        return r >= 0 && c >= 0 && r < rows && c < columns;
    };
    const isLandLocked = (r: number, c: number): boolean => {
        let count = 0;
        for (const dr of [-1, 0, 1]) {
            for (const dc of [-1, 0, 1]) {
                if (inBounds(r + dr, c + dc) && map[r + dr][c + dc] === TileType.EMPTY) {
                    return false;
                }
            }
        }
        return true;
    };
    const isFreeInAdjacents = (r: number, c: number, n: number): boolean => {
        let count = 0;
        for (const [dr, dc] of getRandomCardinalOffsets()) {
            if (inBounds(r + dr, c + dc) && map[r + dr][c + dc] === TileType.EMPTY) {
                count++;
            }
        }
        return count === n;
    };
    const isFreeOnCorners = (r: number, c: number, n: number): boolean => {
        let count = 0;
        for (const [dr, dc] of getCornerOffsets()) {
            if (inBounds(r + dr, c + dc) && map[r + dr][c + dc] === TileType.EMPTY) {
                count++;
            }
        }
        return count === n;
    };
    const isCriticalCorner = (r: number, c: number): boolean => {
        for (const [dr, dc] of getCornerOffsets()) {
            if (inBounds(r + dr, c + dc)
                && map[r + dr][c + dc] === TileType.EMPTY
                && map[r][c + dc] !== TileType.EMPTY
                && map[r + dr][c] !== TileType.EMPTY)
            {
                return true;
            }
        }
        return false;
    };
    const isWall = (r: number, c: number): boolean => {
        return !inBounds(r, c) || map[r][c] === TileType.WALL;
    };
    const isOpen = (r: number, c: number): boolean => {
        return inBounds(r, c) && map[r][c] === TileType.EMPTY;
    };
    const isPotentialDoorway = (r: number, c: number): boolean => {
        // Vertical doorway
        if (isWall(r, c - 1) && isWall(r, c + 1) && isOpen(r - 1, c) && isOpen(r + 1, c)) {
            return true;
        }
        // Horizontal doorway
        if (isOpen(r, c - 1) && isOpen(r, c + 1) && isWall(r - 1, c) && isWall(r + 1, c)) {
            return true;
        }
        return false;
    };
    const is2x2 = (r: number, c: number): boolean => {
        for (const [dr, dc] of getCornerOffsets()) {
            if (isWall(r, c) && isWall(r + dr, c) && isWall(r, c + dc) && isWall(r + dr, c + dc)) {
                return true;
            }
        }
        return false;
    };

    for (let r = 0; r < rows; r++) {
        map.push([]);
        for (let c = 0; c < columns; c++) {
            map[r][c] = TileType.WALL;
        }
    }

    const step = (r: number, c: number, prev: [number, number] = [0, 0]) => {
        // Carve
        map[r][c] = TileType.EMPTY;
        const offsets = getRandomCardinalOffsets();
        while (offsets.length > 0) {
            const offset = offsets.shift() as [number, number];
            const [dr, dc] = offset;
            // If going in a straight line, come to this last
            if (chance(0.75) && dr === prev[0] && dc === prev[1]) {
                offsets.push(offset);
                continue;
            }

            const nr = r + dr;
            const nc = c + dc;

            const n2r = r + 2 * dr;
            const n2c = c + 2 * dc;

            // If going OOB, skip
            if (!inBounds(nr, nc)) {
                continue;
            }

            // If next is already carved, skip
            if (map[nr][nc] === TileType.EMPTY) {
                continue;
            }

            // If next is a critical corner, skip
            if (isCriticalCorner(nr, nc)) {
                continue;
            }

            // If next is free in adjacent tiles, maybe skip
            if (isFreeInAdjacents(nr, nc, 4)) {
                if (chance(0.95)) {
                    continue;
                }
            } else if (isFreeInAdjacents(nr, nc, 3)) {
                if (chance(0.95)) {
                    continue;
                }
            } else if (isFreeInAdjacents(nr, nc, 2)) {
                if (chance(0.75)) {
                    continue;
                }
            }

            // If next is free in corners, maybe skip
            if (isFreeOnCorners(nr, nc, 4)) {
                if (chance(0.95)) {
                    continue;
                }
            } else if (isFreeOnCorners(nr, nc, 3)) {
                if (chance(0.9)) {
                    continue;
                }
            } else if (isFreeOnCorners(nr, nc, 2)) {
                if (chance(0.75)) {
                    continue;
                }
            } else if (isFreeOnCorners(nr, nc, 1)) {
                if (chance(0.6)) {
                    continue;
                }
            }

            // If we're not breaking onto another path, go this way
            if (chance(0.5) || !inBounds(n2r, n2c) || map[n2r][n2c] !== TileType.EMPTY) {
                step(nr, nc, offset);
            }
        }
    };

    // Initial step
    step(0, 0);

    // Find all landlocked tiles and step there
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
            if (isLandLocked(r, c)) {
                step(r, c);
            }
        }
    }

    // Find all 2x2 chunks and break them up (if they contain no critical corners)
    // TODO: Randomize indexes
    for (const r of shuffle([...Array(rows).keys()])) {
        for (const c of shuffle([...Array(columns).keys()])) {
            if (is2x2(r, c) && !isCriticalCorner(r, c)) {
                map[r][c] = TileType.EMPTY;
            }
        }
    }

    // Add doorways
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
            if (chance(0.66) && isWall(r, c) && isPotentialDoorway(r, c)) {
                map[r][c] = TileType.DOORWAY;
            }
        }
    }

    return map;
};
