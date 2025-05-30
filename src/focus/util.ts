import { chance, loadJson, randChoice } from "evanw555.js";
import PopcornFocusGame from "./popcorn";
import { FocusGameState, WheelOfFortune, WheelOfFortuneRound } from "./types";
import { WheelOfFortuneFocusGame } from "./wheel-of-fortune";
import { WordleFocusGame } from "./wordle";
import { SubmissionPromptHistory } from "../types";

import { CONFIG } from "../constants";

import controller from "../controller";

export function getFocusHandler(focusGame: FocusGameState) {
    // Return the proper wrapper
    switch (focusGame.type) {
        case 'POPCORN':
            return new PopcornFocusGame();
        case 'WORDLE':
            return new WordleFocusGame();
        case 'WHEEL_OF_FORTUNE':
            return new WheelOfFortuneFocusGame();
    }
}

export async function getNewWheelOfFortuneRound(options?: { minLength?: number }): Promise<WheelOfFortuneRound | undefined> {
    const { storage, sharedStorage } = controller.getAllReferences();

    const minLength = options?.minLength ?? 6;

    try {
        // First, randomly select a data set
        let choices: string[] = ['ERROR'];
        let category: string = 'Unknown';
        if (!CONFIG.testing && chance(0.1)) {
            choices = await sharedStorage.readJson('mcmpisms.json');
            category = 'MCMPisms';
        } else if (!CONFIG.testing && chance(0.1)) {
            const prompts = await storage.readJson('prompts.json') as SubmissionPromptHistory;
            choices = [...prompts.unused, ...prompts.used];
            category = 'GMBR Tuesday Prompts';
        } else if (!CONFIG.testing && chance(0.5)) {
            choices = await sharedStorage.readJson('bad-language.json');
            category = 'Bad Language';
        } else if (chance(0.5)) {
            choices = await loadJson('config/wof/vidya.json');
            category = 'Vidya';
        } else {
            choices = await loadJson('config/wof/kino.json');
            category = 'Kino';
        }
        // Now, select one random element from the set that meets a few criteria
        for (let i = 0; i < 100; i++) {
            const choice = randChoice(...choices);
            // If it's too short, skip
            if (choice.length < minLength) {
                continue;
            }
            // If it contains mentions/emojis/timestamps, skip
            if (choice.includes('<') && choice.includes('>')) {
                continue;
            }
            // If it contains unicode emojis, skip
            if (choice.match(/\p{Emoji}/u)) {
                continue;
            }
            return {
                solution: choice,
                category,
                usedLetters: '',
                blacklistedUserIds: [],
                roundScores: {}
            };
        }
    } catch (err) {
        return undefined;
    }

}

export async function getNewWheelOfFortuneState(): Promise<WheelOfFortune | undefined> {
    const round = await getNewWheelOfFortuneRound();
    if (round) {
        return {
            type: 'WHEEL_OF_FORTUNE',
            scores: {},
            round
        };
    }
}

// Effective odds: wof = 0.4, wordle = 0.54, popcorn = 0.06
export async function getRandomFocusGame(): Promise<FocusGameState> {
    // If a wheel of fortune solution can be found, return that with 40% odds
    // TODO: The WOF logic should be completely removed from GMBR and added to another more general bot
    // const wheelOfFortune = await getNewWheelOfFortuneState();
    // if (wheelOfFortune && chance(0.4)) {
    //     return wheelOfFortune;
    // }
    // If a wordle solution can be found, return that with 90% odds
    const wordleWords = await controller.chooseMagicWords(1, { characters: 6, bonusMultiplier: 8 });
    if (wordleWords.length > 0 && chance(0.9)) {
        return {
            type: 'WORDLE',
            scores: {},
            puzzle: {
                solution: wordleWords[0].toUpperCase(),
                guesses: [],
                guessOwners: []
            }
        };
    }
    // Else, do popcorn
    return {
        type: 'POPCORN',
        storySegments: [],
        scores: {}
    };
}