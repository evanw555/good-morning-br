import { Canvas, createCanvas } from "canvas";
import { canonicalizeText, drawBackground, getSimpleScaledPoints, getTextLabel, setHue } from "../util";
import { PastTimeoutStrategy, getRankString, joinCanvasesHorizontal, joinCanvasesVertical, randChoice, randInt, withDropShadow, withMargin } from "evanw555.js";
import { AttachmentBuilder, Message, MessageFlags, Snowflake } from "discord.js";
import { WheelOfFortuneRound } from "./types";
import AbstractFocusHandler from "./abstract-focus";
import { MessengerPayload, TimeoutType } from "../types";
import { getNewWheelOfFortuneRound } from "./util";

import { CONFIG } from "../constants";

import imageLoader from "../image-loader";
import controller from "../controller";
import logger from "../logger";

export class WheelOfFortuneFocusGame extends AbstractFocusHandler {
    override async getGoodMorningMessage(intro: string): Promise<MessengerPayload> {
        const { state } = controller.getAllReferences();

        const wof = state.getFocusGame();
        if (wof.type !== 'WHEEL_OF_FORTUNE') {
            // TODO: How do we handle this?
            return '';
        }

        const round = wof.round;
        if (!round) {
            // TODO: How do we handle this?
            return '';
        }

        return {
            content: `${intro} Today we're going to play a special game... It's my very own morningtime rendition of _Wheel of Fortune_! `
                + 'Say _"spin"_ to spin the wheel, but bewarned - for once it\'s your turn there is a **60**-second shot clock for all actions!',
            files: [await WheelOfFortuneFocusGame.renderWheelOfFortuneState(round)]
        };
    }
    override async onMorningMessage(message: Message<boolean>): Promise<void> {
        const { state, timeoutManager, messenger, goodMorningChannel } = controller.getAllReferences();

        const wof = state.getFocusGame();
        if (wof.type !== 'WHEEL_OF_FORTUNE') {
            return;
        }

        // Even if the message is invalid, give them zero points to mark them as "active" for the day
        const userId = message.author.id;
        wof.scores[userId] = (wof.scores[userId] ?? 0);

        const round = wof.round;
        if (!round) {
            return;
        }

        // If this user is blacklisted, ignore their message
        if (round.blacklistedUserIds.includes(userId)) {
            console.log(`Ignoring blacklisted user ${userId}`);
            return;
        }
        // If it's someone other than this user's turn, ignore their message
        if (round.userId && userId !== round.userId) {
            console.log(`Ignoring out-of-turn user ${userId} (current turn is ${round.userId})`);
            return;
        }
        const guess = message.content.toUpperCase().trim();
        const isVowel = guess.length === 1 && 'AEIOU'.includes(guess);
        const isConsonant = guess.length === 1 && guess.match(/[A-Z]/) && !isVowel;
        const numOccurrences = round.solution.toUpperCase().split('').filter(x => x === guess).length;
        const priorScore = round.roundScores[userId] ?? 0;
        const VOWEL_COST = 25;
        // Add zero points to ensure an entry is added and thus participation is recorded
        round.roundScores[userId] = priorScore;
        // If awaiting action (there may or may not be a user turn)
        if (round.spinValue === undefined && !round.solving) {
            // Handle a spin command
            if (canonicalizeText(message.content) === 'spin') {
                // First, give them the turn to avoid race conditions
                round.userId = userId;
                // Start/postpone the shot clock
                await this.resetWOFShotClock();
                // Spin the wheel and set the spin value
                const { spinValue, render } = await this.spinWheelOfFortune();
                // If the value is positive, prompt them to proceed
                if (spinValue > 0) {
                    // Set the spin value
                    round.spinValue = spinValue;
                    // Reply prompting them to do more
                    await messenger.reply(message, {
                        content: `You've spun a **$${spinValue}**, give us a consonant!`,
                        // TODO: Add an actual render
                        // files: [render],
                        flags: MessageFlags.SuppressNotifications
                    });
                }
                // The value is positive, so end their turn...
                else {
                    // If it was a bankruptcy, set their round score to zero
                    if (spinValue < 0) {
                        round.roundScores[userId] = 0;
                    }
                    // Reply with a message
                    await messenger.reply(message, {
                        content: (spinValue < 0) ? '**BANKRUPT!** Oh no, you\'ve lost all your cash for this round! ' : '**LOSE A TURN!** Oh dear, looks like your turn is over... '
                            + this.getOpenActionPrompt(round),
                        // TODO: Add an actual render
                        // files: [render],
                        flags: MessageFlags.SuppressNotifications
                    });
                    // Add them to the blacklist and end their turn
                    await this.endWOFTurn(round);
                }
            }
            // Handle an intent to solve
            else if (canonicalizeText(message.content).startsWith('idliketosolve')) {
                // First, give them the turn to avoid race conditions
                round.userId = userId;
                // Start/postpone the shot clock
                await this.resetWOFShotClock();
                // Mark them as intending to solve and reply
                round.solving = true;
                await messenger.reply(message, randChoice('The floor is yours!', 'Go for it!', 'Let\'s hear it!'));
            }
            // Handle passing
            else if (canonicalizeText(message.content) === 'pass') {
                // Add them to the blacklist and end their turn
                await this.endWOFTurn(round);
                // Prompt other users to go
                await messenger.reply(message, `Alright then... ${this.getOpenActionPrompt(round)}`);
            }
            // If they're talking about buying a vowel, point them in the right direction...
            else if (canonicalizeText(message.content).includes('vowel')) {
                // Start/postpone the shot clock
                await this.resetWOFShotClock();
                // Tell them how to buy a vowel
                await messenger.reply(message, 'To buy a vowel, just say the letter you\'d like to buy');
            }
            // Handle buying a vowel
            else if (isVowel) {
                // First, give them the turn to avoid race conditions
                round.userId = userId;
                // Start/postpone the shot clock
                await this.resetWOFShotClock();
                // End their turn if they provide a used guess
                if (round.usedLetters.includes(guess)) {
                    // Add them to the blacklist and end their turn
                    await this.endWOFTurn(round);
                    // Reply indicating that their turn is up
                    await messenger.reply(message, `**${guess}** has already been used, you done goofed... ${this.getOpenActionPrompt(round)}`);
                }
                // End their turn if they can't afford a vowel
                else if (priorScore < VOWEL_COST) {
                    // Add them to the blacklist and end their turn
                    await this.endWOFTurn(round);
                    // Reply indicating that their turn is up
                    await messenger.reply(message, `Vowels cost **$${VOWEL_COST}** yet you have **$${priorScore}**... ${this.getOpenActionPrompt(round)}`);
                }
                // Else, purchase the vowel
                else {
                    // Add this letter to the list of used letters
                    round.usedLetters += guess;
                    // Deduct points
                    round.roundScores[userId] = priorScore - VOWEL_COST;
                    // If there are none, end their turn
                    if (numOccurrences === 0) {
                        // Add them to the blacklist and end their turn
                        await this.endWOFTurn(round);
                        // Reply indicating that their turn is up
                        await messenger.reply(message, `No **${guess}**s! ${this.getOpenActionPrompt(round)}`);
                    }
                    // Successful vowel guess, so let them continue
                    else {
                        // Reset the shot clock
                        await this.resetWOFShotClock();
                        // Prompt them to do more
                        await messenger.reply(message, {
                            content: `${numOccurrences} **${guess}**${numOccurrences > 1 ? 's' : ''}! You spent **$${VOWEL_COST}** and now have **$${round.roundScores[userId]}**. `
                                + 'Spin, buy a vowel, solve the puzzle, or pass!',
                            files: [await WheelOfFortuneFocusGame.renderWheelOfFortuneState(round)],
                            flags: MessageFlags.SuppressNotifications
                        });
                    }
                }
            }
        }
        // Else if it's their turn, process their message...
        else if (round.userId && userId === round.userId) {
            // If solving the puzzle, process the message text as a solution
            if (round.solving) {
                const sanitizedAttempt = canonicalizeText(message.content).toUpperCase();
                const sanitizedSolution = canonicalizeText(round.solution).toUpperCase();
                // Determine if the guess is correct
                if (sanitizedAttempt === sanitizedSolution) {
                    // Clear the round to prevent race conditions
                    delete wof.round;
                    // Cancel the shot clock
                    await controller.cancelTimeoutsWithType(TimeoutType.FocusCustom);
                    // Add the solution itself to the "used letters" so the solution can be rendered
                    this.revealWheelOfFortuneSolution(round);
                    // Add each person's score to the total scoreboard
                    for (const [ someUserId, someScore ] of Object.entries(round.roundScores)) {
                        // Allow the winner to keep all points, only let others keep a quarter
                        const multipliedScore = Math.round((userId === someUserId ? 1 : 0.25) * someScore);
                        wof.scores[someUserId] = (wof.scores[someUserId] ?? 0) + multipliedScore;
                    }
                    // Reply with some messages
                    await messenger.reply(message, {
                        content: `Yes, that\'s it! You can keep your **$${priorScore}** earnings, while everyone else will only keep a quarter`,
                        files: [await WheelOfFortuneFocusGame.renderWheelOfFortuneState(round)]
                    });
                    const sortedUserIds = Object.keys(wof.scores)
                        .filter(x => wof.scores[x] && wof.scores[x] > 0)
                        .sort((x, y) => wof.scores[y] - wof.scores[x]);
                    await messenger.send(goodMorningChannel, {
                        content: '__Total scores so far:__:\n'
                            + sortedUserIds.map(x => `- **$${wof.scores[x]}** _${state.getPlayerDisplayName(x)}_`).join('\n'),
                        flags: MessageFlags.SuppressNotifications
                    });
                    // Schedule the next round
                    const restartDate = new Date();
                    if (new Date().getHours() >= 11) {
                        restartDate.setMinutes(restartDate.getMinutes() + randInt(1, 5));
                    } else if (new Date().getHours() >= 10) {
                        restartDate.setMinutes(restartDate.getMinutes() + randInt(5, 10));
                    } else {
                        restartDate.setMinutes(restartDate.getMinutes() + randInt(10, 15));
                    }
                    await timeoutManager.registerTimeout(TimeoutType.FocusCustom, restartDate, { arg: 'restart', pastStrategy: PastTimeoutStrategy.Invoke });
                }
                // Else, end their turn
                else {
                    // Add them to the blacklist and end their turn
                    await this.endWOFTurn(round);
                    // Reply indicating that their turn is up
                    await messenger.reply(message, `Nope, that's not it! ${this.getOpenActionPrompt(round)}`);
                }
            }
            // If the user just spun and we are awaiting a consonant
            else if (round.spinValue !== undefined) {
                // This validates that the guess is a consonant of length one
                if (!isConsonant) {
                    return;
                }
                // End their turn if they provide a used guess
                else if (round.usedLetters.includes(guess)) {
                    // Add them to the blacklist and end their turn
                    await this.endWOFTurn(round);
                    // Reply indicating that their turn is up
                    await messenger.reply(message, `**${guess}** has already been used, you done goofed... ${this.getOpenActionPrompt(round)}`);
                }
                // Otherwise, accept their guess...
                else {
                    // Add this letter to the list of used letters
                    round.usedLetters += guess;
                    // If there are no occurrences, end this user's turn
                    if (numOccurrences === 0) {
                        // Add them to the blacklist and end their turn
                        await this.endWOFTurn(round);
                        // Reply indicating that their turn is up
                        await messenger.reply(message, `Sorry, but there are no **${guess}**s... ${this.getOpenActionPrompt(round)}`)
                    }
                    // Otherwise, treat this as a good guess
                    else {
                        // Update the user's score
                        const guessAward = numOccurrences * round.spinValue;
                        const newScore = priorScore + guessAward;
                        round.roundScores[userId] = newScore;
                        // Delete the "spin value" property to start accepting other actions
                        delete round.spinValue;
                        // Reset the WOF shot clock
                        await this.resetWOFShotClock();
                        // Reply with a message and the updated render
                        await messenger.reply(message, {
                            content: `We've got ${numOccurrences} **${guess}**${numOccurrences === 1 ? '' : 's'}! You've earned **$${guessAward}** for a total of **$${newScore}**. `
                                + 'Go ahead - spin, buy a vowel, solve the puzzle, or pass!',
                            files: [await WheelOfFortuneFocusGame.renderWheelOfFortuneState(round)],
                            flags: MessageFlags.SuppressNotifications
                        });
                    }
                }
            }
        }
        await controller.dumpState();
    }

    static async renderWheelOfFortuneState(round: WheelOfFortuneRound): Promise<AttachmentBuilder> {
        const words = round.solution
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
                    if (!letter.match(/[A-Z]/) || round.usedLetters.includes(letter)) {
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
            const label = getTextLabel(letter, TILE_WIDTH / 2, TILE_HEIGHT / 2, { alpha: round.usedLetters.includes(letter) ? 0.15 : 1});
            letterLabels.push(label);
        }

        // Add category at the top, letters at the bottom
        const compositeCanvas = withMargin(
            joinCanvasesVertical([
                getTextLabel(round.category, WIDTH, TILE_HEIGHT * 0.75, { style: 'white' }),
                canvas,
                joinCanvasesHorizontal(letterLabels)
            ], { align: 'center', spacing: MARGIN }),
            Math.round(TILE_WIDTH / 2)
        );

        // Add drop shadow to everything
        const finalCanvas = withDropShadow(compositeCanvas, { distance: 2 });
    
        // Draw the image background
        // TODO: Temp logic to get a hue based on the first three letters
        const hueCode = Math.round(round.solution.charCodeAt(0) * 777 + round.solution.charCodeAt(1) * 31 + round.solution.charCodeAt(2) * 7) % 360;
        const backgroundImage = setHue(await imageLoader.loadImage('assets/common/blueblur.jpg'), `hsl(${hueCode}, 100%, 50%)`);
        drawBackground(finalCanvas.getContext('2d'), backgroundImage);

        return new AttachmentBuilder(finalCanvas.toBuffer()).setName('wheel-of-fortune.png');
    }
    
    private async spinWheelOfFortune(): Promise<{ render: AttachmentBuilder, spinValue: number }> {
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

    private revealWheelOfFortuneSolution(round: WheelOfFortuneRound) {
        round.usedLetters += canonicalizeText(round.solution).toUpperCase();
    }


    private async resetWOFShotClock() {
        const { timeoutManager } = controller.getAllReferences();

        // Cancel existing shot clock to avoid duplicate timeouts
        await controller.cancelTimeoutsWithType(TimeoutType.FocusCustom);
        // Schedule a new timeout for a minute from now
        const shotClockDate = new Date();
        const SHOT_CLOCK_SECONDS = CONFIG.testing ? 20 : 60;
        shotClockDate.setSeconds(shotClockDate.getSeconds() + SHOT_CLOCK_SECONDS);
        await timeoutManager.registerTimeout(TimeoutType.FocusCustom, shotClockDate, { arg: 'fallback', pastStrategy: PastTimeoutStrategy.Invoke });
        // Schedule the warning for 10 seconds before that
        const warningDate = new Date(shotClockDate);
        warningDate.setSeconds(warningDate.getSeconds() - 10);
        await timeoutManager.registerTimeout(TimeoutType.FocusCustom, warningDate, { arg: 'warning', pastStrategy: PastTimeoutStrategy.Invoke });

    };

    private async endWOFTurn(round: WheelOfFortuneRound) {
        // If the current turn is claimed by a user, rotate add them to the blacklist
        if (round.userId) {
            round.blacklistedUserIds.unshift(round.userId);
            console.log(`Add ${round.userId} to blacklist`);
            const BLACKLIST_LIMIT = CONFIG.testing ? 0 : 3;
            if (round.blacklistedUserIds.length > BLACKLIST_LIMIT) {
                round.blacklistedUserIds.pop();
                console.log(`Pop 1 from blacklist`);
            }
        }
        // Delete all turn-related data
        delete round.userId;
        delete round.spinValue;
        delete round.solving;
        await controller.dumpState();
        // Wipe the existing shot clock if it exists
        await controller.cancelTimeoutsWithType(TimeoutType.FocusCustom);
    };

    private getOpenActionPrompt(round: WheelOfFortuneRound): string {
        return `Someone other than ${controller.getBoldNames(round.blacklistedUserIds) || '**N/A**'} take a spin, buy a vowel, or solve!`
    }

    override async onNoon(): Promise<void> {
        const { state, messenger, goodMorningChannel } = controller.getAllReferences();

        const wof = state.getFocusGame();
        if (wof.type !== 'WHEEL_OF_FORTUNE') {
            return;
        }

        // If there's an ongoing round, cut it short
        const round = wof.round;
        if (round) {
            // Delete the round to avoid race conditions
            delete wof.round;
            // Add each person's score to the total scoreboard
            for (const [ someUserId, someScore ] of Object.entries(wof.scores)) {
                // Allow the winner to keep all points, only let others keep a quarter
                const multipliedScore = Math.round(0.25 * someScore);
                wof.scores[someUserId] = (wof.scores[someUserId] ?? 0) + multipliedScore;
            }
            // Add the solution itself to the "used letters" so the solution can be rendered
            this.revealWheelOfFortuneSolution(round);
            // Send a message revealing the message
            await messenger.send(goodMorningChannel, {
                content: 'Looks like we\'ve run out of time, so here\'s the solution! Everyone will keep a quarter of their earnings',
                files: [await WheelOfFortuneFocusGame.renderWheelOfFortuneState(round)]
            });
        }

        // Award points
        const sortedUserIds: Snowflake[] = Object.keys(wof.scores).sort((x, y) => (wof.scores[y] ?? 0) - (wof.scores[x] ?? 0));
        const scaledPoints = getSimpleScaledPoints(sortedUserIds, { maxPoints: CONFIG.focusGameAward, order: 2 });
        const rows: string[] = [];
        // Award players points based on their score ranking
        for (const scaledPointsEntry of scaledPoints) {
            const { userId, points, rank } = scaledPointsEntry;
            const score = wof.scores[userId] ?? 0;
            state.awardPoints(userId, points);
            rows.push(`_${getRankString(rank)}:_ **$${score}** <@${userId}>`);
        }
        await messenger.send(goodMorningChannel, `__Wheel of Fortune Results:__\n` + rows.join('\n') + '\n(_Disclaimer:_ these are not your literal points earned)');
    }

    override async onTimeout(arg: any): Promise<void> {
        const { state, messenger, goodMorningChannel } = controller.getAllReferences();

        const wof = state.getFocusGame();
        if (wof.type !== 'WHEEL_OF_FORTUNE') {
            return;
        }

        switch (arg) {
            case 'restart': {
                // Abort if there's already a round in progress
                if (wof.round) {
                    await logger.log('WARNING! Attempted to trigger WOF restart with WOF round already in progress. Aborting...');
                    return;
                }
        
                // Try to create a new WOF state
                const newRound = await getNewWheelOfFortuneRound();
                if (newRound) {
                    wof.round = newRound;
                    await controller.dumpState();
                    await messenger.send(goodMorningChannel, {
                        content: 'Here\'s our next puzzle, someone step up and spin!',
                        files: [await WheelOfFortuneFocusGame.renderWheelOfFortuneState(newRound)]
                    });
                } else {
                    await logger.log('Unable to create a new Wheel of Fortune, ending WOF for today...');
                }
                break;
            }
            case 'warning': {
                await messenger.send(goodMorningChannel, '10 second warning ⏳', { immediate: true });
                break;
            }
            case 'fallback': {
                // Abort if it's no longer morning or if there's no current WOF user
                if (!wof.round || !wof.round.userId) {
                    return;
                }
        
                // Clear the current turn and notify
                await this.endWOFTurn(wof.round);
                await messenger.send(goodMorningChannel, `Your time is up! ${this.getOpenActionPrompt(wof.round)}`, { immediate: true });
                break;
            }
        }
    }
}