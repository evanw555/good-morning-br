import canvas, { Image } from 'canvas';
import { GuildMember, Snowflake } from 'discord.js';
import { AStarFinder } from 'astar-typescript';
import { getRankString, naturalJoin, randInt, shuffle, toLetterId } from 'evanw555.js';
import { DummyGameState, DungeonGameState, DungeonPlayerState } from "../types";
import AbstractGame from "./abstract-game";

enum TileType {
    EMPTY = 0,
    WALL = 1,
    KEY_HOLE = 2,
    OPENED_KEY_HOLE = 3,
    CHEST = 4,
    HIDDEN_TRAP = 5,
    TRAP = 6
}

type ActionName = 'up' | 'down' | 'left' | 'right' | 'unlock' | 'lock' | 'seal' | 'trap';

export default class DungeonCrawler extends AbstractGame<DungeonGameState> {
    private static readonly TILE_SIZE: number = 24;

    private static readonly STYLE_SKY: string = 'hsl(217, 94%, 69%)';
    private static readonly STYLE_LIGHT_SKY: string = 'hsl(217, 85%, 75%)';
    private static readonly STYLE_CLOUD: string = 'rgba(222, 222, 222, 1)';

    constructor(state: DungeonGameState) {
        super(state);
    }

    isSeasonComplete(): boolean {
        return false;
    }

    async renderState(): Promise<Buffer> {
        const WIDTH: number = this.state.columns * DungeonCrawler.TILE_SIZE;
        const HEIGHT: number = this.state.rows * DungeonCrawler.TILE_SIZE;
        const c = canvas.createCanvas(WIDTH, HEIGHT);
        const context = c.getContext('2d');

        // Fill the blue sky background
        context.fillStyle = DungeonCrawler.STYLE_SKY;
        context.fillRect(0, 0, WIDTH, HEIGHT);

        for (let r = 0; r < this.state.rows; r++) {
            for (let c = 0; c < this.state.columns; c++) {
                if (r === 20 && c === 20) {
                    // Draw goal
                    context.fillStyle = 'rgba(200, 0, 100, 1)';
                    context.fillRect(c * DungeonCrawler.TILE_SIZE, r * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
                } else if (this.state.map[r][c] === TileType.CHEST) {
                    // Draw chests
                    context.fillStyle = 'yellow';
                    context.fillRect(c * DungeonCrawler.TILE_SIZE, r * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
                } else if (this.state.map[r][c] === TileType.HIDDEN_TRAP) {
                    // Draw chests
                    context.fillStyle = 'black';
                    context.beginPath();
                    context.arc((c + .5) * DungeonCrawler.TILE_SIZE, (r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE / 4, 0, Math.PI * 2, false);
                    context.fill();
                } else if (this.state.map[r][c] !== TileType.EMPTY) {
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
                    if (this.state.map[r][c] === TileType.KEY_HOLE) {
                        // Draw key hole cost
                        context.fillStyle = DungeonCrawler.STYLE_LIGHT_SKY;
                        context.font = `${DungeonCrawler.TILE_SIZE * .7}px sans-serif`;
                        context.fillText(this.state.keyHoleCosts[DungeonCrawler.getLocationString(r, c)].toString(), (c + .25) * DungeonCrawler.TILE_SIZE, (r + .75) * DungeonCrawler.TILE_SIZE);
                        // context.fillRect((c + .4) * DungeonCrawler.TILE_SIZE, (r + .3) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE * .2, DungeonCrawler.TILE_SIZE * .4);
                    } else if (this.state.map[r][c] === TileType.OPENED_KEY_HOLE) {
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
                    // context.fillText(this.state.map[r][c].toString(), c * DungeonCrawler.TILE_SIZE, (r + .5) * DungeonCrawler.TILE_SIZE);
                }
            }
        }

        // Render all players
        for (const userId of Object.keys(this.state.players)) {
            const player = this.state.players[userId];
            // context.fillStyle = this.state.players[userId].color;
            // context.beginPath();
            // context.arc((this.state.players[userId].x + .5) * DungeonCrawler.TILE_SIZE, (this.state.players[userId].y + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE * .4, 0, Math.PI * 2, false);
            // context.fill();

            // Draw outline
            context.fillStyle = 'black';
            context.beginPath();
            context.arc((player.c + .5) * DungeonCrawler.TILE_SIZE, (player.r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE / 2 + 1, 0, Math.PI * 2, false);
            context.fill();

            // Draw inner stuff
            if (player.avatarUrl.startsWith('http')) {
                // Save the context so we can undo the clipping region at a later time
                context.save();
    
                // Define the clipping region as an 360 degrees arc at point x and y
                context.beginPath();
                context.arc((player.c + .5) * DungeonCrawler.TILE_SIZE, (player.r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE / 2, 0, Math.PI * 2, false);
    
                // Clip!
                context.clip();
    
                // Draw the image at imageX, imageY.
                const avatarImage = await canvas.loadImage(player.avatarUrl);
                context.drawImage(avatarImage, player.c * DungeonCrawler.TILE_SIZE, player.r * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
    
                // Restore context to undo the clipping
                context.restore();
            } else {
                context.fillStyle = player.avatarUrl;
                context.beginPath();
                context.arc((player.c + .5) * DungeonCrawler.TILE_SIZE, (player.r + .5) * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE / 2, 0, Math.PI * 2, false);
                context.fill();
            }

            // context.drawImage(avatarImage, this.state.players[userId].x * DungeonCrawler.TILE_SIZE, this.state.players[userId].y * DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE, DungeonCrawler.TILE_SIZE);
        }

        // TODO: Temp rendering of ideal path
        if ('321059211368988703' in this.state.players) {
            const player = this.state.players['321059211368988703'];
            const path = this.search({ x: player.c, y: player.r }, { x: Math.floor(this.state.rows / 2), y: Math.floor(this.state.columns / 2) });
            context.strokeStyle = 'black';
            context.moveTo(0, 0);
            context.beginPath();
            for (const step of path) {
                context.lineTo((step[0] + .5) * DungeonCrawler.TILE_SIZE, (step[1] + .5) * DungeonCrawler.TILE_SIZE);
            }
            context.stroke();
        }

        const TOTAL_WIDTH = WIDTH + DungeonCrawler.TILE_SIZE * 10;
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
        c2.fillStyle = 'white';
        c2.font = `${DungeonCrawler.TILE_SIZE * .75}px sans-serif`;
        let y = 1;
        for (const userId of this.getOrderedPlayers()) {
            y++;
            const text = `${this.getPlayerLocationString(userId)}: ${this.state.players[userId].displayName}`
            const textX = WIDTH + DungeonCrawler.TILE_SIZE * 1.5;
            const textY = y * DungeonCrawler.TILE_SIZE;
            c2.fillStyle = 'white';
            // c2.fillText(text, textX + 1, textY + 1);
            // c2.fillStyle = this.state.players[userId].color;
            c2.fillText(text, textX, textY);
        }

        return masterImage.toBuffer();
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

    getOrderedPlayers(): string[] {
        const getLocationRank = (userId) => {
            return this.state.players[userId].r * this.state.columns + this.state.players[userId].c;
        }
        return Object.keys(this.state.players).sort((x, y) => getLocationRank(x) - getLocationRank(y));
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
                        // } else if (getEuclideanDistanceToGoal(hnr, hnc) < 18 && getEuclideanDistanceToGoal(hnr, hnc) > 10 && Math.random() < .1) {
                        //     // In the mid-ring of the map, add keyholes somewhat liberally
                        //     map[hnr][hnc] = TileType.KEY_HOLE;
                        //     keyHoleCosts[DungeonCrawler.getLocationString(hnr, hnc)] = randInt(1, 10);
                        // } else if (getEuclideanDistanceToGoal(hnr, hnc) < 5 && Math.random() < .25) {
                        //     // In the inner-ring of the map, add keyholes very liberally
                        //     map[hnr][hnc] = TileType.KEY_HOLE;
                        //     keyHoleCosts[DungeonCrawler.getLocationString(hnr, hnc)] = randInt(5, 10);
                        // } else 
                        // if ([[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([ddr, ddc]) => {
                        //     return !isWall(r + ddr, c + ddc);
                        // }).length === 1) {
                        //     map[hnr][hnc] = -1;
                        // } else {
                        //     if (Math.random() < 0.05) {
                        //         map[hnr][hnc] = -2;
                        //     } else if (Math.random() < 0.05) {
                        //         map[hnr][hnc] = ++i;
                        //     }
                        // }
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
                        map[r][c] = TileType.CHEST;
                    } else {
                        map[r][c] = TileType.EMPTY;
                    }
                }
            }
        }
        const players: Record<Snowflake, DungeonPlayerState> = {};
        players['321059211368988703'] = {
            r: 0,
            c: 20,
            avatarUrl: 'https://cdn.discordapp.com/avatars/321059211368988703/7b0b07b54bc050c93fd4fcf17dcd6546.png?size=32',
            displayName: 'FatherYahweh',
            points: 10
        };
        let j = 0;
        for (const member of members) {
            if (member.id === '321059211368988703') {
                continue;
            }
            j++;
            const [ r, c ] = DungeonCrawler.getInitialLocationV2(j, 41, 41);
            players[member.id] = {
                r,
                c,
                avatarUrl: member.user.displayAvatarURL({ size: 32, format: 'png' }),
                displayName: member.displayName,
                points: 5
            };
        }
        const dungeon = new DungeonCrawler({
            type: 'DUNGEON_GAME_STATE',
            decisions: {},
            rows: 41,
            columns: 41,
            map,
            keyHoleCosts,
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
    private isInBounds(r: number, c: number): boolean {
        return r >= 0 && c >= 0 && r < this.state.rows && c < this.state.columns;
    }

    private isWalkable(r: number, c: number): boolean {
        return this.isInBounds(r, c) && this.isWalkableTileType(this.state.map[r][c]);
    }

    private isWalkableTileType(t: TileType): boolean {
        return t === TileType.EMPTY || t === TileType.OPENED_KEY_HOLE || t === TileType.CHEST || t === TileType.HIDDEN_TRAP || t === TileType.TRAP;
    }

    private isKeyHole(r: number, c: number): boolean {
        return this.isInBounds(r, c) && this.state.map[r][c] === TileType.KEY_HOLE;
    }

    private isSealable(r: number, c: number): boolean {
        return this.isInBounds(r, c) && (this.state.map[r][c] === TileType.KEY_HOLE || this.state.map[r][c] === TileType.OPENED_KEY_HOLE);
    }

    private isNextToKeyHole(r: number, c: number): boolean {
        return this.isKeyHole(r - 1, c) || this.isKeyHole(r + 1, c) || this.isKeyHole(r, c - 1) || this.isKeyHole(r, c + 1);
    }

    private isCloudy(r: number, c: number): boolean {
        return this.isInBounds(r, c) && (this.state.map[r][c] === TileType.WALL || this.state.map[r][c] === TileType.OPENED_KEY_HOLE || this.state.map[r][c] === TileType.KEY_HOLE);
    }

    private getPlayerAtLocation(r: number, c: number): Snowflake | undefined {
        for (const userId of this.getOrderedPlayers()) {
            if (this.state.players[userId].r === r && this.state.players[userId].c === c) {
                return userId;
            }
        }
    }

    addPlayerDecision(userId: Snowflake, text: string): string {
        const commands: string[] = text.replace(/\s+/g, ' ').split(' ').map(c => c.toLowerCase());
        const newLocation = { r: this.state.players[userId].r, c: this.state.players[userId].c };
        const warnings: string[] = [];
        let cost = 0;
        for (const command of commands) {
            const [c, arg] = command.split(':') as [ActionName, string];
            cost += this.getActionCost(c, newLocation.r, newLocation.c);
            switch (c) {
                case 'up':
                    if (this.isKeyHole(newLocation.r - 1, newLocation.c)) {
                        newLocation.r--;
                        warnings.push(`Doorway at **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}** must be unlocked, whether by you or someone else.`);
                    } else if (this.isWalkable(newLocation.r - 1, newLocation.c)) {
                        newLocation.r--;
                    } else {
                        throw new Error('You cannot move there!');
                    }
                    break;
                case 'down':
                    if (this.isKeyHole(newLocation.r + 1, newLocation.c)) {
                        newLocation.r++
                        warnings.push(`Doorway at **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}** must be unlocked, whether by you or someone else.`);
                    } else if (this.isWalkable(newLocation.r + 1, newLocation.c)) {
                        newLocation.r++;
                    } else {
                        throw new Error('You cannot move there!');
                    }
                    break;
                case 'left':
                    if (this.isKeyHole(newLocation.r, newLocation.c - 1)) {
                        newLocation.c--
                        warnings.push(`Doorway at **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}** must be unlocked, whether by you or someone else.`);
                    } else if (this.isWalkable(newLocation.r, newLocation.c - 1)) {
                        newLocation.c--;
                    } else {
                        throw new Error('You cannot move there!');
                    }
                    break;
                case 'right':
                    if (this.isKeyHole(newLocation.r, newLocation.c + 1)) {
                        newLocation.c++
                        warnings.push(`Doorway at **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}** must be unlocked, whether by you or someone else.`);
                    } else if (this.isWalkable(newLocation.r, newLocation.c + 1)) {
                        newLocation.c++;
                    } else {
                        throw new Error('You cannot move there!');
                    }
                    break;
                case 'unlock':
                    if (this.isNextToKeyHole(newLocation.r, newLocation.c)) {
                        // COOL
                    } else {
                        throw new Error(`You can't use "unlock" at **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}**, as there'd be no keyhole near you to unlock!`);
                    }
                    break;
                case 'seal':
                    // TODO: Do validation?
                    break;
                case 'trap':
                    const target = this.parseLocationString(arg);
                    if (!target) {
                        throw new Error(`**${arg}** is not a valid location on the map!`);
                    }
                    if (this.state.map[target.r][target.c] === TileType.EMPTY || this.state.map[target.r][target.c] === TileType.HIDDEN_TRAP) {
                        // COOL
                    } else {
                        throw new Error(`Can't set a trap at **${arg}**, try a different spot.`);
                    }
                    break;
                default:
                    throw new Error(`\`${command}\` is an invalid action!`);
            }
        }
        if (cost > this.state.players[userId].points) {
            throw new Error(`You can't afford these actions. It would cost **${cost}** points, yet you only have **${this.state.players[userId].points}**.`);
        }
        this.state.decisions[userId] = commands;
        return `Valid actions, your new location will be **${DungeonCrawler.getLocationString(newLocation.r, newLocation.c)}**`
            + (warnings.length > 0 ? ', BUT PLEASE NOTE THE FOLLOWING WARNINGS:\n' + warnings.join('\n') : '');
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
            'unlock': () => {
                let cost = 0;
                for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                    if (this.isKeyHole(r + dr, c + dc)) {
                        cost += this.state.keyHoleCosts[DungeonCrawler.getLocationString(r + dr, c + dc)];
                    }
                }
                return cost;
            },
            'lock': () => {
                let cost = 0;
                for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                    if (this.state.map[r + dr][c + dc] === TileType.OPENED_KEY_HOLE) {
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
            }
        };
        return actionCosts[action]();
    }

    processPlayerDecisions(): { summary: string, continueProcessing: boolean } {
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
        // Process one decision from each player
        for (const userId of this.getOrderedPlayers()) {
            if (userId in this.state.decisions && this.state.decisions[userId].length > 0) {
                const player = this.state.players[userId];
                const commandActions: Record<ActionName, (arg: string) => boolean> = {
                    'up': () => {
                        const nr = player.r - 1;
                        const nc = player.c;
                        const playerInLocation: Snowflake = this.getPlayerAtLocation(nr, nc);
                        if (playerInLocation) {
                            pushNonStepStatement(`**${player.displayName}** bumped into **${this.state.players[playerInLocation].displayName}**`);
                            return false;
                        }
                        if (this.isWalkable(nr, nc)) {
                            player.r--;
                            summaryData.consecutiveStepUsers.push(player.displayName);
                            return true;
                        }
                        pushNonStepStatement(`**${player.displayName}** walked into a wall`);
                        return false;
                    },
                    'down': () => {
                        const nr = player.r + 1;
                        const nc = player.c;
                        const playerInLocation: Snowflake = this.getPlayerAtLocation(nr, nc);
                        if (playerInLocation) {
                            pushNonStepStatement(`**${player.displayName}** bumped into **${this.state.players[playerInLocation].displayName}**`);
                            return false;
                        }
                        if (this.isWalkable(nr, nc)) {
                            player.r++;
                            summaryData.consecutiveStepUsers.push(player.displayName);
                            return true;
                        }
                        pushNonStepStatement(`**${player.displayName}** walked into a wall`);
                        return false;
                    },
                    'left': () => {
                        const nr = player.r;
                        const nc = player.c - 1;
                        const playerInLocation: Snowflake = this.getPlayerAtLocation(nr, nc);
                        if (playerInLocation) {
                            pushNonStepStatement(`**${player.displayName}** bumped into **${this.state.players[playerInLocation].displayName}**`);
                            return false;
                        }
                        if (this.isWalkable(nr, nc)) {
                            player.c--
                            summaryData.consecutiveStepUsers.push(player.displayName);
                            return true;
                        }
                        pushNonStepStatement(`**${player.displayName}** walked into a wall`);
                        return false;
                    },
                    'right': () => {
                        const nr = player.r;
                        const nc = player.c + 1;
                        const playerInLocation: Snowflake = this.getPlayerAtLocation(nr, nc);
                        if (playerInLocation) {
                            pushNonStepStatement(`**${player.displayName}** bumped into **${this.state.players[playerInLocation].displayName}**`);
                            return false;
                        }
                        if (this.isWalkable(nr, nc)) {
                            player.c++
                            summaryData.consecutiveStepUsers.push(player.displayName);
                            return true;
                        }
                        pushNonStepStatement(`**${player.displayName}** walked into a wall`);
                        return false;
                    },
                    'unlock': () => {
                        let numDoorwaysUnlocked = 0;
                        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            if (this.isKeyHole(player.r + dr, player.c + dc)) {
                                this.state.map[player.r + dr][player.c + dc] = TileType.OPENED_KEY_HOLE;
                                numDoorwaysUnlocked++;
                            }
                        }
                        pushNonStepStatement(`**${player.displayName}** unlocked **${numDoorwaysUnlocked}** doorways`);
                        return true;
                    },
                    'lock': () => {
                        let numDoorwaysLocked = 0;
                        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            if (this.state.map[player.r + dr][player.c + dc] === TileType.OPENED_KEY_HOLE) {
                                this.state.map[player.r + dr][player.c + dc] = TileType.KEY_HOLE;
                                numDoorwaysLocked++;
                            }
                        }
                        pushNonStepStatement(`**${player.displayName}** locked **${numDoorwaysLocked}** doorways`);
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
                        pushNonStepStatement(`**${player.displayName}** sealed **${numDoorwaysSealed}** doorways`);
                        return true;
                    },
                    'trap': (arg) => {
                        const { r, c } = this.parseLocationString(arg);
                        this.state.map[r][c] = TileType.HIDDEN_TRAP;
                        return true;
                    }
                };
                // Get the next action for this user
                const nextAction = this.state.decisions[userId][0];
                const [actionName, arg] = nextAction.toLowerCase().split(':') as [ActionName, string];

                // If the player can't afford this action, delete all their decisions (ending their turn)
                const actionCost: number = this.getActionCost(actionName, player.r, player.c);
                // TODO: player points!!!
                if (actionCost > player.points) {
                    delete this.state.decisions[userId];
                    pushNonStepStatement(`**${player.displayName}** ran out of action points`);
                    continue;
                }

                // Execute the action
                const consumeAction: boolean = commandActions[actionName](arg);

                // Consume points
                player.points -= actionCost;

                // If the action was successful, remove this decision from the queue so any following ones can be processed
                if (consumeAction) {
                    this.state.decisions[userId].shift();
                    // Delete the decision list if it's been exhausted
                    if (this.state.decisions[userId].length === 0) {
                        delete this.state.decisions[userId];
                    }
                }
            }
        }


        // If there are no decisions left, end the turn
        addStepStatements();
        return {
            summary: naturalJoin(summaryData.statements, 'then'),
            continueProcessing: Object.keys(this.state.decisions).length > 0
        };
    }

    getNextActionsTowardGoal(userId: Snowflake, n: number = 1): string {
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
        return result.join(' ');
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
}