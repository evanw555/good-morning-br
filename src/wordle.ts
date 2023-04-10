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

export async function renderWordleState(wordle: Wordle, options?: { members: Record<Snowflake, User>, hiScores: Record<Snowflake, number> }): Promise<Buffer> {
    const showMembers: boolean = options !== undefined;
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
    let winnerId: Snowflake | null = null;
    const currentPlayerScores: Record<Snowflake, number> = {};

    const drawAvatar = async (userId: Snowflake, xIndex: number, yIndex: number) => {
        if (showMembers && options) {
            const member = options.members[userId];
            if (member) {
                try {
                    const avatarUrl = member.displayAvatarURL({ size: 64, extension: 'png' });
                    const avatar = await canvas.loadImage(avatarUrl);
                    // If this wasn't the player's high score, render their avatar faintly
                    const isHiScore = currentPlayerScores[userId] === options.hiScores[userId];
                    context.globalAlpha = isHiScore ? 1 : 0.5;
                    context.drawImage(avatar,
                        TILE_MARGIN + xIndex * (TILE_SIZE + TILE_MARGIN),
                        TILE_MARGIN + yIndex * (TILE_SIZE + TILE_MARGIN),
                        TILE_SIZE,
                        TILE_SIZE);
                    // Reset the global alpha to ensure it doesn't affect other renderings
                    context.globalAlpha = 1;
                    // If this wasn't their high score, render a red X through the avatar
                    if (!isHiScore) {
                        const xLeft = TILE_MARGIN + xIndex * (TILE_SIZE + TILE_MARGIN);
                        const xRight = TILE_MARGIN + xIndex * (TILE_SIZE + TILE_MARGIN) + TILE_SIZE;
                        const yTop = TILE_MARGIN + yIndex * (TILE_SIZE + TILE_MARGIN);
                        const yBottom = TILE_MARGIN + yIndex * (TILE_SIZE + TILE_MARGIN) + TILE_SIZE;
                        context.strokeStyle = 'red';
                        context.lineWidth = 3;
                        context.setLineDash([]);
                        context.beginPath();
                        context.moveTo(xLeft, yTop);
                        context.lineTo(xRight, yBottom);
                        context.moveTo(xLeft, yBottom);
                        context.lineTo(xRight, yTop);
                        context.stroke();
                    }
                } catch (err) {
                    // TODO: Fallback?
                }
            }
        }
    };

    // Draw the guesses
    for (let i = 0; i < NUM_GUESSES; i++) {
        const guess = wordle.guesses[i];
        const y = TILE_MARGIN + i * (TILE_SIZE + TILE_MARGIN);
        const ownerId = wordle.guessOwners[i];
        currentPlayerScores[ownerId] = 1;
        // If this was the winning guess, set them as the winner
        if (guess === wordle.solution) {
            winnerId = ownerId;
            currentPlayerScores[ownerId]++;
        }
        for (let j = 0; j < NUM_LETTERS; j++) {
            const letter = guess[j];
            const x = TILE_MARGIN + j * (TILE_SIZE + TILE_MARGIN);
            // Determine color
            if (wordle.solution[j] === letter) {
                context.fillStyle = 'green';
                // If this letter hasn't been claimed yet, claim it for this user
                if (letterOwners[j] === null) {
                    letterOwners[j] = ownerId;
                    currentPlayerScores[ownerId]++;
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
        // Render avatars on the side along each row
        await drawAvatar(ownerId, NUM_LETTERS, i);
    }

    // Render avatars on the bottom for each column
    for (let j = 0; j < NUM_LETTERS; j++) {
        const letterOwnerId = letterOwners[j];
        if (letterOwnerId) {
            await drawAvatar(letterOwnerId, j, NUM_GUESSES);
        }
    }
    // Render the winner's avatar in the corner
    if (winnerId) {
        await drawAvatar(winnerId, NUM_LETTERS, NUM_GUESSES);
    }

    return c.toBuffer();
}