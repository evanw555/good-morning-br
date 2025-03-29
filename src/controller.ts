import { Snowflake, TextChannel } from "discord.js";
import { DiscordTimestampFormat, FileStorage, LanguageGenerator, Messenger, PastTimeoutStrategy, TimeoutManager, addReactsSync, getPollChoiceKeys, loadJson, naturalJoin, shuffle, toDiscordTimestamp } from "evanw555.js";
import GoodMorningState from "./state";
import { FinalizeSungazerPollData, GoodMorningHistory, SungazerPollType, TimeoutType } from "./types";

import logger from "./logger";

interface ControllerReferences {
    state: GoodMorningState,
    history: GoodMorningHistory,
    storage: FileStorage,
    sharedStorage: FileStorage,
    timeoutManager: TimeoutManager<TimeoutType>,
    languageGenerator: LanguageGenerator,
    messenger: Messenger,
    goodMorningChannel: TextChannel,
    sungazersChannel: TextChannel
}

class Controller {
    private state: GoodMorningState;
    private history: GoodMorningHistory;
    private storage: FileStorage;
    private sharedStorage: FileStorage;
    private timeoutManager: TimeoutManager<TimeoutType>;
    private languageGenerator: LanguageGenerator;
    private messenger: Messenger;
    private goodMorningChannel: TextChannel;
    private sungazersChannel: TextChannel;

    /**
     * Set of users who have typed in the good morning channel since some event-related point in time.
     * Currently this is only used for the Popcorn event to track users who've typed since the last turn.
     */
    readonly typingUsers: Set<string> = new Set();

    /**
     * This lock is used to ensure that no high-focus messages are processed while a previous one is still being processed.
     */
    focusLock: boolean = false;

    constructor() {
        
    }

    getAllReferences(): ControllerReferences {
        return {
            state: this.state,
            history: this.history,
            storage: this.storage,
            sharedStorage: this.sharedStorage,
            timeoutManager: this.timeoutManager,
            languageGenerator: this.languageGenerator,
            messenger: this.messenger,
            goodMorningChannel: this.goodMorningChannel,
            sungazersChannel: this.sungazersChannel
        };
    }

    setAllReferences(refs: ControllerReferences) {
        this.state = refs.state;
        this.history = refs.history;
        this.storage = refs.storage;
        this.sharedStorage = refs.sharedStorage;
        this.timeoutManager = refs.timeoutManager;
        this.languageGenerator = refs.languageGenerator;
        this.messenger = refs.messenger;
        this.goodMorningChannel = refs.goodMorningChannel;
        this.sungazersChannel = refs.sungazersChannel;
    }

    async dumpState() {
        await this.storage.write('state', this.state.toJson());
    }

    async cancelTimeoutsWithType(type: TimeoutType): Promise<void> {
        try {
            const canceledIds = await this.timeoutManager.cancelTimeoutsWithType(type);
            if (canceledIds.length > 0) {
                await logger.log(`Canceled \`${type}\` timeouts \`${JSON.stringify(canceledIds)}\``);
            }
        } catch (err) {
            await logger.log(`Failed to cancel \`${type}\` timeouts: \`${err}\``);
        }
    }

    getBoldNames(userIds: Snowflake[]): string {
        return naturalJoin(userIds.map(userId => this.state.getPlayerDisplayName(userId)), { bold: true });
    }

    async chooseMagicWords(n: number, options?: { characters?: number, bonusMultiplier?: number }): Promise<string[]> {
        const words: string[] = [];
        // First, load the main list
        try {
            const main: string[] = await loadJson('config/words/main.json');
            words.push(...main);
        } catch (err) {
            await logger.log(`Failed to load the **main** magic words list: \`${err.toString()}\``);
        }
        // Then, load the bonus list and apply any bonus repetitions
        try {
            const bonusMultiplier = Math.floor(options?.bonusMultiplier ?? 1);
            const bonus: string[] = await loadJson('config/words/bonus.json');
            for (let i = 0; i < bonusMultiplier; i++) {
                words.push(...bonus);
            }
        } catch (err) {
            await logger.log(`Failed to load the **bonus** magic words list: \`${err.toString()}\``);
        }
        // Finally, shuffle and filter the list to get the final magic words
        shuffle(words);
        return words.filter(w => !options?.characters || w.length === options.characters).slice(0, n);
    }

    async startSungazerPoll(options: { values: string[], pollEndDate: Date, type: SungazerPollType, title: string, valueNames?: Record<string, string> }) {
        const valueNames = options.valueNames ?? {};

        // Abort if trying to start a poll with <2 choices
        if (options.values.length < 2) {
            await logger.log(`Trying to start \`${options.type}\` poll with only **${options.values.length}** options, aborting...`);
            return;
        }

        // Construct the poll data
        const choiceKeys: string[] = getPollChoiceKeys(options.values);
        const choices: Record<string, string> = {};
        for (let i = 0; i < options.values.length; i++) {
            choices[choiceKeys[i]] = options.values[i];
        }
    
        // Send the poll message and prime the choices
        const pollMessage = await this.sungazersChannel.send(`${options.title} (poll ends ${toDiscordTimestamp(options.pollEndDate, DiscordTimestampFormat.ShortTime)})\n`
            + Object.entries(choices).map(([key, value]) => `${key} _${valueNames[value] ?? value}_`).join('\n'));
        await addReactsSync(pollMessage, choiceKeys, { delay: 500 });
    
        // Schedule the end of the poll
        const arg: FinalizeSungazerPollData = {
            type: options.type,
            messageId: pollMessage.id,
            choices
        };
        // Use the invoke strategy, all subsequent handlers should validate that it's not too late to use the result
        await this.timeoutManager.registerTimeout(TimeoutType.FinalizeSungazerPoll, options.pollEndDate, { arg, pastStrategy: PastTimeoutStrategy.Invoke });
    }
}

export default new Controller();