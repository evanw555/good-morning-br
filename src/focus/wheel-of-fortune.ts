import { Canvas, createCanvas } from "canvas";
import { WheelOfFortune } from "../types";
import { drawBackground, getTextLabel } from "../util";
import { joinCanvasesHorizontal, joinCanvasesVertical, randChoice, withDropShadow, withMargin } from "evanw555.js";

import imageLoader from "../image-loader";
import { AttachmentBuilder } from "discord.js";

export async function renderWheelOfFortuneState(wofState: WheelOfFortune): Promise<AttachmentBuilder> {
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

    // If there aren't enough rows, add one to the bottom
    if (grid.length < 3) {
        grid.push(' '.repeat(COLUMNS));
    }
    // If there still aren't enough, add one to the top
    if (grid.length < 3) {
        grid.unshift(' '.repeat(COLUMNS));
    }

    const ROWS = grid.length;

    // Count the number of trailing columns comprised of only spaces
    let numTrailingSpaceColumns = 0;
    for (let i = COLUMNS - 1; i >= 0; i--) {
        if (grid.some(row => row[i] !== ' ')) {
            break;
        }
        numTrailingSpaceColumns++;
    }
    // Rotate half of them to the left of each row
    const numRotations = Math.floor(numTrailingSpaceColumns / 2);
    for (let i = 0; i < numRotations; i++) {
        for (let j = 0; j < ROWS; j++) {
            grid[j] = grid[j].slice(-1) + grid[j].slice(0, -1);
        }
    }

    const TILE_WIDTH = 36;
    const TILE_HEIGHT = 48;
    const MARGIN = 4;

    const WIDTH = COLUMNS * TILE_WIDTH + (COLUMNS + 1) * MARGIN;
    const HEIGHT = ROWS * TILE_HEIGHT + (ROWS + 1) * MARGIN;

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
                context.fillRect(baseX, baseY, TILE_WIDTH, TILE_HEIGHT);
            } else {
                context.fillStyle = 'white';
                context.fillRect(baseX, baseY, TILE_WIDTH, TILE_HEIGHT);
                // Draw the letter if it's not a letter or has already been guessed
                if (!letter.match(/[A-Z]/) || wofState.usedLetters.includes(letter)) {
                    const letterImage = getTextLabel(letter, TILE_WIDTH, TILE_HEIGHT, { align: 'center', style: 'black', font: `bold ${TILE_HEIGHT * 0.75}px sans-serif` });
                    context.drawImage(letterImage, baseX, baseY);
                }
            }
            baseX += TILE_WIDTH + MARGIN;
        }
        baseY += TILE_HEIGHT + MARGIN;
    }

    // Construct the "used letters" label
    const letterLabels: Canvas[] = [];
    for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i);
        const label = getTextLabel(letter, TILE_WIDTH / 2, TILE_HEIGHT / 2, { alpha: wofState.usedLetters.includes(letter) ? 0.15 : 1});
        letterLabels.push(label);
    }

    // Add category at the top, letters at the bottom
    const compositeCanvas = withMargin(
        joinCanvasesVertical([
            getTextLabel(wofState.category, WIDTH, TILE_HEIGHT * 0.75, { style: 'white' }),
            canvas,
            joinCanvasesHorizontal(letterLabels)
        ], { align: 'center', spacing: MARGIN }),
        Math.round(TILE_WIDTH / 2)
    );

    // Add drop shadow to everything
    const finalCanvas = withDropShadow(compositeCanvas, { distance: 2 });

    // Draw the image background
    const backgroundImage = await imageLoader.loadImage('assets/common/blueblur.jpg');
    drawBackground(finalCanvas.getContext('2d'), backgroundImage);

    return new AttachmentBuilder(finalCanvas.toBuffer()).setName('wheel-of-fortune.png');
}

export async function spinWheelOfFortune(): Promise<{ render: AttachmentBuilder, spinValue: number }> {
    // TODO: Have a better system for spinning
    const spinValue = randChoice(
        250,
        10,
        60,
        70,
        60,
        65,
        50,
        70,
        500,
        60,
        55,
        50,
        60,
        -1,
        65,
        20,
        70,
        0,
        80,
        50,
        65,
        50,
        90,
        -1
    );
    // TODO: Actually render a real wheel
    const canvas = getTextLabel(spinValue.toString(), 32, 32);
    return {
        spinValue,
        render: new AttachmentBuilder(canvas.toBuffer()).setName('temp-spin.png')
    };
}