import { Message, Snowflake, TextBasedChannels } from "discord.js";
import { GoodMorningConfig } from "./types";
import canvas from 'canvas';

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

export function getOrderedPlayers(points: Record<Snowflake, number>): string[] {
    return Object.keys(points).sort((x, y) => points[y] - points[x]);
}

export async function replyToMessage(msg: Message, text: string): Promise<void> {
    await msg.channel.sendTyping();
    await new Promise(r => setTimeout(r, 45 * text.length));
    await msg.reply(text);
}

export async function sendMessageInChannel(channel: TextBasedChannels, text: string): Promise<void> {
    await channel.sendTyping();
    await new Promise(r => setTimeout(r, 45 * text.length));
    await channel.send(text);
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
