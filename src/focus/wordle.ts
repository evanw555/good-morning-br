import canvas from 'canvas';
import { AttachmentBuilder, Message, MessageFlags, Snowflake } from 'discord.js';
import { WordlePuzzle } from './types';
import AbstractFocusHandler from './abstract-focus';
import { randChoice, randInt, PastTimeoutStrategy, getRankString, s } from 'evanw555.js';
import { TimeoutType, MessengerPayload } from '../types';
import { getSimpleScaledPoints } from '../util';

import { CONFIG } from '../constants';

import imageLoader from '../image-loader';
import controller from '../controller';
import logger from '../logger';

export class WordleFocusGame extends AbstractFocusHandler {
    override async getGoodMorningMessage(intro: string): Promise<MessengerPayload> {
        const { state } = controller.getAllReferences();

        const wordle = state.getFocusGame();
        if (wordle.type !== 'WORDLE') {
            // TODO: How do we handle this?
            return '';
        }

        const puzzle = wordle.puzzle;
        if (!puzzle) {
            // TODO: How do we handle this?
            return '';
        }

        return `${intro} Today I have a special puzzle for you... we'll be playing my own proprietary morningtime game called _Wordle_! `
            + `I'm thinking of a **${puzzle.solution.length ?? '???'}**-letter word, and you each get only one guess! You'll earn points for each new _green_ letter you reveal. Good luck!`;
    }
    override async onMorningMessage(message: Message<boolean>): Promise<void> {
        const { state, timeoutManager, messenger } = controller.getAllReferences();

        const wordle = state.getFocusGame();
        if (wordle.type !== 'WORDLE') {
            return;
        }

        // Even if the message is invalid, give them zero points to mark them as "active" for the day
        const userId = message.author.id;
        wordle.scores[userId] = (wordle.scores[userId] ?? 0);

        const puzzle = wordle.puzzle;
        if (!puzzle) {
            return;
        }

        // If this user hasn't guessed yet for this puzzle, process their guess
        if (!puzzle.guessOwners.includes(userId)) {
            const wordleGuess = message.content.trim().toUpperCase();
            // Ignore this guess if it isn't one single word
            if (!wordleGuess.match(/^[A-Z]+$/)) {
                return;
            }
            // Ignore the user if they solved the previous puzzle
            if (userId === wordle.blacklistedUserId) {
                await messenger.reply(message, 'You solved the previous puzzle, give someone else a chance!');
                return;
            }
            // Cut the user off if their guess isn't the right length
            if (wordleGuess.length !== puzzle.solution.length) {
                await messenger.reply(message, `Try again but with a **${puzzle.solution.length}**-letter word`);
                return;
            }
            // Get progress of this guess in relation to the current state of the puzzle
            const progress = WordleFocusGame.getProgressOfGuess(puzzle, wordleGuess);
            // Add this guess
            puzzle.guesses.push(wordleGuess);
            puzzle.guessOwners.push(userId);
            // If this guess is correct, end the game
            if (puzzle.solution === wordleGuess) {
                // Wipe the round data to prevent further action until the next round starts (race conditions)
                delete wordle.puzzle;
                // Set this user as the blacklisted user for next round
                wordle.blacklistedUserId = userId;
                // Determine this user's score (1 default + 1 for each new tile + 1 for winning)
                // We must do this before we show the solved puzzle so their hi-score is reflected accurately.
                const score = CONFIG.defaultAward * (2 + progress);
                wordle.scores[userId] = Math.max(wordle.scores[userId] ?? 0, score);
                // Notify the channel
                await messenger.reply(message, {
                    content: 'Congrats, you\'ve solved the puzzle!',
                    files: [new AttachmentBuilder(await WordleFocusGame.renderWordleState(puzzle, {
                        hiScores: wordle.scores
                    })).setName('wordle.png')]
                });
                await messenger.send(message.channel, `Count how many times your avatar appears, that's your score ${CONFIG.defaultGoodMorningEmoji}`);
                // Schedule the next round
                const wordleRestartDate = new Date();
                wordleRestartDate.setMinutes(wordleRestartDate.getMinutes() + randInt(5, 25));
                await timeoutManager.registerTimeout(TimeoutType.FocusCustom, wordleRestartDate, { pastStrategy: PastTimeoutStrategy.Delete});
            } else {
                // Determine this user's score (1 default + 1 for each new tile)
                const score = CONFIG.defaultAward * (1 + progress);
                wordle.scores[userId] = Math.max(wordle.scores[userId] ?? 0, score);
                // Reply letting them know how many letter they've revealed (suppress notifications to reduce spam)
                await messenger.reply(message, {
                    content: progress ? `You've revealed ${progress} new letter${s(progress)}!` : 'Hmmmmm...',
                    files: [new AttachmentBuilder(await WordleFocusGame.renderWordleState(puzzle)).setName('wordle.png')],
                    flags: MessageFlags.SuppressNotifications
                });
            }
            await controller.dumpState();
        }
    }

    static getProgressOfGuess(puzzle: WordlePuzzle, guess: string): number {
        const NUM_LETTERS = puzzle.solution.length;
        let num = 0;
        for (let i = 0; i < NUM_LETTERS; i++) {
            const isCorrect = puzzle.solution[i] === guess[i];
            const isNew = !puzzle.guesses.some(g => puzzle.solution[i] === g[i]);
            if (isCorrect && isNew) {
                num++;
            }
        }
        return num;
    }

    static async renderWordleState(puzzle: WordlePuzzle, options?: { hiScores: Record<Snowflake, number> }): Promise<Buffer> {
        const NUM_LETTERS = puzzle.solution.length;
        const NUM_COLUMNS = NUM_LETTERS + (options ? 1 : 0);
        const NUM_GUESSES = puzzle.guesses.length;
        const NUM_ROWS = NUM_GUESSES + (options ? 1 : 0);
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
            if (options) {
                try {
                    const avatar = await imageLoader.loadAvatar(userId, 64);
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
        };

        // Draw the guesses
        for (let i = 0; i < NUM_GUESSES; i++) {
            const guess = puzzle.guesses[i];
            const y = TILE_MARGIN + i * (TILE_SIZE + TILE_MARGIN);
            const ownerId = puzzle.guessOwners[i];
            // Generally, there should only be one guess per player, but this handles players with multiple guesses just in case...
            currentPlayerScores[ownerId] = (currentPlayerScores[ownerId] ?? 0) + 1;
            // If this was the winning guess, set them as the winner
            if (guess === puzzle.solution) {
                winnerId = ownerId;
                currentPlayerScores[ownerId]++;
            }
            // Determine the which solution letters remain and what quantities
            const remainingLetters: Record<string, number> = {};
            for (let j = 0; j < NUM_LETTERS; j++) {
                const letter = puzzle.solution[j];
                if (letter !== guess[j]) {
                    remainingLetters[letter] = (remainingLetters[letter] ?? 0) + 1;
                }
            }
            // Draw each guessed letter
            for (let j = 0; j < NUM_LETTERS; j++) {
                const letter = guess[j];
                const x = TILE_MARGIN + j * (TILE_SIZE + TILE_MARGIN);
                // Determine color
                if (puzzle.solution[j] === letter) {
                    context.fillStyle = 'green';
                    // If this letter hasn't been claimed yet, claim it for this user
                    if (letterOwners[j] === null) {
                        letterOwners[j] = ownerId;
                        currentPlayerScores[ownerId]++;
                    }
                } else if (remainingLetters[letter]) {
                    context.fillStyle = 'goldenrod';
                    // "Consume" one of these remaining letters
                    remainingLetters[letter]--;
                    if (remainingLetters[letter] < 1) {
                        delete remainingLetters[letter];
                    }
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

    override async onNoon(): Promise<void> {
        const { state, messenger, goodMorningChannel } = controller.getAllReferences();

        const wordle = state.getFocusGame();
        if (wordle.type !== 'WORDLE') {
            return;
        }

        // If there's an ongoing puzzle, cut it short
        if (wordle.puzzle) {
            const solution = wordle.puzzle.solution;
            // Delete the puzzle to avoid race conditions
            delete wordle.puzzle;
            // The hi-score is updated at the time of guessing, so just send a message
            await messenger.send(goodMorningChannel, `Looks like we've run out of time! The answer was _"${solution ?? '???'}"_ 😏`);
        }

        // Award points
        const sortedUserIds: Snowflake[] = Object.keys(wordle.scores).sort((x, y) => (wordle.scores[y] ?? 0) - (wordle.scores[x] ?? 0));
        const scaledPoints = getSimpleScaledPoints(sortedUserIds, { maxPoints: CONFIG.focusGameAward, order: 2 });
        const rows: string[] = [];
        // Award players points based on their score ranking
        for (const scaledPointsEntry of scaledPoints) {
            const { userId, points, rank } = scaledPointsEntry;
            const score = wordle.scores[userId] ?? 0;
            state.awardPoints(userId, points);
            rows.push(`_${getRankString(rank)}:_ **${score}** <@${userId}>`);
        }
        await messenger.send(goodMorningChannel, `__Wordle Results:__\n` + rows.join('\n') + '\n(_Disclaimer:_ these are not your literal points earned)');
    }

    override async onTimeout(arg: any): Promise<void> {
        const { state, messenger, goodMorningChannel } = controller.getAllReferences();

        const wordle = state.getFocusGame();
        if (wordle.type !== 'WORDLE') {
            return;
        }

        // Abort if there's already a round in progress
        if (wordle.puzzle) {
            await logger.log('WARNING! Attempted to trigger wordle restart with Wordle round already in progress. Aborting...');
            return;
        }

        // Try to find some words of the correct length
        const nextPuzzleLength = randChoice(5, 6, 7, 8);
        const nextPuzzleWords = await controller.chooseMagicWords(1, { characters: nextPuzzleLength, bonusMultiplier: 8 });
        if (nextPuzzleWords.length > 0) {
            // If a word was found, restart the puzzle and notify the channel
            wordle.puzzle = {
                solution: nextPuzzleWords[0].toUpperCase(),
                guesses: [],
                guessOwners: []
            };
            await controller.dumpState();
            const someoneText = wordle.blacklistedUserId === undefined ? 'Someone' : `Someone other than **${state.getPlayerDisplayName(wordle.blacklistedUserId)}**`
            await messenger.send(goodMorningChannel, `Let's solve another puzzle! If you get a better score, it will overwrite your previous score. `
                + `${someoneText} give me a **${nextPuzzleLength}**-letter word`);
        } else {
            await logger.log(`Unable to find a **${nextPuzzleLength}**-letter word, ending Wordle for today...`);
        }
    }
}
