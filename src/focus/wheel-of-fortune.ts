import { createCanvas } from "canvas";
import { WheelOfFortune } from "../types";
import { getTextLabel } from "../util";

export async function renderWheelOfFortuneState(wofState: WheelOfFortune): Promise<Buffer> {
    const words = wofState.solution
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .split(' ')
        .filter(x => x);
    const maxWordLength = Math.max(...words.map(w => w.length));
    const COLUMNS = Math.max(maxWordLength, 12);

    // Put all the words onto different rows such that they all fit
    const grid: string[] = [''];
    for (const word of words) {
        const index = grid.length - 1;
        const currentRowLength = grid[index].length;
        // If row is empty and it can fit, add without a space
        if (currentRowLength === 0 && word.length <= COLUMNS) {
            grid[index] += word;
        }
        // If the new word plus one space can fit on this row, add it
        else if (currentRowLength + 1 + word.length <= COLUMNS) {
            grid[index] += ' ' + word;
        }
        // Otherwise, push to a new row
        else {
            grid[index] += ' '.repeat(COLUMNS - currentRowLength);
            grid.push(word);
        }
    }
    // Fill in trailing spaces on the last row
    const lastIndex = grid.length - 1;
    const lastRowLength = grid[lastIndex].length;
    grid[lastIndex] += ' '.repeat(COLUMNS - lastRowLength);

    const ROWS = grid.length;
    const TILE_SIZE = 48;
    const MARGIN = 4;

    const WIDTH = COLUMNS * TILE_SIZE + (COLUMNS + 1) * MARGIN;
    const HEIGHT = ROWS * TILE_SIZE + (ROWS + 1) * MARGIN;

    const canvas = createCanvas(WIDTH, HEIGHT);
    const context = canvas.getContext('2d');

    // Fill the background
    context.fillStyle = 'black';
    context.fillRect(0, 0, WIDTH, HEIGHT);

    // Draw each row
    let baseY = MARGIN;
    for (const row of grid) {
        let baseX = MARGIN;
        for (const letter of row) {
            if (letter === ' ') {
                context.fillStyle = '#003333';
                context.fillRect(baseX, baseY, TILE_SIZE, TILE_SIZE);
            } else {
                context.fillStyle = 'white';
                context.fillRect(baseX, baseY, TILE_SIZE, TILE_SIZE);
                // Draw the letter if it's not a letter or has already been guessed
                if (!letter.match(/[A-Z]/) || wofState.letters.includes(letter)) {
                    const letterImage = getTextLabel(letter, TILE_SIZE, TILE_SIZE, { align: 'center', style: 'black', font: `bold ${TILE_SIZE * 0.75}px sans-serif` });
                    context.drawImage(letterImage, baseX, baseY);
                }
            }
            baseX += TILE_SIZE + MARGIN;
        }
        baseY += TILE_SIZE + MARGIN;
    }

    return canvas.toBuffer();
}