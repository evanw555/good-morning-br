import { Snowflake, TextChannel } from "discord.js";
import { FileStorage, LanguageGenerator, Messenger, TimeoutManager, loadJson, naturalJoin, shuffle } from "evanw555.js";
import GoodMorningState from "./state";
import { TimeoutType } from "./types";

import logger from "./logger";

interface ControllerReferences {
    state: GoodMorningState,
    storage: FileStorage,
    sharedStorage: FileStorage,
    timeoutManager: TimeoutManager<TimeoutType>,
    languageGenerator: LanguageGenerator,
    messenger: Messenger,
    goodMorningChannel: TextChannel
}

class Controller {
    private state: GoodMorningState;
    private storage: FileStorage;
    private sharedStorage: FileStorage;
    private timeoutManager: TimeoutManager<TimeoutType>;
    private languageGenerator: LanguageGenerator;
    private messenger: Messenger;
    private goodMorningChannel: TextChannel;

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
            storage: this.storage,
            sharedStorage: this.sharedStorage,
            timeoutManager: this.timeoutManager,
            languageGenerator: this.languageGenerator,
            messenger: this.messenger,
            goodMorningChannel: this.goodMorningChannel
        };
    }

    setAllReferences(refs: ControllerReferences) {
        this.state = refs.state;
        this.storage = refs.storage;
        this.sharedStorage = refs.sharedStorage;
        this.timeoutManager = refs.timeoutManager;
        this.languageGenerator = refs.languageGenerator;
        this.messenger = refs.messenger;
        this.goodMorningChannel = refs.goodMorningChannel;
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
}

export default new Controller();