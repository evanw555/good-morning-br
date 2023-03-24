import canvas, { Image } from 'canvas';
import { Wordle } from "./types";

export async function renderWordleState(wordle: Wordle): Promise<Buffer> {
    const NUM_LETTERS = wordle.solution.length;
    const NUM_GUESSES = wordle.guesses.length;
    const TILE_SIZE = 64;
    const TILE_MARGIN = 4;
    const WIDTH = NUM_LETTERS * TILE_SIZE + (NUM_LETTERS + 1) * TILE_MARGIN;
    const HEIGHT = NUM_GUESSES * TILE_SIZE + (NUM_GUESSES + 1) * TILE_MARGIN;
    const c = canvas.createCanvas(WIDTH, HEIGHT);
    const context = c.getContext('2d');

    // Fill the blue sky background
    context.fillStyle = 'black';
    context.fillRect(0, 0, WIDTH, HEIGHT);

    // Draw the guesses
    for (let i = 0; i < NUM_GUESSES; i++) {
        const guess = wordle.guesses[i];
        const y = TILE_MARGIN + i * (TILE_SIZE + TILE_MARGIN);
        for (let j = 0; j < NUM_LETTERS; j++) {
            const letter = guess[j];
            const x = TILE_MARGIN + j * (TILE_SIZE + TILE_MARGIN);
            // Determine color
            if (wordle.solution[j] === letter) {
                context.fillStyle = 'green';
            } else if (wordle.solution.includes(letter)) {
                context.fillStyle = 'gold';
            } else {
                context.fillStyle = 'gray';
            }
            // Fill rect
            context.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            // Draw letter
            context.font = `${TILE_SIZE * .8}px sans-serif`;
            context.strokeStyle = 'white';
            context.lineWidth = TILE_MARGIN / 2;
            const width = context.measureText(letter).width;
            const horizontalMargin = (TILE_SIZE - width) / 2;
            const ascent = context.measureText(letter).actualBoundingBoxAscent;
            const verticalMargin = (TILE_SIZE - ascent) / 2;
            context.strokeText(letter, x + horizontalMargin, y + verticalMargin + ascent);
        }
    }

    return c.toBuffer();
}