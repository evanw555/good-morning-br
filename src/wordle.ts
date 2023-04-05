import canvas from 'canvas';
import { Wordle } from "./types";
import { Snowflake, User } from 'discord.js';

export function getProgressOfGuess(wordle: Wordle, guess: string): number {
    const NUM_LETTERS = wordle.solution.length;
    let num = 0;
    for (let i = 0; i < NUM_LETTERS; i++) {
        const isCorrect = wordle.solution[i] === guess[i];
        const isNew = !wordle.guesses.some(g => wordle.solution[i] === g[i]);
        if (isCorrect && isNew) {
            num++;
        }
    }
    return num;
}

export async function renderWordleState(wordle: Wordle, members?: Record<Snowflake, User>): Promise<Buffer> {
    const showMembers: boolean = members !== undefined;
    const NUM_LETTERS = wordle.solution.length;
    const NUM_COLUMNS = NUM_LETTERS + (showMembers ? 1 : 0);
    const NUM_GUESSES = wordle.guesses.length;
    const NUM_ROWS = NUM_GUESSES + (showMembers ? 1 : 0);
    const TILE_SIZE = 48;
    const TILE_MARGIN = 4;
    const WIDTH = NUM_COLUMNS * TILE_SIZE + (NUM_COLUMNS + 1) * TILE_MARGIN;
    const HEIGHT = NUM_ROWS * TILE_SIZE + (NUM_ROWS + 1) * TILE_MARGIN;
    const c = canvas.createCanvas(WIDTH, HEIGHT);
    const context = c.getContext('2d');

    // Fill the background
    context.fillStyle = 'black';
    context.fillRect(0, 0, WIDTH, HEIGHT);

    // Save state for each of the letter owners
    const letterOwners: (Snowflake | null)[] = [];
    for (let j = 0; j < NUM_LETTERS; j++) {
        letterOwners.push(null);
    }

    // Draw the guesses
    for (let i = 0; i < NUM_GUESSES; i++) {
        const guess = wordle.guesses[i];
        const y = TILE_MARGIN + i * (TILE_SIZE + TILE_MARGIN);
        const ownerId = wordle.guessOwners[i];
        for (let j = 0; j < NUM_LETTERS; j++) {
            const letter = guess[j];
            const x = TILE_MARGIN + j * (TILE_SIZE + TILE_MARGIN);
            // Determine color
            if (wordle.solution[j] === letter) {
                context.fillStyle = 'green';
                // If this letter hasn't been claimed yet, claim it for this user
                if (letterOwners[j] === null) {
                    letterOwners[j] = ownerId;
                }
            } else if (wordle.solution.includes(letter)) {
                context.fillStyle = 'goldenrod';
            } else {
                context.fillStyle = 'gray';
            }
            // Fill rect
            context.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            // Draw letter
            context.font = `${TILE_SIZE * .9}px sans-serif`;
            context.strokeStyle = 'white';
            context.lineWidth = TILE_MARGIN / 2;
            const width = context.measureText(letter).width;
            const horizontalMargin = (TILE_SIZE - width) / 2;
            const ascent = context.measureText(letter).actualBoundingBoxAscent;
            const verticalMargin = (TILE_SIZE - ascent) / 2;
            context.strokeText(letter, x + horizontalMargin, y + verticalMargin + ascent);
        }
        // If showing members, render avatars on the side
        if (showMembers && members) {
            const member = members[ownerId];
            if (member) {
                try {
                    const avatarUrl = member.displayAvatarURL({ size: 64, extension: 'png' });
                    const avatar = await canvas.loadImage(avatarUrl);
                    const x = TILE_MARGIN + NUM_LETTERS * (TILE_SIZE + TILE_MARGIN);
                    context.drawImage(avatar, x, y, TILE_SIZE, TILE_SIZE);
                } catch (err) {
                    // TODO: Fallback?
                }
            }
        }
    }

    // If showing members, render avatars on the bottom
    if (showMembers && members) {
        for (let j = 0; j < NUM_LETTERS; j++) {
            const letterOwnerId = letterOwners[j];
            if (letterOwnerId) {
                const member = members[letterOwnerId];
                if (member) {
                    try {
                        const avatarUrl = member.displayAvatarURL({ size: 64, extension: 'png' });
                        const avatar = await canvas.loadImage(avatarUrl);
                        const x = TILE_MARGIN + NUM_LETTERS * (TILE_SIZE + TILE_MARGIN);
                        const y = TILE_MARGIN + NUM_GUESSES * (TILE_SIZE + TILE_MARGIN);
                        context.drawImage(avatar, x, y, TILE_SIZE, TILE_SIZE);
                    } catch (err) {
                        // TODO: Fallback?
                    }
                }
            }
        }
    }

    return c.toBuffer();
}