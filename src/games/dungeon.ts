import canvas from 'canvas';
import { GuildMember, Snowflake } from 'discord.js';
import { AStarFinder } from 'astar-typescript';
import { naturalJoin, randInt, shuffle, toLetterId } from 'evanw555.js';
import { DungeonGameState, DungeonPlayerState } from "../types";
import AbstractGame from "./abstract-game";
import logger from '../logger';

enum TileType {
    EMPTY = 0,
    WALL = 1,
    KEY_HOLE = 2,
    OPENED_KEY_HOLE = 3,
    CHEST = 4,
    HIDDEN_TRAP = 5,
    TRAP = 6
}

type ActionName = 'up' | 'down' | 'left' | 'right' | 'pause' | 'unlock' | 'lock' | 'seal' | 'trap' | 'punch' | 'warp';

export default class DungeonCrawler extends AbstractGame<DungeonGameState> {
    private static readonly TILE_SIZE: number = 24;
    private static readonly STARTER_POINTS: number = 3;

    private static readonly STYLE_SKY: string = 'hsl(217, 94%, 69%)';
    private static readonly STYLE_LIGHT_SKY: string = 'hsl(217, 85%, 75%)';
    private static readonly STYLE_CLOUD: string = 'rgba(222, 222, 222, 1)';
    private static readonly STYLE_WARP_PATH: string = 'rgba(98, 11, 212, 0.25)';

    constructor(state: DungeonGameState) {
        super(state);
    }

    getIntroductionText(): string {
        return 'My dear dogs... Welcome to the Clouded Labyrinth of the Shining Idol! '
            + 'This season, you will all be traversing this silver-lined dungeon in search of bright mornings. '
            + 'The first, second, and third pups to reach me at the center will be crowned victorious. '
            + 'Each Saturday, you will have all day to choose your moves, each costing some amount of points. '
            + 'The next day (Sunday), your moves will be performed one-by-one.';
    }

    getInstructionsText(): string {
        return 'Here are the possible actions you may take and their associated costs. Send me something like `up right unlock right pause right punch trap:b12 down`.\n'
                + '`up`, `down`, `left`, `right`: move one step in such direction. Costs `1`\n'
                + '`unlock`: open all doorways adjacent to you. Cost is denoted on each doorway\n'
                + '`lock`: close all doorways adjacent to you. Cost is denoted on each doorway\n'
                + '`seal`: permanently close all doorways adjacent to you. Cost is **twice the value** denoted on each doorway\n'
                + '`punch`: 75% chance of knocking out any player adjacent to you, ending their turn. Costs `2`\n'
                + '`trap:[LOCATION]`: place a hidden trap at the specified location (e.g. `trap:G9`). Costs `2`\n'
                + '`warp`: warp to a random player. Costs `6`\n'
                + '`pause`: do nothing. Free\n\n'
            + 'Misc Rules:\n'
                + '1. If you do not choose your actions, actions will be chosen for you (use `pause` to do nothing instead).\n'
                + '2. In a given turn, one action is processed from each player in a _random_ order until all players have no actions left.\n'
                + '3. You cannot walk over/past other players unless they are KO\'ed or you are walking into each other head-on.\n'
                + '4. Players starting their turn with negative points are KO\'ed the entire turn.\n'
                + '5. If you somehow walk into a wall, your turn is ended.\n'
                + '6. If you walk into another player, your turn is ended if they have no more actions remaining.\n'
                + '7. If your turn is ended early due to any of these reasons, you will only lose points for each action taken.\n'
                + '8. If you end your turn on a trap, the trap can now be seen and you are sent back to where you started (points are still lost).\n'
                + '9. If you warp, you will be KO\'ed so that others can walk past you.\n'
                + '10. If you warp multiple times in one turn, all subsequent warps will only go through if it brings you closer to the goal.'
    }

    isSeasonComplete(): boolean {
        return false;
    }

    hasPlayer(userId: Snowflake): boolean {
        return userId in this.state.players;
    }

    addPlayer(member: GuildMember): string {
        if (member.id in this.state.players) {
            logger.log(`Refusing to add **${member.displayName}** to the dungeon, as they're already in it!`);
            return;
        }
        // Get the worst 33% of players based on location
        const playersClosestToGoal: Snowflake[] = this.getPlayersClosestToGoal();
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
            points: lateStarterPoints,
            displayName: member.displayName,
            avatarUrl: member.user.displayAvatarURL({ size: 32, format: 'png' })
        };
        const locationText: string = spawnLocation ? `near **${this.getDisplayName(spawnLocation.userId)}**` : `at \`${DungeonCrawler.getLocationString(spawnR, spawnC)}\``;
        return `Added player **${member.displayName}** ${locationText} with **${lateStarterPoints}** starter points`;
    }

    updatePlayer(member: GuildMember): void {
        if (this.hasPlayer(member.id)) {
            const player = this.state.players[member.id];
            player.displayName = member.displayName;
            player.avatarUrl = member.user.displayAvatarURL({ size: 32, format: 'png' });
        }
    }

    async renderState(options?: { showPlayerDecision?: Snowflake, admin?: boolean }): Promise<Buffer> {
        const WIDTH: number = this.state.columns * DungeonCrawler.TILE_SIZE;
        const HEIGHT: number = this.state.rows * DungeonCrawler.TILE_SIZE;
        const c = canvas.createCanvas(WIDTH, HEIGHT);
        const context = c.getContext('2d');

        // Fill the blue sky background
        context.fillStyle = DungeonCrawler.STYLE_SKY;
        context.fillRect(0, 0, WIDTH, HEIGHT);

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
                        context.font = `${DungeonCrawler.TILE_SIZE * .7}px sans-serif`;
                        context.fillText(this.state.keyHoleCosts[DungeonCrawler.getLocationString(r, c)].toString(), (c + .25) * DungeonCrawler.TILE_SIZE, (r + .75) * DungeonCrawler.TILE_SIZE);
                        // context.fillRect((c + .4) * DungeonCrawler.TILE_SIZE, (r + .3) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE * .2, DungeonCrawler.TILE_SIZE * .4);
                    } else if (this.isTileType(r, c, TileType.OPENED_KEY_HOLE)) {
                        context.fillStyle = DungeonCrawler.STYLE_SKY;
                        if (this.isWalkable(r - 1, c) || this.isWalkable(r + 1, c)) {
                            context.fillRect((c + .1) * DungeonCrawler.TILE_SIZE, (r - .1) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE * .8, DungeonCrawler.TILE_SIZE * 1.2);
                        }
                        if (this.isWalkable(r, c - 1) || this.isWalkable(r, c + 1)) {
                            context.fillRect((c - .1) * DungeonCrawler.TILE_SIZE, (r + .1) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE * 1.2, DungeonCrawler.TILE_SIZE * .8);
                        }
                        // Draw opened key hole cost
                        context.fillStyle = DungeonCrawler.STYLE_CLOUD;
                        context.font = `${DungeonCrawler.TILE_SIZE * .7}px sans-serif`;
                        context.fillText(this.state.keyHoleCosts[DungeonCrawler.getLocationString(r, c)].toString(), (c + .25) * DungeonCrawler.TILE_SIZE, (r + .75) * DungeonCrawler.TILE_SIZE);
                    }
                } else {
                    context.fillStyle = 'black';
                }
            }
        }

        // Draw the sun at the center
        const sunImage = await canvas.loadImage('assets/sun4.png');
        context.drawImage(sunImage, (this.getGoalColumn() - .5) * DungeonCrawler.TILE_SIZE, (this.getGoalRow() - .5) * DungeonCrawler.TILE_SIZE, 2 * DungeonCrawler.TILE_SIZE, 2 * DungeonCrawler.TILE_SIZE);

        // Render all player "previous locations" before rendering the players themselves
        for (const userId of Object.keys(this.state.players)) {
            const player = this.state.players[userId];
            // Render movement line (or dashed warp line if warped)
            if (player.previousLocation) {
                if (player.warped) {
                    context.lineWidth = 4;
                    context.strokeStyle = DungeonCrawler.STYLE_WARP_PATH;
                    context.setLineDash([Math.floor(DungeonCrawler.TILE_SIZE * 0.25), Math.floor(DungeonCrawler.TILE_SIZE * 0.25)]);
                } else {
                    context.lineWidth = 2;
                    context.strokeStyle = DungeonCrawler.STYLE_LIGHT_SKY;
                    context.setLineDash([]);
                }
                context.beginPath();
                context.moveTo((player.previousLocation.c + .5) * DungeonCrawler.TILE_SIZE, (player.previousLocation.r + .5) * DungeonCrawler.TILE_SIZE);
                context.lineTo((player.c + .5) * DungeonCrawler.TILE_SIZE, (player.r + .5) * DungeonCrawler.TILE_SIZE);
                context.stroke();
            }
        }

        // Render the player's actions if enabled
        if (options?.showPlayerDecision) {
            const player = this.state.players[options.showPlayerDecision];
            const decisions: string[] = this.state.decisions[options.showPlayerDecision] ?? [];
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
            for (const decision of decisions.filter(d => d.includes('trap:'))) {
                const [ action, locationString ] = decision.split(':');
                const location = this.parseLocationString(locationString);
                context.strokeText('PLACE\nTRAP', location.c * DungeonCrawler.TILE_SIZE, (location.r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
            }
            // Show placed traps
            context.lineWidth = 1;
            context.strokeStyle = 'black';
            context.setLineDash([Math.floor(DungeonCrawler.TILE_SIZE * .1), Math.floor(DungeonCrawler.TILE_SIZE * .1)]);
            for (const location of this.getHiddenTrapsForPlayer(options.showPlayerDecision)) {
                context.beginPath();
                context.arc((location.c + .5) * DungeonCrawler.TILE_SIZE, (location.r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE / 4, 0, Math.PI * 2, false);
                context.stroke();
            }
            context.setLineDash([]);
        }

        // Render all players
        for (const userId of Object.keys(this.state.players)) {
            const player = this.state.players[userId];

            // Draw outline
            context.fillStyle = 'black';
            context.beginPath();
            context.arc((player.c + .5) * DungeonCrawler.TILE_SIZE, (player.r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE / 2 + 1, 0, Math.PI * 2, false);
            context.fill();

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
                try {
                    const avatarImage = await canvas.loadImage(player.avatarUrl);
                    context.drawImage(avatarImage, player.c * DungeonCrawler.TILE_SIZE, player.r * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
                } catch (err) {
                    logger.log(`Failed to load/draw avatar for player **${player.displayName}**`);
                }
    
                // Restore context to undo the clipping
                context.restore();
                context.globalAlpha = 1;
            } else {
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

        // Render admin stuff
        if (options?.admin) {
            // Render trap owners
            context.font = `${DungeonCrawler.TILE_SIZE * .35}px sans-serif`;
            context.fillStyle = 'black';
            for (const locationString of Object.keys(this.state.trapOwners)) {
                const location = this.parseLocationString(locationString);
                context.fillText(this.getDisplayName(this.state.trapOwners[locationString]), location.c * DungeonCrawler.TILE_SIZE, (location.r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
            }
            // Render all player decisions
            // TODO (2.0): Reuse decision rendering logic from above??
            for (const userId of Object.keys(this.state.players)) {
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

        // Render usernames in order of location
        const MARGIN = 0.5 * DungeonCrawler.TILE_SIZE;
        c2.font = `${DungeonCrawler.TILE_SIZE * .75}px sans-serif`;
        let y = 2;
        c2.fillStyle = 'white';
        const leftTextX = WIDTH + DungeonCrawler.TILE_SIZE + MARGIN;
        c2.fillText(`Turn ${this.state.turn}, Action ${this.state.action}`, leftTextX, DungeonCrawler.TILE_SIZE);
        for (const userId of this.getOrderedPlayers()) {
            y++;
            const player = this.state.players[userId];
            c2.fillStyle = player.knockedOut ? 'hsl(360,50%,55%)' : `hsl(360,0%,${y % 2 === 0 ? 85 : 55}%)`;
            const textY = y * DungeonCrawler.TILE_SIZE;
            // Draw the location
            const leftTextWidth = 1.5 * DungeonCrawler.TILE_SIZE;
            c2.fillText(this.getPlayerLocationString(userId), leftTextX, textY, leftTextWidth);
            // Draw the points
            const middleTextX = leftTextX + leftTextWidth + MARGIN;
            const middleTextWidth = 1.25 * DungeonCrawler.TILE_SIZE;
            c2.fillText(`$${player.points}`, middleTextX, textY, middleTextWidth);
            // Draw the username
            const rightTextX = middleTextX + middleTextWidth + MARGIN;
            const rightTextWidth = TOTAL_WIDTH - rightTextX;
            c2.fillText(player.displayName, rightTextX, textY, rightTextWidth);
        }

        // Write extra text on the sidebar
        y += 2;
        c2.fillStyle = 'white';
        c2.fillText('Reach me in the center to win!\nDM me "help" for help', leftTextX, y * DungeonCrawler.TILE_SIZE, TOTAL_WIDTH - leftTextX);

        // Draw potential actions
        y += 2;
        for (const [actionName, { cost, description }] of Object.entries(this.getChoices())) {
            y++;
            c2.fillStyle = `hsl(360,0%,${y % 2 === 0 ? 85 : 55}%)`;
            const textY = y * DungeonCrawler.TILE_SIZE;
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

    private getChoices(): Record<ActionName, { cost: number | string, description: string }> {
        return {
            'up': { cost: 1, description: 'Move up 1 tile' },
            'down': { cost: 1, description: 'Move down 1 tile' },
            'left': { cost: 1, description: 'Move left 1 tile' },
            'right': { cost: 1, description: 'Move right 1 tile' },
            'pause': { cost: 0, description: 'Do nothing' },
            'unlock': { cost: 'N', description: 'Open adjacent doorways' },
            'lock': { cost: 'N', description: 'Close adjacent doorways' },
            'seal': { cost: '2N', description: 'Permanently close doorways' },
            'punch': { cost: 2, description: 'Try to KO adjacent players' },
            'trap': { cost: 2, description: 'Place trap e.g. "trap:B12"' },
            'warp': { cost: 6, description: 'Warp to a random player' }
        };
    }

    getTurn(): number {
        return this.state.turn;
    }

    beginTurn(): void {
        // Increment turn and reset action counter
        this.state.turn++;
        this.state.action = 0;

        for (const userId of this.getOrderedPlayers()) {
            const player = this.state.players[userId];
            // Reset per-turn metadata and statuses
            delete player.previousLocation;
            player.originLocation = { r: player.r, c: player.c };
            delete player.knockedOut;
            delete player.warped;
            // If the user has negative points, knock them out
            if (player.points < 0 && !this.hasPendingDecisions(userId)) {
                player.knockedOut = true;
            }
            // Otherwise if player has at least one point, choose a default sequence of actions for the user
            else if (player.points >= 1) {
                const actions: string[] = this.getNextActionsTowardGoal(userId, Math.floor(player.points));
                this.state.decisions[userId] = actions;
            }
        }
    }

    getPoints(userId: Snowflake): number {
        return this.state.players[userId].points;
    }

    addPoints(userId: Snowflake, points: number): void {
        this.state.players[userId].points += points;
    }

    parseLocationString(location: string): { r: number, c: number } | undefined {
        // TODO: Horrible brute-force method, too lazy to reverse the letter stuff
        for (let r = 0; r < this.state.rows; r++) {
            for (let c = 0; c < this.state.columns; c++) {
                if (location && location.toUpperCase() === DungeonCrawler.getLocationString(r, c)) {
                    return { r, c };
                }
            }
        }
    }

    private static getLocationString(r: number, c: number): string {
        return `${toLetterId(r)}${c + 1}`;
    }

    private getPlayerLocationString(userId: string): string {
        return DungeonCrawler.getLocationString(this.state.players[userId].r, this.state.players[userId].c);
    }

    getOrderedPlayers(): Snowflake[] {
        const getLocationRank = (userId) => {
            return this.state.players[userId].r * this.state.columns + this.state.players[userId].c;
        }
        return Object.keys(this.state.players).sort((x, y) => getLocationRank(x) - getLocationRank(y));
    }

    getPlayersClosestToGoal(): Snowflake[] {
        return Object.keys(this.state.players).sort((x, y) => this.getPlayerDistanceToGoal(x) - this.getPlayerDistanceToGoal(y));
    }

    getShuffledPlayers(): Snowflake[] {
        return shuffle(Object.keys(this.state.players));
    }

    getOtherPlayers(userId: Snowflake): Snowflake[] {
        return Object.keys(this.state.players).filter(id => id !== userId);
    }

    getDisplayName(userId: Snowflake): string {
        if (userId in this.state.players) {
            return this.state.players[userId].displayName;
        }
        return userId || 'Unknown Player';
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
        } else {
            return location;
        }
    }

    private static getInitialLocation(seq: number, rows: number, cols: number): [number, number] {
        const offset = Math.floor(seq / 4);
        const corner = seq % 4;
        const corners = [[0, 0], [0, cols - 1], [rows - 1, cols - 1], [rows - 1, 0]];
        const offsets = [[0, 6], [6, 0], [0, -6], [-6, 0]];
        return [corners[corner][0] + offsets[corner][0] * offset, corners[corner][1] + offsets[corner][1] * offset];
    }

    private static getInitialLocationV2(seq: number, rows: number, cols: number): [number, number] {
        const basePositions: [number, number][] = [[0, Math.floor(cols / 2)], [Math.floor(rows / 2), cols - 1], [rows - 1, Math.floor(cols / 2)], [Math.floor(rows / 2), 0]];

        const side = seq % 4;
        const rankOnSide = Math.floor(seq / 4);
        const direction = rankOnSide % 2 === 0 ? 1 : -1;
        const magnitude = Math.floor((rankOnSide + 1) / 2);

        const offsets = [[0, 4], [4, 0], [0, -4], [-4, 0]];

        const basePosition = basePositions[side];

        return [basePosition[0] + offsets[side][0] * magnitude * direction, basePosition[1] + offsets[side][1] * magnitude * direction];
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
            const l = shuffle([[-2, 0], [2, 0], [0, -2], [0, 2]]);
            let pick = 0;
            while (l.length > 0) {
                const [dr, dc] = l.shift();
                // If looking in the same direction we just came from, skip this direction and come to it last
                if (prev[0] === dr && prev[1] === dc && Math.random() < 0.5) {
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
                        if ((r === 0 || c === 0 || r === 40 || c === 40) && Math.random() < 0.25) {
                            // If the current spot is on the edge, clear walls liberally
                            map[hnr][hnc] = TileType.EMPTY;
                        } else if (distance < 20) {
                            if (Math.random() < .02) {
                                // With an even smaller chance, clear this wall
                                map[hnr][hnc] = TileType.EMPTY;
                            }
                            // In the mid-ring of the map, add keyholes somewhat liberally
                            else if (distance < 7) {
                                if (Math.random() < .3) {
                                    map[hnr][hnc] = TileType.KEY_HOLE;
                                    keyHoleCosts[location] = Math.max(randInt(1, 10), randInt(1, 10));
                                }
                            } else if (distance < 16) {
                                if (Math.random() < .075) {
                                    map[hnr][hnc] = TileType.KEY_HOLE;
                                    keyHoleCosts[location] = Math.floor((randInt(1, 10) + randInt(1, 10)) / 2);
                                }
                            } else {
                                if (Math.random() < .25) {
                                    map[hnr][hnc] = TileType.KEY_HOLE;
                                    keyHoleCosts[location] = Math.min(randInt(1, 10), randInt(1, 10));
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
            const [ r, c ] = DungeonCrawler.getInitialLocationV2(j, 41, 41);
            players[member.id] = {
                r,
                c,
                avatarUrl: member.user.displayAvatarURL({ size: 32, format: 'png' }),
                displayName: member.displayName,
                points: DungeonCrawler.STARTER_POINTS
            };
        }
        const dungeon = new DungeonCrawler({
            type: 'DUNGEON_GAME_STATE',
            decisions: {},
            turn: 0,
            action: 0,
            rows: 41,
            columns: 41,
            map,
            keyHoleCosts,
            trapOwners: {},
            players
        });
        return dungeon;
    }

    static createBest(members: GuildMember[], attempts: number, minSteps: number = 0): DungeonCrawler {
        let maxFairness = { fairness: 0 };
        let bestMap = null;
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
        return bestMap;
    }

    private getTileAtUser(userId: Snowflake): TileType {
        const player = this.state.players[userId];
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
        return t === TileType.EMPTY || t === TileType.OPENED_KEY_HOLE || t === TileType.CHEST || t === TileType.HIDDEN_TRAP || t === TileType.TRAP;
    }

    private isSealable(r: number, c: number): boolean {
        return this.isTileType(r, c, TileType.KEY_HOLE) || this.isTileType(r, c, TileType.OPENED_KEY_HOLE);
    }

    /**
     * @returns True if this location is adjacent to a locked doorway, unlocked doorway, or a sealed doorway.
     */
    private isNextToDoorway(r: number, c: number): boolean {
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            if (this.isInBounds(r + dr, c + dc) && (DungeonCrawler.getLocationString(r + dr, c + dc) in this.state.keyHoleCosts)) {
                return true;
            }
        }
        return false;
    }

    private isCloudy(r: number, c: number): boolean {
        return this.isTileType(r, c, TileType.WALL) || this.isTileType(r, c, TileType.KEY_HOLE) || this.isTileType(r, c, TileType.OPENED_KEY_HOLE);
    }

    private getHiddenTrapsForPlayer(userId: Snowflake): { r: number, c: number }[] {
        const locations = [];
        for (const [locationString, ownerId] of Object.entries(this.state.trapOwners)) {
            if (ownerId === userId) {
                const location = this.parseLocationString(locationString);
                if (this.isTileType(location.r, location.c, TileType.HIDDEN_TRAP)) {
                    locations.push(location);
                }
            }
        }
        return locations;
    }

    private getPlayerAtLocation(r: number, c: number): Snowflake | undefined {
        for (const userId of this.getOrderedPlayers()) {
            if (this.state.players[userId].r === r && this.state.players[userId].c === c) {
                return userId;
            }
        }
    }

    addPlayerDecision(userId: Snowflake, text: string): string {
        const commands: string[] = text.replace(/\s+/g, ' ').trim().split(' ').map(c => c.toLowerCase());
        const newLocation = { r: this.state.players[userId].r, c: this.state.players[userId].c };
        const warnings: string[] = [];
        const playerPoints: number = this.state.players[userId].points;
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
        if (commands.includes('warp') && !commands.every(c => c === 'warp')) {
            throw new Error('If you warp this turn, ALL your actions must be warps');
        }

        for (const command of commands) {
            const [c, arg] = command.split(':') as [ActionName, string];
            cost += this.getActionCost(c, newLocation.r, newLocation.c);
            switch (c) {
                case 'up':
                    if (this.isTileType(newLocation.r - 1, newLocation.c, TileType.KEY_HOLE)) {
                        newLocation.r--;
                        warnings.push(`Doorway at **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}** must be unlocked, whether by you or someone else.`);
                    } else if (this.isWalkable(newLocation.r - 1, newLocation.c)) {
                        newLocation.r--;
                    } else {
                        throw new Error('You cannot move there!');
                    }
                    break;
                case 'down':
                    if (this.isTileType(newLocation.r + 1, newLocation.c, TileType.KEY_HOLE)) {
                        newLocation.r++
                        warnings.push(`Doorway at **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}** must be unlocked, whether by you or someone else.`);
                    } else if (this.isWalkable(newLocation.r + 1, newLocation.c)) {
                        newLocation.r++;
                    } else {
                        throw new Error('You cannot move there!');
                    }
                    break;
                case 'left':
                    if (this.isTileType(newLocation.r, newLocation.c - 1, TileType.KEY_HOLE)) {
                        newLocation.c--
                        warnings.push(`Doorway at **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}** must be unlocked, whether by you or someone else.`);
                    } else if (this.isWalkable(newLocation.r, newLocation.c - 1)) {
                        newLocation.c--;
                    } else {
                        throw new Error('You cannot move there!');
                    }
                    break;
                case 'right':
                    if (this.isTileType(newLocation.r, newLocation.c + 1, TileType.KEY_HOLE)) {
                        newLocation.c++
                        warnings.push(`Doorway at **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}** must be unlocked, whether by you or someone else.`);
                    } else if (this.isWalkable(newLocation.r, newLocation.c + 1)) {
                        newLocation.c++;
                    } else {
                        throw new Error('You cannot move there!');
                    }
                    break;
                case 'pause':
                    // TODO: Do validation?
                    break;
                case 'unlock':
                    if (!this.isNextToDoorway(newLocation.r, newLocation.c)) {
                        throw new Error(`You can't use "unlock" at **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}**, as there'd be no doorway near you to unlock!`);
                    }
                    break;
                case 'lock':
                    if (!this.isNextToDoorway(newLocation.r, newLocation.c)) {
                        throw new Error(`You can't use "lock" at **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}**, as there'd be no doorway near you to lock!`);
                    }
                    break;
                case 'seal':
                    if (!this.isNextToDoorway(newLocation.r, newLocation.c)) {
                        throw new Error(`You can't use "seal" at **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}**, as there'd be no doorway near you to seal!`);
                    }
                    break;
                case 'trap':
                    const target = this.parseLocationString(arg);
                    if (!target) {
                        throw new Error(`**${arg}** is not a valid location on the map!`);
                    }
                    if (this.isTileType(target.r, target.c, TileType.EMPTY) || this.isTileType(target.r, target.c, TileType.HIDDEN_TRAP)) {
                        // COOL
                    } else {
                        throw new Error(`Can't set a trap at **${arg}**, try a different spot.`);
                    }
                    break;
                case 'punch':
                    // TODO: Do validation?
                    break;
                case 'warp':
                    // TODO: Do validation?
                    break;
                default:
                    throw new Error(`\`${command}\` is an invalid action!`);
            }
        }

        if (cost > playerPoints) {
            throw new Error(`You can't afford these actions. It would cost **${cost}** points, yet you only have **${this.state.players[userId].points}**.`);
        }

        this.state.decisions[userId] = commands;
        return `Valid actions, your new location will be **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}**. `
            + `This will consume **${cost}** of your **${playerPoints}** points if successful. `
            + (warnings.length > 0 ? ' BUT PLEASE NOTE THE FOLLOWING WARNINGS:\n' + warnings.join('\n') : '');
    }

    private getActionCost(action: ActionName, r: number, c: number): number {
        const actionCosts: Record<ActionName, () => number> = {
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
                for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                    if (this.isTileType(r + dr, c + dc, TileType.KEY_HOLE)) {
                        cost += this.state.keyHoleCosts[DungeonCrawler.getLocationString(r + dr, c + dc)];
                    }
                }
                return cost;
            },
            'lock': () => {
                let cost = 0;
                for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                    if (this.isTileType(r + dr, c + dc, TileType.OPENED_KEY_HOLE)) {
                        cost += this.state.keyHoleCosts[DungeonCrawler.getLocationString(r + dr, c + dc)];
                    }
                }
                return cost;
            },
            'seal': () => {
                let cost = 0;
                for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                    if (this.isSealable(r + dr, c + dc)) {
                        cost += 2 * this.state.keyHoleCosts[DungeonCrawler.getLocationString(r + dr, c + dc)];
                    }
                }
                return cost;
            },
            'trap': () => {
                return 2;
            },
            'punch': () => {
                return 2;
            },
            'warp': () => {
                return 6;
            }
        };
        return actionCosts[action]();
    }

    processPlayerDecisions(): { summary: string, continueProcessing: boolean } {
        this.state.action++;
        const summaryData = {
            consecutiveStepUsers: [],
            statements: []
        };
        const addStepStatements = () => {
            if (summaryData.consecutiveStepUsers.length > 0) {
                if (summaryData.consecutiveStepUsers.length === 1) {
                    summaryData.statements.push(`**${summaryData.consecutiveStepUsers[0]}** took a step`);
                } else {
                    summaryData.statements.push(`**${summaryData.consecutiveStepUsers.length}** players took a step`);
                }
                summaryData.consecutiveStepUsers = [];
            }
        };
        const pushNonStepStatement = (s) => {
            addStepStatements();
            summaryData.statements.push(s);
        };
        const bumpers: Record<Snowflake, Snowflake> = {};
        // Process one decision from each player
        for (const userId of this.getShuffledPlayers()) {
            const player = this.state.players[userId];
            delete player.previousLocation;
            if (this.hasPendingDecisions(userId)) {
                let endTurn = false;
                const processStep = (dr: number, dc: number): boolean => {
                    player.previousLocation = { r: player.r, c: player.c };
                    const nr = player.r + dr;
                    const nc = player.c + dc;
                    const blockingUserId: Snowflake = this.getPlayerAtLocation(nr, nc);
                    if (blockingUserId) {
                        const blockingUser = this.state.players[blockingUserId];
                        bumpers[userId] = blockingUserId;
                        if (bumpers[blockingUserId] === userId) {
                            // If the other user previously bumped into this user, then allow him to pass by
                            pushNonStepStatement(`**${player.displayName}** walked past **${blockingUser.displayName}**`);
                        } else if (blockingUser.knockedOut) {
                            // If the other user is knocked out, walk past him
                            pushNonStepStatement(`**${player.displayName}** stepped over the knocked-out body of **${blockingUser.displayName}**`);
                        } else {
                            if (this.hasPendingDecisions(blockingUserId)) {
                                pushNonStepStatement(`**${player.displayName}** bumped into **${blockingUser.displayName}**`);
                            } else {
                                pushNonStepStatement(`**${player.displayName}** bumped into **${blockingUser.displayName}** and gave up`);
                                endTurn = true;
                            }
                            return false;
                        }
                    }
                    if (this.isWalkable(nr, nc)) {
                        player.r += dr;
                        player.c += dc;
                        summaryData.consecutiveStepUsers.push(player.displayName);
                        return true;
                    }
                    pushNonStepStatement(`**${player.displayName}** walked into a wall and gave up`);
                    endTurn = true;
                    return false;
                };
                const commandActions: Record<ActionName, (arg: string) => boolean> = {
                    'up': () => {
                        return processStep(-1, 0);
                    },
                    'down': () => {
                        return processStep(1, 0);
                    },
                    'left': () => {
                        return processStep(0, -1);
                    },
                    'right': () => {
                        return processStep(0, 1);
                    },
                    'pause': () => {
                        return true;
                    },
                    'unlock': () => {
                        let numDoorwaysUnlocked = 0;
                        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            if (this.isTileType(player.r + dr, player.c + dc, TileType.KEY_HOLE)) {
                                this.state.map[player.r + dr][player.c + dc] = TileType.OPENED_KEY_HOLE;
                                numDoorwaysUnlocked++;
                            }
                        }
                        if (numDoorwaysUnlocked === 1) {
                            pushNonStepStatement(`**${player.displayName}** unlocked a doorway`);
                        } else {
                            pushNonStepStatement(`**${player.displayName}** unlocked **${numDoorwaysUnlocked}** doorways`);
                        }
                        return true;
                    },
                    'lock': () => {
                        let numDoorwaysLocked = 0;
                        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            if (this.isTileType(player.r + dr, player.c + dc, TileType.OPENED_KEY_HOLE)) {
                                this.state.map[player.r + dr][player.c + dc] = TileType.KEY_HOLE;
                                numDoorwaysLocked++;
                            }
                        }
                        if (numDoorwaysLocked === 1) {
                            pushNonStepStatement(`**${player.displayName}** locked a doorway`);
                        } else {
                            pushNonStepStatement(`**${player.displayName}** locked **${numDoorwaysLocked}** doorways`);
                        }
                        return true;
                    },
                    'seal': () => {
                        let numDoorwaysSealed = 0;
                        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            if (this.isSealable(player.r + dr, player.c + dc)) {
                                this.state.map[player.r + dr][player.c + dc] = TileType.WALL;
                                numDoorwaysSealed++;
                            }
                        }
                        if (numDoorwaysSealed === 1) {
                            pushNonStepStatement(`**${player.displayName}** sealed a doorway`);
                        } else {
                            pushNonStepStatement(`**${player.displayName}** sealed **${numDoorwaysSealed}** doorways`);
                        }
                        return true;
                    },
                    'trap': (arg) => {
                        const { r, c } = this.parseLocationString(arg);
                        this.state.map[r][c] = TileType.HIDDEN_TRAP;
                        this.state.trapOwners[arg.toUpperCase()] = userId;
                        return true;
                    },
                    'punch': () => {
                        let nearPlayer = false;
                        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            const otherPlayerId = this.getPlayerAtLocation(player.r + dr, player.c + dc);
                            if (otherPlayerId) {
                                nearPlayer = true;
                                const otherPlayer = this.state.players[otherPlayerId];
                                if (Math.random() < 0.75) {
                                    otherPlayer.knockedOut = true;
                                    delete this.state.decisions[otherPlayerId];
                                    pushNonStepStatement(`**${player.displayName}** knocked out **${otherPlayer.displayName}**`);
                                } else {
                                    pushNonStepStatement(`**${player.displayName}** tried to punch **${otherPlayer.displayName}** and missed`);
                                }
                            }
                        }
                        if (!nearPlayer) {
                            pushNonStepStatement(`**${player.displayName}** swung at the air`);
                        }
                        return true;
                    },
                    'warp': () => {
                        const { r: newR, c: newC, userId: nearUserId } = this.getSpawnableLocationAroundPlayers(this.getOtherPlayers(userId));
                        const isFirstWarp: boolean = !player.warped;
                        const isCloser: boolean = this.getEuclideanDistanceToGoal(newR, newC) < this.getEuclideanDistanceToGoal(player.r, player.c);
                        // If it's the user's first warp of the turn or the warp is closer to the goal, do it and knock them out
                        if (isFirstWarp || isCloser) {
                            player.previousLocation = { r: player.r, c: player.c };
                            player.r = newR;
                            player.c = newC;
                            player.warped = true;
                            player.knockedOut = true;
                            pushNonStepStatement(`**${player.displayName}** warped to **${this.getDisplayName(nearUserId)}**`);
                        } else {
                            pushNonStepStatement(`**${player.displayName}** avoided warping to **${this.getDisplayName(nearUserId)}**`);
                        }
                        return true;
                    }
                };
                // Get the next action for this user
                const nextAction = this.state.decisions[userId][0];
                const [actionName, arg] = nextAction.toLowerCase().split(':') as [ActionName, string];

                // If the player can't afford this action, delete all their decisions (ending their turn)
                const actionCost: number = this.getActionCost(actionName, player.r, player.c);
                if (actionCost > player.points) {
                    delete this.state.decisions[userId];
                    pushNonStepStatement(`**${player.displayName}** ran out of action points`);
                    continue;
                }

                // Execute the action
                const consumeAction: boolean = commandActions[actionName](arg);

                // If the action was successful, remove this decision from the queue so any following ones can be processed
                if (consumeAction) {
                    // Consume points
                    player.points -= actionCost;
                    // Remove the action
                    this.state.decisions[userId].shift();
                    // Delete the decision list if it's been exhausted
                    if (!this.hasPendingDecisions(userId)) {
                        delete this.state.decisions[userId];
                    }
                }

                // If this was a turn-ending action, delete the user's entire decision list
                if (endTurn) {
                    delete this.state.decisions[userId];
                }

                const turnIsOver = !this.hasPendingDecisions(userId);
                
                // Process end-of-turn events
                if (turnIsOver) {
                    // Handle hidden traps
                    let trapRevealed = false;
                    if (this.getTileAtUser(userId) === TileType.HIDDEN_TRAP) {
                        this.state.map[player.r][player.c] = TileType.TRAP;
                        trapRevealed = true;
                        const trapOwnerId = this.state.trapOwners[DungeonCrawler.getLocationString(player.r, player.c)];
                        pushNonStepStatement(`**${player.displayName}** revealed a hidden trap placed by **${this.getDisplayName(trapOwnerId)}**`);
                    }
                    // Handle revealed traps (this will trigger if the above condition is triggered)
                    if (this.getTileAtUser(userId) === TileType.TRAP) {
                        player.r = player.originLocation.r;
                        player.c = player.originLocation.c;
                        player.knockedOut = true;
                        delete player.previousLocation;
                        const trapOwnerId = this.state.trapOwners[DungeonCrawler.getLocationString(player.r, player.c)];
                        if (trapRevealed) {
                            pushNonStepStatement(`was sent back to **${this.getPlayerLocationString(userId)}**`);
                        } else {
                            pushNonStepStatement(`**${player.displayName}** stepped on **${this.getDisplayName(trapOwnerId)}'s** trap and was sent back to **${this.getPlayerLocationString(userId)}**`);
                        }
                        // Reward the trap's owner
                        this.state.players[trapOwnerId].points++;
                        pushNonStepStatement(`**${this.getDisplayName(trapOwnerId)}** earned **1** point for trapping`);
                    }
                }
            }
        }


        // If there are no decisions left, end the turn
        addStepStatements();
        return {
            summary: naturalJoin(summaryData.statements, 'then') || 'Dogs sat around with their hands in their pockets...',
            continueProcessing: Object.keys(this.state.decisions).length > 0
        };
    }

    hasPendingDecisions(userId: Snowflake): boolean {
        return userId in this.state.decisions && this.state.decisions[userId].length > 0;
    }

    getNextActionsTowardGoal(userId: Snowflake, n: number = 1): string[] {
        const path = this.searchToGoal(userId);
        const result = [];
        if (path && path.length > n) {
            for (let i = 0; i < n; i++) {
                const dr = path[i + 1][1] - path[i][1];
                const dc = path[i + 1][0] - path[i][0];
                if (dr === -1) {
                    result.push('up');
                } else if (dr === 1) {
                    result.push('down');
                } else if (dc === -1) {
                    result.push('left');
                } else if (dc === 1) {
                    result.push('right');
                }
            }
        }
        return result;
    }

    getNumStepsToGoal(userId: Snowflake): number {
        return this.searchToGoal(userId).length;
    }

    searchToGoal(userId: Snowflake) {
        const player = this.state.players[userId];
        return this.search({ x: player.c, y: player.r }, { x: Math.floor(this.state.rows / 2), y: Math.floor(this.state.columns / 2) });
    }

    search(start: { x: number, y: number }, end: { x: number, y: number }) {
        const finder = new AStarFinder({
            grid: {
                matrix: this.toCollisionMap()
            },
            diagonalAllowed: false,
            heuristic: 'Manhattan'
        });
        const result = finder.findPath(start, end);
        return result;
    }

    private toCollisionMap(): number[][] {
        return this.state.map.map(row => row.map(tile => this.isWalkableTileType(tile) ? 0 : 1));
    }

    getMapFairness(): { min: number, max: number, fairness: number, description: string } {
        let min = Number.MAX_SAFE_INTEGER;
        let max = -1;
        for (const userId of this.getOrderedPlayers()) {
            const numSteps = this.getNumStepsToGoal(userId);
            max = Math.max(max, numSteps);
            min = Math.min(min, numSteps);
        }
        return { min, max, fairness: min / max, description: `[${min}, ${max}] = ${(100 * min / max).toFixed(1)}%` };
    }

    getGoalRow(): number {
        return Math.floor(this.state.rows / 2);
    }

    getGoalColumn(): number {
        return Math.floor(this.state.columns / 2);
    }

    getEuclideanDistanceToGoal(r: number, c: number): number {
        return Math.sqrt(Math.pow(this.getGoalRow() - r, 2) + Math.pow(this.getGoalColumn() - c, 2));
    }

    getPlayerDistanceToGoal(userId: Snowflake):  number {
        const player = this.state.players[userId];
        return this.getEuclideanDistanceToGoal(player.r, player.c);
    }

    /**
     * In a 3x3 box around the given player, return a random location that a user may spawn in (is walkable and isn't occupied by another user).
     * If no such tile exists, return nothing.
     */
    getSpawnableLocationAroundPlayer(userId: Snowflake): { r: number, c: number } | undefined {
        const offsets = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        shuffle(offsets);
        const player = this.state.players[userId];
        for (const [dr, dc] of offsets) {
            const nr = player.r + dr;
            const nc = player.c + dc;
            if (this.isWalkable(nr, nc) && !this.getPlayerAtLocation(nr, nc)) {
                return { r: nr, c: nc };
            }
        }
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
}