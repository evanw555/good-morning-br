import { APIEmbed, Message, Snowflake } from "discord.js";
import OpenAI from 'openai';
import { randChoice, randInt, loadJson, LanguageGenerator } from "evanw555.js";
import { AnonymousSubmission, GoodMorningAuth, GoodMorningConfig } from "./types";

const auth: GoodMorningAuth = loadJson('config/auth.json');
const config: GoodMorningConfig = loadJson('config/config.json');

export function validateConfig(config: GoodMorningConfig): void {
    if (config.goodMorningChannelId === undefined) {
        console.log('No goodMorningChannelId is set in the config, aborting...');
        process.exit(1);
    }
    if (config.goodMorningMessageProbability === undefined) {
        config.goodMorningMessageProbability = 1;
    }
    if (config.replyViaReactionProbability === undefined) {
        config.replyViaReactionProbability = 0;
    }
}

/**
 * @returns YouTube video ID from the given text (may contain more text than just a URL), or undefined if no ID detected
 */
export function extractYouTubeId(text?: string): string | undefined {
    if (!text) {
        return undefined;
    }
    const url = text.split(/(vi\/|v=|\/v\/|youtu\.be\/|\/embed\/|\/shorts\/)/);
    const result = (url[2] !== undefined) ? url[2].split(/[^0-9a-z_\-]/i)[0] : url[0];
    if (result && result.match(/^[a-zA-Z0-9_-]+$/)) {
        return result;
    }
    return undefined;
  }

/**
 * Returns true if the given message contains a video or (potentially animated) GIF.
 */
export function hasVideo(msg: Message): boolean {
    return msg.attachments?.some(x => x.contentType?.includes('video/') || x.contentType === 'image/gif')
        || msg.embeds?.some(x => x.video)
        // Next to manually check for YouTube links since apparently the embeds check doesn't always work...
        || msg.content.includes('https://youtu.be/')
        || msg.content.includes('https://youtube.com/')
        || msg.content.includes('https://www.youtube.com/')
        || msg.content.includes('https://m.youtube.com/');
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

// TODO: Export to common util library
export function getOrderingUpset(upsetter: Snowflake, before: Snowflake[], after: Snowflake[]): Snowflake[] {
    const beforeIndex: number = before.indexOf(upsetter);
    const afterIndex: number = after.indexOf(upsetter);
    const beforeAll: Set<Snowflake> = new Set(before);
    const beforeInferiors: Set<Snowflake> = new Set(before.slice(beforeIndex + 1));
    const afterInferiors: Snowflake[] = after.slice(afterIndex + 1);
    // "Upsets" defined as the set of all inferiors that were previously not inferiors (yet were still in the game)
    return afterInferiors.filter(x => !beforeInferiors.has(x) && beforeAll.has(x));
}

// TODO: Export to common util library
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

/**
 * TODO: This is experimental
 */
export function revealLettersGeometric(input: string): string {
    const letters: string[] = input.split('');
    let result = letters.shift() ?? '';
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

export function toSubmissionEmbed(submission: AnonymousSubmission): APIEmbed {
    const embed: APIEmbed = {};
    if (submission.text) {
        embed.description = submission.text;
    }
    if (submission.url) {
        embed.image = { url: submission.url };
    }
    return embed;
}

export function toSubmission(message: Message): AnonymousSubmission {
    const submission: AnonymousSubmission = {};
    if (message.content.trim()) {
        submission.text = message.content.trim();
    }
    if (message.attachments.size === 1) {
        const attachment = message.attachments.first();
        if (attachment) {
            if (attachment.contentType) {
                if (attachment.contentType === 'image/gif') {
                    throw new Error('No GIFs, buddy!');
                }
                if (attachment.contentType.startsWith('video')) {
                    throw new Error('No videos, pal!');
                }
                if (!attachment.contentType.startsWith('image')) {
                    throw new Error('Didn\'t you mean to send me an image?');
                }
                submission.url = attachment.url;
            } else {
                throw new Error('Hmmmm I can\'t see the content type of your attachment... tell the admin about this');
            }
        } else {
        throw new Error('Hmmmm I don\'t see your attachment... tell the admin about this');
        }
    } else if (message.attachments.size > 1) {
        throw new Error('Hey! Too many attachments, wise guy');
    }
    return submission;
}

/**
 * @returns The user IDs of all non-bot users directly mentioned in this message (replying doesn't count as a mention)
 */
export function getMessageMentions(msg: Message): Snowflake[] {
    return msg.mentions.parsedUsers.toJSON().filter(u => !u.bot).map(u => u.id);
}

/**
 * // TODO: Refactor to common library
 * @returns The given text in lower-case with all non-alphanumeric characters removed
 */
export function canonicalizeText(text: string): string {
    return text.toLowerCase()
        // Remove non-alphanumeric characters
        .replace(/[^0-9a-zA-Z]/g, '');
}

interface ScaledPointsInputEntry {
    userId: Snowflake,
    rank: number
}

interface ScaledPointsOutputEntry extends ScaledPointsInputEntry {
    points: number
}

interface ScaledPointsOptions {
    baseline?: number,
    maxPoints?: number,
    order?: number
}

export function getSimpleScaledPoints(userIds: Snowflake[], options?: ScaledPointsOptions): ScaledPointsOutputEntry[] {
    return getScaledPoints(userIds.map((userId, i) => ({ userId, rank: i + 1 })), options);
}

export function getScaledPoints(entries: { userId: Snowflake, rank: number }[], options?: ScaledPointsOptions): ScaledPointsOutputEntry[] {
    const baseline: number = options?.baseline ?? config.defaultAward;
    const maxPoints: number = options?.maxPoints ?? config.defaultAward;
    const order: number = options?.order ?? 1;

    const n = entries.length;

    const results: ScaledPointsOutputEntry[] = [];
    for (const entry of entries) {
        const userId = entry.userId;
        const rank = entry.rank;
        const x = 1 - ((rank - 1) / (n - 1));
        const points = baseline + (maxPoints - baseline) * Math.pow(x, order);
        results.push({
            userId,
            points,
            rank
        });
    }

    return results;
}

// TODO: Move to common library
export function getMaxKey<T>(keys: T[], valueFn: (x: T) => number): T {
    let maxValue = Number.MIN_SAFE_INTEGER;
    let bestKey: T = keys[0];
    for (const key of keys) {
        const value = valueFn(key);
        if (value > maxValue) {
            bestKey = key;
            maxValue = value;
        }
    }
    return bestKey;
}

// TODO: Move to common library
export function getMinKey<T>(keys: T[], valueFn: (x: T) => number): T {
    let minValue = Number.MAX_SAFE_INTEGER;
    let bestKey: T = keys[0];
    for (const key of keys) {
        const value = valueFn(key);
        if (value < minValue) {
            bestKey = key;
            minValue = value;
        }
    }
    return bestKey;
}

/**
 * Generates text with a config-less language generator object.
 */
export function text(input: string): string {
    const generator = new LanguageGenerator({});
    return generator.generate(input);
}

/**
 * Using some text prompt, use OpenAI to generate a text response.
 */
export async function generateWithAi(prompt: string): Promise<string> {
    const openai = new OpenAI({
        apiKey: auth.openAiKey
    });
    const response = await openai.completions.create({
        model: 'text-davinci-003',
        prompt,
        temperature: 0.9,
        max_tokens: 256,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
    });
    return response.choices[0].text;
}

export async function generateSynopsisWithAi(story: string): Promise<string> {
    return await generateWithAi('The following is a story told by several different storytellers:\n\n'
        + story
        + '\n\nThis concludes the story. Now that the story has ended, please give a synopsis of the story, explaining the premise, conflict, and characters.')
}