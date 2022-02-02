import { Message, Snowflake, TextBasedChannels } from "discord.js";
import { GoodMorningConfig, PlayerState } from "./types";

/**
 * @param lo Lower bound (inclusive)
 * @param hi Upper bound (exclusive)
 * @return integer in the range [lo, hi)
 */
export function randInt(lo: number, hi: number): number {
    return Math.floor(Math.random() * (hi - lo)) + lo;
};

/**
 * @param choices Array of objects to choose from
 * @returns A random element from the input array
 */
export function randChoice<T>(...choices: T[]): T {
    return choices[randInt(0, choices.length)];
};

export function validateConfig(config: GoodMorningConfig): void {
    if (config.goodMorningChannelId === undefined) {
        console.log('No goodMorningChannelId is set in the config, aborting...');
        process.exit(1);
    }
    if (config.seasonGoal === undefined) {
        console.log('No seasonGoal is set in the config, aborting...');
        process.exit(1);
    }
    if (config.goodMorningMessageProbability === undefined) {
        config.goodMorningMessageProbability = 1;
    }
    if (config.replyViaReactionProbability === undefined) {
        config.replyViaReactionProbability = 0;
    }
}

interface KMeansPoint {
    data: string,
    rank: number
}

function getMinClusterIndex(value: number, centers: number[]): number {
    let minCenter: number;
    let minDifference: number = 999;
    for (let i = 0; i < centers.length; i++) {
        const difference: number = Math.abs(value - centers[i]);
        if (difference < minDifference) {
            minCenter = i;
            minDifference = difference;
        }
    }
    return minCenter;
}

// TODO: This is all experimental and should be cleaned up before use
export function generateKMeansClusters(input: Record<string, number>, k: number): any[] {
    const points: KMeansPoint[] = Object.keys(input).map(key => {
        return { data: key, rank: input[key] };
    });
    const minValue: number = Math.min(...Object.values(input));
    const maxValue: number = Math.max(...Object.values(input));
    const valueSet: Set<number> = new Set(Object.values(input));
    valueSet.delete(minValue);
    valueSet.delete(maxValue);
    const randomValues: number[] = Array.from(valueSet)
        .map((x) => ({ x, sort: Math.random() }))
        .sort((x, y) => x.sort - y.sort)
        .map(x => x.x);
    randomValues.push(maxValue);
    randomValues.push(minValue);
    const valueOccurrences: Record<string, number> = {};
    Object.values(input).forEach((value) => {
        valueOccurrences[value.toString()] = valueOccurrences[value.toString()] || 0;
        valueOccurrences[value.toString()]++;
    });
    const range: number = maxValue - minValue;
    const centers: number[] = [];
    for (let i = 0; i < k; i++) {
        const randomCenter: number = randomValues.pop();
        centers.push(randomCenter)
    }
    const getClusters = () => {
        const clusters: KMeansPoint[][] = centers.map((x) => []);
        // Group each point into a particular cluster
        for (let j = 0; j < points.length; j++) {
            const point: KMeansPoint = points[j];
            let minCenter = getMinClusterIndex(point.rank, centers);
            clusters[minCenter].push(point);
        }
        return clusters;
    };
    const printState = () => {
        for (let i = minValue; i <= maxValue; i++) {
            process.stdout.write((i % 10).toString().replace('-', ''));
        }
        process.stdout.write('\n');
        for (let i = minValue; i <= maxValue; i++) {
            if (i.toString() in valueOccurrences) {
                process.stdout.write(valueOccurrences[i.toString()].toString());
            } else {
                process.stdout.write(' ');
            }
        }
        process.stdout.write('\n');
        for (let i = minValue; i <= maxValue; i++) {
            const centerSet: Set<number> = new Set(centers.map(Math.floor.bind(null)));
            if (centerSet.has(i)) {
                process.stdout.write('X');
            } else {
                process.stdout.write(' ');
            }
        }
        process.stdout.write('\n');
    };
    const getClusterAverage = (cluster: KMeansPoint[]): number => {
        return cluster.map((x) => x.rank).reduce((x, y) => x + y) / cluster.length;
    };
    const numPasses: number = 10;
    console.log(Object.values(input).sort());
    let n: number = 0;
    while (true) {
        console.log(`=== Iteration: ${n++} ===`);
        console.log(centers);
        printState();
        const clusters: KMeansPoint[][] = getClusters();
        // Now update the centers for each cluster
        let shouldBreak: boolean = true;
        for (let i = 0; i < k; i++) {
            const center: number = centers[i];
            const cluster: KMeansPoint[] = clusters[i];
            const averageValue: number = getClusterAverage(cluster);
            if (centers[i] !== averageValue) {
                shouldBreak = false;
            }
            centers[i] = averageValue;
        }
        if (shouldBreak) {
            break;
        }
    }
    const finalClusters: KMeansPoint[][] = getClusters();
    return finalClusters.sort((x, y) => {
        return getClusterAverage(x) - getClusterAverage(y);
    }).map((x) => {
        return x.map((y) => {
            return { data: y.data, sort: Math.random() };
        }).sort((a, b) => a.sort - b.sort).map((y) => {
            return `<@${y.data}>`;
        });
    });
}

/**
 * Returns true if the given message contains a video or (potentially animated) GIF.
 */
export function hasVideo(msg: Message): boolean {
    return msg.attachments?.some(x => x.contentType.includes('video/') || x.contentType === 'image/gif')
        || msg.embeds?.some(x => x.video)
        // Next to manually check for YouTube links since apparently the embeds check doesn't always work...
        || msg.content.includes('https://youtu.be/')
        || msg.content.includes('https://youtube.com/');
}


export function getTodayDateString() {
    return new Date().toLocaleDateString('en-US');
}

/**
 * Gets the number of days since the provided date string (e.g. 1/20/2022)
 * @param start date string
 * @returns number of days since that date
 */
export function getNumberOfDaysSince(start: string): number {
    const startDate: Date = new Date(start);
    const todayDate: Date = new Date(getTodayDateString());
    return Math.round((todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Returns an ordered list of user IDs sorted by points, then days since last good morning, then penalties.
 * @param players map of player state objects
 * @returns sorted list of user IDs
 */
export function getOrderedPlayers(players: Record<Snowflake, PlayerState>): Snowflake[] {
    return Object.keys(players).sort((x, y) => players[y].points - players[x].points
        || players[x].daysSinceLastGoodMorning - players[y].daysSinceLastGoodMorning
        || (players[x].penalties ?? 0) - (players[y].penalties ?? 0));
}

export function toPointsMap(players: Record<Snowflake, PlayerState>): Record<Snowflake, number> {
    const result: Record<Snowflake, number> = {};
    Object.keys(players).forEach((userId) => {
        result[userId] = players[userId].points;
    });
    return result;
}

export function getLeastRecentPlayers(players: Record<Snowflake, PlayerState>, minDays: number = 0): Snowflake[] {
    return Object.keys(players)
        .filter((userId) => (players[userId].daysSinceLastGoodMorning ?? -1) >= minDays)
        .sort((x, y) => players[y].daysSinceLastGoodMorning - players[x].daysSinceLastGoodMorning);
}

/**
 * React to the given message with some emoji (or an emoji randomly selected from a list of emojis).
 */
export async function reactToMessage(msg: Message, emoji: string | string[]): Promise<void> {
    if (emoji) {
        await new Promise(r => setTimeout(r, randInt(0, 1750)));
        if (Array.isArray(emoji) && emoji.length > 0) {
            // If the input is a list of emojis, use a random emoji from that list
            const singleEmoji: string = randChoice(...emoji);
            await msg.react(singleEmoji);
        } else if (typeof emoji === 'string') {
            // If the input is a single string, react using just that emoji
            await msg.react(emoji);
        }
    }
}

export function getOrderingUpset(upsetter: string, before: string[], after: string[]): any[] {
    const beforeIndex = before.indexOf(upsetter);
    const afterIndex = after.indexOf(upsetter);
    const beforeInferiors = new Set<string>(before.slice(beforeIndex + 1));
    const afterInferiors = after.slice(afterIndex + 1);
    return afterInferiors.filter(x => !beforeInferiors.has(x));
}

export function getOrderingUpsets(before: string[], after: string[]): Record<string, string[]> {
    const results = {};
    after.forEach(x => {
        const upsettees = getOrderingUpset(x, before, after);
        if (upsettees && upsettees.length > 0) {
            results[x] = upsettees;
        }
    });
    return results;
}

export function sleep(milliseconds: number): Promise<void> {
    return new Promise(r => setTimeout(r, milliseconds));
}
