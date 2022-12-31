import canvas, { NodeCanvasRenderingContext2D } from 'canvas';
import { GuildMember, Snowflake } from 'discord.js';
import { getRankString, naturalJoin, randInt, shuffle, toLetterId, fromLetterId, AStarPathFinder, shuffleWithDependencies, toFixed, collapseRedundantStrings, chance, randChoice } from 'evanw555.js';
import { DecisionProcessingResult, DungeonGameState, DungeonItemName, DungeonLocation, DungeonPlayerState, PrizeType } from "../types";
import AbstractGame from "./abstract-game";
import logger from '../logger';

enum TileType {
    INVALID = -1,
    EMPTY = 0,
    WALL = 1,
    KEY_HOLE = 2,
    OPENED_KEY_HOLE = 3,
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

type BasicActionName = Direction | 'pause' | 'unlock' | 'lock' | 'punch' | 'warp';
type ActionName = BasicActionName | DungeonItemName;

const ITEM_NAME_RECORD: Record<DungeonItemName, boolean> = {
    boulder: true,
    seal: true,
    trap: true,
    key: true,
    star: true,
    charge: true
};
const ITEM_NAMES: DungeonItemName[] = Object.keys(ITEM_NAME_RECORD) as DungeonItemName[];
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
    obstacles?: DungeonLocation[]
}

export default class DungeonCrawler extends AbstractGame<DungeonGameState> {
    private static readonly TILE_SIZE: number = 24;
    private static readonly STARTER_POINTS: number = 3;

    private static readonly STYLE_SKY: string = 'hsl(217, 94%, 69%)';
    private static readonly STYLE_DARK_SKY: string = 'hsl(217, 90%, 64%)';
    private static readonly STYLE_LIGHT_SKY: string = 'hsl(217, 85%, 75%)';
    private static readonly STYLE_CLOUD: string = 'rgba(222, 222, 222, 1)';
    private static readonly STYLE_WARP_PATH: string = 'rgba(98, 11, 212, 0.5)';
    private static readonly STYLE_HEAVY_PATH: string = 'rgba(255, 0, 0, 0.75)';

    constructor(state: DungeonGameState) {
        super(state);
    }

    getIntroductionText(): string {
        return 'My dear dogs... Welcome to the Clouded Labyrinth of the Shining Idol! '
            + 'This season, you will all be traversing this silver-lined dungeon in search of bright mornings. '
            + 'The first, second, and third pups to reach me at the end will be crowned victorious. '
            + 'Each Saturday, you will have all day to choose your moves, each costing some amount of points. '
            + 'Some moves are secret and can only be performed once unlocked. '
            + 'The next day (Sunday), your moves will be performed one-by-one. ';
    }

    getInstructionsText(): string {
        if (this.state.homeStretch && this.getNumWinners() > 0) {
            const text = 'All players in _blue_ have a **2x** point multiplier';
            if (this.getNumWinners() === 1) {
                return `**${this.getDisplayName(this.getWinners()[0])}** has already reached the goal, so the race for 2nd and 3rd is on! ${text}`;
            } else {
                return `**${this.getDisplayName(this.getWinners()[0])}** and **${this.getDisplayName(this.getWinners()[1])}** have already reached the goal, so the race for 3rd is on! ${text}`;
            }
        }
        return 'Choose your moves by sending me a DM with your desired sequence of actions. You have until tomorrow morning to choose. DM me _"help"_ for more info.';
    }

    getHelpText(): string {
        return 'Here are the possible actions you may take and their associated costs:\n'
                + '`up`, `down`, `left`, `right`: move one step in such direction. Costs `1`\n'
                + '`unlock`: open all doorways adjacent to you (or just one e.g. `unlock:b12`). Cost is denoted on each doorway, and is reduced with each unlock\n'
                + '`lock`: close all doorways adjacent to you (or just one e.g. `lock:b12`). Cost is denoted on each doorway\n'
                + '`punch`: 75% chance of knocking out any player adjacent to you, ending their turn. Costs `2`\n'
                + '`warp`: warp to a random player. Costs `0.5` for each week that has elapsed\n'
                + '`pause`: do nothing. Free\n\n'
            + 'Misc Rules:\n'
                + '1. If you do not choose your actions, actions will be chosen for you (use `pause` to do nothing instead).\n'
                + '2. In a given turn, one action is processed from each player in a _semi-random_ order until all players have no actions left '
                + '("semi-random" = random, but your action is guaranteed to be after another player\'s if you\'re walking into them).\n'
                + '3. You cannot walk over/past other players unless they are KO\'ed or you are walking into each other head-on.\n'
                + '4. Players starting their turn with less than one point are KO\'ed the entire turn.\n'
                + '5. If you somehow walk into a wall, your turn is ended.\n'
                + '6. If you walk into another player, your turn is ended if they have no more actions remaining.\n'
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
            logger.log(`Refusing to add **${member.displayName}** to the dungeon, as they're already in it!`);
            return `Cannot add **${member.displayName}** (already in-game)`;
        }
        // Get the worst 33% of players based on location
        const playersClosestToGoal: Snowflake[] = this.getUnfinishedPlayersClosestToGoal();
        const worstPlayers = playersClosestToGoal.slice(-Math.floor(playersClosestToGoal.length / 3));
        // Choose a random vacant spawn location around any of these players
        const spawnLocation = this.getSpawnableLocationAroundPlayers(worstPlayers);
        // If there was no available spawn location, then just choose a random tile in the top row
        const spawnR = spawnLocation?.r ?? 0;
        const spawnC = spawnLocation?.c ?? randInt(0, this.state.columns);
        // This new player gets starter points (plus more if later in the game) as a balance
        const lateStarterPoints: number = DungeonCrawler.STARTER_POINTS + this.getTurn();
        // Create the player at this spawn location
        this.state.players[member.id] = {
            r: spawnR,
            c: spawnC,
            rank: this.getNumPlayers() + 1,
            points: lateStarterPoints,
            displayName: member.displayName,
            avatarUrl: member.user.displayAvatarURL({ size: 32, extension: 'png' })
        };
        // Refresh all player ranks
        this.refreshPlayerRanks();
        // Return log text describing this player being added
        const locationText: string = spawnLocation ? `near **${this.getDisplayName(spawnLocation.userId)}**` : `at \`${DungeonCrawler.getLocationString(spawnR, spawnC)}\``;
        return `Added player **${member.displayName}** ${locationText} with **${lateStarterPoints}** starter points`;
    }

    updatePlayer(member: GuildMember): void {
        if (this.hasPlayer(member.id)) {
            const player = this.state.players[member.id];
            player.displayName = member.displayName;
            player.avatarUrl = member.user.displayAvatarURL({ size: 32, extension: 'png' });
        }
    }

    removePlayer(userId: Snowflake): void {
        delete this.state.players[userId];
        delete this.state.decisions[userId];
        // Remove any owned traps
        for (const locationString of Object.keys(this.state.trapOwners)) {
            if (this.state.trapOwners[locationString] === userId) {
                delete this.state.trapOwners[locationString];
                logger.log(`Deleted trap at \`${locationString}\` for removed player \`${userId}\``);
            }
        }
        // TODO: Remove from winners too?
    }

    doesPlayerNeedHandicap(userId: Snowflake): boolean {
        // True if this player is in the bottom half of players and has fewer than 20 points
        const player = this.state.players[userId];
        return player && player.rank > Math.floor(this.getNumPlayers() / 2) && player.points < 20;
    }

    async renderState(options?: { showPlayerDecision?: Snowflake, admin?: boolean, season?: number }): Promise<Buffer> {
        const WIDTH: number = this.state.columns * DungeonCrawler.TILE_SIZE;
        const HEIGHT: number = this.state.rows * DungeonCrawler.TILE_SIZE;
        const c = canvas.createCanvas(WIDTH, HEIGHT);
        const context = c.getContext('2d');
        const coinImage = await this.loadImage('assets/coin.png');

        // Fill the blue sky background
        context.fillStyle = DungeonCrawler.STYLE_SKY;
        context.fillRect(0, 0, WIDTH, HEIGHT);

        // Draw the checkerboard pattern
        for (let r = 0; r < this.state.rows; r++) {
            for (let c = 0; c < this.state.columns; c++) {
                if ((r + c) % 2 == 0) {
                    context.fillStyle = DungeonCrawler.STYLE_DARK_SKY;
                    context.fillRect(c * DungeonCrawler.TILE_SIZE, r * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
                }
            }
        }

        // Draw all the tiles
        for (let r = 0; r < this.state.rows; r++) {
            for (let c = 0; c < this.state.columns; c++) {
                if (this.isTileType(r, c, TileType.CHEST)) {
                    // Draw chests
                    context.fillStyle = 'yellow';
                    context.fillRect(c * DungeonCrawler.TILE_SIZE, r * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
                } else if (this.isTileType(r, c, TileType.TRAP)) {
                    // Draw revealed traps
                    context.fillStyle = 'black';
                    context.beginPath();
                    context.arc((c + .5) * DungeonCrawler.TILE_SIZE, (r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE / 4, 0, Math.PI * 2, false);
                    context.fill();
                } else if (this.isTileType(r, c, TileType.BOULDER)) {
                    context.fillStyle = 'dimgray';
                    context.strokeStyle = 'black';
                    context.lineWidth = 2;
                    context.setLineDash([]);
                    this.drawRandomPolygonOnTile(context, r, c);
                } else if (this.isTileType(r, c, TileType.COIN)) {
                    context.drawImage(coinImage, c * DungeonCrawler.TILE_SIZE, r * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
                } else if (this.isCloudy(r, c)) {
                    context.fillStyle = DungeonCrawler.STYLE_CLOUD;
                    context.beginPath();
                    context.arc((c + .5) * DungeonCrawler.TILE_SIZE, (r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE / 2, 0, Math.PI * 2, false);
                    context.fill();
                    // Handle connections
                    if (this.isCloudy(r + 1, c)) {
                        const radius = randInt(DungeonCrawler.TILE_SIZE * .4, DungeonCrawler.TILE_SIZE * .6);
                        context.beginPath();
                        context.arc((c + .5) * DungeonCrawler.TILE_SIZE, (r + 1) * DungeonCrawler.TILE_SIZE, radius, 0, Math.PI * 2, false);
                        context.fill();
                    }
                    if (this.isCloudy(r, c + 1)) {
                        const radius = randInt(DungeonCrawler.TILE_SIZE * .4, DungeonCrawler.TILE_SIZE * .6);
                        context.beginPath();
                        context.arc((c + 1) * DungeonCrawler.TILE_SIZE, (r + .5) * DungeonCrawler.TILE_SIZE, radius, 0, Math.PI * 2, false);
                        context.fill();
                    }
                    // context.fillRect(c * DungeonCrawler.TILE_SIZE, r * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
                    if (this.isTileType(r, c, TileType.KEY_HOLE)) {
                        // Draw key hole cost
                        context.fillStyle = DungeonCrawler.STYLE_LIGHT_SKY;
                        context.font = `${DungeonCrawler.TILE_SIZE * .6}px sans-serif`;
                        this.fillTextOnTile(context, this.state.keyHoleCosts[DungeonCrawler.getLocationString(r, c)].toString(), r, c);
                        // context.fillRect((c + .4) * DungeonCrawler.TILE_SIZE, (r + .3) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE * .2, DungeonCrawler.TILE_SIZE * .4);
                    } else if (this.isTileType(r, c, TileType.OPENED_KEY_HOLE)) {
                        context.fillStyle = DungeonCrawler.STYLE_SKY;
                        if (this.isWalkable(r - 1, c) || this.isWalkable(r + 1, c)) {
                            context.fillRect((c + .1) * DungeonCrawler.TILE_SIZE, r * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE * .8, DungeonCrawler.TILE_SIZE);
                        }
                        if (this.isWalkable(r, c - 1) || this.isWalkable(r, c + 1)) {
                            context.fillRect(c * DungeonCrawler.TILE_SIZE, (r + .1) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE * .8);
                        }
                        // Draw opened key hole cost
                        context.fillStyle = DungeonCrawler.STYLE_CLOUD;
                        context.font = `${DungeonCrawler.TILE_SIZE * .6}px sans-serif`;
                        this.fillTextOnTile(context, this.state.keyHoleCosts[DungeonCrawler.getLocationString(r, c)].toString(), r, c);
                    }
                } else {
                    context.fillStyle = 'black';
                }
            }
        }

        // Draw the sun at the center
        const sunImage = await this.loadImage('assets/sun4.png');
        context.drawImage(sunImage, (this.getGoalColumn() - .5) * DungeonCrawler.TILE_SIZE, (this.getGoalRow() - .5) * DungeonCrawler.TILE_SIZE, 2 * DungeonCrawler.TILE_SIZE, 2 * DungeonCrawler.TILE_SIZE);

        // Render all player "previous locations" before rendering the players themselves
        for (const userId of this.getUnfinishedPlayers()) {
            const player = this.state.players[userId];
            // Render movement line if not showing heavy line
            if (player.previousLocations && !player.showHeavyMovementLine) {
                context.lineWidth = 2;
                context.strokeStyle = DungeonCrawler.STYLE_LIGHT_SKY;
                context.setLineDash([Math.floor(DungeonCrawler.TILE_SIZE / 12), Math.floor(DungeonCrawler.TILE_SIZE / 12)]);
                // TODO: Can this "draw path" logic be refactored?
                context.beginPath();
                context.moveTo((player.c + .5) * DungeonCrawler.TILE_SIZE, (player.r + .5) * DungeonCrawler.TILE_SIZE);
                for (const previousLocation of player.previousLocations) {
                    context.lineTo((previousLocation.c + .5) * DungeonCrawler.TILE_SIZE, (previousLocation.r + .5) * DungeonCrawler.TILE_SIZE);
                }
                context.stroke();
            }
        }

        // Render all players (who haven't finished)
        for (const userId of this.getUnfinishedPlayers()) {
            const player = this.state.players[userId];

            // Draw outline (rainbow if invincible, black otherwise)
            const outlineX = (player.c + .5) * DungeonCrawler.TILE_SIZE;
            const outlineY = (player.r + .5) * DungeonCrawler.TILE_SIZE;
            const outlineRadius = DungeonCrawler.TILE_SIZE / 2 + 1;
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
                context.fillStyle = (this.getPlayerMultiplier(userId) > 1) ? 'blue' : 'black';
                context.beginPath();
                context.arc(outlineX, outlineY, outlineRadius, 0, Math.PI * 2, false);
                context.fill();
            }

            // Draw inner stuff
            if (player.avatarUrl.startsWith('http')) {
                // Draw semi-translucent if the user is knocked out
                context.globalAlpha = player.knockedOut ? 0.5 : 1;

                // Save the context so we can undo the clipping region at a later time
                context.save();
    
                // Define the clipping region as an 360 degrees arc at point x and y
                context.beginPath();
                context.arc((player.c + .5) * DungeonCrawler.TILE_SIZE, (player.r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE / 2, 0, Math.PI * 2, false);
    
                // Clip!
                context.clip();
    
                // Draw the image at imageX, imageY
                const avatarImage = await this.loadImage(player.avatarUrl);
                context.drawImage(avatarImage, player.c * DungeonCrawler.TILE_SIZE, player.r * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
    
                // Restore context to undo the clipping
                context.restore();
                context.globalAlpha = 1;
            } else {
                // If it's not a URL, assume it's a CSS style
                context.fillStyle = player.avatarUrl;
                context.beginPath();
                context.arc((player.c + .5) * DungeonCrawler.TILE_SIZE, (player.r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE / 2, 0, Math.PI * 2, false);
                context.fill();
            }

            // If the user is knocked out, draw an X
            if (player.knockedOut) {
                context.strokeStyle = 'red';
                context.lineWidth = 2;
                context.setLineDash([]);
                context.beginPath();
                context.moveTo(player.c * DungeonCrawler.TILE_SIZE, player.r * DungeonCrawler.TILE_SIZE);
                context.lineTo((player.c + 1) * DungeonCrawler.TILE_SIZE, (player.r + 1) * DungeonCrawler.TILE_SIZE);
                context.moveTo((player.c + 1) * DungeonCrawler.TILE_SIZE, player.r * DungeonCrawler.TILE_SIZE);
                context.lineTo(player.c * DungeonCrawler.TILE_SIZE, (player.r + 1) * DungeonCrawler.TILE_SIZE);
                context.stroke();
            }
        }

        // Render all player warp lines after rendering the players themselves
        for (const userId of this.getUnfinishedPlayers()) {
            const player = this.state.players[userId];
            // Render dashed warp line if showing heavy movement line
            if (player.previousLocations && player.showHeavyMovementLine) {
                context.lineWidth = 4;
                context.strokeStyle = player.warped ? DungeonCrawler.STYLE_WARP_PATH : DungeonCrawler.STYLE_HEAVY_PATH;
                context.setLineDash([Math.floor(DungeonCrawler.TILE_SIZE / 4), Math.floor(DungeonCrawler.TILE_SIZE / 4)]);
                // TODO: Can this "draw path" logic be refactored?
                context.beginPath();
                context.moveTo((player.c + .5) * DungeonCrawler.TILE_SIZE, (player.r + .5) * DungeonCrawler.TILE_SIZE);
                for (const previousLocation of player.previousLocations) {
                    context.lineTo((previousLocation.c + .5) * DungeonCrawler.TILE_SIZE, (previousLocation.r + .5) * DungeonCrawler.TILE_SIZE);
                }
                context.stroke();
            }
        }

        // Render the player's actions if enabled
        if (options?.showPlayerDecision) {
            await this.renderPlayerDecision(context, options.showPlayerDecision);
        }

        // Render admin stuff
        if (options?.admin) {
            // Render trap owners
            context.font = `${DungeonCrawler.TILE_SIZE * .35}px sans-serif`;
            context.fillStyle = 'black';
            for (const locationString of Object.keys(this.state.trapOwners)) {
                const location = DungeonCrawler.parseLocationString(locationString);
                if (location) {
                    this.fillTextOnTile(context, this.getDisplayName(this.state.trapOwners[locationString]), location.r, location.c);
                }
            }
            // Render all player decisions
            for (const userId of Object.keys(this.state.players)) {
                await this.renderPlayerDecision(context, userId);
            }
        }

        const SIDEBAR_WIDTH = DungeonCrawler.TILE_SIZE * 11;
        const TOTAL_WIDTH = WIDTH + DungeonCrawler.TILE_SIZE + SIDEBAR_WIDTH;
        const TOTAL_HEIGHT = HEIGHT + DungeonCrawler.TILE_SIZE;
        const masterImage = canvas.createCanvas(TOTAL_WIDTH, TOTAL_HEIGHT);
        const c2 = masterImage.getContext('2d');

        // Render coordinate labels
        c2.font = `${DungeonCrawler.TILE_SIZE * .6}px sans-serif`;
        c2.fillStyle = 'black';
        c2.fillRect(0, 0, TOTAL_WIDTH, TOTAL_HEIGHT);
        c2.drawImage(c, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
        for (let r = 0; r < this.state.rows; r++) {
            const text = toLetterId(r);
            if (r % 2 === 0) {
                c2.fillStyle = 'rgb(50,50,50)';
                c2.fillRect(0, (r + 1) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
            }
            c2.fillStyle = 'white';
            c2.fillText(text, (DungeonCrawler.TILE_SIZE - c2.measureText(text).width) / 2, (r + 1.75) * DungeonCrawler.TILE_SIZE);
        }
        for (let c = 0; c < this.state.columns; c++) {
            const text = (c + 1).toString();
            if (c % 2 === 0) {
                c2.fillStyle = 'rgb(50,50,50)';
                c2.fillRect((c + 1) * DungeonCrawler.TILE_SIZE, 0, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
            }
            c2.fillStyle = 'white';
            c2.fillText(text, (c + 1) * DungeonCrawler.TILE_SIZE + (DungeonCrawler.TILE_SIZE - c2.measureText(text).width) / 2, DungeonCrawler.TILE_SIZE * .75);
        }

        // Determine the number of rows of text we need to render in the sidebar and thus the height per row
        const rowsNeeded = this.getNumPlayers() + Object.keys(this.getChoices()).length + 6;
        const heightPerRow = Math.floor(DungeonCrawler.TILE_SIZE * Math.min(1, this.state.rows / rowsNeeded));

        // Render usernames in order of location
        const MARGIN = 0.5 * DungeonCrawler.TILE_SIZE;
        c2.font = `${heightPerRow * .75}px sans-serif`;
        let y = 2;
        c2.fillStyle = 'white';
        const leftTextX = WIDTH + DungeonCrawler.TILE_SIZE + MARGIN;
        c2.fillText(`Season ${options?.season ?? '???'}, Week ${this.state.turn}, Action ${this.state.action}`, leftTextX, DungeonCrawler.TILE_SIZE);
        for (const userId of this.getOrganizedPlayers()) {
            y++;
            const player = this.state.players[userId];
            // Define helper for resetting the text color
            const resetTextColor = () => {
                if (player.knockedOut) {
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
            const leftTextWidth = 1.5 * DungeonCrawler.TILE_SIZE;
            c2.fillText(this.getPlayerLocationString(userId), leftTextX, textY, leftTextWidth);
            // Set the text to blue just for the points if there's a multiplier
            if (this.getPlayerMultiplier(userId)) {
                c2.fillStyle = 'blue';
            }
            // Draw the points
            const middleTextX = leftTextX + leftTextWidth + MARGIN;
            const middleTextWidth = 1.25 * DungeonCrawler.TILE_SIZE;
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
            const leftTextWidth = 1.5 * DungeonCrawler.TILE_SIZE;
            c2.fillText(actionName, leftTextX, textY, leftTextWidth);
            // Draw the cost
            const middleTextX = leftTextX + leftTextWidth + MARGIN;
            const middleTextWidth = 0.75 * DungeonCrawler.TILE_SIZE;
            c2.fillText(`${cost}`, middleTextX, textY, middleTextWidth);
            // Draw the description
            const rightTextX = middleTextX + middleTextWidth + MARGIN;
            const rightTextWidth = TOTAL_WIDTH - rightTextX;
            c2.fillText(description, rightTextX, textY, rightTextWidth);
        }

        return masterImage.toBuffer();
    }

    private fillTextOnTile(context: NodeCanvasRenderingContext2D, text: string, r: number, c: number): void {
        const width = context.measureText(text).width;
        const baseX = c * DungeonCrawler.TILE_SIZE;
        const horizontalMargin = (DungeonCrawler.TILE_SIZE - width) / 2;
        const ascent = context.measureText(text).actualBoundingBoxAscent;
        const baseY = r * DungeonCrawler.TILE_SIZE;
        const verticalMargin = (DungeonCrawler.TILE_SIZE - ascent) / 2;
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
                radius: randInt(Math.floor(DungeonCrawler.TILE_SIZE * minRadius), Math.floor(DungeonCrawler.TILE_SIZE * maxRadius))
            });
        }

        const baseX = (c + 0.5) * DungeonCrawler.TILE_SIZE;
        const baseY = (r + 0.5) * DungeonCrawler.TILE_SIZE;

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

    private async renderPlayerDecision(context: canvas.CanvasRenderingContext2D, userId: Snowflake) {
        const player = this.state.players[userId];
        const decisions: string[] = this.state.decisions[userId] ?? [];
        const tempLocation = { r: player.r, c: player.c };
        const locations = DungeonCrawler.getSequenceOfLocations(tempLocation, decisions as ActionName[]);
        context.strokeStyle = 'red';
        context.lineWidth = 2;
        context.setLineDash([Math.floor(DungeonCrawler.TILE_SIZE * .25), Math.floor(DungeonCrawler.TILE_SIZE * .25)]);
        for (let i = 1; i < locations.length; i++) {
            const prev = locations[i - 1];
            const curr = locations[i];
            context.beginPath();
            context.moveTo((prev.c + .5) * DungeonCrawler.TILE_SIZE, (prev.r + .5) * DungeonCrawler.TILE_SIZE);
            context.lineTo((curr.c + .5) * DungeonCrawler.TILE_SIZE, (curr.r + .5) * DungeonCrawler.TILE_SIZE);
            context.stroke();
            // Show the final location
            if (i === locations.length - 1) {
                context.setLineDash([]);
                context.beginPath();
                context.arc((curr.c + .5) * DungeonCrawler.TILE_SIZE, (curr.r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE / 2 + 1, 0, Math.PI * 2, false);
                context.stroke();
            }
        }
        // Show attempted traps
        context.font = `${DungeonCrawler.TILE_SIZE * .5}px sans-serif`;
        context.lineWidth = 1;
        context.strokeStyle = 'red';
        context.setLineDash([]);
        for (const decision of decisions.filter(d => d.startsWith('trap:'))) {
            const [ action, locationString ] = decision.split(':');
            const location = DungeonCrawler.parseLocationString(locationString);
            if (location) {
                this.fillTextOnTile(context, 'PLACE\nTRAP', location.r, location.c);
            }
        }
        for (const decision of decisions.filter(d => d.startsWith('boulder:'))) {
            const [ action, locationString ] = decision.split(':');
            const location = DungeonCrawler.parseLocationString(locationString);
            if (location) {
                this.fillTextOnTile(context, 'PLACE\nBOULDER', location.r, location.c);
            }
        }
        // Show placed traps
        context.lineWidth = 1;
        context.strokeStyle = 'black';
        context.setLineDash([Math.floor(DungeonCrawler.TILE_SIZE * .1), Math.floor(DungeonCrawler.TILE_SIZE * .1)]);
        for (const location of this.getHiddenTrapsForPlayer(userId)) {
            context.beginPath();
            context.arc((location.c + .5) * DungeonCrawler.TILE_SIZE, (location.r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE / 4, 0, Math.PI * 2, false);
            context.stroke();
        }
        context.setLineDash([]);
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

    beginTurn(): void {
        // Increment turn and reset action counter
        this.state.turn++;
        this.state.action = 0;
        this.state.decisions = {};

        // Refresh all player ranks
        this.refreshPlayerRanks();

        // If at least player has completed the maze, enable "home stretch" mode
        if (!this.state.homeStretch && this.getNumWinners() > 0) {
            this.state.homeStretch = true;
        }

        for (const userId of this.getPlayers()) {
            const player = this.state.players[userId];
            // Reset per-turn metadata and statuses
            delete player.previousLocations;
            player.originLocation = { r: player.r, c: player.c };
            delete player.itemOffers;
            delete player.knockedOut;
            delete player.invincible;
            delete player.warped;
            delete player.showHeavyMovementLine;
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
                const actions: string[] = this.getNextActionsTowardGoal(userId, Math.floor(player.points));
                if (actions.length > 0) {
                    this.state.decisions[userId] = actions;
                }
            } else {
                // Otherwise, knock them out
                player.knockedOut = true;
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
    }

    getPoints(userId: Snowflake): number {
        return this.state.players[userId]?.points ?? 0;
    }

    addPoints(userId: Snowflake, points: number): void {
        if (isNaN(points)) {
            logger.log(`WARNING! Tried to award \`${points}\` points to **${this.getDisplayName(userId)}** (dungeon)`);
            return;
        }

        // Apply point multiplier (ONLY when adding positive points)
        const multiplier = (points > 0) ? this.getPlayerMultiplier(userId) : 1;

        // TODO: temp logging to see how this plays out
        if (multiplier > 1) {
            logger.log(`Adding **${points}** points to **${this.getDisplayName(userId)}** with **${multiplier}x** multiplier (dungeon)`);
        }

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
        // "Good" items are just any item that's not a trap
        const goodItems: DungeonItemName[] = ITEM_NAMES.filter(item => item !== 'trap');
        switch (type) {
            case 'submissions1':
                // For first place, let the user pick between two random "good" items
                return this.offerItems(userId, shuffle(goodItems).slice(0, 2), intro);
            case 'submissions2':
                // For second place, award a random "good" item
                return this.awardItem(userId, randChoice(...goodItems), intro);
            case 'submissions3':
            case 'streak':
            case 'nightmare':
                return this.awardItem(userId, 'trap', intro);
        }
    }

    private awardItem(userId: Snowflake, item: DungeonItemName, intro: string): string[] {
        // If player isn't in the game yet, do nothing
        if (!this.hasPlayer(userId)) {
            return [];
        }
        // Add the item to the player's state
        this.addPlayerItem(userId, item);
        const numItems = this.getPlayerItemCount(userId, item);
        // Return the notification and instructions text
        logger.log(`Awarded **${item}** to **${this.getDisplayName(userId)}**`);
        return [`${intro}, you've just been awarded a **${item}**! Your inventory now contains **${numItems}**. ${DungeonCrawler.getItemInstructions(item)}`];
    }

    private offerItems(userId: Snowflake, items: DungeonItemName[], intro: string): string[] {
        // If player isn't in the game yet, do nothing
        if (!this.hasPlayer(userId)) {
            return [];
        }
        // Add the item offers to the player's state
        const player = this.state.players[userId];
        player.itemOffers = items;
        // Return text about this
        const texts = [`${intro}, as a reward you may pick one of the follwing items: ${naturalJoin(items, { bold: true, conjunction: 'or' })}. `
            + 'DM me to claim the item of your choice! (e.g. \`claim ITEM\`). This offer is valid until Saturday morning.'];
        for (const item of items) {
            texts.push(`**${item}:** ${DungeonCrawler.getItemInstructions(item)}`);
        }
        logger.log(`Offered ${naturalJoin(items, { bold: true })} to **${this.getDisplayName(userId)}**`);
        return texts;
    }

    private static getItemInstructions(item: DungeonItemName): string {
        const itemInstructions: Record<DungeonItemName, string> = {
            trap: 'You can place a `trap` at a particular location as an action e.g. `trap:b12`. '
                + 'If a player ends their turn on a trap, they will be sent back to where they started that week\'s turn. '
                + 'Traps are invisible until triggered. You will be given **1** point each time this trap is triggered.',
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

    private getPlayerLocation(userId: string): DungeonLocation | undefined {
        if (userId in this.state.players) {
            return { r: this.state.players[userId].r, c: this.state.players[userId].c };
        }
    }

    private getPlayerLocationString(userId: string): string {
        return DungeonCrawler.getLocationString(this.state.players[userId].r, this.state.players[userId].c);
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
                const blockingUserId = this.getPlayerAtLocation(player.r + dr, player.c + dc);
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

    private addPlayerPreviousLocation(userId: Snowflake, location: DungeonLocation): void {
        if (userId in this.state.players) {
            const player = this.state.players[userId];
            player.previousLocations = [location, ...(player.previousLocations ?? [])];
        }
    }

    private static getSequenceOfLocations(initialLocation: { r: number, c: number }, actions: ActionName[]): { r: number, c: number }[] {
        const result = [initialLocation];
        let previousLocation = initialLocation;
        for (const action of actions) {
            const newLocation = DungeonCrawler.getNextLocation(previousLocation, action);
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
            return DungeonCrawler.parseLocationString(arg) ?? location;
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

    private static getInitialLocationSectional(seq: number, areaWidth: number): DungeonLocation {
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

    static create(members: GuildMember[]): DungeonCrawler {
        const map: number[][] = [];
        const keyHoleCosts: Record<string, number> = {};
        const isWall = (r, c) => {
            return r < 0 || c < 0 || r >= 41 || c >= 41 || map[r][c] !== TileType.EMPTY;
        };
        for (let r = 0; r < 41; r++) {
            map.push([]);
            for (let c = 0; c < 41; c++) {
                map[r][c] = TileType.WALL;
            }
        }


        const getEuclideanDistanceToGoal = (r: number, c: number): number => {
            return Math.sqrt(Math.pow(20 - r, 2) + Math.pow(20 - c, 2));
        }
        const step = (r, c, prev: [number, number]) => {
            map[r][c] = 0;
            const l = shuffle(DungeonCrawler.getCardinalOffsets(2));
            let pick = 0;
            while (l.length > 0) {
                const [dr, dc] = l.shift() as [number, number];
                // If looking in the same direction we just came from, skip this direction and come to it last
                if (prev[0] === dr && prev[1] === dc && chance(0.5)) {
                    l.push([dr, dc]);
                    continue;
                }
                pick++;
                const nr = r + dr;
                const nc = c + dc;
                const hnr = r + (dr / 2);
                const hnc = c + (dc / 2);
                // const dist = Math.sqrt(Math.pow(hnr - 20, 2) + Math.pow(hnc - 20, 2)) / 41;
                if (nr >= 0 && nc >= 0 && nr < 41 && nc < 41) {
                    if (map[nr][nc] === TileType.WALL) {
                        map[hnr][hnc] = TileType.EMPTY;
                        step(nr, nc, [dr, dc]);
                    } else if (map[hnr][hnc] === TileType.WALL) {
                        const location = DungeonCrawler.getLocationString(hnr, hnc);
                        const distance = getEuclideanDistanceToGoal(hnr, hnc);
                        // If there's a wall between here and the next spot...
                        if ((r === 0 || c === 0 || r === 40 || c === 40) && chance(0.25)) {
                            // If the current spot is on the edge, clear walls liberally
                            map[hnr][hnc] = TileType.EMPTY;
                        } else if (distance < 20) {
                            if (chance(.02)) {
                                // With an even smaller chance, clear this wall
                                map[hnr][hnc] = TileType.EMPTY;
                            }
                            // In the mid-ring of the map, add keyholes somewhat liberally
                            else if (distance < 7) {
                                if (chance(.3)) {
                                    map[hnr][hnc] = TileType.KEY_HOLE;
                                    keyHoleCosts[location] = Math.max(randInt(1, 16), randInt(1, 16));
                                }
                            } else if (distance < 16) {
                                if (chance(.075)) {
                                    map[hnr][hnc] = TileType.KEY_HOLE;
                                    keyHoleCosts[location] = randInt(1, 16, 2);
                                }
                            } else {
                                if (chance(.25)) {
                                    map[hnr][hnc] = TileType.KEY_HOLE;
                                    keyHoleCosts[location] = Math.min(randInt(1, 16), randInt(1, 16));
                                }
                            }
                        }
                    }
                }
            }
        };
        step(20, 20, [0, 0]);
        for (let r = 19; r < 22; r++) {
            for (let c = 19; c < 22; c++) {
                if (isWall(r, c)) {
                    map[r][c] = TileType.EMPTY;
                }
            }
        }
        // Remove single dots, replace with chests (if not near the border)
        for (let r = 0; r < 41; r++) {
            for (let c = 0; c < 41; c++) {
                if (isWall(r, c) && !isWall(r + 1, c) && !isWall(r - 1, c) && !isWall(r, c + 1) && !isWall(r, c - 1)) {
                    if (r > 1 && c > 1 && r < 39 && c < 39) {
                        map[r][c] = TileType.EMPTY;
                        // TODO: Actually make these chests next season when I figure out how items and stuff work
                        // map[r][c] = TileType.CHEST;
                    } else {
                        map[r][c] = TileType.EMPTY;
                    }
                }
            }
        }
        const players: Record<Snowflake, DungeonPlayerState> = {};
        for (let j = 0; j < members.length; j++) {
            const member = members[j];
            const [ r, c ] = DungeonCrawler.getInitialLocationRadialV2(j, 41, 41);
            players[member.id] = {
                r,
                c,
                rank: j + 1,
                avatarUrl: member.user.displayAvatarURL({ size: 32, extension: 'png' }),
                displayName: member.displayName,
                points: DungeonCrawler.STARTER_POINTS
            };
        }
        const dungeon = new DungeonCrawler({
            type: 'DUNGEON_GAME_STATE',
            decisions: {},
            turn: 0,
            winners: [],
            action: 0,
            rows: 41,
            columns: 41,
            map,
            goal: { r: 20, c: 20 },
            keyHoleCosts,
            trapOwners: {},
            players
        });
        dungeon.refreshPlayerRanks();

        return dungeon;
    }

    private static createSection(rows: number, columns: number, entrance: DungeonLocation, exit: DungeonLocation): { map: TileType[][], keyHoleCosts: Record<string, number> } {
        // Initialize the map
        const map: number[][] = [];
        for (let r = 0; r < rows; r++) {
            map.push([]);
            for (let c = 0; c < columns; c++) {
                map[r][c] = TileType.WALL;
            }
        }
        const keyHoleCosts = {};

        const getEuclideanDistanceFromCenter = (r: number, c: number): number => {
            return Math.sqrt(Math.pow((rows / 2) - r, 2) + Math.pow((columns / 2) - c, 2));
        }

        const step = (r, c, prev: [number, number]) => {
            map[r][c] = 0;
            const l = shuffle(DungeonCrawler.getCardinalOffsets(2));
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
                if (nr >= 0 && nc >= 0 && nr < rows && nc < columns) {
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
                                map[hnr][hnc] = TileType.KEY_HOLE;
                                // Make the cost more severe near the center of the section
                                const distanceFromCenter = getEuclideanDistanceFromCenter(hnr, hnc);
                                const sectionWidth = Math.min(rows, columns);
                                if (distanceFromCenter < 0.25 * sectionWidth) {
                                    keyHoleCosts[DungeonCrawler.getLocationString(hnr, hnc)] = Math.max(randInt(1, 16), randInt(1, 16), randInt(1, 16));
                                } else if (distanceFromCenter < 0.4 * sectionWidth) {
                                    keyHoleCosts[DungeonCrawler.getLocationString(hnr, hnc)] = Math.max(randInt(1, 16), randInt(1, 16));
                                } else {
                                    keyHoleCosts[DungeonCrawler.getLocationString(hnr, hnc)] = randInt(1, 16);
                                }
                            }
                        }
                    }
                }
            }
        };

        step(entrance.r, entrance.c, [-1, -1]);

        return { map, keyHoleCosts };
    }

    static createSectional(members: GuildMember[], options: { sectionSize: number, sectionsAcross: number }): DungeonCrawler {
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
        const keyHoleCosts = {};

        const placeKeyHole = (_r: number, _c: number, cost: number) => {
            map[_r][_c] = TileType.KEY_HOLE;
            keyHoleCosts[DungeonCrawler.getLocationString(_r, _c)] = cost;
        };

        // Create the sections
        let goal = { r: rows - 1, c: columns - 1 };
        for (let sr = 0; sr < options.sectionsAcross; sr++) {
            for (let sc = 0; sc < options.sectionsAcross; sc++) {
                const section = DungeonCrawler.createSection(options.sectionSize,
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
                // Transform and apply each keyhole cost
                for (const keyHoleLocation of Object.keys(section.keyHoleCosts)) {
                    const { r: keyR, c: keyC } = DungeonCrawler.parseLocationString(keyHoleLocation) as DungeonLocation;
                    const transformedLocation = DungeonCrawler.getLocationString(keyR + baseR, keyC + baseC);
                    keyHoleCosts[transformedLocation] = section.keyHoleCosts[keyHoleLocation];
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
                            placeKeyHole(baseR, baseC + options.sectionSize, randomCost);
                        } else {
                            map[baseR][baseC + options.sectionSize] = TileType.EMPTY;
                            placeKeyHole(baseR + options.sectionSize - 1, baseC + options.sectionSize, randomCost);
                        }
                    } else {
                        if (evenColumn) {
                            map[baseR + options.sectionSize - 1][baseC - 1] = TileType.EMPTY;
                            placeKeyHole(baseR, baseC - 1, randomCost);
                        } else {
                            map[baseR][baseC - 1] = TileType.EMPTY;
                            placeKeyHole(baseR + options.sectionSize - 1, baseC - 1, randomCost);
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

        // Initialize players
        const players: Record<Snowflake, DungeonPlayerState> = {};
        for (let j = 0; j < members.length; j++) {
            const member = members[j];
            const { r, c } = DungeonCrawler.getInitialLocationSectional(j, spawnWidth);
            players[member.id] = {
                r,
                c,
                rank: j + 1,
                avatarUrl: member.user.displayAvatarURL({ size: 32, extension: 'png' }),
                displayName: member.displayName,
                points: DungeonCrawler.STARTER_POINTS
            };
        }

        const dungeon = new DungeonCrawler({
            type: 'DUNGEON_GAME_STATE',
            decisions: {},
            turn: 0,
            winners: [],
            action: 0,
            rows,
            columns,
            map,
            goal,
            keyHoleCosts,
            trapOwners: {},
            players
        });
        dungeon.refreshPlayerRanks();

        return dungeon;
    }

    static createBest(members: GuildMember[], attempts: number, minSteps: number = 0): DungeonCrawler {
        let maxFairness = { fairness: 0 };
        let bestMap: DungeonCrawler | null = null;
        let validAttempts = 0;
        while (validAttempts < attempts) {
            const newDungeon = DungeonCrawler.create(members);
            const fairness = newDungeon.getMapFairness();
            if (fairness.min >= minSteps) {
                validAttempts++;
                if (fairness.fairness > maxFairness.fairness) {
                    maxFairness = fairness;
                    bestMap = newDungeon;
                }
                console.log(`Attempt ${validAttempts}: ${fairness.description}`);
            }
        }
        return bestMap as DungeonCrawler;
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
        return t === TileType.EMPTY || t === TileType.OPENED_KEY_HOLE || t === TileType.CHEST || t === TileType.HIDDEN_TRAP || t === TileType.TRAP || t === TileType.COIN;
    }

    private isSealable(r: number, c: number): boolean {
        return this.isTileType(r, c, TileType.KEY_HOLE) || this.isTileType(r, c, TileType.OPENED_KEY_HOLE);
    }

    private isPlaceable(r: number, c: number): boolean {
        // Users can only place tiles over empty spots, hidden traps, or coins
        return this.isTileType(r, c, TileType.EMPTY) || this.isTileType(r, c, TileType.HIDDEN_TRAP) || this.isTileType(r, c, TileType.COIN);
    }

    /**
     * @returns True if this location is adjacent to a locked doorway, an unlocked doorway, or a sealed doorway.
     */
    private isNextToDoorway(location: DungeonLocation): boolean {
        for (const { r, c } of this.getAdjacentLocations(location)) {
            if (this.isInBounds(r, c) && (DungeonCrawler.getLocationString(r, c) in this.state.keyHoleCosts)) {
                return true;
            }
        }
        return false;
    }

    /**
     * @returns True if this location is a locked doorway, an unlocked doorway, or a sealed doorway.
     */
    private isDoorway(location: DungeonLocation): boolean {
        return this.isInBounds(location.r, location.c) && (DungeonCrawler.getLocationString(location.r, location.c) in this.state.keyHoleCosts);
    }

    private isCloudy(r: number, c: number): boolean {
        return this.isTileType(r, c, TileType.WALL) || this.isTileType(r, c, TileType.KEY_HOLE) || this.isTileType(r, c, TileType.OPENED_KEY_HOLE);
    }

    private getHiddenTrapsForPlayer(userId: Snowflake): { r: number, c: number }[] {
        const locations: DungeonLocation[] = [];
        for (const [locationString, ownerId] of Object.entries(this.state.trapOwners)) {
            if (ownerId === userId) {
                const location = DungeonCrawler.parseLocationString(locationString);
                if (location && this.isTileType(location.r, location.c, TileType.HIDDEN_TRAP)) {
                    locations.push(location);
                }
            }
        }
        return locations;
    }

    /**
     * @returns an unfinished player at the given location, else undefined if no player exists at this location
     */
    private getPlayerAtLocation(r: number, c: number): Snowflake | undefined {
        // Exclude players who've already finished (since they effectively don't have a location)
        for (const userId of this.getUnfinishedPlayers()) {
            const player = this.state.players[userId];
            if (player.r === r && player.c === c) {
                return userId;
            }
        }
    }

    /**
     * @returns all unfinished players at the given location
     */
    private getPlayersAtLocation(location: DungeonLocation): Snowflake[] {
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

    private isPlayerAtLocation(location: DungeonLocation): boolean {
        return this.getPlayerAtLocation(location.r, location.c) !== undefined;
    }

    getWeeklyDecisionDMs(): Record<Snowflake, string> {
        const results: Record<Snowflake, string> = {};
        for (const userId of this.getPlayers()) {
            // If the player has at least 1 of any item, construct a string informing them of their inventory
            if (this.playerHasAnyItem(userId)) {
                const items = this.getPlayerItems(userId);
                results[userId] = 'Good morning! Reminder: your inventory contains '
                    + naturalJoin(Object.keys(items).map(item => items[item] === 1 ? `a **${item}**` : `${items[item]} **${item}s**`));
            }
        }
        return results;
    }

    addPlayerDecision(userId: Snowflake, text: string): string {
        const commands: string[] = text.replace(/\s+/g, ' ').trim().split(' ').map(c => c.toLowerCase());
        const warnings: string[] = [];

        const player = this.state.players[userId];
        const newLocation = { r: player.r, c: player.c };
        const playerPoints: number = player.points;
        let cost: number = 0;

        // Abort if the user has negative points
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

        // Ensure that finished players can only trap
        if (player.finished && !commands.every(c => c.startsWith('trap'))) {
            throw new Error('You\'ve already finished, the only action you can take now is to place traps')
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
                .map(l => DungeonCrawler.parseLocationString(l) as DungeonLocation);
            if (!this.canAllPlayersReachGoal(boulderLocations)) {
                throw new Error('You can\'t place a boulder in a location that would permanently trap players! Please pick another location...');
            }
        }

        const validateDoorwayAction = (targetLocation: DungeonLocation | undefined, action: ActionName) => {
            const newLocationString: string = DungeonCrawler.getLocationString(newLocation.r, newLocation.c);
            // If there's a target location, validate that the target is a doorway and that it's adjacent to the current location
            if (targetLocation) {
                const targetLocationString: string = DungeonCrawler.getLocationString(targetLocation.r, targetLocation.c);
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
            if (this.isTileType(nr, nc, TileType.KEY_HOLE)) {
                newLocation.r += dr;
                newLocation.c += dc;
                warnings.push(`Doorway at **${DungeonCrawler.getLocationString(nr, nc)}** must be unlocked, whether by you or someone else.`);
            } else if (this.isWalkable(nr, nc)) {
                newLocation.r += dr;
                newLocation.c += dc;
            } else {
                throw new Error('You cannot move there!');
            }
        };

        for (const command of commands) {
            const [c, arg] = command.split(':') as [ActionName, string];
            const argLocation: DungeonLocation | undefined = DungeonCrawler.parseLocationString(arg);
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
                    warnings.push(`Doorways are halved in cost when unlocked, so subsequent actions taken on a doorway you unlock will be cheaper.`);
                    break;
                case 'lock':
                    validateDoorwayAction(argLocation, 'lock');
                    warnings.push(`Doorways are halved in cost when unlocked, so you may end up spending fewer points than expected.`);
                    break;
                case 'seal':
                    validateDoorwayAction(argLocation, 'seal');
                    // Ensure this action wouldn't softlock anyone
                    for (const { r, c } of this.getAdjacentLocationsOrOverride(newLocation, argLocation)) {
                        const sealableLocations: DungeonLocation[] = [];
                        if (this.isSealable(r, c)) {
                            sealableLocations.push({ r, c })
                        }
                        if (!this.canAllPlayersReachGoal(sealableLocations)) {
                            throw new Error(`Using "seal" at **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}** would cause some players to become permanently trapped!`);
                        }
                    }
                    break;
                case 'trap':
                case 'boulder':
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
                            throw new Error(`You can't charge to **${arg}**, as obstacle at **${DungeonCrawler.getLocationString(intermediateLocation.r, intermediateLocation.c)}** is in the way!`);
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

        if (cost > playerPoints) {
            throw new Error(`You can't afford these actions. It would cost **${cost}** points, yet you only have **${Math.floor(playerPoints)}**.`);
        }

        this.state.decisions[userId] = commands;
        return `Valid actions, your new location will be **${isWarping ? '???' : DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}**. `
            + `This will consume **${cost}** of your **${Math.floor(playerPoints)}** points if successful. `
            + (warnings.length > 0 ? ' BUT PLEASE NOTE THE FOLLOWING WARNINGS:\n' + warnings.join('\n') : '');
    }

    private getActionCost(action: ActionName, location?: DungeonLocation, arg?: string): number {
        const argLocation: DungeonLocation | undefined = arg ? DungeonCrawler.parseLocationString(arg) : undefined;
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
                    if (this.isTileType(r, c, TileType.KEY_HOLE)) {
                        cost += this.state.keyHoleCosts[DungeonCrawler.getLocationString(r, c)];
                    }
                }
                return cost;
            },
            'lock': () => {
                let cost = 0;
                for (const { r, c } of this.getAdjacentLocationsOrOverride(location, argLocation)) {
                    if (this.isTileType(r, c, TileType.OPENED_KEY_HOLE)) {
                        cost += this.state.keyHoleCosts[DungeonCrawler.getLocationString(r, c)];
                    }
                }
                return cost;
            },
            'punch': () => {
                return 2;
            },
            'warp': () => {
                return Math.ceil(this.getTurn() / 2);
            }
        };
        if (action in actionCosts) {
            return actionCosts[action]();
        }
        // Emergency fallback, invalid actions should be handled elsewhere
        return 0;
    }

    processPlayerDecisions(): DecisionProcessingResult {
        // Delete all previous locations for all players (this is not done in the inner method since we want to show long paths for multiple consecutive actions)
        for (const userId of this.getPlayers()) {
            delete this.state.players[userId].previousLocations;
            delete this.state.players[userId].showHeavyMovementLine;
        }

        // Process one action for each player, and repeat so long as the inner method says it's ok
        const summaries: string[] = [];
        let processingResult: DecisionProcessingResult & { continueImmediately: boolean };
        do {
           processingResult = this.processPlayerDecisionsOnce();
           summaries.push(processingResult.summary);
        } while (processingResult.continueProcessing && processingResult.continueImmediately);

        // If more than one action was processed for each player, collapse action summaries to reduce redundant messages (e.g. "___ took a step")
        if (summaries.length === 1) {
            return processingResult;
        } else {
            return {
                summary: collapseRedundantStrings(summaries, (s, n) => n > 1 ? `${s} _(x${n})_` : s).join('\n'),
                continueProcessing: processingResult.continueProcessing
            };
        }
    }

    /**
     * Process exactly one action for each player. Return extra information about whether we can run this procedure again with no delay.
     */
    processPlayerDecisionsOnce(): DecisionProcessingResult & { continueImmediately: boolean } {
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
        const bumpers: Record<Snowflake, Snowflake> = {};
        // Process one decision from each player
        let numPlayersProcessed: number = 0;
        for (const userId of this.getDecisionShuffledPlayers()) {
            const player = this.state.players[userId];
            if (this.hasPendingDecisions(userId)) {
                numPlayersProcessed++;
                let endTurn = false;
                const processStep = (dr: number, dc: number): boolean => {
                    this.addPlayerPreviousLocation(userId, { r: player.r, c: player.c });
                    const nr = player.r + dr;
                    const nc = player.c + dc;
                    // Handle situations where another user is standing in the way
                    const blockingUserId: Snowflake | undefined = this.getPlayerAtLocation(nr, nc);
                    if (blockingUserId) {
                        const blockingUser = this.state.players[blockingUserId];
                        if (player.invincible && !blockingUser.invincible) {
                            // If this player is invincible and the other isn't, knock them out and continue walking
                            blockingUser.knockedOut = true;
                            pushNonCollapsableStatement(`**${player.displayName}** trampled **${blockingUser.displayName}**`)
                        } else {
                            // Otherwise, handle the blocking user as normal
                            bumpers[userId] = blockingUserId;
                            if (bumpers[blockingUserId] === userId) {
                                // If the other user previously bumped into this user, then allow him to pass by
                                pushNonCollapsableStatement(`**${player.displayName}** walked past **${blockingUser.displayName}**`);
                            } else if (blockingUser.knockedOut) {
                                // If the other user is knocked out, walk past him
                                pushNonCollapsableStatement(`**${player.displayName}** stepped over the knocked-out body of **${blockingUser.displayName}**`);
                            } else {
                                // Otherwise, refuse to move
                                if (this.hasPendingDecisions(blockingUserId)) {
                                    pushNonCollapsableStatement(`**${player.displayName}** bumped into someone`);
                                } else {
                                    summaryData.consecutiveBumpGoners.push(userId);
                                    endTurn = true;
                                }
                                return false;
                            }
                        }
                    }
                    // If the logic hasn't returned by now, then attempt to walk to the new location
                    if (this.isWalkable(nr, nc)) {
                        player.r += dr;
                        player.c += dc;
                        summaryData.consecutiveStepUsers.push(player.displayName);
                        return true;
                    }
                    pushNonCollapsableStatement(`**${player.displayName}** walked into a wall and gave up`);
                    endTurn = true;
                    return false;
                };
                const doUnlock = (arg: string): number => {
                    const argLocation: DungeonLocation| undefined = DungeonCrawler.parseLocationString(arg);
                    let numDoorwaysUnlocked = 0;
                    for (const { r, c } of this.getAdjacentLocationsOrOverride({ r: player.r, c: player.c }, argLocation)) {
                        if (this.isTileType(r, c, TileType.KEY_HOLE)) {
                            this.state.map[r][c] = TileType.OPENED_KEY_HOLE;
                            numDoorwaysUnlocked++;
                            // Halve the cost of the doorway (bottoms out at 1)
                            const locationString = DungeonCrawler.getLocationString(r, c);
                            this.state.keyHoleCosts[locationString] = Math.max(1, Math.floor(this.state.keyHoleCosts[locationString] / 2));
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
                        const argLocation: DungeonLocation | undefined = DungeonCrawler.parseLocationString(arg);
                        let numDoorwaysLocked = 0;
                        for (const { r, c } of this.getAdjacentLocationsOrOverride({ r: player.r, c: player.c }, argLocation)) {
                            if (this.isTileType(r, c, TileType.OPENED_KEY_HOLE)) {
                                this.state.map[r][c] = TileType.KEY_HOLE;
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
                        for (const { r, c } of this.getAdjacentLocations({ r: player.r, c: player.c })) {
                            const otherPlayerId = this.getPlayerAtLocation(r, c);
                            if (otherPlayerId) {
                                nearPlayer = true;
                                const otherPlayer = this.state.players[otherPlayerId];
                                if (otherPlayer.invincible) {
                                    pushNonCollapsableStatement(`**${player.displayName}** threw fists at the invincible **${otherPlayer.displayName}** to no avail`);
                                } else if (chance(0.75)) {
                                    otherPlayer.knockedOut = true;
                                    pushNonCollapsableStatement(`**${player.displayName}** knocked out **${otherPlayer.displayName}**`);
                                } else {
                                    pushNonCollapsableStatement(`**${player.displayName}** tried to punch **${otherPlayer.displayName}** and missed`);
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
                            player.knockedOut = true;
                            endTurn = true;
                            pushNonCollapsableStatement(`**${player.displayName}** tried to warp but forgot to jump into the wormhole because he was watching webMs`);
                            return false;
                        }
                        const { r: newR, c: newC, userId: nearUserId } = warpableLocation;
                        const isFirstWarp: boolean = !player.warped;
                        const isCloser: boolean = this.approximateCostToGoal(newR, newC) < this.approximateCostToGoal(player.r, player.c);
                        // If it's the user's first warp of the turn or the warp is closer to the goal, do it
                        if (isFirstWarp || isCloser) {
                            this.addPlayerPreviousLocation(userId, { r: player.r, c: player.c });
                            player.r = newR;
                            player.c = newC;
                            player.warped = true;
                            player.showHeavyMovementLine = true;
                            pushNonCollapsableStatement(`**${player.displayName}** warped to **${this.getDisplayName(nearUserId)}**`);
                        } else {
                            pushNonCollapsableStatement(`**${player.displayName}** avoided warping to **${this.getDisplayName(nearUserId)}**`);
                        }
                        return true;
                    },
                    trap: (arg) => {
                        const targetLocation = DungeonCrawler.parseLocationString(arg);
                        // Emergency fallback (this shouldn't happen)
                        if (!targetLocation) {
                            player.knockedOut = true;
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
                        const targetLocation = DungeonCrawler.parseLocationString(arg);
                        // Emergency fallback (this shouldn't happen)
                        if (!targetLocation) {
                            player.knockedOut = true;
                            endTurn = true;
                            pushNonCollapsableStatement(`**${player.displayName}** tried to place a boulder but the boulder disintegrated in his hands`);
                            return false;
                        }
                        // If doing this will softlock the game, knock out the player
                        if (!this.canAllPlayersReachGoal([targetLocation])) {
                            player.knockedOut = true;
                            endTurn = true;
                            pushNonCollapsableStatement(`**${player.displayName}** got knocked out trying to softlock the game (tried to place boulder at **${DungeonCrawler.getLocationString(targetLocation.r, targetLocation.c)}**)`);
                            return false;
                        }
                        // Otherwise, place the boulder
                        this.state.map[targetLocation.r][targetLocation.c] = TileType.BOULDER;
                        this.consumePlayerItem(userId, 'boulder');
                        pushNonCollapsableStatement(`**${player.displayName}** placed a boulder at **${DungeonCrawler.getLocationString(targetLocation.r, targetLocation.c)}**`);
                        return true;
                    },
                    seal: (arg) => {
                        const argLocation: DungeonLocation | undefined = DungeonCrawler.parseLocationString(arg);
                        const sealableLocations = this.getAdjacentLocationsOrOverride({ r: player.r, c: player.c }, argLocation).filter(l => this.isSealable(l.r, l.c));
                        // If doing this will softlock the game, knock out the player
                        if (!this.canAllPlayersReachGoal(sealableLocations)) {
                            player.knockedOut = true;
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
                        const argLocation: DungeonLocation | undefined = DungeonCrawler.parseLocationString(arg);
                        // Emergency fallback (this shouldn't happen)
                        if (!argLocation) {
                            player.knockedOut = true;
                            endTurn = true;
                            pushNonCollapsableStatement(`**${player.displayName}** tried to charge like a madman but accidentally gave himself AIDS`);
                            return false;
                        }
                        const direction = DungeonCrawler.getDirectionTo({ r: player.r, c: player.c }, argLocation);
                        const intermediateLocations = this.getLocationsBetween({ r: player.r, c: player.c }, argLocation);
                        this.consumePlayerItem(userId, 'charge');
                        this.addPlayerPreviousLocation(userId, { r: player.r, c: player.c });
                        player.showHeavyMovementLine = true;
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
                                pushNonCollapsableStatement(getChargeText(true));
                                player.knockedOut = true;
                                return true;
                            }
                            // Trample all other players in this location
                            const playersAtLocation = this.getPlayersAtLocation({ r: player.r, c: player.c });
                            for (const otherPlayerId of playersAtLocation) {
                                if (otherPlayerId !== userId) {
                                    const otherPlayer = this.state.players[otherPlayerId];
                                    otherPlayer.knockedOut = true;
                                    trampledPlayers.push(otherPlayerId);
                                }
                            }
                            // Move to the new location
                            player.r = intermediateLocation.r;
                            player.c = intermediateLocation.c;
                            spacesMoved++;
                        }
                        pushNonCollapsableStatement(getChargeText(false));
                        return true;
                    }
                };

                // This player is knocked out yet still has pending decisions (likely knocked out by another player), thus we need to end their turn.
                // We can't let players wipe the decisions of other players because we need to process turn-end logic for all players (e.g. punching another player, then letting them trigger a trap)
                if (player.knockedOut) {
                    endTurn = true;
                }

                // Unless this player's turn should end, process their next action
                if (!endTurn) {
                    // Get the next action for this user
                    const nextAction = this.state.decisions[userId][0];
                    const [actionName, actionArg] = nextAction.toLowerCase().split(':') as [ActionName, string];

                    // If the player can't afford this action, delete all their decisions (ending their turn)
                    const actionCost: number = this.getActionCost(actionName, { r: player.r, c: player.c }, actionArg);
                    if (actionCost > player.points) {
                        delete this.state.decisions[userId];
                        pushNonCollapsableStatement(`**${player.displayName}** ran out of action points`);
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
                    if (!player.finished && this.isGoal(player.r, player.c)) {
                        // Mark the player as finished
                        player.finished = true;
                        // Add to list of finished players
                        this.addWinner(userId);
                        // Add to log and end the turn
                        pushNonCollapsableStatement(`**${this.getDisplayName(userId)}** reached the goal for _${getRankString(this.state.winners.length)} place_`)
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
                        player.knockedOut = true;
                    }
                    // Handle hidden traps if not invincible
                    if (!player.invincible) {
                        let trapRevealed = false;
                        const locationString = DungeonCrawler.getLocationString(player.r, player.c);
                        if (this.getTileAtUser(userId) === TileType.HIDDEN_TRAP) {
                            this.state.map[player.r][player.c] = TileType.TRAP;
                            trapRevealed = true;
                            const trapOwnerId = this.state.trapOwners[locationString];
                            pushNonCollapsableStatement(`**${player.displayName}** revealed a hidden trap placed by **${this.getDisplayName(trapOwnerId)}**`);
                        }
                        // Handle revealed traps (this will trigger if the above condition is triggered)
                        if (this.getTileAtUser(userId) === TileType.TRAP) {
                            player.previousLocations = [{ r: player.r, c: player.c }];
                            player.showHeavyMovementLine = true;
                            if (player.originLocation) {
                                player.r = player.originLocation.r;
                                player.c = player.originLocation.c;
                            } else {
                                logger.log(`Unable to send \`${userId}\` back to origin location (it doesn't exist!)`);
                            }
                            player.knockedOut = true;
                            const trapOwnerId = this.state.trapOwners[locationString];
                            logger.log(`\`${userId}\` triggered trap by \`${trapOwnerId}\` at \`${locationString}\``);
                            if (trapRevealed) {
                                pushNonCollapsableStatement(`was sent back to **${this.getPlayerLocationString(userId)}**`);
                            } else {
                                pushNonCollapsableStatement(`**${player.displayName}** stepped on **${this.getDisplayName(trapOwnerId)}'s** trap and was sent back to **${this.getPlayerLocationString(userId)}**`);
                            }
                            // Reward the trap's owner
                            this.addPoints(trapOwnerId, 1);
                            pushNonCollapsableStatement(`**${this.getDisplayName(trapOwnerId)}** earned **1** point for trapping`);
                        }
                    }
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
            summary: naturalJoin(summaryData.statements, { conjunction: 'then' }) || 'Dogs sat around with their hands in their pockets...',
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
                    return this.awardItem(userId, claimedItem as DungeonItemName, 'Nice choice');
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
     * The actions are determined using a naive search (ignore keyholes).
     */
    getNextActionsTowardGoal(userId: Snowflake, n: number = 1): string[] {
        if (!this.hasPlayer(userId)) {
            throw new Error(`Cannot get next actions toward goal for nonexistent player \`${userId}\``);
        }
        const player = this.state.players[userId];
        // Treat player-occupied tiles as very costly to create more distributed pathing
        return this.searchToGoal(player.r, player.c, { addedOccupiedTileCost: 4 }).semanticSteps.slice(0, n);
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

    search(start: DungeonLocation, goal: DungeonLocation, options?: PathingOptions) {
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
            const locationString = DungeonCrawler.getLocationString(r, c);
            if (options?.useDoorways && tile === TileType.KEY_HOLE && locationString in this.state.keyHoleCosts) {
                // Multiply keyhole cost by 2 since it's risky
                return this.state.keyHoleCosts[locationString] * 2;
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

    private static getNormalizedOffsetTo(from: DungeonLocation, to: DungeonLocation): [number, number] {
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

    private static getDirectionTo(from: DungeonLocation, to: DungeonLocation): Direction {
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

    private static locationEquals(a: DungeonLocation, b: DungeonLocation): boolean {
        return a.r === b.r && a.c === b.c;
    }

    private getLocationsBetween(from: DungeonLocation, to: DungeonLocation): DungeonLocation[] {
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
        const offset = DungeonCrawler.getNormalizedOffsetTo(from, to);
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
    private getAdjacentLocations(location: DungeonLocation | undefined): DungeonLocation[] {
        // Emergency fallback
        if (!location) {
            return [];
        }
        const result: DungeonLocation[] = [];
        for (const [dr, dc] of DungeonCrawler.getCardinalOffsets()) {
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
    private getAdjacentLocationsOrOverride(location: DungeonLocation | undefined, override: DungeonLocation | undefined): DungeonLocation[] {
        // Emergency fallback
        if (!location) {
            return [];
        }
        if (override) {
            return [override];
        }
        return this.getAdjacentLocations(location);
    }

    private isAdjacent(l1: DungeonLocation, l2: DungeonLocation): boolean {
        return this.getAdjacentLocations(l1).some(la => la.r === l2.r && la.c === l2.c);
    }

    getMapFairness(): { min: number, max: number, fairness: number, description: string } {
        let min = Number.MAX_SAFE_INTEGER;
        let max = -1;
        for (const userId of this.getPlayers()) {
            const cost = this.approximateCostToGoalForPlayer(userId);
            max = Math.max(max, cost);
            min = Math.min(min, cost);
        }
        return { min, max, fairness: min / max, description: `[${min}, ${max}] = ${(100 * min / max).toFixed(1)}%` };
    }

    canAllPlayersReachGoal(obstacles: DungeonLocation[] = []): boolean {
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
            if (this.isWalkable(nr, nc) && !this.getPlayerAtLocation(nr, nc) && !this.isGoal(nr, nc)) {
                return { r: nr, c: nc };
            }
        }
    }

    getAllLocations(): DungeonLocation[] {
        const results: DungeonLocation[] = [];
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
    getSpawnableLocationAroundPlayers(userIds: Snowflake[]): { r: number, c: number, userId: Snowflake } | undefined {
        // Make sure to clone it first
        const shuffledUserIds: Snowflake[] = userIds.slice();
        shuffle(shuffledUserIds);
        for (const userId of shuffledUserIds) {
            const location = this.getSpawnableLocationAroundPlayer(userId);
            if (location) {
                return { r: location.r, c: location.c, userId };
            }
        }
    }

    getRandomVacantLocationsBehindPlayer(userId: Snowflake, n: number): DungeonLocation[] {
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

        const results: DungeonLocation[] = [];
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

    getPlayerMultiplier(userId: Snowflake): number {
        return this.state.players[userId]?.multiplier ?? 1;
    }

    playerHasAnyItem(userId: Snowflake): boolean {
        return ITEM_NAMES.some(item => this.playerHasItem(userId, item));
    }

    playerHasItem(userId: Snowflake, item: DungeonItemName): boolean {
        return this.getPlayerItemCount(userId, item) > 0;
    }

    getPlayerItemCount(userId: Snowflake, item: DungeonItemName): number {
        return this.getPlayerItems(userId)[item] ?? 0;
    }

    getPlayerItems(userId: Snowflake): Partial<Record<DungeonItemName, number>> {
        return this.state.players[userId]?.items ?? {};
    }

    addPlayerItem(userId: Snowflake, item: DungeonItemName, num: number = 1): void {
        const player = this.state.players[userId];

        if (player.items === undefined) {
            player.items = {};
        }

        player.items[item] = (player.items[item] ?? 0) + num;
    }

    consumePlayerItem(userId: Snowflake, item: DungeonItemName): void {
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
}
