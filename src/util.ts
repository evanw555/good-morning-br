import { Message, Snowflake } from "discord.js";
import { randChoice, randInt } from "evanw555.js";
import { CalendarDate, FullDate, GoodMorningConfig } from "./types";

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
        || msg.content.includes('https://youtube.com/')
        || msg.content.includes('https://www.youtube.com/')
        || msg.content.includes('https://m.youtube.com/');
}

/**
 * @returns e.g. "12/25/2020"
 */
export function getTodayDateString(): FullDate {
    return new Date().toLocaleDateString('en-US');
}

/**
 * @param date input date
 * @returns e.g. "12/25"
 */
export function toCalendarDate(date: Date): CalendarDate {
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * @returns The current date-time plus 24 hours
 */
export function getTomorrow(): Date {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
}

/**
 * Gets the number of days since the provided date string (e.g. 1/20/2022)
 * @param start date string
 * @returns number of days since that date
 */
export function getNumberOfDaysSince(start: FullDate): number {
    const startDate: Date = new Date(start);
    const todayDate: Date = new Date(getTodayDateString());
    return Math.round((todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * @returns The current 24-hour time in the "HH:MM" format (e.g. "06:30", "17:14")
 */
export function getClockTime(): string {
    const now: Date = new Date();
    return now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
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

export function getOrderingUpset(upsetter: Snowflake, before: Snowflake[], after: Snowflake[]): Snowflake[] {
    const beforeIndex: number = before.indexOf(upsetter);
    const afterIndex: number = after.indexOf(upsetter);
    const beforeAll: Set<Snowflake> = new Set(before);
    const beforeInferiors: Set<Snowflake> = new Set(before.slice(beforeIndex + 1));
    const afterInferiors: Snowflake[] = after.slice(afterIndex + 1);
    // "Upsets" defined as the set of all inferiors that were previously not inferiors (yet were still in the game)
    return afterInferiors.filter(x => !beforeInferiors.has(x) && beforeAll.has(x));
}

export function getOrderingUpsets(before: Snowflake[], after: Snowflake[]): Record<Snowflake, Snowflake[]> {
    const results: Record<Snowflake, Snowflake[]> = {};
    after.forEach(x => {
        const upsettees: Snowflake[] = getOrderingUpset(x, before, after);
        if (upsettees && upsettees.length > 0) {
            results[x] = upsettees;
        }
    });
    return results;
}

export function sleep(milliseconds: number): Promise<void> {
    return new Promise(r => setTimeout(r, milliseconds));
}

/**
 * @returns The given rank expressed as a string (e.g. 1st, 2nd, 3rd, 11th, 21st)
 */
export function getRankString(rank: number): string {
    if (rank % 10 === 1 && rank !== 11) {
        return `${rank}st`;
    } else if (rank % 10 === 2 && rank !== 12) {
        return `${rank}nd`;
    } else if (rank % 10 === 3 && rank !== 13) {
        return `${rank}rd`;
    }
    return `${rank}th`;
}

/**
 * TODO: Make this work on upper-case words
 *
 * @param input Text to pluralize
 * @returns The pluralized input text
 */
export function pluralize(input: string): string {
    if (input.endsWith('y')) {
        return input.substring(0, input.length - 1) + 'ies';
    }
    if (input.endsWith(')')) {
        const openParenIndex: number = input.lastIndexOf('(');
        const preParenText: string = input.substring(0, openParenIndex).trim();
        return pluralize(preParenText) + ' ' + input.substring(openParenIndex);
    }
    return input + 's';
}

/**
 * @param input List of strings
 * @returns The given list of strings joined in a way that is grammatically correct in English
 */
export function naturalJoin(input: string[], conjunction: string = 'and'): string {
    if (!input || input.length === 0) {
        return '';
    }
    if (input.length === 1) {
        return input[0];
    }
    if (input.length === 2) {
        return `${input[0]} ${conjunction} ${input[1]}`;
    }
    let result = '';
    for (let i = 0; i < input.length; i++) {
        if (i !== 0) {
            result += ', ';
        }
        if (i === input.length - 1) {
            result += `${conjunction} `;
        }
        result += input[i];
    }
    return result;
}

export function capitalize(input: string): string {
    return input.substring(0, 1).toUpperCase() + input.substring(1);
}

/**
 * Given some non-negative number, returns an alphabetical representation (e.g. 0 is "A", 1 is "B", 25 is "Z", 26 is "AA")
 */
export function toLetterId(input: number): string {
    return (input < 26 ? '' : toLetterId(Math.floor(input / 26) - 1)) + String.fromCharCode((input % 26) + 65);
}

/**
 * TODO: This is experimental
 */
export function revealLettersGeometric(input: string): string {
    const letters: string[] = input.split('');
    let result = letters.shift();
    while (letters.length > 0) {
        const p = letters.length / input.length;
        if (Math.random() < p) {
            result += letters.shift();
        } else {
            break;
        }
    }
    return result;
}

/**
 * Take a given input float and return it rounded to some fixed number of decimal places.
 * @param input the float
 * @param places number of decimal places (defaults to 2)
 * @returns the float rounded to some fixed number of decimal places
 */
export function toFixed(input: number, places: number = 2): number {
    return parseFloat(input.toFixed(places));
}
