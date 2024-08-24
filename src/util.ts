import { APIEmbed, Message, Snowflake } from "discord.js";
import { Canvas, Image, createCanvas, CanvasRenderingContext2D as NodeCanvasRenderingContext2D } from "canvas";
import OpenAI from 'openai';
import { randChoice, randInt, LanguageGenerator } from "evanw555.js";
import { AnonymousSubmission, GoodMorningConfig } from "./types";

import { CONFIG, AUTH } from './constants';

interface Coordinates {
    x: number,
    y: number
}

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
    const baseline: number = options?.baseline ?? CONFIG.defaultAward;
    const maxPoints: number = options?.maxPoints ?? CONFIG.defaultAward;
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


// TODO: Move to common library
export async function drawTextCentered(context: NodeCanvasRenderingContext2D, text: string, left: number, right: number, y: number, options?: { padding?: number }) {
    const titleWidth = context.measureText(text).width;
    const padding = options?.padding ?? 0;
    const areaWidth = right - left - (2 * padding);
    if (titleWidth > areaWidth) {
        context.fillText(text, Math.floor(left + padding), y, areaWidth);
    } else {
        context.fillText(text, Math.floor(left + padding + (areaWidth - titleWidth) / 2), y);
    }
}

// TODO: Move to common library
export function getTextLabel(text: string, width: number, height: number, options?: { align?: 'center' | 'left' | 'right', font?: string, style?: string, alpha?: number }): Canvas {
    const ALIGN = options?.align ?? 'center';
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');

    context.font = options?.font ?? `${height * 0.6}px sans-serif`;
    context.fillStyle = options?.style ?? 'white';
    context.globalAlpha = options?.alpha ?? 1;

    const ascent = context.measureText(text).actualBoundingBoxAscent;
    const verticalMargin = (height - ascent) / 2;

    if (ALIGN === 'center') {
        drawTextCentered(context, text, 0, width, verticalMargin + ascent);
    } else if (ALIGN === 'right') {
        context.fillText(text, Math.floor(width - context.measureText(text).width), verticalMargin + ascent, width);
    } else {
        context.fillText(text, 0, verticalMargin + ascent, width);
    }

    context.restore();

    return canvas;
}

export function drawBackground(context: NodeCanvasRenderingContext2D, image: Canvas | Image) {
    const widthRatio = context.canvas.width / image.width;
    const heightRatio = context.canvas.height / image.height;
    const resizeFactor = Math.max(widthRatio, heightRatio);
    const resizedWidth = image.width * resizeFactor;
    const resizedHeight = image.height * resizeFactor;
    const x = (context.canvas.width - resizedWidth) / 2;
    const y = (context.canvas.height - resizedHeight) / 2;
    context.save();
    context.globalCompositeOperation = 'destination-over';
    context.drawImage(image, x, y, resizedWidth, resizedHeight);
    context.restore();
}

// TODO: Move this to the common library
export function superimpose(canvases: (Canvas | Image)[]): Canvas {
    const WIDTH = Math.max(...canvases.map(c => c.width));
    const HEIGHT = Math.max(...canvases.map(c => c.height));
    const canvas = createCanvas(WIDTH, HEIGHT);
    const context = canvas.getContext('2d');

    // Draw each canvas in order centered on the canvas
    for (const c of canvases) {
        context.drawImage(c, Math.round((WIDTH - c.width) / 2), Math.round((HEIGHT - c.height) / 2));
    }

    return canvas;
}

// TODO: Move to common library
export function setHue(image: Image | Canvas, style: string): Canvas {
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');

    context.drawImage(image, 0, 0);

    context.save();
    context.globalCompositeOperation = 'hue';
    context.fillStyle = style;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();

    return canvas;
}
// TODO: Move to common utility
/**
 * @param image Source image/canvas
 * @param angle Angle (in radians) to rotate the image clockwise
 */
export function getRotated(image: Image | Canvas, angle: number): Canvas {
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');

    context.save();
    // Set the origin to the middle of the canvas
    context.translate(canvas.width / 2,canvas.height / 2);
    // Adjust the context space to be rotated
    context.rotate(angle);
    // Draw the rotated image
    context.drawImage(image, Math.round(-image.width / 2), Math.round(-image.width / 2));
    context.restore();

    return canvas;
}

// TODO: Move to common library
export function crop(image: Image | Canvas, options?: { x?: number, y?: number, width?: number, height?: number, horizontal?: 'left' | 'center' | 'right' | 'custom', vertical?: 'top' | 'center' | 'bottom' | 'custom'}): Canvas {
    const WIDTH = options?.width ?? image.width;
    const HEIGHT = options?.height ?? image.height;
    const HORIZONTAL = options?.horizontal ?? 'center';
    const VERTICAL = options?.vertical ?? 'center';

    const canvas = createCanvas(WIDTH, HEIGHT);
    const context = canvas.getContext('2d');

    let x = -(options?.x ?? 0);
    switch (HORIZONTAL) {
        case 'left':
            x = 0;
            break;
        case 'center':
            x = Math.round((WIDTH - image.width) / 2);
            break;
        case 'right':
            x = WIDTH - image.width;
            break;
        case 'custom':
            // Let override remain
            break;
    }

    let y = -(options?.y ?? 0);
    switch (VERTICAL) {
        case 'top':
            y = 0;
            break;
        case 'center':
            y = Math.round((HEIGHT - image.height) / 2);
            break;
        case 'bottom':
            y = HEIGHT - image.height;
            break;
        case 'custom':
            // Let override remain
            break;
    }

    context.drawImage(image, x, y);

    return canvas;
}

// TODO: Move to common library
export function cropAroundPoints(image: Image | Canvas, points: { x: number, y: number }[], options?: { margin?: number }): Canvas {
    if (points.length === 0) {
        throw new Error('Cannot crop around no points!');
    }
    const leftX = Math.min(...points.map(p => p.x));
    const rightX = Math.max(...points.map(p => p.x));
    const topY = Math.min(...points.map(p => p.y));
    const bottomY = Math.max(...points.map(p => p.y));
    const margin = options?.margin ?? 0;

    return crop(image, {
        x: leftX - margin,
        y: topY - margin,
        width: rightX - leftX + 2 * margin,
        height: bottomY - topY + 2 * margin,
        horizontal: 'custom',
        vertical: 'custom'
    });
}

// TODO: Move to common library
export function renderArrow(context: CanvasRenderingContext2D, from: Coordinates, to: Coordinates, options?: { thickness?: number, tipLength?: number, fillStyle?: string, tailPadding?: number, tipPadding?: number }): {
    tail: Coordinates,
    center: Coordinates,
    head: Coordinates
} {
    const getPointRelative = (point: Coordinates, distance: number, angle: number): Coordinates => {
        const { x, y } = point;
        const dx = distance * Math.cos(angle);
        const dy = distance * Math.sin(angle);
        return {
            x: x + dx,
            y: y + dy
        };
    };

    const tailPadding = options?.tailPadding ?? 0;
    const tipPadding = options?.tipPadding ?? 0;

    const t = options?.thickness ?? 10;
    const l = distance(from, to) - tailPadding - tipPadding;
    const tl = options?.tipLength ?? t;
    const tt = t * 2;

    const theta = Math.atan2(to.y - from.y, to.x - from.x);
    const hpi = Math.PI / 2;

    const trueFrom = getPointRelative(from, tailPadding, theta);
    const trueTo = getPointRelative(to, -tailPadding, theta);

    const rear1 = getPointRelative(trueFrom, t / 2, theta + hpi);
    const rear2 = getPointRelative(trueFrom, t / 2, theta - hpi);
    const notch1 = getPointRelative(rear1, l - tl, theta);
    const notch2 = getPointRelative(rear2, l - tl, theta);
    const side1 = getPointRelative(notch1, (tt - t) / 2, theta + hpi);
    const side2 = getPointRelative(notch2, (tt - t) / 2, theta - hpi);
    const tip = trueTo;

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

    return {
        tail: trueFrom,
        center: {
            x: Math.round((trueFrom.x + trueTo.x) / 2),
            y: Math.round((trueFrom.y + trueTo.y) / 2)
        },
        head: trueTo
    };
}

// TODO: Move to common library
export function distance(a: Coordinates, b: Coordinates): number {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

// TODO: Can we move this to a common library?
// TODO: This isn't perfect, can it be improved?
export function quantify(quantity: number, noun: string, options?: { bold?: boolean }): string {
    const bold = options?.bold ?? true;
    let result = '';
    if (bold) {
        result += `**${quantity}**`;
    } else {
        result += `${quantity}`;
    }
    if (quantity === 1) {
        result += ` ${noun}`;
    } else if (noun.endsWith('y')) {
        result += ` ${noun.replace(/y$/, 'ies')}`;
    } else {
        result += ` ${noun}s`;
    }
    return result;
}

/**
 * Generates text with a config-less language generator object.
 */
export function text(input: string, variables?: Record<string, string>): string {
    const generator = new LanguageGenerator({});
    return generator.generate(input, variables);
}

/**
 * Using some text prompt, use OpenAI to generate a text response.
 */
export async function generateWithAi(prompt: string): Promise<string> {
    const openai = new OpenAI({
        apiKey: AUTH.openAiKey
    });
    const response = await openai.completions.create({
        model: "gpt-3.5-turbo-instruct",
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

/**
 * Given some source list, returns a copy shortened to the desired list by removing elements at even intervals.
 * @param values Source list
 * @param newLength Desired length of shortened list
 * @returns Copy of the source list shortened to the desired length
 */
// TODO: Move to common library
export function getEvenlyShortened<T>(values: T[], newLength: number): T[] {
    const result: T[] = [];
    const n = values.length;
    for (let i = 0; i < newLength; i++) {
        const sourceIndex = Math.floor(i * n / newLength);
        result[i] = values[sourceIndex];
    }
    return result;
}

/**
 * Given a list of string options, a specified length, and the specified number of sequential repeats to avoid,
 * generates an N-length random sequences of string options without letting the same elements be within M indices of each other.
 * @param choices Choices to use when populating each element
 * @param m Number of recent elements to avoid using
 * @param n Length of output list
 * @returns Random nonsequential sequence of strings
 */
// TODO: Move to common library
export function generateRandomNonsequentialSequence<T>(choices: T[], m: number, n: number) {
    const result: T[] = [];
    for (let i = 0; i < n; i++) {
        const banned = result.slice(-m);
        const validChoices = choices.filter(o => !banned.includes(o));
        const element = validChoices[Math.floor(Math.random() * validChoices.length)];
        result.push(element);
    }
    return result;
}

// TODO: Move to common library
export function withAn(input: string): string {
    if ('aeiou'.includes(input.replace(/[^0-9a-z]/gi, '').toLowerCase().charAt(0))) {
        return `an ${input}`;
    }
    return `a ${input}`;
}