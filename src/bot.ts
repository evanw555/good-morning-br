import { ActivityType, ApplicationCommandOptionType, AttachmentBuilder, BaseMessageOptions, ButtonStyle, Client, ComponentType, DMChannel, GatewayIntentBits, MessageFlags, PartialMessage, Partials, TextChannel, TextInputStyle, User } from 'discord.js';
import { Guild, GuildMember, Message, Snowflake, TextBasedChannel } from 'discord.js';
import { DailyEvent, DailyEventType, GoodMorningConfig, GoodMorningHistory, Season, TimeoutType, Combo, CalendarDate, PrizeType, Bait, GameState, Wordle, SubmissionPromptHistory, ReplyToMessageData, GoodMorningAuth, MessengerPayload, WordleRestartData, AnonymousSubmission, GamePlayerAddition } from './types';
import { hasVideo, validateConfig, reactToMessage, extractYouTubeId, toSubmissionEmbed, toSubmission, getMessageMentions, canonicalizeText, getScaledPoints, generateSynopsisWithAi, getSimpleScaledPoints } from './util';
import GoodMorningState from './state';
import { addReactsSync, chance, DiscordTimestampFormat, FileStorage, generateKMeansClusters, getClockTime, getJoinedMentions, getPollChoiceKeys, getRandomDateBetween,
    getRankString, getRelativeDateTimeString, getTodayDateString, getTomorrow, LanguageGenerator, loadJson, Messenger,
    naturalJoin, PastTimeoutStrategy, R9KTextBank, randChoice, randInt, shuffle, sleep, splitTextNaturally, TimeoutManager, TimeoutOptions, toCalendarDate, toDiscordTimestamp, toFixed, toLetterId } from 'evanw555.js';
import { getProgressOfGuess, renderWordleState } from './wordle';
import { AnonymousSubmissionsState } from './submissions';
import ActivityTracker from './activity-tracker';
import AbstractGame from './games/abstract-game';
import ClassicGame from './games/classic';
import MazeGame from './games/maze';
import MasterpieceGame from './games/masterpiece';
import IslandGame from './games/island';
import RiskGame from './games/risk';

import logger from './logger';
import imageLoader from './image-loader';

const auth: GoodMorningAuth = loadJson('config/auth.json');
const config: GoodMorningConfig = loadJson('config/config.json');
// For local testing, load a config override file to override specific properties
try {
    const configOverride: Record<string, any> = loadJson('config/config-override.json');
    for (const key of Object.keys(configOverride)) {
        config[key] = configOverride[key];
        console.log(`Loaded overridden ${key} config property: ${JSON.stringify(configOverride[key])}`);
    }
} catch (err) {}

const storage = new FileStorage('./data/');
const sharedStorage = new FileStorage('/home/pi/.mcmp/');
const languageConfig = loadJson('config/language.json');
const languageGenerator = new LanguageGenerator(languageConfig);
languageGenerator.setLogger((message) => {
    logger.log(message);
});
const r9k = new R9KTextBank();
const baitR9K = new R9KTextBank();
const knownYouTubeIds: Set<string> = new Set();
const messenger = new Messenger({ alwaysImmediate: config.testing });
messenger.setLogger((message) => {
    logger.log(message);
});
messenger.setMemberResolver(async (id) => {
    return await guild.members.fetch(id);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [
        Partials.Channel // Required to receive DMs
    ]
});

let guild: Guild;

let goodMorningChannel: TextChannel;
let sungazersChannel: TextChannel;
let testingChannel: TextChannel;
let guildOwner: GuildMember;
let guildOwnerDmChannel: DMChannel;

let state: GoodMorningState;
let history: GoodMorningHistory;

let dailyVolatileLog: [Date, String][] = [];

/**
 * Set of users who have typed in the good morning channel since some event-related point in time.
 * Currently this is only used for the Popcorn event to track users who've typed since the last turn.
 */
const typingUsers: Set<string> = new Set();

const getPopcornFallbackUserId = (): Snowflake | undefined => {
    if (state.getEventType() === DailyEventType.Popcorn) {
        const event = state.getEvent();
        // First, give priority to typing users who haven't had a turn yet
        const turnlessTypingUsers = Array.from(typingUsers).filter(id => !state.hasDailyRank(id) && id !== event.user);
        if (turnlessTypingUsers.length > 0) {
            return randChoice(...turnlessTypingUsers);
        }
        // Next, give priority to typing users who may have had a turn already
        const otherTypingUsers = Array.from(typingUsers).filter(id => id !== event.user);
        if (otherTypingUsers.length > 0) {
            return randChoice(...otherTypingUsers);
        }
        // Last priority goes to the most active user who hasn't had a turn yet
        return state.getActivityOrderedPlayers().filter(id => !state.hasDailyRank(id) && id !== event.user)[0];
    }
};

const registerPopcornFallbackTimeout = async (userId: Snowflake) => {
    // If the player is more active, give them more time (5-9 default, +1-4 when in-game, +1m for each day of streak)
    let fallbackDate = new Date();
    fallbackDate.setMinutes(fallbackDate.getMinutes() + randInt(5, 10));
    if (state.hasPlayer(userId)) {
        fallbackDate.setMinutes(fallbackDate.getMinutes() + randInt(1, 5) + state.getPlayerActivity(userId).getStreak());
    }
    await registerTimeout(TimeoutType.PopcornFallback, fallbackDate, { pastStrategy: PastTimeoutStrategy.Invoke});
    // TODO: Temp logging to see how this goes
    await logger.log(`Scheduled popcorn fallback for **${state.getPlayerDisplayName(userId)}** at **${getRelativeDateTimeString(fallbackDate)}**`);
};

// TODO(testing): Use this during testing to directly trigger subsequent timeouts
const showTimeoutTriggerButton = async (type: TimeoutType, arg?: any) => {
    let customId = `invokeTimeout:${type}`;
    if (arg !== undefined) {
        customId += `:${encodeURIComponent(JSON.stringify(arg))}`;
    }
    await goodMorningChannel.send({
        content: `Click here to trigger \`${customId}\``,
        components: [{
            type: ComponentType.ActionRow,
            components: [{
                type: ComponentType.Button,
                style: ButtonStyle.Primary,
                custom_id: customId,
                label: 'Go'
            }]
        }]
    });
};

/**
 * This is a wrapper for the timeout manager that allows us to spawn buttons instead of timeouts when testing locally.
 */
const registerTimeout = async (type: TimeoutType, date: Date, options?: TimeoutOptions, testOptions?: { testingSeconds?: number }) => {
    if (config.testing) {
        const testingSeconds = testOptions?.testingSeconds ?? 0;
        if (testingSeconds > 0) {
            // If a test delay was specified, register it as a brief timeout
            const d = new Date();
            d.setSeconds(d.getSeconds() + testingSeconds);
            await timeoutManager.registerTimeout(type, d, options);
        } else {
            // Otherwise, spawn a test button
            await showTimeoutTriggerButton(type, options?.arg);
        }
    } else {
        await timeoutManager.registerTimeout(type, date, options);
    }
};

const getDisplayName = async (userId: Snowflake): Promise<string> => {
    try {
        const member = await guild.members.fetch(userId);
        return member.displayName;
    } catch (err) {
        return `User ${userId}`;
    }
}

const fetchMember = async (userId: Snowflake): Promise<GuildMember | undefined> => {
    try {
        return await guild.members.fetch(userId);
    } catch (err) {
        return undefined;
    }
}

const fetchMembers = async (userIds: Snowflake[]): Promise<Record<Snowflake, GuildMember>> => {
    const members = await guild.members.fetch({ user: userIds });
    const result: Record<Snowflake, GuildMember> = {};
    for (const [userId, member] of members.entries()) {
        result[userId] = member;
    }
    return result;
}

const fetchUsers = async (userIds: Snowflake[]): Promise<Record<Snowflake, User>> => {
    const members = await guild.members.fetch({ user: userIds });
    const result: Record<Snowflake, User> = {};
    for (const [userId, member] of members.entries()) {
        result[userId] = member.user;
    }
    return result;
}

const getBoldNames = (userIds: Snowflake[]): string => {
    return naturalJoin(userIds.map(userId => `**${state.getPlayerDisplayName(userId)}**`));
}

const replaceUserIdsInText = (input: string): string => {
    return input.replace(/\d{17,}/g, (id) => {
        return state.hasPlayer(id) ? state.getPlayerDisplayName(id) : id;
    });
}

const reactToMessageById = async (messageId: Snowflake, emoji: string | string[]): Promise<void> => {
    try {
        const message = await goodMorningChannel.messages.fetch(messageId);
        await reactToMessage(message, emoji);
    } catch (err) {
        await logger.log(`Failed to react with ${emoji} to message with ID \`${messageId}\`: \`${err}\``);
    }
}

const getSubmissionRevealTimestamp = (): string => {
    const date = timeoutManager.getDateForTimeoutWithType(TimeoutType.AnonymousSubmissionReveal);
    if (date) {
        return toDiscordTimestamp(date, DiscordTimestampFormat.ShortTime);
    }
    // TODO: This is hardcoded, fix this
    return '10:50';
}

const logJsonAsFile = async (title: string, data: Record<string, any> | string) => {
    if (guildOwnerDmChannel) {
        try {
            const sanitizedName = title.trim().toLowerCase().replace(/\s+/g, '_');
            const dateString = new Date().toDateString().replace(/[\s\/-]/g, '_').toLowerCase();
            const fileName = `${sanitizedName}_${dateString}.json`;
            const serialized = (typeof data === 'string') ? data : JSON.stringify(data);
            await guildOwnerDmChannel.send({
                content: `${title} backup: \`${fileName}\``,
                files: [new AttachmentBuilder(Buffer.from(serialized)).setName(fileName)]
            });
        } catch (err) {
            await logger.log(`Failed to log ${title} backup: \`${err}\``);
        }
    }
};

/**
 * For each player currently in the state, fetch their current member info and update it everywhere in the state (e.g. display name, avatar).
 */
const refreshStateMemberInfo = async (): Promise<void> => {
    if (config.testing) {
        await logger.log('Skipping state member info refresh in testing mode...');
        return;
    }
    try {
        const members = await fetchMembers(state.getPlayers());
        for (const [userId, member] of Object.entries(members)) {
            state.setPlayerDisplayName(userId, member.displayName);
            if (state.hasGame() && state.getGame().hasPlayer(userId)) {
                state.getGame().updatePlayer(member);
            }
        }
        await dumpState();
        await logger.log(`Refreshed state member info for **${Object.keys(members).length}** players`);
    } catch (err) {
        await logger.log(`Unable to refresh state member info: \`${err}\``);
    }
}

const grantGMChannelAccess = async (userIds: Snowflake[]): Promise<void> => {
    for (let userId of userIds) {
        try {
            const member = await fetchMember(userId);
            if (member) {
                await goodMorningChannel.permissionOverwrites.delete(member);
            }
        } catch (err) {
            await logger.log(`Unable to grant GM channel access for user <@${userId}>: \`${err.toString()}\``);
        }
        state.setPlayerMute(userId, false);
    }
}

const revokeGMChannelAccess = async (userIds: Snowflake[]): Promise<void> => {
    for (let userId of userIds) {
        try {
            const member = await fetchMember(userId);
            if (member) {
                await goodMorningChannel.permissionOverwrites.create(member, {
                    SendMessages: false
                });
            }
        } catch (err) {
            await logger.log(`Unable to revoke GM channel access for user <@${userId}>: \`${err.toString()}\``);
        }
        state.setPlayerMute(userId, true);
    }
}

const updateSungazer = async (userId: Snowflake, terms: number): Promise<void> => {
    if (history.sungazers[userId] === undefined) {
        history.sungazers[userId] = terms;
        const member: GuildMember = await guild.members.fetch(userId);
        await member.roles.add(config.sungazers.role);
    } else {
        history.sungazers[userId] += terms;
    }
}

const updateSungazers = async (winners: { gold?: Snowflake, silver?: Snowflake, bronze?: Snowflake }): Promise<void> => {
    // Get the sungazer channel
    const sungazerChannel: TextBasedChannel = (await guild.channels.fetch(config.sungazers.channel)) as TextBasedChannel;
    const newSungazers: boolean = (winners.gold  !== undefined && history.sungazers[winners.gold] === undefined)
        || (winners.silver  !== undefined && history.sungazers[winners.silver] === undefined)
        || (winners.bronze  !== undefined && history.sungazers[winners.bronze] === undefined);
    if (newSungazers) {
        await messenger.send(sungazerChannel, 'As the sun fades into the horizon on yet another sunny season, let us welcome the new Sungazers to the Council!');
    } else {
        await messenger.send(sungazerChannel, 'Well, my dear dogs... it appears there are no new additions to the council this season. Cheers to our continued hegemony!');
    }
    await sleep(10000);
    // First, decrement the term counters of each existing sungazers
    for (let userId of Object.keys(history.sungazers)) {
        history.sungazers[userId]--;
    }
    // Then, add terms for each winner (and add roles if necessary)
    if (winners.gold) {
        await updateSungazer(winners.gold, 3);
        await messenger.send(sungazerChannel, `Our newest champion <@${winners.gold}> has earned **3** terms on the council!`);
    }
    if (winners.silver) {
        await updateSungazer(winners.silver, 2);
        await messenger.send(sungazerChannel, `The runner-up <@${winners.silver}> has earned **2** terms`);
    }
    if (winners.bronze) {
        await updateSungazer(winners.bronze, 1);
        await messenger.send(sungazerChannel, `And sweet old <@${winners.bronze}> has earned **1** term`);
    }
    // Finally, remove any sungazer who's reached the end of their term
    const expirees: Snowflake[] = Object.keys(history.sungazers).filter(userId => history.sungazers[userId] === 0);
    if (expirees.length > 0) {
        await sleep(10000);
        await messenger.send(sungazerChannel, `The time has come, though, to say goodbye to some now-former sungazers... ${getJoinedMentions(expirees)}, farewell!`);
        await sleep(30000);
        for (let userId of expirees) {
            delete history.sungazers[userId];
            try {
                const member: GuildMember = await guild.members.fetch(userId);
                await member.roles.remove(config.sungazers.role);
            } catch (err) {
                await logger.log(`Failed to remove role \`${config.sungazers.role}\` for user <@${userId}>: \`${err}\``);
            }
        }
    }
    const soonToBeExpirees: Snowflake[] = Object.keys(history.sungazers).filter(userId => history.sungazers[userId] === 1);
    if (soonToBeExpirees.length > 0) {
        await sleep(10000);
        await messenger.send(sungazerChannel, `As for ${getJoinedMentions(soonToBeExpirees)}, I advise that you stay spooked! For this is your final term on the council`);
    }
    logger.log(`\`${JSON.stringify(history.sungazers)}\``);
    await dumpHistory();
}

const advanceSeason = async (): Promise<{ gold?: Snowflake, silver?: Snowflake, bronze?: Snowflake }> => {
    // Send the final state/history to the guild owner one last time before wiping it
    if (guildOwnerDmChannel) {
        await logger.log(`Sending final state of season **${state.getSeasonNumber()}** (and a history backup) before it's wiped...`);
        await logJsonAsFile('GMBR final state', state.toCompactJson());
        await logJsonAsFile('GMBR history', history);
    }
    // Add new entry for this season
    const newHistoryEntry: Season = state.toHistorySeasonEntry();
    history.seasons.push(newHistoryEntry);
    // Compute medals
    const winnersList: Snowflake[] = state.getGame().getWinners();
    const winners = {
        gold: winnersList[0],
        silver: winnersList[1],
        bronze: winnersList[2]
        // TODO: Give out the skull award once penalties are counted
        // skull: orderedUserIds[orderedUserIds.length - 1]
    };
    // Increment medals counts (initialize missing objects if needed)
    if (history.medals === undefined) {
        history.medals = {};
    }
    Object.entries(winners).forEach(([medal, userId]) => {
        if (userId) {
            if (history.medals[userId] === undefined) {
                history.medals[userId] = {};
            }
            history.medals[userId][medal] = (history.medals[userId][medal] ?? 0) + 1;
        }
    });
    // Reset the state
    const nextSeason: number = state.getSeasonNumber() + 1;
    state = new GoodMorningState({
        season: nextSeason,
        startedOn: getTodayDateString(),
        isMorning: false,
        isGracePeriod: true,
        goodMorningEmoji: config.defaultGoodMorningEmoji,
        dailyStatus: {},
        players: {}
    });
    // Dump the state and history
    await dumpState();
    await dumpHistory();

    return winners;
};

const chooseEvent = async (date: Date): Promise<DailyEvent | undefined> => {
    // If we're testing locally, alternate between game decision and update
    if (config.testing) {
        if (state.getEventType() === DailyEventType.GameDecision) {
            return {
                type: DailyEventType.GameUpdate
            };
        } else {
            return {
                type: DailyEventType.GameDecision
            };
        }
    }
    // Sunday: Game Update
    if (date.getDay() === 0) {
        return {
            type: DailyEventType.GameUpdate
        };
    }
    // Tuesday: Anonymous Submissions
    if (date.getDay() === 2) {
        return {
            type: DailyEventType.AnonymousSubmissions
        };
    }
    // Thursday: High-focus event
    if (date.getDay() === 4) {
        const focusEvents: DailyEvent[] = [{
            type: DailyEventType.Popcorn
        }];
        // Add the wordle event if words can be found
        const wordleWords = await chooseMagicWords(1, { characters: 6, bonusMultiplier: 8 });
        if (wordleWords.length > 0) {
            focusEvents.push({
                type: DailyEventType.Wordle,
                wordle: {
                    solution: wordleWords[0].toUpperCase(),
                    guesses: [],
                    guessOwners: []
                },
                wordleHiScores: {}
            });
        }
        // Return a random one of these high-focus events
        return randChoice(...focusEvents);
    }
    // Friday: Monkey Friday
    if (date.getDay() === 5) {
        const fridayEvents: DailyEvent[] = [{
            type: DailyEventType.MonkeyFriday
        }, {
            type: DailyEventType.ChimpOutFriday
        }];
        // Return a random one of these Friday events
        return randChoice(...fridayEvents);
    }
    // Saturday: Game Decision
    if (date.getDay() === 6) {
        return {
            type: DailyEventType.GameDecision
        };
    }
    // If this date has a calendar date message override, then just do a standard GM (this means date overrides will take precedent over the below events)
    const calendarDate: CalendarDate = toCalendarDate(date); // e.g. "12/25" for xmas
    if (calendarDate in config.goodMorningMessageOverrides) {
        return undefined;
    }
    // Wednesday: Wishful Wednesday (sometimes!)
    if (date.getDay() === 3 && chance(0.5)) {
        return {
            type: DailyEventType.WishfulWednesday,
            wishesReceived: {}
        };
    }
    // Begin home stretch if we're far enough along and not currently in the home stretch (this will be delayed if an above event needs to happen instead e.g. MF)
    // TODO (2.0): Re-enable this?
    // if (state.getSeasonCompletion() >= 0.85 && !state.isHomeStretch()) {
    //     return {
    //         type: DailyEventType.BeginHomeStretch,
    //         homeStretchSurprises: [HomeStretchSurprise.Multipliers, HomeStretchSurprise.LongestComboBonus, HomeStretchSurprise.ComboBreakerBonus]
    //     };
    // }
    // High chance of a random event every day
    if (chance(0.95)) {
        // Compile a list of potential events (include default events)
        const potentialEvents: DailyEvent[] = [
            {
                type: DailyEventType.GrumpyMorning
            },
            {
                type: DailyEventType.EarlyMorning
            },
            {
                type: DailyEventType.SleepyMorning
            },
            {
                type: DailyEventType.EarlyEnd,
                minutesEarly: randChoice(1, 2, 5, 10, 15, randInt(3, 20))
            }
        ];
        // Do the reverse GM event with a smaller likelihood
        if (chance(0.5)) {
            potentialEvents.push({
                type: DailyEventType.ReverseGoodMorning,
                reverseGMRanks: {}
            });
        }
        // Do the nightmare event with a smaller likelihood
        if (chance(0.5)) {
            potentialEvents.push({
                type: DailyEventType.Nightmare,
                disabled: true
            });
        }
        // If someone should be beckoned, add beckoning as a potential event
        const potentialBeckonees: Snowflake[] = state.getLeastRecentPlayers(6);
        if (potentialBeckonees.length > 0) {
            potentialEvents.push({
                type: DailyEventType.Beckoning,
                user: randChoice(...potentialBeckonees)
            });
        }
        // If anyone is qualified to be a guest reveiller, add guest reveille as a potential event
        const potentialReveillers: Snowflake[] = state.getPotentialReveillers();
        if (potentialReveillers.length > 0) {
            const guestReveiller: Snowflake = randChoice(...potentialReveillers);
            potentialEvents.push({
                type: DailyEventType.GuestReveille,
                user: guestReveiller
            });
        }
        // If anyone has a full activity streak, add an event for one of those players to provide tomorrow's GM message
        const potentialWriters: Snowflake[] = state.getFullActivityStreakPlayers();
        if (potentialWriters.length > 0) {
            const guestWriter: Snowflake = randChoice(...potentialWriters);
            potentialEvents.push({
                type: DailyEventType.WritersBlock,
                user: guestWriter
            });
        }
        // Now return one of those events
        return randChoice(...potentialEvents);
    }
};

const awardPrize = async (userId: Snowflake, type: PrizeType, intro: string): Promise<void> => {
    if (!state.hasGame()) {
        await logger.log(`Aborting _${type}_ prize award for **${state.getPlayerDisplayName(userId)}**, as the game hasn't started!`);
        return;
    }
    if (!state.getGame().hasPlayer(userId)) {
        await logger.log(`Aborting _${type}_ prize award for **${state.getPlayerDisplayName(userId)}**, as this player isn't in the game yet!`);
        return;
    }
    try {
        const prizeTexts = state.getGame().awardPrize(userId, type, intro).filter(t => t);
        await dumpState();
        if (prizeTexts.length > 0) {
            for (const prizeText of prizeTexts) {
                await messenger.dm(userId, prizeText, { immediate: true });
            }
            await logger.log(`Sent ${prizeTexts.length} _${type}_ prize DM(s) to **${state.getPlayerDisplayName(userId)}**`);
        }
    } catch (err) {
        await logger.log(`Unable to award _${type}_ prize to **${state.getPlayerDisplayName(userId)}**: \`${err.toString()}\``);
    }
};

const chooseMagicWords = async (n: number, options?: { characters?: number, bonusMultiplier?: number }): Promise<string[]> => {
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
};

const loadSubmissionPromptHistory = async (): Promise<SubmissionPromptHistory> => {
    try {
        return await storage.readJson('prompts.json') as SubmissionPromptHistory;
    } catch (err) {
        if (err.code === 'ENOENT') {
            return {
                used: [],
                unused: []
            };
        }
        throw err;
    }
};

const updateSubmissionPromptHistory = async (used: string[], unused: string[]) => {
    try {
        const promptHistory: SubmissionPromptHistory = await loadSubmissionPromptHistory();
        // Update the used prompts
        const usedSet: Set<string> = new Set(promptHistory.used);
        for (const prompt of used) {
            usedSet.add(prompt);
        }
        promptHistory.used = Array.from(usedSet).sort();
        // Update the unused prompts
        const unusedSet: Set<string> = new Set(promptHistory.unused);
        for (const prompt of unused) {
            unusedSet.add(prompt);
        }
        promptHistory.unused = Array.from(unusedSet).filter(p => !usedSet.has(p)).sort();
        // Dump it
        await storage.write('prompts.json', JSON.stringify(promptHistory, null, 2));
        // TODO: Temp logging
        await logJsonAsFile('Submission prompt history', JSON.stringify(promptHistory, null, 2));
    } catch (err) {
        await logger.log(`Unhandled exception while updating prompts file:\n\`\`\`${err.message}\`\`\``);
    }
};

const chooseRandomUnusedSubmissionPrompt = async (): Promise<string> => {
    const choices = await chooseRandomUnusedSubmissionPrompts(1);
    if (choices.length === 1) {
        return choices[0];
    }
    // Random fallback
    return randChoice(
        // 50% chance to suggest a text prompt
        randChoice("haiku", "limerick", "poem (ABAB)", "2-sentence horror story", "fake movie title", `${randInt(6, 12)}-word story`),
        // 50% chance to suggest an image prompt
        randChoice("pic that goes hard", "cursed image", "dummy stupid pic", "pic that goes adorable", randChoice("pic that goes ruh", "pic that goes buh"))
    );
};

const chooseRandomUnusedSubmissionPrompts = async (n: number): Promise<string[]> => {
    try {
        const choices = (await loadSubmissionPromptHistory()).unused;
        if (choices.length > 0) {
            shuffle(choices);
            return choices.slice(0, n);
        }
    } catch (err) {
        await logger.log(`Unhandled exception while choosing random unused prompt:\n\`\`\`${err.message}\`\`\``);
    }
    return [];
};

const sendGoodMorningMessage = async (): Promise<void> => {
    // Get the overridden message for today, if it exists (some events may use this instead)
    // TODO: need a cleaner way to handle this, but these potential conflicts need to be handled somehow...
    const calendarDate: CalendarDate = toCalendarDate(new Date());
    const overriddenMessage: string | undefined = config.goodMorningMessageOverrides[calendarDate];
    // Now, actually send out the message
    if (goodMorningChannel) {
        switch (state.getEventType()) {
        case DailyEventType.RecapSunday:
            // TODO: This logic makes some assumptions... fix it!
            const orderedPlayers: Snowflake[] = state.getOrderedPlayers();
            const top: Snowflake = orderedPlayers[0];
            const second: Snowflake = orderedPlayers[1];
            await goodMorningChannel.send({
                content: languageGenerator.generate(overriddenMessage ?? '{weeklyUpdate}', { season: state.getSeasonNumber().toString(), top: `<@${top}>`, second: `<@${second}>` }),
                files: [] // TODO (2.0): Should we just delete this?
            });
            break;
        case DailyEventType.WishfulWednesday:
            // If there's an overridden message, just send it naively upfront
            if (overriddenMessage) {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage));
            }
            // Send the standard WW message (immediately if we just sent an overridden message)
            await messenger.send(goodMorningChannel, languageGenerator.generate('{wishfulWednesday}'), { immediate: overriddenMessage !== undefined });
            break;
        case DailyEventType.MonkeyFriday:
            await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage ?? '{happyFriday}'));
            break;
        case DailyEventType.ChimpOutFriday:
            // If there's an overridden message, just send it naively upfront
            if (overriddenMessage) {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage));
            }
            await messenger.send(goodMorningChannel, 'Today is _CHIMP OUT FRIDAY_! Send me a voice message of you going absolutely chimp mode 🗣️');
            break;
        case DailyEventType.BeginHomeStretch:
            // TODO (2.0): If we enable home stretch again, fix this
            await goodMorningChannel.send({
                content: `WAKE UP MY DEAR FRIENDS! For we are now in the home stretch of season **${state.getSeasonNumber()}**! `
                    + 'There are some surprises which I will reveal in a short while, though in the meantime, please take a look at the current standings...',
                files: [] // TODO (2.0): Should we just delete this?
            });
            break;
        case DailyEventType.Beckoning:
            await messenger.send(goodMorningChannel, languageGenerator.generate('{beckoning.goodMorning?}', { player: `<@${state.getEvent().user}>` }));
            break;
        case DailyEventType.GrumpyMorning:
            await messenger.send(goodMorningChannel, languageGenerator.generate('{grumpyMorning}'));
            break;
        case DailyEventType.EarlyMorning:
            await messenger.send(goodMorningChannel, languageGenerator.generate('{earlyMorning}'));
            break;
        case DailyEventType.SleepyMorning:
            await messenger.send(goodMorningChannel, languageGenerator.generate('{sleepyMorning}'));
            break;
        case DailyEventType.WritersBlock:
            // If the guest writer submitted something, use that; otherwise, send the standard GM message
            await messenger.send(goodMorningChannel, state.getEvent().customMessage ?? languageGenerator.generate(overriddenMessage ?? '{goodMorning}'));
            break;
        case DailyEventType.EarlyEnd:
            const minutesEarly: number = state.getEvent().minutesEarly ?? 0;
            const minutesText: Record<number, string> = {
                0: 'at noon',
                1: 'a minute early',
                2: 'a couple minutes early',
                5: 'at five till',
                10: 'at ten till',
                15: 'at a quarter till'
            };
            const when: string = minutesText[minutesEarly] ?? `${minutesEarly} minutes early`;
            await messenger.send(goodMorningChannel, languageGenerator.generate('{earlyEndMorning}', { when }));
            break;
        case DailyEventType.Popcorn: {
            // If there's an overridden message, just send it naively upfront
            if (overriddenMessage) {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage));
            }
            // Send the popcorn intro
            const intro: string = overriddenMessage ? 'There\'s more!' : 'Good morning! It will surely be a fun one.';
            const text = `${intro} Today we'll be playing _Popcorn_! You may only send a message once you've been called on. `
             + 'To call on a friend, simply tag them in your message. I\'ll let the first spot be up for grabs... Who wants to start today\'s Good Morning story?';
            await messenger.send(goodMorningChannel, text, { immediate: overriddenMessage !== undefined });
            break;
        }
        case DailyEventType.Wordle: {
            // If there's an overridden message, just send it naively upfront
            if (overriddenMessage) {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage));
            }
            // Send the wordle intro
            const intro: string = overriddenMessage ? 'There\'s more!' : 'Good morning! ';
            const text = `${intro} Today I have a special puzzle for you... we'll be playing my own proprietary morningtime game called _Wordle_! `
             + `I'm thinking of a **${state.getEvent().wordle?.solution.length ?? '???'}**-letter word, and you each get only one guess! You'll earn points for each new _green_ letter you reveal. Good luck!`;
            await messenger.send(goodMorningChannel, text, { immediate: overriddenMessage !== undefined });
            break;
        }
        case DailyEventType.AnonymousSubmissions: {
            // If there's an overridden message, just send it naively upfront
            if (overriddenMessage) {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage));
            }
            // Send the standard submission prompt
            const prompt = state.getAnonymousSubmissions().getPrompt();
            const intro: string = overriddenMessage ? 'There\'s more!' : 'Good morning! Today is a special one.';
            const text = `${intro} Rather than sending your good morning messages here for all to see, `
                + `I'd like you to come up with a _${prompt}_ and send it directly to me via DM! `
                + `At ${getSubmissionRevealTimestamp()}, I'll post them here anonymously and you'll all be voting on your favorites 😉`;
            await messenger.send(goodMorningChannel, text, { immediate: overriddenMessage !== undefined });
            // Also, let players know they can forfeit
            await sleep(10000);
            await goodMorningChannel.send({
                content: 'If you won\'t be able to vote, then you can _forfeit_ to avoid the no-vote penalty. '
                    + `Your _${prompt}_ will still be presented, but you won't be rewarded if you win big.`,
                components: [{
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.Button,
                        style: ButtonStyle.Danger,
                        customId: 'forfeit',
                        label: 'Forfeit'
                    }]
                }]
            });
            break;
        }
        case DailyEventType.GameDecision:
            // If there's an overridden message, just send it naively upfront
            if (overriddenMessage) {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage));
            }
            // Send the first basic message of the game decision day before the morning officially begins (logic for sending subsequent messages is elsewhere)
            if (state.getGame().getTurn() === 1) {
                await messenger.send(goodMorningChannel, `Welcome to season **${state.getSeasonNumber()}**! Allow me introduce you to this season's game...`, { immediate: overriddenMessage !== undefined })
            } else {
                await messenger.send(goodMorningChannel, `Turn **${state.getGame().getTurn()}** has begun!`, { immediate: overriddenMessage !== undefined });
            }
            break;
        case DailyEventType.GameUpdate:
            if (!state.hasGame()) {
                await logger.log('Attempted to send out the game update Sunday GM message with no game instance! Aborting...');
                return;
            }
            // If there's an overridden message, just send it naively upfront
            if (overriddenMessage) {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage));
            }
            // Send all game-specific messages that should be shown before any decisions are processed
            const preProcessingMessages = await state.getGame().getPreProcessingMessages();
            for (const messengerPayload of preProcessingMessages) {
                await messenger.send(goodMorningChannel, messengerPayload);
            }
            break;
        default:
            // Otherwise, send the standard GM message as normal (do a season intro greeting if today is the first day)
            if (state.getSeasonStartedOn() === getTodayDateString()) {
                const text = `Good morning everyone and welcome to season **${state.getSeasonNumber()}**! `
                    + `I hope to see many familiar faces, and if I\'m lucky maybe even some new ones ${config.defaultGoodMorningEmoji}`;
                await messenger.send(goodMorningChannel, text);
            } else if (chance(config.goodMorningMessageProbability)) {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage ?? '{goodMorning}'));
            }
            break;
        }
    }
};

const sendSeasonEndMessages = async (channel: TextBasedChannel, previousState: GoodMorningState): Promise<void> => {
    // TODO (2.0): We should do this a little more safely...
    const game = previousState.getGame();
    const newSeason: number = previousState.getSeasonNumber() + 1;
    // Send one preliminary hard-coded message signaling the end of the season
    await messenger.send(channel, `Well everyone, season **${previousState.getSeasonNumber()}** has finally come to an end!`);
    await sleep(10000);
    // Send custom messages for each game
    const seasonEndMessages = await game.getSeasonEndMessages();
    await messenger.sendAll(goodMorningChannel, seasonEndMessages);
    // await messenger.send(channel, 'In a couple minutes, I\'ll reveal the winners and the final standings...');
    // await messenger.send(channel, 'In the meantime, please congratulate yourselves (penalties are disabled), take a deep breath, and appreciate the friends you\'ve made in this channel 🙂');
    // Send the "final results image"
    // await sleep(120000);
    // await messenger.send(channel, 'Alright, here are the final standings...');
    // const attachment = new MessageAttachment(await createSeasonResultsImage(previousState, history.medals), 'results.png');
    // await channel.send({ files: [attachment] });
    // await sleep(5000);
    // Send information about the season rewards
    // await sleep(60000);
    // await messenger.send(channel, `As a reward, our champion <@${winner}> will get the following perks throughout season **${newSeason}**:`);
    // await messenger.send(channel, ' ⭐ Ability to set a special "good morning" emoji that everyone in the server can use');
    // await messenger.send(channel, ' ⭐ Honorary Robert status, with the ability to post in **#robertism**');
    // await messenger.send(channel, ' ⭐ Other secret perks...');
    // Wait, then send info about the next season
    await sleep(30000);
    await messenger.send(channel, 'Now that this season is over, I\'ll be taking a vacation for several days. Feel free to post whatever whenever until I return 🌞');
    await messenger.send(channel, `See you all in season **${newSeason}** 😉`);
};

const setStatus = async (active: boolean): Promise<void> => {
    if (client.user) {
        if (active) {
            client.user.setPresence({
                status: 'online',
                activities: [{
                    name: 'GOOD MORNING! 🌞',
                    type: ActivityType.Playing
                }]
            });
        } else {
            client.user.setPresence({
                status: 'idle',
                activities: []
            });
        }
    } else {
        await logger.log('Cannot set bot presence, as `client.user` is null!');
    }
};

const chooseGoodMorningTime = (eventType: DailyEventType | undefined): Date => {
    // Hour-minute overrides of the earliest/latest possible time of a particular event
    const MIN_HOURS: Record<string, [number, number]> = {
        default: [7, 0],
        [DailyEventType.EarlyMorning]: [5, 0],
        [DailyEventType.SleepyMorning]: [10, 0],
        [DailyEventType.ReverseGoodMorning]: [7, 0],
        [DailyEventType.AnonymousSubmissions]: [6, 0],
        [DailyEventType.GameDecision]: [7, 0]
    };
    const MAX_HOURS: Record<string, [number, number]> = {
        default: [10, 0],
        [DailyEventType.EarlyMorning]: [7, 0],
        [DailyEventType.SleepyMorning]: [11, 30],
        [DailyEventType.ReverseGoodMorning]: [11, 15],
        [DailyEventType.AnonymousSubmissions]: [8, 0],
        [DailyEventType.Popcorn]: [9, 15],
        [DailyEventType.GameDecision]: [9, 30],
        [DailyEventType.GameUpdate]: [9, 0]
    };
    const MIN_HOUR: [number, number] = MIN_HOURS[eventType ?? 'default'] ?? MIN_HOURS.default;
    const MAX_HOUR_EXCLUSIVE: [number, number] = MAX_HOURS[eventType ?? 'default'] ?? MAX_HOURS.default;

    // Set boundary of possible date a number of days in the future (1 by default)
    const lowDate: Date = new Date();
    lowDate.setDate(lowDate.getDate());
    lowDate.setHours(...MIN_HOUR, 0, 0);
    const highDate: Date = new Date();
    highDate.setDate(highDate.getDate());
    highDate.setHours(...MAX_HOUR_EXCLUSIVE, 0, 0);

    // Choose a random time between those two times with a 2nd degree Bates distribution
    return getRandomDateBetween(lowDate, highDate, { bates: 2 });
};

const registerGoodMorningTimeout = async (): Promise<void> => {
    // Choose a random time based on the event type
    const nextMorning: Date = chooseGoodMorningTime(state.getEventType());

    // If the chosen morning time has already past, then advance the date to tomorrow
    if (nextMorning.getTime() < new Date().getTime()) {
        nextMorning.setDate(nextMorning.getDate() + 1);
    }

    // We register this with the "Increment Day" strategy since it happens at a particular time and it's not competing with any other triggers.
    await registerTimeout(TimeoutType.NextGoodMorning, nextMorning, { pastStrategy: PastTimeoutStrategy.IncrementDay }, { testingSeconds: 5 });
};

const registerGuestReveilleFallbackTimeout = async (): Promise<void> => {
    // Schedule tomrrow sometime between 11:30 and 11:45
    const date: Date = getTomorrow();
    date.setHours(11, randInt(30, 45), randInt(0, 60));
    // We register this with the "Invoke" strategy since this way of "waking up" is competing with a user-driven trigger.
    // We want to invoke this ASAP in order to avoid this event when it's no longer needed.
    await registerTimeout(TimeoutType.GuestReveilleFallback, date, { pastStrategy: PastTimeoutStrategy.Invoke });
};

const wakeUp = async (sendMessage: boolean): Promise<void> => {
    // If attempting to wake up while already awake, warn the admin and abort
    if (state.isMorning()) {
        logger.log('WARNING! Attempted to wake up while `state.isMorning` is already `true`');
        return;
    }

    // If testing locally, delete recent messages upon waking up
    if (config.testing) {
        await goodMorningChannel.bulkDelete(await goodMorningChannel.messages.fetch({ limit: 50 }));
    }

    // If today is the first decision of the season, instantiate the game...
    if (state.getEventType() === DailyEventType.GameDecision && !state.hasGame()) {
        // Fetch all participating members, ordered by performance in the first week
        const participatingUserIds: Snowflake[] = state.getOrderedPlayers();
        const members: GuildMember[] = [];
        for (const userId of participatingUserIds) {
            const member = await fetchMember(userId);
            if (member) {
                members.push(member);
            }
        }
        // Create the game using these initial members
        // TODO (2.0): Eventually, this should be more generic for other game types (don't hardcode this)
        // const dungeon = DungeonCrawler.createSectional(members, { sectionSize: 11, sectionsAcross: 3 });
        // const newGame = MazeGame.createOrganicBest(members, 20, 43, 19, 90);
        // const newGame = ClassicGame.create(members, true);
        // const newGame = IslandGame.create(members);
        // const newGame = MasterpieceGame.create(members, state.getSeasonNumber());
        const newGame = RiskGame.create(members, state.getSeasonNumber());
        state.setGame(newGame);
        if (config.testing) {
            newGame.setTesting(true);
        }
        // For all starting players, add the points they earned before the game was instantiated
        for (const userId of participatingUserIds) {
            state.getGame().addPoints(userId, state.getPlayerPoints(userId));
        }
        // Award a prize upfront for this week's submission winner(s)
        const lastSubmissionWinners = state.getLastSubmissionWinners();
        for (const userId of lastSubmissionWinners) {
            await awardPrize(userId, lastSubmissionWinners.length === 1 ? 'submissions1' : 'submissions1-tied', 'Congrats on winning the first contest of the season (a few days ago)');
        }
    }

    // If today is a decision day
    let extraGameMessages: MessengerPayload[] = [];
    if (state.getEventType() === DailyEventType.GameDecision && state.hasGame()) {
        // First, attempt to refresh state member info
        await refreshStateMemberInfo();
        // Add new players to the game
        const newPlayers: Snowflake[] = state.getPlayers().filter(userId => !state.getGame().hasPlayer(userId));
        const newMembersById = await fetchMembers(newPlayers);
        const gamePlayerAdditions: GamePlayerAddition[] = Object.values(newMembersById)
            .map(m => ({
                userId: m.id,
                displayName: m.displayName,
                points: state.getPlayerPoints(m.id)
            }));
        // If testing and not just starting the game, add 3 random new NPCs each week
        if (config.testing && state.getGame().getTurn() !== 0) {
            for (let i = 0; i < 3; i++) {
                const npcNumber = state.getGame().getNumPlayers() + i;
                gamePlayerAdditions.push({
                    userId: `npc${npcNumber}`,
                    displayName: `NPC ${npcNumber}`,
                    points: randInt(0, 10)
                });
            }
        }
        // Process the late additions and keep track of the response payload
        const addPlayersMessengerPayloads = state.getGame().addLatePlayers(gamePlayerAdditions);
        extraGameMessages.push(...addPlayersMessengerPayloads);
        // If testing, add a random number of points
        if (config.testing) {
            for (const userId of state.getGame().getPlayers()) {
                state.getGame().addPoints(userId, randInt(0, 18));
            }
        }
        // Begin this week's turn
        const beginTurnMessages = await state.getGame().beginTurn();
        extraGameMessages.push(...beginTurnMessages);
        // Start accepting game decisions
        state.setAcceptingGameDecisions(true);
    } else {
        // For all other morning types, stop accepting game decisions
        state.setAcceptingGameDecisions(false);
    }

    // Increment "days since last good morning" counters for all participating users
    state.incrementAllLGMs();

    // Set today's positive react emoji
    state.setGoodMorningEmoji(config.goodMorningEmojiOverrides[toCalendarDate(new Date())] ?? config.defaultGoodMorningEmoji);

    // Set today's birthday boys
    try {
        const birthdays: Record<Snowflake, string> = await sharedStorage.readJson('birthdays.json');
        state.setBirthdayBoys(Object.keys(birthdays).filter(id => birthdays[id] === toCalendarDate(new Date())));
        if (state.hasBirthdayBoys()) {
            await logger.log(`Today's birthday boys: ${getBoldNames(state.getBirthdayBoys())}`);
        }
    } catch (err) {
        await logger.log(`Failed to load up today's birthday boys: \`${err}\``);
        state.setBirthdayBoys([]);
    }

    // Give hints for today's magic words
    if (state.hasMagicWords()) {
        // Get list of all suitable recipients of the magic word (this is a balancing mechanic, so pick players who are behind yet active)
        const potentialMagicWordRecipients: Snowflake[] = state.getPotentialMagicWordRecipients();
        // Determine if we should give out the hints
        const shouldGiveHint: boolean = potentialMagicWordRecipients.length > 0
            && state.getEventType() !== DailyEventType.BeginHomeStretch;
        // If yes, then give out the hints to random suitable recipients
        if (shouldGiveHint) {
            // Give out as many hints as possible so long as each recipient receives a different magic word
            const magicWords = state.getMagicWords();
            const numHints = Math.min(magicWords.length, potentialMagicWordRecipients.length);
            // Shuffle the recipients so the recipients are random in case it's limited
            shuffle(potentialMagicWordRecipients);
            // For each recipient/word pair, send out the hint via DM
            for (let i = 0; i < numHints; i++) {
                const singleMagicWord = magicWords[i];
                const singleRecipient: Snowflake = potentialMagicWordRecipients[i];
                await messenger.dm(singleRecipient, `Psssst.... a magic word of the day is _"${singleMagicWord}"_`);
                if (singleRecipient !== guildOwner.id) {
                    await logger.log(`Magic word _"${singleMagicWord}"_ was sent to **${state.getPlayerDisplayName(singleRecipient)}** (all: ${naturalJoin(magicWords, { bold: true })})`);
                }
            }
        }
    }

    // Set timeout to prime the game processing loop
    if (state.getEventType() === DailyEventType.GameUpdate) {
        const firstDecisionProcessDate: Date = new Date();
        firstDecisionProcessDate.setMinutes(firstDecisionProcessDate.getMinutes() + 5);
        await registerTimeout(TimeoutType.ProcessGameDecisions, firstDecisionProcessDate, { pastStrategy: PastTimeoutStrategy.Invoke });
    }

    if (state.getEventType() === DailyEventType.BeginHomeStretch) {
        // Activate home stretch mode!
        state.setHomeStretch(true);
        // Set timeout for first home stretch surprise (these events are recursive)
        const surpriseTime = new Date();
        surpriseTime.setMinutes(surpriseTime.getMinutes() + 10);
        await registerTimeout(TimeoutType.HomeStretchSurprise, surpriseTime, { pastStrategy: PastTimeoutStrategy.Invoke });
    }

    if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
        // First, cancel all pending submission prompt polls (if any have been delayed for long enough)
        await cancelTimeoutsWithType(TimeoutType.AnonymousSubmissionTypePollStart);
        await cancelTimeoutsWithType(TimeoutType.AnonymousSubmissionTypePollEnd);
        // Set timeout for anonymous submission reveal
        const submissionRevealTime = new Date();
        submissionRevealTime.setHours(10, 50, 0, 0);
        // We register this with the "Invoke" strategy since we want it to happen before Pre-Noon (with which it's registered in parallel)
        await registerTimeout(TimeoutType.AnonymousSubmissionReveal, submissionRevealTime, { pastStrategy: PastTimeoutStrategy.Invoke });
        // Also, register a reply to give users a 5 minute warning
        const fiveMinuteWarningTime = new Date(submissionRevealTime);
        fiveMinuteWarningTime.setMinutes(fiveMinuteWarningTime.getMinutes() - 5);
        const warningArg: ReplyToMessageData = {
            channelId: goodMorningChannel.id,
            content: randChoice('5 minute warning', '5 minutes left, submit now or hold your peace', '5 minutes left', 'You have 5 minutes',
                'Revealing submissions in 5 minutes', '5 MINUTES!', 'Closing my DMs in 5 minutes', 'Window closes in 5 minutes') + ' ⏳'
        };
        await registerTimeout(TimeoutType.ReplyToMessage, fiveMinuteWarningTime, { arg: warningArg, pastStrategy: PastTimeoutStrategy.Delete });
    }

    const minutesEarly: number = state.getEventType() === DailyEventType.EarlyEnd ? (state.getEvent().minutesEarly ?? 0) : 0;
    // Set timeout for when morning almost ends
    const preNoonToday: Date = new Date();
    preNoonToday.setHours(11, randInt(48, 56) - minutesEarly, randInt(0, 60), 0);
    // We register this with the "Increment Hour" strategy since its subsequent timeout (Noon) is registered in series
    await registerTimeout(TimeoutType.NextPreNoon, preNoonToday, { pastStrategy: PastTimeoutStrategy.IncrementHour });

    // Update the bot's status to active
    await setStatus(true);

    // If there is no player data, then reset the started-on date for this season
    if (state.getNumPlayers() === 0) {
        state.setSeasonStartedOn(getTodayDateString());
        await logger.log('Set season started-on date to today');
    }

    // Send the good morning message
    if (sendMessage) {
        await sendGoodMorningMessage();
    }

    // Reset the daily state (should happen immediately after sending the first message to be fair)
    state.setMorning(true);
    state.setGracePeriod(false);
    state.resetDailyState();
    state.clearBaiters();
    dailyVolatileLog = [];
    dailyVolatileLog.push([new Date(), 'GMBR has arisen.']);

    // Send the remaining game decision messages
    if (state.getEventType() === DailyEventType.GameDecision && state.hasGame()) {
        if (state.getGame().getTurn() === 1) {
            // If it's the first week, send the introduction messages for this game
            const introductionMessages = await state.getGame().getIntroductionMessages();
            for (const messengerPayload of introductionMessages) {
                await messenger.send(goodMorningChannel, messengerPayload);
            }
        } else {
            // If it's not the first week, send the state image for this week
            const attachment = new AttachmentBuilder(await state.getGame().renderState()).setName(`game-turn${state.getGame().getTurn()}-decision.png`);
            await goodMorningChannel.send({
                files: [attachment],
                components: state.getGame().getDecisionActionRow()
            });
        }
        // Send the instructions for this game no matter the week
        await messenger.send(goodMorningChannel, state.getGame().getInstructionsText());
        // Get decision phases that need to be scheduled
        for (const decisionPhase of state.getGame().getDecisionPhases()) {
            const phaseDate = new Date(new Date().getTime() + decisionPhase.millis);
            await registerTimeout(TimeoutType.GameDecisionPhase, phaseDate, { arg: decisionPhase.key, pastStrategy: PastTimeoutStrategy.Invoke});
        }
    }

    // If there are any extra begin-turn messages, send them now
    if (extraGameMessages.length > 0) {
        for (const extraGameMessage of extraGameMessages) {
            await messenger.send(goodMorningChannel, extraGameMessage);
        }
    }

    // Notify the channel of any birthdays today
    if (state.hasBirthdayBoys()) {
        await messenger.send(goodMorningChannel, `Everyone please wish a very _happy birthday_ to our very own ${getJoinedMentions(state.getBirthdayBoys())}! 🎁`);
    }

    // Send any game-related DMs, if any
    if (state.getEventType() === DailyEventType.GameDecision && state.hasGame()) {
        const weeklyDecisionDMs = state.getGame().getWeeklyDecisionDMs();
        const recipients = Object.keys(weeklyDecisionDMs);
        if (recipients.length > 0) {
            for (const userId of recipients) {
                await messenger.dm(userId, weeklyDecisionDMs[userId], { immediate: true });
            }
            await logger.log(`Sent weekly decision DMs to: ${getJoinedMentions(recipients)}`);
        }
    }

    // Process "reverse" GM ranks
    if (state.getEventType() === DailyEventType.ReverseGoodMorning) {
        const event = state.getEvent();
        const reverseGMRanks = event.reverseGMRanks;
        if (reverseGMRanks) {
            const mostRecentUsers: Snowflake[] = Object.keys(reverseGMRanks);
            mostRecentUsers.sort((x, y) => reverseGMRanks[y] - reverseGMRanks[x]);
            const scaledPoints = getSimpleScaledPoints(mostRecentUsers, { maxPoints: config.miniGameAward, order: 2 });
            for (const scaledPointsEntry of scaledPoints) {
                const { userId, points, rank } = scaledPointsEntry;
                // Dump the rank info into the daily status map and assign points accordingly
                state.awardPoints(userId, points);
                state.setDailyRank(userId, rank);
                state.resetDaysSinceLGM(userId);
                dailyVolatileLog.push([new Date(), `<@${userId}> was ${getRankString(rank)}-to-last = \`${points}\``]);
            }
            // Send a message to the channel tagging the respective players
            if (mostRecentUsers.length >= 3) {
                await messenger.send(goodMorningChannel, `Thanks to <@${mostRecentUsers[2]}>, <@${mostRecentUsers[1]}>, and especially <@${mostRecentUsers[0]}> for paving the way!`);
            }
        } else {
            await logger.log('Cannot process reverse GM winners, as there\'s no `reverseGMRanks` map in the event state!');
        }
    }

    // Finally, re-grant access for all muted players
    await grantGMChannelAccess(state.getMutedPlayers());

    // Dump state
    await dumpState();
};

const processSubmissionVote = async (userId: Snowflake, submissionCodes: string[], source: string, callback: (text: string) => Promise<void>) => {
    if (!state.isAcceptingAnonymousSubmissionVotes()) {
        await callback('You shouldn\'t be able to vote right now!');
        return;
    }
    const anonymousSubmissions = state.getAnonymousSubmissions();
    const isSubmitterVote: boolean = anonymousSubmissions.isSubmitter(userId);
    const submissionCodeSet: Set<string> = new Set(submissionCodes);
    // Require at least three votes (or one less than the total number of votes if there aren't enough submissions)
    // Due to prior validation, there will always be two or more submissions, so this min will always be computed as at least 1
    const maxRequiredVotes: number = 3;
    const minRequiredVotes: number = Math.min(maxRequiredVotes, anonymousSubmissions.getSubmissionCodes().length - 1);
    // Do some validation on the vote before processing it further
    if (submissionCodes.length === 0) {
        await callback(`I don\'t understand, please tell me which submissions you\'re voting for. Choose from ${naturalJoin([...anonymousSubmissions.getSubmissionCodes()])}.`);
    } else if (submissionCodes.length < minRequiredVotes) {
        await callback(`You must vote for at least **${minRequiredVotes}** submission${minRequiredVotes === 1 ? '' : 's'}!`);
    } else if (submissionCodes.length > maxRequiredVotes) {
        await callback(`You cannot vote for more than **${maxRequiredVotes}** submissions!`);
    } else if (submissionCodeSet.size !== submissionCodes.length) {
        await callback('You can\'t vote for the same submission twice!');
    } else {
        // Ensure that all votes are for valid submissions
        for (const submissionCode of submissionCodes) {
            if (!anonymousSubmissions.isValidSubmissionCode(submissionCode)) {
                await callback(`${submissionCode} is not a valid submission! Choose from ${naturalJoin([...anonymousSubmissions.getSubmissionCodes()])}.`);
                return;
            }
            if (anonymousSubmissions.getOwnerOfSubmission(submissionCode) === userId) {
                await callback('You can\'t vote for your own submission!');
                return;
            }
        }
        // Cast the vote
        anonymousSubmissions.setVote(userId, submissionCodes);
        // If the player is on voting probation, take them off
        let takenOffProbation = false;
        if (state.isPlayerOnVotingProbation(userId)) {
            state.setPlayerVotingProbation(userId, false);
            takenOffProbation = true;
        }
        await dumpState();

        if (state.haveAllSubmittersVoted()) {
            // If all the votes have been cast, then finalize the voting
            await callback('Thanks, but you were the last to vote (no penalty, but be quicker next time) 🌚');
            await finalizeAnonymousSubmissions();
        } else {
            // Otherwise, just send confirmation to the voter
            await callback((isSubmitterVote ? 'Your vote has been cast! ' : 'Your vote will be used for the collective audience vote! ')
                + naturalJoin(submissionCodes, { bold: true, conjunction: 'then' })
                + (takenOffProbation ? ' (you have been taken off probation, nice job 👍)' : ''));
            // Notify the admin of how many votes remain
            await logger.log(`**${state.getPlayerDisplayName(userId)}** just voted (${source}), waiting on **${anonymousSubmissions.getNumDeadbeats()}** more votes. ${takenOffProbation ? '**(off probation)**' : ''}`);
        }
    }
};

const finalizeAnonymousSubmissions = async () => {
    // Validate that the current event is correct
    if (state.getEventType() !== DailyEventType.AnonymousSubmissions) {
        await logger.log(`WARNING! Attempted to finalize submissions with the event as \`${state.getEventType()}\`, aborting...`);
        return;
    }
    // Validate that the submissions exist
    if (!state.hasAnonymousSubmissions()) {
        await logger.log('WARNING! Attempted to finalize submissions with no submissions data, aborting...');
        return;
    }
    const anonymousSubmissions = state.getAnonymousSubmissions();

    // Validate that the current phase is correct
    if (!anonymousSubmissions.isVotingPhase()) {
        await logger.log(`WARNING! Attempted to finalize submissions while in the \`${anonymousSubmissions.getPhase()}\` phase, aborting...`);
        return;
    }

    // Update the phase to prevent further action
    anonymousSubmissions.setPhase('results');
    await dumpState(); // Just in case anything below fails

    // TODO: Temp logging to see how this works
    await logger.log(`Participant votes: ${getJoinedMentions(Object.keys(anonymousSubmissions.getSubmitterVotes()))}\nAudience votes: ${getJoinedMentions(Object.keys(anonymousSubmissions.getAudienceVotes()))}`);

    // Cancel any scheduled voting reminders
    await cancelTimeoutsWithType(TimeoutType.AnonymousSubmissionVotingReminder);

    // Disable voting and forfeiting by deleting commands
    const guildCommands = await guild.commands.fetch();
    guildCommands.forEach(command => {
        if ((command.name === 'vote') && command.applicationId === client.application?.id) {
            command.delete();
        }
    });

    // Penalize the submitters who didn't vote (but didn't forfeit)
    const deadbeats: Snowflake[] = anonymousSubmissions.getDeadbeats();
    const deadbeatsOnProbation: Snowflake[] = deadbeats.filter(userId => state.isPlayerOnVotingProbation(userId));
    for (const userId of deadbeats) {
        // Deduct points
        state.deductPoints(userId, config.defaultAward);
        // Put them on voting probation
        state.setPlayerVotingProbation(userId, true);
    }

    // Then, assign points based on rank in score (excluding those who didn't vote or forfeit)
    const { results, audienceVote, scoringDetailsString } = anonymousSubmissions.computeVoteResults();
    const validResults = results.filter(r => !r.disqualified);
    const scaledPoints = getScaledPoints(validResults, { maxPoints: config.grandContestAward, order: 3 });
    const handicapReceivers: Set<string> = new Set();
    for (const scaledPointsEntry of scaledPoints) {
        const { userId, points, rank } = scaledPointsEntry;
        const pointsEarned = anonymousSubmissions.hasUserForfeited(userId) ? config.defaultAward : points;
        // If the player placed in the top 3 and needs a handicap, give them double points
        if (rank <= 3 && state.doesPlayerNeedHandicap(userId)) {
            state.awardPoints(userId, 2 * pointsEarned);
            handicapReceivers.add(userId);
        } else {
            state.awardPoints(userId, pointsEarned);
        }
        state.setDailyRank(userId, rank);
        state.resetDaysSinceLGM(userId);
    }
    await dumpState(); // Just in case anything below fails

    // Reveal the winners (and losers) to the channel
    if (deadbeatsOnProbation.length > 0) {
        await messenger.send(goodMorningChannel, `I'm waiting on ${getJoinedMentions(deadbeatsOnProbation)}, but they're on probation so let's go ahead and reveal the results...`);
    } else {
        await messenger.send(goodMorningChannel, 'Now, time to reveal the results...');
    }
    if (deadbeats.length > 0) {
        await sleep(10000);
        await messenger.send(goodMorningChannel, `Before anything else, say hello to the deadbeats who were disqualified for not voting! ${getJoinedMentions(deadbeats)} 👋`);
    }
    const zeroVoteResults = validResults.filter(r => r.noVotes);
    if (zeroVoteResults.length > 0) {
        const zeroVoteUserIds: Snowflake[] = zeroVoteResults.map(r => r.userId);
        await sleep(12000);
        await messenger.send(goodMorningChannel, `Now, let us extend our solemn condolences to ${getJoinedMentions(zeroVoteUserIds)}, for they received no votes this fateful morning... 😬`);
    }

    // Show the 3rd/2nd place winners
    const showRunnersUp = async (rank: number) => {
        const runnersUp = validResults.filter(r => r.rank === rank);
        if (runnersUp.length > 0) {
            await sleep(15000);
            let headerText = '';
            // Construct the header text
            if (runnersUp.length === 1) {
                // If there's only one runner-up
                const userId = runnersUp[0].userId;
                const code = runnersUp[0].code;
                // First, add the headline
                headerText += `In ${getRankString(rank)}`;
                // If this one runner-up forfeited, mention it here
                if (anonymousSubmissions.hasUserForfeited(userId)) {
                    headerText += ' yet only receiving participation points';
                }
                // Finally, mention their name and their submission code
                const userTitle = anonymousSubmissions.hasUserForfeited(userId) ? `the forfeiting <@${userId}>` : `<@${userId}>`;
                headerText += `, we have ${userTitle} with submission **${code}**!`;
            } else {
                // If there's a tie for this runner-up position
                const userIds = runnersUp.map(r => r.userId);
                const codes = runnersUp.map(r => r.code);
                // First, add the headline
                if (runnersUp.length === 2) {
                    headerText += `Tying for ${getRankString(rank)}`;
                } else {
                    headerText += `Coming in a ${runnersUp.length}-way tie for ${getRankString(rank)}`
                }
                // Mention their names and submission codes
                headerText += `, we have ${getJoinedMentions(userIds)} with submissions ${naturalJoin(codes, { bold: true })}!`;
                // If any of them forfeited, mention it after the fact
                const forfeiters = runnersUp.filter(r => r.forfeited);
                if (forfeiters.length > 0) {
                    headerText += ` (${getJoinedMentions(forfeiters.map(f => f.userId))} sadly forfeited and will only receive participation points)`;
                }
            }
            await messenger.send(goodMorningChannel, {
                content: headerText,
                embeds: runnersUp.map(r => toSubmissionEmbed(r.submission))
            });
        }
    };
    await showRunnersUp(3);
    await showRunnersUp(2);

    // Now, present the first-place winner
    const winners = validResults.filter(r => r.rank === 1);
    if (winners.length > 0) {
        await sleep(15000);
        if (winners.length === 1) {
            await messenger.send(goodMorningChannel, `And in first place, with submission **${winners[0].code}**...`);
        } else {
            await messenger.send(goodMorningChannel, `And tying for first place, with submissions ${naturalJoin(winners.map(w => w.code), { bold: true })}...`);
        }
        await sleep(6000);
        await messenger.send(goodMorningChannel, `Receiving ${winners[0].breakdownString}...`);
        // If only one person won and they forfeited, mention it beforehand
        if (winners.length === 1 && winners[0].forfeited) {
            await sleep(6000);
            await messenger.send(goodMorningChannel, 'Being awarded only participation points on account of them sadly forfeiting...');
        }
        // Do the grand reveal
        await sleep(6000);
        await messenger.send(goodMorningChannel, {
            content: `We have our winner${winners.length === 1 ? '' : 's'}, ${getJoinedMentions(winners.map(w => w.userId))}! Congrats!`,
            embeds: winners.map(w => toSubmissionEmbed(w.submission))
        });
        // If more than one person won and any forfeited, mention it after the fact
        if (winners.length > 1) {
            const forfeiters = winners.filter(w => w.forfeited);
            if (forfeiters.length > 0) {
                await messenger.send(goodMorningChannel, `Sadly, ${getJoinedMentions(forfeiters.map(f => f.userId))} forfeited and has only received participation points...`);
            }
        }
    } else {
        // Handle the case in which there are somehow no first-place winners
        await messenger.send(goodMorningChannel, 'Oh dear, it appears as if no one got first place? Mister Admin, I think you\'re gonna wanna see this...');
    }

    // Set the winner(s) as the "last submission winners" for the next week
    state.setLastSubmissionWinners(winners.map(r => r.userId));

    // Send DMs to let each user know their ranking
    for (const result of validResults) {
        const userId = result.userId;
        // Send the DM (let them know about forfeiting and handicapping too)
        await messenger.dm(userId,
            `Your ${anonymousSubmissions.getPrompt()} ${result.tied ? 'tied for' : 'placed'} **${getRankString(result.rank)}** of **${validResults.length}**, receiving ${result.breakdownString}. `
                + `Thanks for participating ${config.defaultGoodMorningEmoji}`
                + (result.forfeited ? ' (and sorry that you had to forfeit)' : '')
                + (handicapReceivers.has(userId) ? ' (since you\'re a little behind, I\'ve doubled the points earned for this win!)' : ''),
            { immediate: true });
    }

    // Set the winner(s) as the "last submission winners" for the next week
    state.setLastSubmissionWinners(validResults.filter(r => r.rank === 1).map(r => r.userId));

    // Award special prizes and notify via DM
    for (const entry of validResults) {
        if (entry.rank === 1) {
            if (entry.tied) {
                await awardPrize(entry.userId, 'submissions1-tied', 'Congrats on your shared victory');
            } else {
                await awardPrize(entry.userId, 'submissions1', 'Congrats on your victory');
            }
        } else if (entry.rank === 2) {
            if (entry.tied) {
                await awardPrize(entry.userId, 'submissions2-tied', 'Congrats on tying for 2nd place');
            } else {
                await awardPrize(entry.userId, 'submissions2', 'Congrats on snagging 2nd place');
            }
        } else if (entry.rank === 3) {
            if (entry.tied) {
                await awardPrize(entry.userId, 'submissions3-tied', 'Congrats on tying for 3rd place');
            } else {
                await awardPrize(entry.userId, 'submissions3', 'Congrats on snagging 3rd place');
            }
        }
    }

    // Send the details of the scoring to the sungazers
    await messenger.send(sungazersChannel, 'FYI gazers, here are the details of today\'s voting...');
    await messenger.send(sungazersChannel, scoringDetailsString);
    // Let them know how the score is calculated
    await messenger.send(sungazersChannel, AnonymousSubmissionsState.getVotingFormulaString());
    // Let them know the audience votes, if any
    if (audienceVote.length > 0) {
        await messenger.send(sungazersChannel, `**${Object.keys(anonymousSubmissions.getAudienceVotes()).length}** audience vote(s) merged as: ${naturalJoin(audienceVote, { bold: true })}`);
    }
    // Let them know who's on probation, if anyone
    if (state.getPlayersOnVotingProbation().length > 0) {
        await messenger.send(sungazersChannel, `Players currently on voting probation: ${getBoldNames(state.getPlayersOnVotingProbation())}`);
    }

    // Misc logging
    if (handicapReceivers.size > 0) {
        await logger.log(`Awarded handicap points to ${getBoldNames(Array.from(handicapReceivers))}!`);
    }

    await dumpState();
};

const TIMEOUT_CALLBACKS: Record<TimeoutType, (arg?: any) => Promise<void>> = {
    [TimeoutType.NextGoodMorning]: async (): Promise<void> => {
        await wakeUp(true);
    },
    [TimeoutType.NextPreNoon]: async (): Promise<void> => {
        // If attempting to invoke this while already asleep, warn the admin and abort
        if (!state.isMorning()) {
            logger.log('WARNING! Attempted to trigger pre-noon while `state.isMorning` is `false`');
            return;
        }

        const minutesEarly: number = state.getEventType() === DailyEventType.EarlyEnd ? (state.getEvent().minutesEarly ?? 0) : 0;
        // Set timeout for when morning ends
        const noonToday: Date = new Date();
        noonToday.setHours(12, 0, 0, 0);
        noonToday.setMinutes(noonToday.getMinutes() - minutesEarly);
        // We register this with the "Increment Hour" strategy since its subsequent timeout (GoodMorning) is registered in series
        await registerTimeout(TimeoutType.NextNoon, noonToday, { pastStrategy: PastTimeoutStrategy.IncrementHour }, { testingSeconds: 5 });
        // Set timeout for when baiting starts
        const baitingStartTime: Date = new Date();
        baitingStartTime.setHours(11, 59, 0, 0);
        baitingStartTime.setMinutes(baitingStartTime.getMinutes() - minutesEarly);
        // We register this with the "Delete" strategy since it doesn't schedule any events and it's non-critical
        await registerTimeout(TimeoutType.BaitingStart, baitingStartTime, { pastStrategy: PastTimeoutStrategy.Delete }, { testingSeconds: 4 });

        // Check the results of anonymous submissions
        if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
            // ...if the votes haven't been finalized already
            if (state.isAcceptingAnonymousSubmissionVotes()) {
                await finalizeAnonymousSubmissions();
                // Sleep to provide a buffer in case more messages need to be sent
                await sleep(10000);
            } else {
                await logger.log('Aborting pre-noon submission finalizing, as the submissions are not currently in the voting phase.');
            }
            // Wipe the submissions data from the state since we're done with it completely
            state.clearAnonymousSubmissions();
        }

        // Award prizes to the players with the most wishes
        if (state.getEventType() === DailyEventType.WishfulWednesday) {
            // TODO: Remove this try-catch once we're sure this works
            try {
                const wishesReceived = state.getEvent().wishesReceived;
                if (wishesReceived) {
                    const winners = Object.keys(wishesReceived).sort((x, y) => (wishesReceived[y] ?? 0) - (wishesReceived[x] ?? 0));
                    await logger.log('Wishful wednesday results:\n' + winners.map(u => `**${state.getPlayerDisplayName(u)}:** ${wishesReceived[u]}`));
                    // Award points based on number of wishes received
                    const scaledPoints = getSimpleScaledPoints(winners, { maxPoints: config.miniGameAward, order: 2 });
                    for (const scaledPointsEntry of scaledPoints) {
                        const { userId, points } = scaledPointsEntry;
                        state.awardPoints(userId, points);
                    }
                    // Fill in missing display names before sending out the message
                    await refreshStateMemberInfo();
                    // Tag players who received wishes
                    if (winners.length > 0) {
                        await messenger.send(goodMorningChannel, `Today's biggest wish receipient was **${state.getPlayerDisplayName(winners[0])}**, how wonderful ${config.defaultGoodMorningEmoji}`);
                        if (winners.length > 2) {
                            await messenger.send(goodMorningChannel, `**${state.getPlayerDisplayName(winners[1])}** and **${state.getPlayerDisplayName(winners[2])}** were also blessed!`);
                        }
                    }
                }
            } catch (err) {
                await logger.log(`Wishful Wednesday wrapup logic failed: \`${err}\``);
            }
        }

        // If it's a popcorn day, prompt the end of the story
        if (state.getEventType() === DailyEventType.Popcorn) {
            const event = state.getEvent();
            // Cancel the fallback timeout to prevent weird race conditions at the end of the game
            await cancelTimeoutsWithType(TimeoutType.PopcornFallback);
            // "Disabling" the event allows the current user to end the story, and if there's no user then it prevents further action
            event.disabled = true;
            // Prompt the user to end the story or cut it off there
            if (event.user) {
                await messenger.send(goodMorningChannel, `<@${event.user}> my friend, pass the torch to someone else or complete this story by ending your message with _"The End"_!`);
            } else {
                await messenger.send(goodMorningChannel, languageGenerator.generate('My, what a truly {adjectives.positive?} story! Thank you all for weaving the threads of imagination this morning...'));
            }
        }

        // Update current leader property
        const previousLeader = state.getCurrentLeader();
        const leaderUpset: boolean = state.updateCurrentLeader();
        // TODO (2.0): Should this be re-enabled?
        if (false && leaderUpset) {
            const newLeader = state.getCurrentLeader();
            // If it's not the end of the season, notify the channel of the leader shift
            if (!state.isSeasonGoalReached() && previousLeader && newLeader) {
                await messenger.send(goodMorningChannel, languageGenerator.generate('{leaderShift?}', { old: `<@${previousLeader}>`, new: `<@${newLeader}>` }));
            }
            // Sleep to provide a buffer in case more messages need to be sent
            await sleep(10000);
        }

        // Determine event for tomorrow
        const nextEvent = await chooseEvent(getTomorrow());
        if (nextEvent && !state.isSeasonGoalReached()) {
            state.setNextEvent(nextEvent);
            // TODO: temporary message to tell admin when a special event has been selected, remove this soon
            await logger.log(`Event for tomorrow has been selected: \`${JSON.stringify(nextEvent)}\``);
            // Depending on the type of event chosen for tomorrow, send out a special message
            if (nextEvent.type === DailyEventType.GuestReveille) {
                await messenger.send(goodMorningChannel, languageGenerator.generate('{reveille.summon}', { player: `<@${nextEvent.user}>` }));
            } else if (nextEvent.type === DailyEventType.ReverseGoodMorning) {
                const text = 'Tomorrow morning will be a _Reverse_ Good Morning! '
                    + 'Instead of saying good morning after me, you should say good morning _before_ me. '
                    + 'The last ones to say it before I wake up will be the most appreciated 🙂';
                await messenger.send(goodMorningChannel, text);
            }
        }

        // If there's a pre-determined submissions prompt, notify the players
        if (state.hasAnonymousSubmissions()) {
            const prompt = state.getAnonymousSubmissions().getPrompt();
            if (nextEvent && nextEvent.type === DailyEventType.AnonymousSubmissions) {
                await messenger.send(goodMorningChannel, `Reminder that tomorrow's submission prompt is _"${prompt}"_! I'm already accepting submissions`);
            } else {
                await messenger.send(goodMorningChannel, 'Hear ye, hear ye! Have a little sneak peek at this Tuesday\'s submission prompt 👀 '
                    + `you'll all be sending me a _${prompt}_! You can send it to me now if it's ready, otherwise start putting something together if you know what's best for you...`);
            }
        }

        // Process the pre-noon game decision endpoint and send any messages
        if (state.getEventType() === DailyEventType.GameDecision && state.hasGame()) {
            const responseMessages = await state.getGame().onDecisionPreNoon();
            await messenger.sendAll(goodMorningChannel, responseMessages);
        }

        // Dump state
        await dumpState();
    },
    [TimeoutType.BaitingStart]: async (): Promise<void> => {
        // Start accepting bait
        state.setAcceptingBait(true);
        await dumpState();
        // If it's the end of the popcorn event...
        if (state.getEventType() === DailyEventType.Popcorn) {
            const event = state.getEvent();
            // If there's still a user on the hook, tell them to hurry up!
            if (event.user) {
                await messenger.send(goodMorningChannel, languageGenerator.generate('{popcorn.hurry?}'));
            }
        }
    },
    [TimeoutType.NextNoon]: async (): Promise<void> => {
        // If attempting to end the morning while already asleep, warn the admin and abort
        if (!state.isMorning()) {
            logger.log('WARNING! Attempted to end the morning while `state.isMorning` is already `false`');
            return;
        }

        // We may send a warning if not ending at noon only if this isn't the "early end" event (we expect players to be paying attention)
        const maySendWarning: boolean = state.getEventType() !== DailyEventType.EarlyEnd;

        // Update basic state properties
        state.setMorning(false);
        state.setAcceptingBait(false);

        // If someone baited, then award the most recent baiter
        const bait: Bait | undefined = state.getMostRecentBait();
        if (bait) {
            state.awardPoints(bait.userId, config.defaultAward / 2);
            await messenger.dm(bait.userId, languageGenerator.generate('{bait.setup?}'), { immediate: true });
            await logger.log(`Awarded **${state.getPlayerDisplayName(bait.userId)}** for setting up bait.`);
        }
        // If someone was out-baited, penalize and react to their message
        const previousBait: Bait | undefined = state.getPreviousBait();
        if (previousBait) {
            state.deductPoints(previousBait.userId, config.defaultAward / 2);
            await reactToMessageById(previousBait.messageId, '🤡');
            await logger.log(`Penalized **${state.getPlayerDisplayName(previousBait.userId)}** for being out-baited.`);
        }

        // If today was a Wordle day, award points using the hi-scores map
        if (state.getEventType() === DailyEventType.Wordle) {
            // Cancel any timeouts for subsequent rounds
            await cancelTimeoutsWithType(TimeoutType.WordleRestart);
            // Award points
            const event = state.getEvent();
            if (event && event.wordleHiScores) {
                const scores = event.wordleHiScores;
                const sortedUserIds: Snowflake[] = Object.keys(scores).sort((x, y) => (scores[y] ?? 0) - (scores[x] ?? 0));
                const scaledPoints = getSimpleScaledPoints(sortedUserIds, { maxPoints: config.focusGameAward, order: 2 });
                const rows: string[] = [];
                // Award players points based on their score ranking
                for (const scaledPointsEntry of scaledPoints) {
                    const { userId, points, rank } = scaledPointsEntry;
                    const score = scores[userId] ?? 0;
                    state.awardPoints(userId, points);
                    rows.push(`_${getRankString(rank)}:_ **${score}** <@${userId}>`);
                }
                await messenger.send(goodMorningChannel, '__Wordle Results:__\n' + rows.join('\n') + '\n(_Disclaimer:_ these are not your literal points earned)');
            }
        }

        // Update player activity counters (this can only be done after all things which can possibly award points)
        const newStreakUsers: Snowflake[] = state.incrementPlayerActivities();
        // Award prizes to all players who just achieved full streaks
        for (const userId of newStreakUsers) {
            await awardPrize(userId, 'streak', `Thank you for bringing us Good Morning cheer for **${ActivityTracker.CAPACITY}** consecutive days`);
        }

        // If today was a popcorn day, penalize and notify if a user failed to take the call
        if (state.getEventType() === DailyEventType.Popcorn) {
            const event = state.getEvent();
            if (event.user) {
                state.deductPoints(event.user, config.defaultAward);
                await messenger.send(goodMorningChannel, `Looks like our dear friend <@${event.user}> wasn't able to complete today's Good Morning story... 😔`);
            }
            // Summarize the story
            if (event.storySegments && event.storySegments.length > 0) {
                // TODO: Remove this try-catch once we're sure it's working
                try {
                    const summary = splitTextNaturally(await generateSynopsisWithAi(event.storySegments.join('\n')), 1500);
                    for (const summarySegment of summary) {
                        await messenger.send(goodMorningChannel, summarySegment);
                    }
                } catch (err) {
                    await logger.log(`Failed to summarize popcorn story: \`${err}\``);
                }
            }
        }

        // Activate the queued up event (this can only be done after all thing which process the morning's event)
        state.dequeueNextEvent();

        // If we're testing locally, simulate the prize award system by awarding a prize to a random user
        if (config.testing && state.getEventType() === DailyEventType.GameDecision) {
            const randomUserId = randChoice(...state.getPlayers());
            await awardPrize(randomUserId, 'submissions1', 'Congrats for existing');
            await goodMorningChannel.send(`Sent prize offer to <@${randomUserId}>`);
        }

        // Set tomorrow's magic words (if it's not an abnormal event tomorrow)
        state.clearMagicWords();
        const magicWords = await chooseMagicWords(randInt(2, 8));
        if (magicWords.length > 0 && !state.isEventAbnormal()) {
            state.setMagicWords(magicWords);
        }

        // Invoke the daily noon game endpoint, which may subsequently result in the season being over.
        // This MUST be invoked before any checks on the season end condition.
        if (state.hasGame()) {
            state.getGame().endDay();
        }

        // If the season is still going... (before dumping state)
        if (!state.isSeasonGoalReached()) {
            // Revoke access for all players who should be muted (based on their track record / penalty history)
            // Must be done before dumping the state because it sets player mute properties
            await revokeGMChannelAccess(state.getDelinquentPlayers());
        }

        // Dump state and R9K hashes
        await dumpState();
        await dumpR9KHashes();
        await dumpBaitR9KHashes();
        await dumpYouTubeIds();

        // If the season is still going... (after dumping state)
        if (!state.isSeasonGoalReached()) {
            // Register a timeout that will allow the bot to "wake up" tomorrow
            if (state.getEventType() === DailyEventType.GuestReveille) {
                // Register "fallback" timeout to wake up in case the guest reveille doesn't say anything
                await registerGuestReveilleFallbackTimeout();
            } else {
                // Register the normal GM timeout
                await registerGoodMorningTimeout();
            }
            // If there's a nightmare event, schedule the timeout for it
            if (state.getEventType() === DailyEventType.Nightmare) {
                // Sometime between 1am-4am
                const nightmareDate: Date = getTomorrow();
                nightmareDate.setHours(randInt(1, 4), randInt(0, 60), randInt(0, 60), 0);
                // If this event was missed, simply delete it (nothing will be impacted if it's skipped)
                await registerTimeout(TimeoutType.Nightmare, nightmareDate, { pastStrategy: PastTimeoutStrategy.Delete });
                await logger.log(`Scheduled nightmare event for **${getRelativeDateTimeString(nightmareDate)}**`);
            }
            // Poll for tomorrow's submission prompt (if tomorrow is a submissions day and there's not already a pre-determined prompt)
            // TODO: If the high-effort poll gets delayed for long enough, this could theoretically kick off in parallel. HANDLE THIS!
            if (state.getEventType() === DailyEventType.AnonymousSubmissions && !state.hasAnonymousSubmissions()) {
                // Accept suggestions for 2 hours
                const pollStartDate = new Date();
                pollStartDate.setHours(pollStartDate.getHours() + 2);
                // In 2 hours, fetch replies to this message and start a poll for the submission type
                const fyiText: string = 'FYI gazers: it\'s time to pick a submission prompt for tomorrow! '
                    + `Reply to this message before ${toDiscordTimestamp(pollStartDate, DiscordTimestampFormat.ShortTime)} to suggest a prompt ${config.defaultGoodMorningEmoji}`;
                const fyiMessage = await sungazersChannel.send(fyiText);
                // Schedule a timeout to prime the suggestions with a random unused prompt (use delete strategy because it's not required)
                const arg: ReplyToMessageData = {
                    channelId: fyiMessage.channelId,
                    messageId: fyiMessage.id,
                    content: await chooseRandomUnusedSubmissionPrompt()
                };
                await registerTimeout(TimeoutType.ReplyToMessage, getRandomDateBetween(new Date(), pollStartDate, { maxAlong: 0.8, bates: 2 }), { arg, pastStrategy: PastTimeoutStrategy.Delete });
                // Use the delete strategy because it's not required and we want to ensure it's before the morning date
                await registerTimeout(TimeoutType.AnonymousSubmissionTypePollStart, pollStartDate, { arg: fyiMessage.id, pastStrategy: PastTimeoutStrategy.Delete });
            }
            // Alternatively, if it's the first Saturday of the month then start a high-effort submissions prompt poll
            else if (new Date().getDay() === 6 && new Date().getDate() <= 7) {
                // Accept suggestions for 5 hours
                const pollStartDate = new Date();
                pollStartDate.setHours(pollStartDate.getHours() + 5);
                // In 5 hours, fetch replies to this message and start a poll for the submission type
                const fyiText: string = 'Hello gazers, this upcoming Tuesday will be this month\'s _high-effort_ submissions contest! '
                    + `Reply to this message before ${toDiscordTimestamp(pollStartDate, DiscordTimestampFormat.ShortTime)} to suggest a prompt ${config.defaultGoodMorningEmoji}`;
                const fyiMessage = await sungazersChannel.send(fyiText);
                // Schedule timeouts to prime the suggestions with a few random unused prompts (use delete strategy because it's not required)
                const unusedPrompts = await chooseRandomUnusedSubmissionPrompts(3);
                for (const unusedPrompt of unusedPrompts) {
                    const arg: ReplyToMessageData = {
                        channelId: fyiMessage.channelId,
                        messageId: fyiMessage.id,
                        content: unusedPrompt
                    };
                    await registerTimeout(TimeoutType.ReplyToMessage, getRandomDateBetween(new Date(), pollStartDate, { maxAlong: 0.8, bates: 2 }), { arg, pastStrategy: PastTimeoutStrategy.Delete });
                }
                // Use the delete strategy because it's not required and we want to ensure it's before the morning date
                await registerTimeout(TimeoutType.AnonymousSubmissionTypePollStart, pollStartDate, { arg: fyiMessage.id, pastStrategy: PastTimeoutStrategy.Delete });
            }
        }

        // If this is happening at a non-standard time, explicitly warn players (add some tolerance in case of timeout variance)
        const clockTime: string = getClockTime();
        const standardClockTimes: Set<string> = new Set(['11:59', '12:00', '12:01']);
        if (maySendWarning && !standardClockTimes.has(clockTime)) {
            await messenger.send(goodMorningChannel, 'The "morning" technically ends now, so SHUT UP 🤫');
        }

        // If the event for tomorrow is writer's block, then send a message to the guest writer asking them to submit a GM message
        if (!state.isSeasonGoalReached() && state.getEventType() === DailyEventType.WritersBlock) {
            const writersBlockUserId = state.getEvent().user;
            if (writersBlockUserId) {
                try {
                    await messenger.dm(writersBlockUserId,
                        "Hey, I've been experiencing a little writer's block lately and can't think of a solid greeting for tomorrow. "
                        + "What do you think I should say? Send me something and I'll use it as my Good Morning greeting tomorrow as-is 🤔");
                    await logger.log(`Sent writer's block invite to **${state.getPlayerDisplayName(writersBlockUserId)}**`);
                } catch (err) {
                    await logger.log(`Unable to send writer's block invite to **${state.getPlayerDisplayName(writersBlockUserId)}**: \`${err.toString()}\``);
                }
            } else {
                await logger.log('Cannot DM the writer\'s block user, as there\'s no user ID in the event state!');
            }
        }

        // If the game is over, then proceed to the next season
        if (state.isSeasonGoalReached()) {
            const previousState: GoodMorningState = state;
            const winners = await advanceSeason();
            await sendSeasonEndMessages(goodMorningChannel, previousState);
            await updateSungazers(winners);
            // Register the next GM timeout for next Monday
            const nextSeasonStart: Date = new Date();
            nextSeasonStart.setHours(8, 0, 0, 0);
            nextSeasonStart.setDate(nextSeasonStart.getDate() + 8 - nextSeasonStart.getDay());
            await registerTimeout(TimeoutType.NextGoodMorning, nextSeasonStart, { pastStrategy: PastTimeoutStrategy.IncrementDay });
            await logger.log(`Registered next season's first GM for **${getRelativeDateTimeString(nextSeasonStart)}**`);
        }

        // Update the bot's status
        await setStatus(false);

        // Finally, log the final state for today
        await logJsonAsFile('GMBR state', state.toCompactJson());
    },
    [TimeoutType.GuestReveilleFallback]: async (): Promise<void> => {
        // Take action if the guest reveiller hasn't said GM
        if (!state.isMorning()) {
            const userId = state.getEvent().user;
            if (userId) {
                // Penalize the reveiller
                state.deductPoints(userId, 2);
                // Wake up, then send a message calling out the reveiller (don't tag them, we don't want to give them an advantage...)
                await wakeUp(false);
                await messenger.send(goodMorningChannel, `Good morning! I had to step in because I guess ${state.getPlayerDisplayName(userId)} isn't cut out for the job 😒`);
            } else {
                await logger.log('Cannot penalize guest reveille, as there\'s no user ID in the event state!');
            }
        }
    },
    [TimeoutType.PopcornFallback]: async (): Promise<void> => {
        if (state.getEventType() !== DailyEventType.Popcorn) {
            await logger.log(`WARNING! Attempted to trigger popcorn fallback with the event as \`${state.getEventType()}\``);
            return;
        }
        const event = state.getEvent();

        // Abort if it's no longer morning or if there's no current popcorn user
        if (!state.isMorning() || !event.user) {
            return;
        }

        // Clear the current turn and notify
        delete event.user;
        await dumpState();
        await messenger.send(goodMorningChannel, 'I don\'t think we\'re gonna hear back... next turn is up for grabs!');
    },
    [TimeoutType.WordleRestart]: async (arg: any): Promise<void> => {
        if (state.getEventType() !== DailyEventType.Wordle) {
            await logger.log(`WARNING! Attempted to trigger wordle restart with the event as \`${state.getEventType()}\``);
            return;
        }
        const event = state.getEvent();

        // Abort if it's no longer morning
        if (!state.isMorning()) {
            await logger.log('WARNING! Attempted to trigger wordle restart when it\'s not morning. Aborting...');
            return;
        }

        // Abort if there's already a round in progress
        if (event.wordle) {
            await logger.log('WARNING! Attempted to trigger wordle restart with Wordle round already in progress. Aborting...');
            return;
        }

        // Abort if there's no length argument to the timeout
        if (!arg) {
            await logger.log('WARNING! Attempted to trigger wordle restart with no arg. Aborting...');
            return;
        }
        const { nextPuzzleLength, blacklistedUserId } = arg as WordleRestartData;

        // Try to find some words of the correct length
        const nextPuzzleWords = await chooseMagicWords(1, { characters: nextPuzzleLength, bonusMultiplier: 8 });
        if (nextPuzzleWords.length > 0) {
            // If a word was found, restart the puzzle and notify the channel
            event.wordle = {
                solution: nextPuzzleWords[0].toUpperCase(),
                guesses: [],
                guessOwners: [],
                blacklistedUserId
            };
            await dumpState();
            await messenger.send(goodMorningChannel, `Let's solve another puzzle! If you get a better score, it will overwrite your previous score. `
                + `Someone other than **${state.getPlayerDisplayName(blacklistedUserId)}** give me a **${nextPuzzleLength}**-letter word`);
        } else {
            await logger.log(`Unable to find a **${nextPuzzleLength}**-letter word, ending Wordle for today...`);
        }
    },
    [TimeoutType.AnonymousSubmissionReveal]: async (): Promise<void> => {
        // Validate that the current event is correct
        if (state.getEventType() !== DailyEventType.AnonymousSubmissions) {
            await logger.log(`WARNING! Attempted to trigger anonymous submission reveal with the event as \`${state.getEventType()}\`, aborting...`);
            return;
        }
        // Validate that the submissions exist
        if (!state.hasAnonymousSubmissions()) {
            await logger.log('WARNING! Attempted to trigger anonymous submission reveal with no submissions data, aborting...');
            return;
        }
        const anonymousSubmissions = state.getAnonymousSubmissions();

        // Validate that the current phase is correct
        if (!anonymousSubmissions.isSubmissionsPhase()) {
            await logger.log(`WARNING! Attempted to trigger anonymous submission reveal while in the \`${anonymousSubmissions.getPhase()}\` phase, aborting...`);
            return;
        }

        // Advance the phase now to prevent voting and to ensure this process can't be triggered again
        anonymousSubmissions.setPhase('reveal');
        await dumpState();

        const userIds: Snowflake[] = anonymousSubmissions.getSubmitters();

        // If nobody sent anything at all, abort!
        if (userIds.length === 0) {
            await messenger.send(goodMorningChannel, `My inbox is empty... This day, **${toCalendarDate(new Date())}**, shall live in infamy...`);
            return;
        }

        // If only one person sent a submission, reward them greatly and abort
        if (userIds.length === 1) {
            const soleUserId: Snowflake = userIds[0];
            // Award the player double the grand contest award
            state.awardPoints(soleUserId, 2 * config.grandContestAward);
            await awardPrize(soleUserId, 'submissions1', 'Thank you for being the only participant today');
            await dumpState();
            // Notify the channel
            await messenger.send(goodMorningChannel, `My oh my! Looks like <@${soleUserId}> was the only friend to submit anything, so I have rewarded him greatly for his undying loyalty...`);
            await messenger.send(goodMorningChannel, 'As for the rest of you? Reflect upon your actions, and look to our lone participant as a shining example of brilliant friendship');
            await messenger.send(goodMorningChannel, 'Remember, for even if we are the last men on Earth seeing the sun rise over the very last morning, we still raise our Good Morning glasses in celebration...');
            return;
        }

        // Send the initial message
        const rootSubmissionMessage = await messenger.send(goodMorningChannel, `Here are your anonymous submissions! ${config.defaultGoodMorningEmoji}`);
        if (rootSubmissionMessage) {
            anonymousSubmissions.setRootSubmissionMessage(rootSubmissionMessage.id);
        }
        await dumpState();

        // Shuffle all the revelant user IDs
        shuffle(userIds);

        // For each submission (in shuffled order)...
        for (let i = 0; i < userIds.length; i++) {
            const userId: Snowflake = userIds[i];
            const submission = anonymousSubmissions.getSubmissionForUser(userId);
            const submissionCode: string = toLetterId(i);
            
            // Keep track of which user this submission's "number" maps to
            anonymousSubmissions.setSubmissionOwnerByCode(submissionCode, userId);
            await dumpState();

            // Send the message out (suppress notifications to reduce spam)
            await messenger.send(goodMorningChannel, {
                content: `**Submission ${submissionCode}:**`,
                embeds: [ toSubmissionEmbed(submission) ],
                flags: MessageFlags.SuppressNotifications
            });
            // Take a long pause
            await sleep(40000);
        }

        // Register the vote command
        const choices = anonymousSubmissions.getSubmissionCodes().map(c => { return { name: `Submission ${c}`, value: c }; });
        await guild.commands.create({
            name: 'vote',
            description: `Vote for a ${anonymousSubmissions.getPrompt().slice(0, 50)}`,
            // TODO: What do we do if there are 2-3 submissions?
            options: [
                {
                    type: ApplicationCommandOptionType.String,
                    name: 'first',
                    description: 'Your favorite submission',
                    required: true,
                    choices
                },
                {
                    type: ApplicationCommandOptionType.String,
                    name: 'second',
                    description: 'Your second favorite submission',
                    required: true,
                    choices
                },
                {
                    type: ApplicationCommandOptionType.String,
                    name: 'third',
                    description: 'Your third favorite submission',
                    required: true,
                    choices
                }
            ]
         });

        // Advance to the voting phase
        anonymousSubmissions.setPhase('voting');
        await dumpState();

        // Send voting message
        await messenger.send(goodMorningChannel,
            `Alright, that's all of them! Use the \`/vote\` command to vote for your 3 favorite submissions. `
            + `If you submitted a ${anonymousSubmissions.getPrompt()}, you _must_ vote otherwise you will be disqualified and penalized.`);
        // TODO: Enable if we can figure out why this breaks
        // TODO: Remove try-catch once we're sure this works
        // try {
        //     const selectSubmissionMessage = await goodMorningChannel.send({
        //         content: 'Alternatively, you can vote using this peculiar menu',
        //         components: [{
        //             type: ComponentType.ActionRow,
        //             components: [{
        //                 type: ComponentType.StringSelect,
        //                 customId: 'selectAnonymousSubmissions',
        //                 options: Object.keys(event.submissionOwnersByCode).map(c => {
        //                     return {
        //                         label: `Submission ${c}`,
        //                         value: c,
        //                         description: (event.submissions && event.submissionOwnersByCode)
        //                             ? event.submissions[event.submissionOwnersByCode[c]]?.text?.slice(0, 30)
        //                             : undefined
        //                     };
        //                 }),
        //                 maxValues: 3,
        //                 minValues: 3
        //             }]
        //         }]
        //     });
        //     event.selectSubmissionMessage = selectSubmissionMessage.id;
        //     await dumpState();
        // } catch (err) {
        //     await logger.log(`Failed to send select submission message: \`${err}\``);
        // }

        // Schedule voting reminders
        [[11, 10], [11, 30]].forEach(([hour, minute]) => {
            const reminderTime: Date = new Date();
            reminderTime.setHours(hour, minute);
            // We register these with the "Delete" strategy since they are terminal and aren't needed if in the past
            registerTimeout(TimeoutType.AnonymousSubmissionVotingReminder, reminderTime, { pastStrategy: PastTimeoutStrategy.Delete });
        });
    },
    [TimeoutType.AnonymousSubmissionVotingReminder]: async (): Promise<void> => {
        // Validate that the current event is correct
        if (state.getEventType() !== DailyEventType.AnonymousSubmissions) {
            await logger.log(`WARNING! Attempted to trigger anonymous submission voting reminder with the event as \`${state.getEventType()}\``);
            return;
        }
        // Validate that the submissions exist
        if (!state.hasAnonymousSubmissions()) {
            await logger.log('WARNING! Attempted to trigger anonymous submission voting reminder with no submissions data, aborting...');
            return;
        }
        const anonymousSubmissions = state.getAnonymousSubmissions();

        // Validate that the current phase is correct
        if (!anonymousSubmissions.isVotingPhase()) {
            await logger.log(`WARNING! Attempted to trigger anonymous submission voting reminder while in the \`${anonymousSubmissions.getPhase()}\` phase, aborting...`);
            return;
        }

        // Validate that the root submission message ID exists
        if (!anonymousSubmissions.hasRootSubmissionMessage()) {
            await logger.log('Aborting submission voting reminder, as there\'s no root submission message ID.');
            return;
        }

        const delinquents: Snowflake[] = anonymousSubmissions.getDeadbeats();
        if (delinquents.length === 1) {
            // Send voting reminder targeting the one remaining user
            await messenger.send(goodMorningChannel, `Ahem <@${delinquents[0]}>... Please vote.`);
        } else if (delinquents.length > 1) {
            // Send a voting notification to the channel
            try {
                const reminderText = `If you haven't already, please vote on your favorite ${anonymousSubmissions.getPrompt()} with \`/vote\`!`;
                if (anonymousSubmissions.hasRootSubmissionMessage()) {
                    const rootSubmissionMessage: Message = await goodMorningChannel.messages.fetch(anonymousSubmissions.getRootSubmissionMessage());
                    await messenger.reply(rootSubmissionMessage, reminderText);
                } else {
                    await messenger.send(goodMorningChannel, reminderText);
                }
            } catch (err) {
                logger.log(`Failed to fetch root submission message and send reminder: \`${err.toString()}\``);
            }
            // Also, DM players who still haven't voted
            if (delinquents.length > 0) {
                await logger.log(`Sending voting reminder DM to ${getBoldNames(delinquents)}...`);
                delinquents.forEach(async (userId) => {
                    try {
                        await messenger.dm(userId,
                            `You still haven\'t voted! You and your ${anonymousSubmissions.getPrompt()} will be disqualified if you don't vote by noon. You can vote with the \`/vote\` command.`);
                    } catch (err) {
                        await logger.log(`Unable to send voting reminder DM to **${state.getPlayerDisplayName(userId)}**: \`${err.toString()}\``);
                    }
                });
            }
        }
    },
    [TimeoutType.AnonymousSubmissionTypePollStart]: async (messageId: Snowflake): Promise<void> => {
        if (!messageId) {
            await logger.log('Aborting anonymous submission type poll start, as there\'s no message ID somehow...');
            return;
        }
        if (!sungazersChannel) {
            await logger.log('Aborting anonymous submission type poll start, as there\'s no sungazers channel...');
            return;
        }
        if (state.hasAnonymousSubmissions()) {
            await logger.log(`Aborting anonymous submission type poll start, as the next submission prompt is already set: \`${state.getAnonymousSubmissions().getPrompt()}\``);
            return;
        }

        // Construct the set of proposed submission types by fetching replies to the original FYI message
        let proposalSet: Set<string> = new Set();
        const messages = await sungazersChannel.messages.fetch({ after: messageId });
        for (const message of messages.toJSON()) {
            if (message.reference?.messageId === messageId) {
                proposalSet.add(message.content.trim().toLowerCase());
            }
        }

        // If there are no proposed alternatives...
        if (proposalSet.size === 0) {
            // Schedule the timeout again
            const in1Hour = new Date();
            in1Hour.setHours(in1Hour.getHours() + 2);
            await registerTimeout(TimeoutType.AnonymousSubmissionTypePollStart, in1Hour, { arg: messageId, pastStrategy: PastTimeoutStrategy.Delete });
            // Notify the channel
            await sungazersChannel.send('I don\'t see any prompt ideas, I\'ll give you one more hour to pitch some...');
            return;
        }

        // If there are too many, trim it down to 20
        const maxAlternatives: number = 20;
        if (proposalSet.size > maxAlternatives) {
            await logger.log(`Too many anonymous submission type proposals, truncating from **${proposalSet.size}** to **${maxAlternatives}**`);
            proposalSet = new Set(Array.from(proposalSet).slice(0, maxAlternatives));
        }

        // Shuffle all the prompts
        const proposedTypes: string[] = Array.from(proposalSet);
        shuffle(proposedTypes);

        // Construct the poll data
        const choiceKeys: string[] = getPollChoiceKeys(proposedTypes);
        const choices: Record<string, string> = {};
        for (let i = 0; i < proposedTypes.length; i++) {
            choices[choiceKeys[i]] = proposedTypes[i];
        }

        // Determine the poll end time (extend it longer if it's a high-effort submission poll)
        const pollEndDate = new Date();
        if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
            pollEndDate.setHours(pollEndDate.getHours() + 5);
        } else {
            pollEndDate.setHours(pollEndDate.getHours() + 8);
        }

        // Send the poll message and prime the choices
        const pollMessage = await sungazersChannel.send(`What should people submit? (poll ends ${toDiscordTimestamp(pollEndDate, DiscordTimestampFormat.ShortTime)})\n`
            + Object.entries(choices).map(([key, value]) => `${key} _${value}_`).join('\n'));
        await addReactsSync(pollMessage, choiceKeys, { delay: 500 });

        // Schedule the end of the poll
        const arg = {
            messageId: pollMessage.id,
            choices
        }
        // Use the delete strategy because it's not required and we want to ensure it's before the morning date
        await registerTimeout(TimeoutType.AnonymousSubmissionTypePollEnd, pollEndDate, { arg, pastStrategy: PastTimeoutStrategy.Delete });
    },
    [TimeoutType.AnonymousSubmissionTypePollEnd]: async (arg: { messageId: Snowflake, choices: Record<string, string> }): Promise<void> => {
        if (!arg || !arg.messageId || !arg.choices) {
            await logger.log('Aborting anonymous submission type poll end, as there\'s no timeout arg...');
            return;
        }
        if (!sungazersChannel) {
            await logger.log('Aborting anonymous submission type poll end, as there\'s no sungazers channel...');
            return;
        }
        if (state.hasAnonymousSubmissions()) {
            await logger.log(`Aborting anonymous submission type poll end, as the next submission prompt is already set: \`${state.getAnonymousSubmissions().getPrompt()}\``);
            return;
        }

        // Fetch the poll message
        const pollMessage = await sungazersChannel.messages.fetch(arg.messageId);

        // Determine the winner(s) of the poll
        // TODO: Can we refactor the poll logic to the common util library?
        let maxVotes: number = -1;
        let winningChoices: string[] = [];
        for (const key of Object.keys(arg.choices)) {
            const choice: string = arg.choices[key];
            const votes: number = pollMessage.reactions.cache.get(key)?.count ?? 0;
            if (votes > maxVotes) {
                maxVotes = votes;
                winningChoices = [choice];
            } else if (votes == maxVotes) {
                winningChoices.push(choice);
            }
        }

        // Update the next submission prompt in the state
        const chosenPrompt = randChoice(...winningChoices)
        state.setAnonymousSubmissions({
            prompt: chosenPrompt,
            phase: 'submissions',
            submissions: {},
            submissionOwnersByCode: {},
            votes: {},
            forfeiters: []
        });
        await dumpState();

        // Update the submission prompt history
        await updateSubmissionPromptHistory([chosenPrompt], Object.values(arg.choices));

        // Notify the channel
        await pollMessage.reply(`The results are in, everyone will be sending me a _${chosenPrompt}_ ${config.defaultGoodMorningEmoji}. You can start sending me submissions now!`);
    },
    [TimeoutType.Nightmare]: async (): Promise<void> => {
        if (state.getEventType() !== DailyEventType.Nightmare) {
            await logger.log('Attempting to trigger nightmare timeout without a nightmare event! Aborting...');
            return;
        }
        if (state.isMorning()) {
            await logger.log('Attempting to trigger nightmare timeout after the morning has started! Aborting...');
            return;
        }

        delete state.getEvent().disabled;
        await dumpState();

        await messenger.send(goodMorningChannel, 'Just woke up from a scary nightmare, anyone awake to cheer me up?');
    },
    [TimeoutType.HomeStretchSurprise]: async (): Promise<void> => {
        // TODO (2.0): If we enable home stretch again, fix this
        // const surprises: HomeStretchSurprise[] = state.getEvent()?.homeStretchSurprises;
        // if (surprises && surprises.length > 0) {
        //     // Get the next surprise and dump state
        //     const surprise: HomeStretchSurprise = surprises.shift();
        //     await dumpState();
        //     // Recursively schedule the next timeout
        //     const nextTimeout: Date = new Date();
        //     nextTimeout.setMinutes(nextTimeout.getMinutes() + 10);
        //     await timeoutManager.registerTimeout(TimeoutType.HomeStretchSurprise, nextTimeout, { pastStrategy: PastTimeoutStrategy.Invoke });
        //     // Act on this surprise
        //     switch (surprise) {
        //     case HomeStretchSurprise.Multipliers:
        //         const x1players: Snowflake[] = [];
        //         const x1_5players: Snowflake[] = [];
        //         const x2players: Snowflake[] = [];
        //         const orderedPlayers: Snowflake[] = state.getOrderedPlayers();
        //         // Update player multipliers and dump state
        //         orderedPlayers.forEach(userId => {
        //             // TODO (2.0): Re-enable this using some accurate form of completion?
        //             // if (state.getPlayerPoints(userId) <= 0) {
        //             //     state.setPlayerMultiplier(userId, 0.5);
        //             // } else if (state.getPlayerCompletion(userId) >= 0.8) {
        //             //     x1players.push(userId);
        //             // } else if (state.getPlayerCompletion(userId) >= 0.7) {
        //             //     x1_5players.push(userId);
        //             //     state.setPlayerMultiplier(userId, 1.5);
        //             // } else if (state.getPlayerCompletion(userId) >= 0.5) {
        //             //     x2players.push(userId);
        //             //     state.setPlayerMultiplier(userId, 2);
        //             // } else {
        //             //     state.setPlayerMultiplier(userId, 3);
        //             // }
        //         });
        //         await dumpState();
        //         // Notify the channel
        //         await messenger.send(goodMorningChannel, 'Here is a very special surprise indeed...');
        //         await messenger.send(goodMorningChannel, 'In order to help some of you catch up, I\'ll be handing out some karma multipliers');
        //         await sleep(10000);
        //         await messenger.send(goodMorningChannel, `First and foremost, ${getBoldNames(x1players)} will sadly not be getting any multiplier`);
        //         await sleep(6000);
        //         await messenger.send(goodMorningChannel, `${getBoldNames(x1_5players)} will receive 1.5x karma until the end of the season!`);
        //         await sleep(6000);
        //         await messenger.send(goodMorningChannel, `For ${getBoldNames(x2players)}, it's DOUBLE XP WEEKEND!`);
        //         await sleep(6000);
        //         await messenger.send(goodMorningChannel, `...and everyone else not mentioned will be getting 3x karma 😉`);
        //         break;
        //     case HomeStretchSurprise.LongestComboBonus:
        //         const maxCombo: Combo = state.getMaxCombo();
        //         if (maxCombo) {
        //             await messenger.send(goodMorningChannel, 'It\'s time to announce the winner of the _longest combo_ bonus! This user was first to say good morning the most days in a row...');
        //             await sleep(10000);
        //             // Award points and dump state
        //             const pointsAwarded: number = state.awardPoints(maxCombo.user, config.bonusAward);
        //             await dumpState();
        //             // Notify channel
        //             await messenger.send(goodMorningChannel, `The winner is <@${maxCombo.user}>, with a streak lasting **${maxCombo.days}** days! This bonus is worth **${pointsAwarded}%** karma ${config.defaultGoodMorningEmoji}`);
        //         }
        //         break;
        //     case HomeStretchSurprise.ComboBreakerBonus:
        //         const maxTimesBroken: number = Math.max(...Object.values(state.getPlayerStates()).map(player => player.combosBroken ?? 0));
        //         const maxBreakers: Snowflake[] = state.getOrderedPlayers().filter(userId => state.getPlayerCombosBroken(userId) === maxTimesBroken);
        //         if (maxBreakers.length > 0) {
        //             const maxBreaker: Snowflake = maxBreakers[0];
        //             await messenger.send(goodMorningChannel, 'Now to announce the winner of the _combo breaker_ bonus! This user broke the most Good Morning combos...');
        //             await sleep(10000);
        //             // Award points and dump state
        //             const pointsAwarded: number = state.awardPoints(maxBreaker, config.bonusAward);
        //             await dumpState();
        //             // Notify channel
        //             await messenger.send(goodMorningChannel, `The winner is <@${maxBreaker}>, who broke **${maxTimesBroken}** streaks! This bonus is worth **${pointsAwarded}%** karma ${config.defaultGoodMorningEmoji}`);
        //         }
        //         break;
        //     }
        // } else {
        //     await goodMorningChannel.send({
        //         content: 'Well that\'s all for now! Here are the updated standings, good luck everyone!',
        //         files: [] // TODO (2.0): Should we just delete this?
        //     });
        // }
    },
    [TimeoutType.ProcessGameDecisions]: async (): Promise<void> => {
        if (!state.hasGame()) {
            await logger.log('Tried to invoke the game decision processing loop with no game instance! Aborting...');
            return;
        }

        // Process player decisions
        const game = state.getGame();
        const processingResult = await game.processPlayerDecisions();
        await dumpState();

        // Send out the message payload for the updated game state (may contain attachments or just be text)
        await messenger.send(goodMorningChannel, processingResult.summary);
        if (processingResult.extraSummaries) {
            await messenger.sendAll(goodMorningChannel, processingResult.extraSummaries);
        }

        if (processingResult.continueProcessing) {
            // If there are more decisions to be processed, schedule the next processing timeout
            const nextProcessDate: Date = new Date();
            // Determine the time of the next game update
            if (processingResult.nextUpdateTime) {
                // If a specific time was set for the next update...
                // It's possible that this might be in the past, but that's ok (see below)
                nextProcessDate.setHours(...processingResult.nextUpdateTime);
            } else {
                // Else, schedule the next update using a random delay (shorter if it's later in the day)
                let baseDelayMinutes: number = 1;
                if (new Date().getHours() >= 11) {
                    baseDelayMinutes = randInt(1, 5);
                } else if (new Date().getHours() >= 10) {
                    baseDelayMinutes = randInt(5, 15);
                } else if (new Date().getHours() >= 9) {
                    baseDelayMinutes = randInt(10, 25);
                } else {
                    baseDelayMinutes = randInt(20, 35);
                }
                // Apply a multiplier at the granularity of seconds
                const delaySeconds = Math.floor((baseDelayMinutes * 60) * (processingResult.delayMultiplier ?? 1));
                // Now, actually apply the delay to the scheduled date
                nextProcessDate.setSeconds(nextProcessDate.getSeconds() + delaySeconds);
            }
            // Schedule the next update using this calculated date (use the "invoke" past strategy just in case the specified date is in the past)
            await registerTimeout(TimeoutType.ProcessGameDecisions, nextProcessDate, { pastStrategy: PastTimeoutStrategy.Invoke }, { testingSeconds: 3 });
        } else {
            // Trigger turn-end logic and send turn-end messages
            const turnEndMessages = await game.endTurn();
            await dumpState();
            await messenger.sendAll(goodMorningChannel, turnEndMessages);
        }
    },
    [TimeoutType.GameDecisionPhase]: async (arg): Promise<void> => {
        if (!arg || typeof arg !== 'string') {
            await logger.log(`Tried to invoke game decision with no string phase argument! Aborting...`);
            return;
        }
        if (!state.hasGame()) {
            await logger.log(`Tried to invoke game decision phase \`${arg}\` with no game instance! Aborting...`);
            return;
        }

        // Invoke game decision phase
        const responseMessages = await state.getGame().onDecisionPhase(arg);
        await dumpState();
        for (const messengerPayload of responseMessages) {
            await messenger.send(goodMorningChannel, messengerPayload);
        }
    },
    [TimeoutType.ReplyToMessage]: async (arg): Promise<void> => {
        if (arg) {
            const { channelId, messageId, content } = arg as ReplyToMessageData;
            try {
                const channel = await client.channels.fetch(channelId);
                if (channel instanceof TextChannel) {
                    // If no message ID provided, just send the message
                    if (messageId) {
                        const message = await channel.messages.fetch(messageId);
                        await messenger.reply(message, content || 'Bump!');
                    } else {
                        await messenger.send(channel, content || 'Bump!');
                    }
                } else {
                    await logger.log(`Cannot reply to message, \`${channelId}\` is not a text channel`);
                }
            } catch (err) {
                await logger.log(`Failed replying to message: \`${err}\``);
            }
        } else {
            await logger.log('Cannot reply to message, no message reply data provided');
        }
    }
};

const timeoutManager = new TimeoutManager(storage, TIMEOUT_CALLBACKS, {
    onError: async (id, type, err) => {
        await logger.log(`Timeout of type \`${type}\` with ID \`${id}\` failed: \`${err}\``);
    }
});

const cancelTimeoutsWithType = async (type: TimeoutType): Promise<void> => {
    try {
        const canceledIds = await timeoutManager.cancelTimeoutsWithType(type);
        if (canceledIds.length > 0) {
            await logger.log(`Canceled \`${type}\` timeouts \`${JSON.stringify(canceledIds)}\``);
        }
    } catch (err) {
        await logger.log(`Failed to cancel \`${type}\` timeouts: \`${err}\``);
    }
}

const processGameDecision = async (userId: Snowflake, decision: string, source: string, callback: (text: MessengerPayload) => Promise<void>) => {
    if (!state.isAcceptingGameDecisions()) {
        await callback({ content: 'You can\'t do that now, the game isn\'t accepting decisions right now!' });
        return;
    }
    if (!state.hasGame()) {
        await callback({ content: 'You can\'t do that now, the game hasn\'t started yet!' });
        return;
    }
    const game = state.getGame();
    if (!game.hasPlayer(userId)) {
        await callback({ content: 'You aren\'t in the game! Participate more if you want to play.' });
        return;
    }
    // Handle help requests
    if (decision.trim().toLowerCase() === 'help') {
        await logger.log(`<@${userId}> asked for help! (${source})`);
        await callback({ content: game.getHelpText() });
        return;
    }
    try {
        // Validate decision string
        const response = await game.addPlayerDecision(userId, decision);
        // If it succeeds, dump the state and reply with the validation response
        await dumpState();
        await callback(response);
        await logger.log(`**${state.getPlayerDisplayName(userId)}** made a valid decision! (${source})`);
    } catch (err) {
        // Validation failed, notify the user why it failed
        await callback({ content: err.toString() });
    }
    return;
};

const loadState = async (): Promise<void> => {
    try {
        state = new GoodMorningState(await storage.readJson('state'));
        // Temporary logic to initialize newly introduced properties
        // ...
    } catch (err) {
        // Specifically check for file-not-found errors to make sure we don't overwrite anything
        if (err.code === 'ENOENT') {
            await logger.log('Existing state file not found, creating a fresh state...');
            state = new GoodMorningState({
                season: 1,
                startedOn: getTodayDateString(),
                isMorning: false,
                isGracePeriod: true,
                goodMorningEmoji: config.defaultGoodMorningEmoji,
                dailyStatus: {},
                players: {}
            });
            await dumpState();
        } else {
            logger.log(`Unhandled exception while loading state file:\n\`\`\`${err.message}\`\`\``);
        }
    }
};

const dumpState = async (): Promise<void> => {
    await storage.write('state', state.toJson());
};

const loadHistory = async (): Promise<void> => {
    try {
        history = await storage.readJson('history');
        // Temporary logic to initialize newly introduced properties
        // ...
    } catch (err) {
        // Specifically check for file-not-found errors to make sure we don't overwrite anything
        if (err.code === 'ENOENT') {
            await logger.log('Existing history file not found, creating a fresh history...');
            history = {
                seasons: [],
                medals: {},
                sungazers: {}
            };
            await dumpHistory();
        } else {
            logger.log(`Unhandled exception while loading history file:\n\`\`\`${err.message}\`\`\``);
        }
    }
};

const dumpHistory = async (): Promise<void> => {
    await storage.write('history', JSON.stringify(history, null, 2));
};

const loadR9KHashes = async (): Promise<void> => {
    try {
        const existingR9KHashes: string[] = await storage.readJson('r9k.json');
        r9k.addRawHashes(existingR9KHashes);
    } catch (err) {
        // Specifically check for file-not-found errors to make sure we don't overwrite anything
        if (err.code === 'ENOENT') {
            await logger.log('Existing R9K hashes file not found, starting with a fresh text bank...');
            await dumpR9KHashes();
        } else {
            logger.log(`Unhandled exception while loading R9K hashes file:\n\`\`\`${err.message}\`\`\``);
        }
    }
}

const dumpR9KHashes = async (): Promise<void> => {
    await storage.write('r9k.json', JSON.stringify(r9k.getAllEntries(), null, 2));
};

const loadBaitR9KHashes = async (): Promise<void> => {
    try {
        const existingBaitR9KHashes: string[] = await storage.readJson('bait-r9k.json');
        baitR9K.addRawHashes(existingBaitR9KHashes);
    } catch (err) {
        // Specifically check for file-not-found errors to make sure we don't overwrite anything
        if (err.code === 'ENOENT') {
            await logger.log('Existing Bait R9K hashes file not found, starting with a fresh text bank...');
            await dumpBaitR9KHashes();
        } else {
            logger.log(`Unhandled exception while loading Bait R9K hashes file:\n\`\`\`${err.message}\`\`\``);
        }
    }
}

const dumpBaitR9KHashes = async (): Promise<void> => {
    await storage.write('bait-r9k.json', JSON.stringify(baitR9K.getAllEntries(), null, 2));
};

const loadYouTubeIds = async (): Promise<void> => {
    try {
        const existingYouTubeIds: string[] = await storage.readJson('youtube.json');
        for (const ytid of existingYouTubeIds) {
            knownYouTubeIds.add(ytid);
        }
    } catch (err) {
        // Specifically check for file-not-found errors to make sure we don't overwrite anything
        if (err.code === 'ENOENT') {
            await logger.log('Existing YouTube IDs file not found, starting with a fresh set...');
            await dumpYouTubeIds();
        } else {
            logger.log(`Unhandled exception while loading YouTube IDs file:\n\`\`\`${err.message}\`\`\``);
        }
    }
}

const dumpYouTubeIds = async (): Promise<void> => {
    await storage.write('youtube.json', JSON.stringify(Array.from(knownYouTubeIds).sort(), null, 2));
};

const logTimeouts = async (): Promise<void> => {
    await guildOwnerDmChannel.send(timeoutManager.toStrings().map(entry => `- ${entry}`).join('\n') || '_No timeouts._');
};

client.on('ready', async (): Promise<void> => {
    // First, validate the config file to ensure it conforms to the schema
    validateConfig(config);

    // Then, fetch the guilds and guild channels
    await client.guilds.fetch();
    // TODO: Can this be safer?
    guild = client.guilds.cache.first() as Guild;
    await guild.channels.fetch();

    // Determine the guild owner and the guild owner's DM channel
    guildOwner = await guild.fetchOwner();
    if (guildOwner) {
        guildOwnerDmChannel = await guildOwner.createDM();
        logger.setChannel(guildOwnerDmChannel);
    } else {
        await logger.log('Could not determine the guild\'s owner!');
    }

    // Attempt to load the good morning channel (abort if not successful)
    try {
        goodMorningChannel = (await client.channels.fetch(config.goodMorningChannelId)) as TextChannel;
    } catch (err) {}
    if (!goodMorningChannel) {
        await logger.log(`Couldn't load good morning channel with ID \`${config.goodMorningChannelId}\`, aborting...`);
        process.exit(1);
    }

    // Attempt to load the sungazers channel (abort if not successful)
    try {
        sungazersChannel = (await client.channels.fetch(config.sungazers.channel)) as TextChannel;
    } catch (err) {}
    if (!sungazersChannel) {
        await logger.log(`Couldn't load sungazers channel with ID \`${config.sungazers.channel}\`, aborting...`);
        process.exit(1);
    }

    // Attempt to load the testing channel
    try {
        testingChannel = (await client.channels.fetch(config.testingChannelId)) as TextChannel;
    } catch (err) {}
    if (!testingChannel) {
        await logger.log(`Couldn't load testing channel with ID \`${config.testingChannelId}\`, aborting...`);
        process.exit(1);
    }

    // Load all necessary data from disk
    await loadState();
    await loadHistory();
    await loadR9KHashes();
    await loadBaitR9KHashes();
    await loadYouTubeIds();
    await timeoutManager.loadTimeouts();

    if (guildOwner && goodMorningChannel) {
        await logger.log(`Bot rebooting at **${getClockTime()}** with guild owner **${guildOwner.displayName}** and GM channel ${goodMorningChannel.toString()}`);
        dailyVolatileLog.push([new Date(), 'Bot rebooting...']);
    }
    await logTimeouts();

    // Attempt to refresh state member info
    await refreshStateMemberInfo();

    // Set the user manager for the image loader
    imageLoader.setUserManager(client.users);

    // Update the bot's status
    await setStatus(state.isMorning());

    await dumpState();

    // If we're testing locally, delete all existing timeouts and jump straight to the morning of the decision
    if (config.testing) {
        // First, create a new state altogether
        state = new GoodMorningState(await storage.readJson('test-state.json'));
        if (state.hasGame()) {
            state.getGame().addNPCs();
        }
        await dumpState();
        // Jump straight to the morning of the decision
        state.setNextEvent({
            type: DailyEventType.GameDecision
        });
        state.dequeueNextEvent();
        state.setMorning(false);
        // TODO: Can we somehow delete all scheduled events? May need to add a new library method
        await timeoutManager.cancelTimeoutsWithType(TimeoutType.NextPreNoon);
        await timeoutManager.cancelTimeoutsWithType(TimeoutType.NextNoon);
        await timeoutManager.cancelTimeoutsWithType(TimeoutType.NextGoodMorning);
        await timeoutManager.cancelTimeoutsWithType(TimeoutType.GameDecisionPhase);
        await timeoutManager.cancelTimeoutsWithType(TimeoutType.ProcessGameDecisions);
        await wakeUp(true);
    }
});

client.on('guildMemberRemove', async (member): Promise<void> => {
    // Remove this user from the state
    state.removePlayer(member.id);
    await dumpState();
    await logger.log(`**${member.displayName}** left the guild, removed from state`);
});

client.on('shardError', async (error, shardId) => {
    await logger.log(`Shard Error: \`${shardId}\`, error: \`${error}\``);
});

client.on('shardDisconnect', async (closeEvent, shardId) => {
    await logger.log(`Shard Disconnect: \`${shardId}\` (code **${closeEvent.code}**)`);
});

client.on('shardReconnecting', async (shardId) => {
    // TODO: Re-enable? Do we have any idea why it's failing to reconnect?
    // await logger.log(`Shard Reconnecting: \`${shardId}\``);
});

client.on('shardResume', async (shardId, replayedEvents) => {
    // TODO: Re-enable? Do we have any idea why it's failing to reconnect?
    // await logger.log(`Shard Resume: \`${shardId}\` (**${replayedEvents}** replayed events)`);
});

client.on('shardReady', async (shardId, unavailableGuilds) => {
    await logger.log(`Shard Ready: \`${shardId}\` (**${unavailableGuilds?.size ?? 'N/A'}** unavailable guilds), restarting bot...`);
    // This event typically results in the bot becoming unreachable/disconnected for some reason, so just reboot (but not on reboot)
    if (guildOwnerDmChannel && goodMorningChannel) {
        await logger.log('Shard Ready after bot is already ready, exiting...');
        process.exit(0);
    }
});

client.on('guildUnavailable', async (guild) => {
    await logger.log('Guild unavailable!');
});

client.on('error', async (error) => {
    await logger.log(`Discord Error Event: \`${error}\``);
});

client.on('warn', async (message) => {
    await logger.log(`Discord Warn Event: \`${message}\``);
});

client.on('invalidated', async () => {
    await logger.log('Client session invalidated!');
});

client.on('interactionCreate', async (interaction): Promise<void> => {
    // If this isn't from this application, abort!
    if (interaction.applicationId !== client.application?.id) {
        return;
    }
    // TODO: Allow this to be used in testing mode
    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
        const customIdSegments = interaction.customId.split(':');
        const rootCustomId = customIdSegments[0];
        // TODO: Temp logic to simulate jumping forward to timeouts
        if (rootCustomId === 'invokeTimeout') {
            await interaction.reply({
                ephemeral: true,
                content: 'Invoking...'
            });
            await interaction.message?.delete();
            let timeoutArg = undefined;
            if (customIdSegments[2]) {
                timeoutArg = JSON.parse(decodeURIComponent(customIdSegments[2]));
            }
            await timeoutManager.registerTimeout(customIdSegments[1] as TimeoutType, new Date(), { arg: timeoutArg, pastStrategy: PastTimeoutStrategy.Invoke });
            return;
        }
        // First, if this is a game decision interaction, pass the handling off to the game instance
        if (rootCustomId === 'decision') {
            const decisionName = customIdSegments[1];
            let decisionText = decisionName;
            // If this decision was from a user select menu, append the user ID as a decision argument
            if (interaction.isUserSelectMenu()) {
                const targetUserId = interaction.values[0];
                // Validate that the selected user is even in the game
                if (state.hasGame() && !state.getGame().hasPlayer(targetUserId)) {
                    await interaction.reply({
                        ephemeral: true,
                        content: `<@${targetUserId}> isn't in the game! Choose someone else.`
                    });
                    return;
                }
                // Add the user's ID to the constructed decision text
                decisionText += ' ' + targetUserId;
            }
            // If this decision was from a string select menu, append the first string as a decision argument
            if (interaction.isStringSelectMenu()) {
                // TODO: Can this somehow support multiple values?
                decisionText += ' ' + interaction.values[0];
            }
            // If this decision was from a modal submit, append the text value as a decision argument
            if (interaction.isModalSubmit()) {
                decisionText += ' ' + interaction.fields.getTextInputValue('value').trim();
            }
            await processGameDecision(interaction.user.id, decisionText, 'UI', async (response: MessengerPayload) => {
                if (typeof response === 'string') {
                    await interaction.reply({
                        content: response,
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        ...(response as BaseMessageOptions),
                        ephemeral: true
                    });
                }
            });
            return;
        }
        // If this is meant to spawn a decision user select input
        if (rootCustomId === 'spawnDecisionUserSelect') {
            const decisionName = customIdSegments[1];
            await interaction.reply({
                ephemeral: true,
                components: [{
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.UserSelect,
                        customId: 'decision:' + decisionName,
                        placeholder: 'Select a user...'
                    }]
                }]
            });
            return;
        }
        // If this is meant to spawn a decision modal text input
        if (rootCustomId === 'spawnDecisionModal' && interaction.isMessageComponent()) {
            const decisionName = customIdSegments[1];
            await interaction.showModal({
                customId: 'decision:' + decisionName,
                title: 'Enter Game Decision',
                components: [{
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.TextInput,
                        customId: 'value',
                        label: decisionName,
                        style: TextInputStyle.Short,
                        required: false
                    }]
                }]
            });
            return;
        }
        // If this is a generic game interaction, pass the handling off to the game instance
        if (rootCustomId === 'game') {
            if (state.hasGame()) {
                // Handle the game interaction in the game state
                try {
                    const messengerPayloads = await state.getGame().handleGameInteraction(interaction);
                    // If any payloads were returned, send them to the channel
                    if (messengerPayloads) {
                        await messenger.sendAll(goodMorningChannel, messengerPayloads);
                    }
                } catch (err) {
                    await interaction.reply({
                        ephemeral: true,
                        content: err.toString()
                    });
                }
                await dumpState();
                // If not replied to, send an error reply
                if (!interaction.replied) {
                    await interaction.reply({
                        ephemeral: true,
                        content: 'This action could not be processed right now (see admin)'
                    });
                }
            } else {
                await interaction.reply({
                    ephemeral: true,
                    content: 'Game hasn\'t started yet, see admin...'
                });
            }
            return;
        }
    }
    // Handle anonymous submission forfeiting
    if (interaction.isButton()) {
        if (interaction.customId === 'forfeit') {
            await interaction.reply({
                ephemeral: true,
                content: 'Are you sure you want to forfeit?',
                components: [{
                    type: ComponentType.ActionRow,
                    components: [{
                        type: ComponentType.Button,
                        style: ButtonStyle.Danger,
                        customId: 'forfeitConfirm',
                        label: 'Yes, Forfeit'
                    }]
                }]
            });
            return;
        } else if (interaction.customId === 'forfeitConfirm') {
            const userId: Snowflake = interaction.user.id;
            await interaction.deferReply({ ephemeral: true });
            if (state.hasAnonymousSubmissions()) {
                const anonymousSubmissions = state.getAnonymousSubmissions();
                // If voting has started, notify and abort
                if (anonymousSubmissions.getPhase() !== 'submissions') {
                    await interaction.editReply('You can\'t forfeit now, it\'s too late! Now please vote.');
                    return;
                }
                // If they haven't submitted anything, notify and abort
                if (!anonymousSubmissions.isSubmitter(userId)) {
                    await interaction.editReply('Why are you trying to forfeit? You haven\'t even submitted anything!');
                    return;
                }
                // Add the player to the forefeiters list if they're not already on it
                if (anonymousSubmissions.hasUserForfeited(userId)) {
                    await interaction.editReply(languageGenerator.generate('{!Uhhh|Erm|Um}... you\'ve already forfeited, {!bonehead|blockhead|silly}.'));
                } else {
                    anonymousSubmissions.addForfeiter(userId);
                    await interaction.editReply('You have forfeited today\'s contest. This cannot be undone. You will still be able to vote, though.');
                    await logger.log(`**${state.getPlayerDisplayName(userId)}** has forfeited!`);
                }
                await dumpState();
            } else {
                await interaction.editReply('You can\'t forfeit right now!');
            }
            return;
        }
    }
    // Else, handle as voting
    if (interaction.isStringSelectMenu()) {
        const userId: Snowflake = interaction.user.id;
        await interaction.deferReply({ ephemeral: true });
        if (interaction.customId === 'selectAnonymousSubmissions') {
            await processSubmissionVote(userId, interaction.values, 'menu', async (text: string) => {
                await interaction.editReply(text);
            });
        }
    } else if (interaction.isChatInputCommand()) {
        const userId: Snowflake = interaction.user.id;
        await interaction.deferReply({ ephemeral: true });
        if (interaction.commandName === 'vote') {
            // TODO: What do we do if there are 2-3 submissions?
            const submissionCodes: string[] = [
                interaction.options.getString('first', true),
                interaction.options.getString('second', true),
                interaction.options.getString('third', true)
            ];
            await processSubmissionVote(userId, submissionCodes, 'command', async (text: string) => {
                await interaction.editReply(text);
            });
        } else {
            await interaction.editReply(`Unknown command: \`${interaction.commandName}\``);
        }
    }
});

client.on('typingStart', async (typing) => {
    if (goodMorningChannel && typing.channel.id === goodMorningChannel.id && !typing.user.bot) {
        // If it's the morning...
        if (state.isMorning()) {
            // Handle typing for the popcorn event
            if (state.getEventType() === DailyEventType.Popcorn) {
                const event = state.getEvent();
                const userId = typing.user.id;
                if (event.user && event.user === userId) {
                    // It's currently this user's turn, so postpone the fallback.
                    // Determine the postponed fallback time
                    const inFiveMinutes = new Date();
                    inFiveMinutes.setMinutes(inFiveMinutes.getMinutes() + 5);
                    // Determine the existing fallback time
                    const existingFallbackTime = timeoutManager.getDateForTimeoutWithType(TimeoutType.PopcornFallback);
                    if (!existingFallbackTime) {
                        await logger.log('Cannot postpone the popcorn fallback, as no existing fallback date was found!');
                        return;
                    }
                    // Only postpone if the existing fallback is sooner than 1m from now (otherwise, it would be moved up constantly with lots of spam)
                    if (existingFallbackTime.getTime() - new Date().getTime() < 1000 * 60) {
                        const ids = await timeoutManager.postponeTimeoutsWithType(TimeoutType.PopcornFallback, inFiveMinutes);
                        // TODO: Temp logging to see how this is working
                        await logger.log(`**${state.getPlayerDisplayName(userId)}** started typing, postpone fallback ` + naturalJoin(ids.map(id => `**${id}** to **${timeoutManager.getDateForTimeoutWithId(id)?.toLocaleTimeString()}**`)));
                    }
                } else if (!event.disabled && !event.user) {
                    // It's not this user's turn, but it's up for grabs so let them have it!
                    event.user = userId;
                    await dumpState();
                    await messenger.send(goodMorningChannel, languageGenerator.generate('{popcorn.typing?}', { player: `<@${userId}>` }));
                    // Wipe the typing users map
                    typingUsers.clear();
                    // Register a fallback for this user's turn
                    await registerPopcornFallbackTimeout(userId);
                } else {
                    // In all other cases, add the user to this turn's set of typing users
                    typingUsers.add(userId);
                }
            }
        }
    }
});

// TODO: Temp wordle game data
let tempWordle: Wordle | null = null;

let tempDungeon: AbstractGame<GameState> | null = null;
let awaitingGameCommands = false;
let awaitingSubmission = false;

const processCommands = async (msg: Message): Promise<void> => {
    // First thing's first: force timeout commands
    const forceTimeoutPattern = /^\+?FORCE_TIMEOUT\(([A-Z_]+)\)/;
    const forceTimeoutMatch = msg.content.match(forceTimeoutPattern);
    if (forceTimeoutMatch) {
        const timeoutName = forceTimeoutMatch[1];
        if (timeoutName && timeoutName in TIMEOUT_CALLBACKS) {
            await msg.reply(`Invoking timeout \`${timeoutName}\`...`);
            await TIMEOUT_CALLBACKS[timeoutName]();
        } else {
            await msg.reply(`Invalid timeout name \`${timeoutName || 'N/A'}\``);
        }
        return;
    }
    if (awaitingSubmission) {
        try {
            const submission = toSubmission(msg);
            await msg.channel.send({
                content: `\`${JSON.stringify(submission)}\``,
                embeds: [ toSubmissionEmbed(submission) ]
            });
        } catch (err) {
            await msg.reply((err as Error).message);
        }
        awaitingSubmission = false;
        return;
    }
    if (tempWordle) {
        // Emergency abort
        if (msg.content.replace(/^\+/, '').toLowerCase() === 'exit') {
            tempWordle = null;
            await msg.reply('Exiting temp wordle mode...');
            return;
        }
        const guess = msg.content.trim().toUpperCase();
        if (guess.length !== tempWordle.solution.length) {
            await msg.reply('Incorrect length!');
            return;
        }
        // Get progress of this guess in relation to the current state of the puzzle
        const progress = getProgressOfGuess(tempWordle, guess);
        // Add this guess
        tempWordle.guesses.push(guess);
        tempWordle.guessOwners.push(msg.author.id);
        // If this guess is correct, end the game
        if (tempWordle.solution === guess) {
            await msg.reply({
                content: 'Correct!',
                files: [new AttachmentBuilder(await renderWordleState(tempWordle, {
                    hiScores: { [msg.author.id]: 1 }
                })).setName('wordle.png')]
            });
            // Restart the game
            const newPuzzleLength = tempWordle.solution.length + 1;
            const words = await chooseMagicWords(1, { characters: newPuzzleLength });
            if (words.length > 0) {
                const word = words[0].toUpperCase();
                tempWordle = {
                    solution: word,
                    guesses: [],
                    guessOwners: []
                };
            } else {
                await msg.channel.send(`Couldn't find a word of length **${newPuzzleLength}**, aborting...`);
                tempWordle = null;
            }
            return;
        }
        // Otherwise, reply with updated state
        await msg.reply({
            content: `Guess ${tempWordle.guesses.length}, you revealed ${progress || 'no'} new letter(s)!`,
            files: [
                new AttachmentBuilder(await renderWordleState(tempWordle)).setName('wordle.png')
            ]
        });
        await msg.channel.send({
            content: 'With avatars',
            files: [
                new AttachmentBuilder(await renderWordleState(tempWordle, {
                    hiScores: { [msg.author.id]: 1 }
                })).setName('wordle-avatars.png')
            ]
        });
        return;
    }
    if (awaitingGameCommands) {
        // Emergency abort temp dungeon
        if (msg.content.replace(/^\+/, '').toLowerCase() === 'exit') {
            tempDungeon = null;
            awaitingGameCommands = false;
            await msg.reply('Exiting temp game mode...');
            return;
        }
        if (tempDungeon) {
            const skipRenderingActions = msg.content.endsWith('!');
            if (msg.content.toLowerCase().includes('auto')) {
                await msg.reply('Using auto-actions...');
            } else {
                try {
                    const response = await tempDungeon.addPlayerDecision(msg.author.id, msg.content.replace(/^\+/, '').replace(/!$/, ''));
                    try { // TODO: refactor typing event to somewhere else?
                        await msg.channel.sendTyping();
                    } catch (err) {}
                    // const randomOrdering: Snowflake[] = tempDungeon.getDecisionShuffledPlayers();
                    await msg.reply(response);
                    await sleep(5000);
                } catch (err) {
                    await msg.reply(err.toString());
                    return;
                }
            }

            // Process decisions and sending updated state
            while (true) {
                const processingData = await tempDungeon.processPlayerDecisions();
                if (!skipRenderingActions) {
                    try { // TODO: refactor typing event to somewhere else?
                        await msg.channel.sendTyping();
                    } catch (err) {}
                    // TODO: This may result in messages with too much text, can we truncate that somehow?
                    await msg.channel.send(processingData.summary);
                    if (processingData.extraSummaries) {
                        await messenger.sendAll(goodMorningChannel, processingData.extraSummaries);
                    }
                    await sleep(2500);
                }
                if (!processingData.continueProcessing) {
                    break;
                }
            }
            const endTurnMessages = await tempDungeon.endTurn();
            for (const messengerPayload of endTurnMessages) {
                await msg.channel.send(messengerPayload);
            }

            // Notify and exit if the game is over
            if (tempDungeon.isSeasonComplete()) {
                await msg.channel.send(`The winners are: ${getJoinedMentions(tempDungeon.getWinners())} (GAME OVER)`);
                tempDungeon = null;
                awaitingGameCommands = false;
                await msg.reply('Exiting temp dungeon mode...');
                return;
            }

            // Give everyone points then show the final state
            // TODO: Temp logic to move all other players
            for (const otherId of tempDungeon.getOrderedPlayers()) {
                if (chance(0.1) && otherId !== msg.author.id) {
                    tempDungeon.addPoints(otherId, -5);
                } else {
                    tempDungeon.addPoints(otherId, Math.random() * state.getPlayerDisplayName(otherId).length);
                }
            }
            // Maybe pick a random player to award the grand contest prize to
            if (chance(0.9)) {
                const randomPlayer = randChoice(...tempDungeon.getPlayers());
                tempDungeon.awardPrize(randomPlayer, 'submissions1', 'TEMP');
            }
            const beginTurnMessages = await tempDungeon.beginTurn();
            for (const text of beginTurnMessages) {
                await msg.channel.send(text);
            }
            try { // TODO: refactor typing event to somewhere else?
                await msg.channel.sendTyping();
            } catch (err) {}
            const attachment = new AttachmentBuilder(await tempDungeon.renderState({ admin: true })).setName('dungeon.png');
            await msg.channel.send({ content: tempDungeon.getInstructionsText(), files: [attachment], components: tempDungeon.getDecisionActionRow() });

        } else {
            await msg.reply('The game has not been created yet!');
        }
        return;
    }
    // Test out hashing of raw text input
    if (msg.content.startsWith('#')) {
        const exists = r9k.contains(msg.content);
        r9k.add(msg.content);
        messenger.reply(msg, `\`${msg.content}\` ${exists ? 'exists' : 'does *not* exist'} in the R9K text bank.`);
        return;
    }
    // Test out language generation
    if (msg.content.startsWith('$')) {
        if (chance(.5)) {
            messenger.reply(msg, languageGenerator.generate(msg.content.substring(1), { player: `<@${msg.author.id}>` }));
        } else {
            messenger.send(msg.channel, languageGenerator.generate(msg.content.substring(1), { player: `<@${msg.author.id}>` }));
        }
        return;
    }
    // Handle sanitized commands
    const sanitizedText: string = msg.content.trim().toLowerCase();
    if (hasVideo(msg)) {
        await msg.react('🎥');
    }
    // Check for mentions
    const mentions: Snowflake[] = getMessageMentions(msg);
    if (mentions.length > 0) {
        await msg.reply('Mentions: ' + getJoinedMentions(mentions));
    }
    if (sanitizedText.includes('?')) {
        // Test the experimental clusters logic
        if (sanitizedText.includes('clusters')) {
            // msg.reply(JSON.stringify(generateKMeansClusters(state.points, 3)));
            const k: number = parseInt(sanitizedText.split(' ')[0]);
            msg.reply(JSON.stringify(generateKMeansClusters(state.toPointsMap(), k)));
        }
        // Return the order info
        else if (sanitizedText.includes('order') || sanitizedText.includes('rank') || sanitizedText.includes('winning') || sanitizedText.includes('standings')) {
            const fullStreakPlayers = state.getFullActivityStreakPlayers();
            const potentialReveillers = state.getPotentialReveillers();
            const potentialMagicWordRecipients = state.getPotentialMagicWordRecipients();
            msg.reply(state.getOrderedPlayers()
                .map((key) => {
                    const gamePoints = (state.hasGame() && state.getGame().hasPlayer(key)) ? state.getGame().getPoints(key) : '???';
                    return `- <@${key}>: **${gamePoints}/${state.getPlayerPoints(key)}**`
                        + (state.isPlayerInGame(key) ? '' : ' _(NEW)_')
                        + (state.getPlayerDaysSinceLGM(key) ? ` ${state.getPlayerDaysSinceLGM(key)}d` : '')
                        + (state.getPlayerDeductions(key) ? (' -' + state.getPlayerDeductions(key)) : '')
                        + (state.isLastSubmissionWinner(key) ? '👑' : '')
                        + (state.doesPlayerNeedHandicap(key) ? '♿' : '')
                        + (state.doesPlayerNeedNerf(key) ? '🎾' : '')
                        + (fullStreakPlayers.includes(key) ? '🔥' : '')
                        + (potentialReveillers.includes(key) ? '📯' : '')
                        + (potentialMagicWordRecipients.includes(key) ? '✨' : '');
                })
                .join('\n') || 'None.');
        }
        // Return the daily status info
        else if (sanitizedText.includes('daily')) {
            msg.reply(state.getOrderedDailyPlayers()
                .map((key) => {
                    return `- **${getRankString(state.getDailyRank(key) ?? 0)}** <@${key}>: **${state.getPlayerActivity(key).getRating()}** ar`
                        + (state.getPointsEarnedToday(key) ? `, **${state.getPointsEarnedToday(key)}** earned` : '')
                        + (state.getPointsLostToday(key) ? `, **${state.getPointsLostToday(key)}** lost` : '')
                        + (state.isPlayerInGame(key) ? '' : ' _(NEW)_');
                })
                .join('\n') || 'None.');
        }
        // Return the state
        else if (sanitizedText.includes('state')) {
            // Collapse all primitive lists into one line
            await messenger.sendLargeMonospaced(msg.channel, state.toSpecialJson());
        }
        // Log the state backup
        else if (sanitizedText.includes('backup')) {
            await logJsonAsFile('GMBR state', state.toCompactJson());
        }
        // Return the timeout info
        else if (sanitizedText.includes('timeouts')) {
            await logTimeouts();
        }
        // Schedule the next good morning
        else if (sanitizedText.includes('schedule')) {
            if (timeoutManager.hasTimeoutWithType(TimeoutType.NextGoodMorning)) {
                msg.reply('Good morning timeout has already been scheduled, no action taken.');
            } else {
                await registerGoodMorningTimeout();
                msg.reply('Scheduled good morning timeout!');
            }
        }
        // Asking about points
        else if (sanitizedText.includes('points')) {
            const points: number = state.getPlayerPoints(msg.author.id);
            if (points < 0) {
                messenger.reply(msg, `You have **${points}** points this season... bro...`);
            } else if (points === 0) {
                messenger.reply(msg, `You have no points this season`);
            } else if (points === 1) {
                messenger.reply(msg, `You have **1** point this season`);
            } else {
                messenger.reply(msg, `You have **${points}** points this season`);
            }
        }
        // Asking about the season
        else if (sanitizedText.includes('season')) {
            await messenger.reply(msg, `It\'s season **${state.getSeasonNumber()}** and we're **${toFixed(state.getSeasonCompletion() * 100)}%** complete!`);
        }
        // Test reaction
        else if (sanitizedText.includes('react')) {
            await reactToMessage(msg, ['🌚', '❤️', '☘️', '🌞']);
        }
        // Test the beckoning message
        else if (sanitizedText.includes('beckon')) {
            messenger.send(msg.channel, languageGenerator.generate('{beckoning.goodMorning?}', { player: `<@${state.getCurrentLeader()}>` }));
        }
        // Simulate events for the next 2 weeks
        else if (sanitizedText.includes('event')) {
            let message: string = 'Sample events:';
            for (let i = 1; i < 22; i++) {
                // Choose event for i days in the future
                let eventTime: Date = new Date();
                eventTime.setDate(eventTime.getDate() + i);
                const event: DailyEvent | undefined = await chooseEvent(eventTime);
                // Choose time for this event (have to reset days, annoying)
                eventTime = chooseGoodMorningTime(event?.type);
                eventTime.setDate(eventTime.getDate() + i);
                // "None" if there's no event, the event type if there are no params, and the entire JSON object with IDs resolved if it has params
                const eventString = event ? (Object.keys(event).length === 1 ? event.type : replaceUserIdsInText(JSON.stringify(event))) : 'None';
                message += `\n${getRelativeDateTimeString(eventTime)}: ${eventString}`;
            }
            await messenger.sendLargeMonospaced(msg.channel, message);
        }
        // Test the percentile querying logic
        else if (sanitizedText.includes('percentile')) {
            const from: number = parseFloat(sanitizedText.split(' ')[1] ?? '0');
            const to: number = parseFloat(sanitizedText.split(' ')[2] ?? '1');
            await msg.reply(`Querying ordered players from P \`${from}\` to \`${to}\`:\n`
                + state.queryOrderedPlayers({ abovePercentile: from, belowPercentile: to }).map((userId, i) => `**${i}. ${state.getPlayerDisplayName(userId)}**`).join('\n'));
        }
        // Choose a magic word and show potential recipients
        else if (sanitizedText.includes('magic word')) {
            const magicWords = await chooseMagicWords(randInt(2, 5), { bonusMultiplier: 10 });
            const potentialRecipients: Snowflake[] = state.getPotentialMagicWordRecipients();
            const recipient: string = potentialRecipients.length > 0 ? state.getPlayerDisplayName(randChoice(...potentialRecipients)) : 'N/A';
            await msg.reply(`The test magic words are ${naturalJoin(magicWords, { bold: true })}, and send the hint to **${recipient}** (Out of **${potentialRecipients.length}** choices)`);
        }
        // Activity counter simulation/testing
        else if (sanitizedText.includes('activity')) {
            await msg.reply(state.getActivityOrderedPlayers()
                .map(userId => `${state.getPlayerActivity(userId).toString()} <@${userId}>`)
                .join('\n') || 'No players.');
        }
        // Refresh all display names
        else if (sanitizedText.includes('display names')) {
            try { // TODO: refactor typing event to somewhere else?
                await msg.channel.sendTyping();
            } catch (err) {}
            for (const userId of state.getPlayers()) {
                const displayName: string = await getDisplayName(userId);
                state.setPlayerDisplayName(userId, displayName);
            }
            await dumpState();
            await msg.reply('Refreshed all player display names!');
        }
        // Test YouTube ID extraction
        else if (sanitizedText.includes('youtube')) {
            const extractedYouTubeId: string | undefined = extractYouTubeId(msg.content);
            if (extractedYouTubeId) {
                if (knownYouTubeIds.has(extractedYouTubeId)) {
                    await msg.reply(`\`${extractedYouTubeId}\` is a **KNOWN** YouTube ID! (**${knownYouTubeIds.size}**)`);
                } else {
                    knownYouTubeIds.add(extractedYouTubeId);
                    await dumpYouTubeIds();
                    await msg.reply(`\`${extractedYouTubeId}\` is _not_ a known YouTube ID, added! (**${knownYouTubeIds.size}**)`);
                }
            } else {
                await msg.reply(`Could not extract YouTube ID! (**${knownYouTubeIds.size}**)`);
            }
        }
        else if (sanitizedText.includes('log')) {
            await msg.channel.send(dailyVolatileLog.map(entry => `**[${entry[0].toLocaleTimeString('en-US')}]:** ${entry[1]}`).join('\n') || 'Log is empty.');
        }
        else if (sanitizedText.includes('game')) {
            if (state.hasGame()) {
                try { // TODO: refactor typing event to somewhere else?
                    await msg.channel.sendTyping();
                } catch (err) {}
                await msg.channel.send({ content: state.getGame().getDebugText() || 'No Debug Text.', files: [
                    new AttachmentBuilder(await state.getGame().renderState({ admin: true })).setName('game-test-admin.png')
                ]});
            } else {
                await msg.reply('The game hasn\'t been created yet!');
            }
        } else if (sanitizedText.includes('temp')) {
            await msg.reply('Populating members...');
            const members = shuffle((await guild.members.list({ limit: 75 })).toJSON()).slice(0, randInt(10, 20));
            // Sort by display name just so it's easy to figure out what the ordering is supposed to be
            members.sort((x, y) => x.displayName.localeCompare(y.displayName));
            // Add self if not already in the fetched members list
            if (members.every(m => m.id !== msg.author.id)) {
                members.push(await guild.members.fetch(msg.author.id));
            }
            const useBetaFeatures = sanitizedText.includes('beta');
            await msg.reply(`Generating new game with **${members.length}** player(s)...` + (useBetaFeatures ? ' (with beta features enabled)' : ''));
            awaitingGameCommands = true;
            if (sanitizedText.includes('maze')) {
                tempDungeon = MazeGame.create(members, 99);
                (tempDungeon as MazeGame).addPlayerItem(msg.author.id, 'trap', 5);
                (tempDungeon as MazeGame).addPlayerItem(msg.author.id, 'boulder', 3);
                (tempDungeon as MazeGame).addPlayerItem(msg.author.id, 'seal', 3);
                (tempDungeon as MazeGame).addPlayerItem(msg.author.id, 'key', 2);
                (tempDungeon as MazeGame).addPlayerItem(msg.author.id, 'star', 1);
                (tempDungeon as MazeGame).addPlayerItem(msg.author.id, 'charge', 5);
                if (useBetaFeatures) {
                    (tempDungeon as MazeGame).setUsingBetaFeatures(true);
                }
            } else if (sanitizedText.includes('island')) {
                tempDungeon = IslandGame.create(members, 99);
            } else if (sanitizedText.includes('halloween')) {
                tempDungeon = ClassicGame.create(members, 99, true);
            } else if (sanitizedText.includes('masterpiece')) {
                tempDungeon = MasterpieceGame.create(members, 99);
            } else {
                tempDungeon = ClassicGame.create(members, 99);
            }
            // Enable the testing flag
            tempDungeon.setTesting(true);
            tempDungeon.addPoints(msg.author.id, 10);
            tempDungeon.beginTurn();
            // Show the introduction messages for this newly generated game
            const introductionMessages = await tempDungeon.getIntroductionMessages();
            for (const messagePayload of introductionMessages) {
                await msg.channel.send(messagePayload);
            }
        } else if (sanitizedText.includes('submission')) {
            awaitingSubmission = true;
            await msg.reply('Awaiting submission...');
        } else if (sanitizedText.includes('offer')) {
            if (state.hasGame() && state.getGame() instanceof MazeGame) {
                const dungeon = state.getGame() as MazeGame;
                const prizeTexts = dungeon.awardPrize(msg.author.id, 'submissions1', 'Testing the claim functionality');
                await dumpState();
                for (const prizeText of prizeTexts) {
                    await msg.channel.send(prizeText);
                }
            }
        } else if (sanitizedText.includes('items')) {
            if (state.hasGame() && state.getGame() instanceof MazeGame) {
                const dungeon = state.getGame() as MazeGame;
                await msg.reply(dungeon.getOrderedPlayers().filter(p => dungeon.playerHasAnyItem(p)).map(p => `**${dungeon.getDisplayName(p)}:** \`${JSON.stringify(dungeon.getPlayerItems(p))}\``).join('\n'));
            }
        } else if (sanitizedText.includes('remove')) {
            const id = sanitizedText.replace(/\D/g, '');
            if (state.hasPlayer(id)) {
                const playerDisplayName = state.getPlayerDisplayName(id);
                if (sanitizedText.includes('confirm')) {
                    state.removePlayer(id);
                    await dumpState();
                    await msg.reply(`Removed **${playerDisplayName}** from the state.`);
                } else {
                    await msg.reply(`\`${id}\` is in the state as **${playerDisplayName}**, type this command again with "confirm" to remove`);
                }
            } else {
                await msg.reply(`\`${id}\` is NOT in the state!`);
            }
        } else if (sanitizedText.includes('wordle')) {
            const words = await chooseMagicWords(1, { characters: 4 });
            if (words.length > 0) {
                const word = words[0].toUpperCase();
                tempWordle = {
                    solution: word,
                    guesses: [],
                    guessOwners: []
                };
                await msg.reply('Game begin!');
            }
        } else if (sanitizedText.includes('scaled')) {
            const [ n, baseline, maxPoints, order ] = sanitizedText.replace('scaled', '').replace('?', '').replace(/\s+/g, ' ').trim().split(' ').map(s => parseInt(s));
            const userIds = state.queryOrderedPlayers({ n });
            const result = getSimpleScaledPoints(userIds, { baseline, maxPoints, order });
            await msg.channel.send('Sample result of scaled points:\n' + result.map(r => `**${getRankString(r.rank)}:** _${state.getPlayerDisplayName(r.userId)}_ **${toFixed(r.points)}**`).join('\n'));
        } else if (sanitizedText.includes('scoring')) {
            await msg.reply('Simulating a submissions scenario...');
            const members = shuffle((await guild.members.list({ limit: 75 })).toJSON()).slice(0, randInt(5, 15));
            const submissions: Record<Snowflake, AnonymousSubmission> = {};
            const forfeiters: Snowflake[] = [];
            const submissionOwnersByCode: Record<string, Snowflake> = {};
            const votes: Record<Snowflake, string[]> = {};
            let i = 0;
            for (const member of members) {
                submissions[member.id] = { text: `I'm ${member.displayName}` };
                submissionOwnersByCode[toLetterId(i++)] = member.id;
                if (chance(0.1)) {
                    forfeiters.push(member.id);
                }
            }
            for (const member of members) {
                const randomCodes = shuffle(Object.keys(submissionOwnersByCode)).slice(0, 3);
                if (chance(0.9)) {
                    votes[member.id] = randomCodes;
                }
            }
            const s = new AnonymousSubmissionsState({
                prompt: await chooseRandomUnusedSubmissionPrompt(),
                forfeiters,
                phase: 'results',
                submissionOwnersByCode,
                submissions,
                votes
            });
            const { results, audienceVote, scoringDetailsString } = s.computeVoteResults();
            msg.channel.send('__Scoring Details__:\n' + scoringDetailsString);
            const scaledPoints = getScaledPoints(results.filter(r => !r.disqualified), { maxPoints: config.grandContestAward, order: 3 });
            msg.channel.send('__Points Awarded (n/i forfeits or handicaps)__:\n' + scaledPoints.map(r => `**${r.rank}.** <@${r.userId}> \`${toFixed(r.points)}\``).join('\n'));
        }
    }
};

const safeProcessCommands = async (msg: Message): Promise<void> => {
    try {
        await processCommands(msg);
    } catch (err) {
        await msg.reply(`Unhandled error while processing admin command: \`${err}\` ${(err as Error).stack}`);
    }
};

const extractMagicWord = (message: Message): string | undefined => {
    const magicWords = state.getMagicWords();
    for (const word of magicWords) {
        if (message.content.toLowerCase().includes(word.toLowerCase())) {
            return word;
        }
    }
};

// TODO: Temp variable to test normalized edit distance comparison for messages (primed with empty message to discourage short messages)
// const previousTokenizedMessages: string[][] = [[]];

// const tokenizeMessage = (content: string): string[] => {
//     if (!content) {
//         return [];
//     }
//     return content
//         // Remove apastrophes
//         .replace(/['‘’]/g, '')
//         // Lower-case
//         .toLowerCase()
//         // Split along non-word boundaries
//         .split(/\W+/)
//         // Remove all empty entries, just in case
//         .filter(x => x);
// }

client.on('messageCreate', async (msg: Message): Promise<void> => {
    const userId: Snowflake = msg.author.id;
    if (testingChannel && msg.channelId === testingChannel.id && !msg.author.bot) {
        // If message was posted in the testing channel, process as command
        await safeProcessCommands(msg);
    } else if (goodMorningChannel && msg.channel.id === goodMorningChannel.id && !msg.author.bot) {
        const isAm: boolean = new Date().getHours() < 12;
        const isPlayerNew: boolean = !state.hasPlayer(userId);
        const isQuestion: boolean = msg.content.trim().endsWith('?');
        const extractedMagicWord: string | undefined = extractMagicWord(msg);

        // TODO: Compare edit distance to all existing message contents
        // if (msg.content) {
        //     const tokenizedMessage = tokenizeMessage(msg.content);
        //     if (tokenizedMessage.length > 0) {
        //         const comparisonResult = getMostSimilarByNormalizedEditDistance(tokenizedMessage, previousTokenizedMessages);
        //         if (comparisonResult) {
        //             await logger.log(`Message \`"${JSON.stringify(tokenizedMessage).slice(0, 100)}"\` by **${msg.member?.displayName}** similar with normalized distance of \`${comparisonResult.distance.toFixed(4)}\` to message \`"${JSON.stringify(comparisonResult.value).slice(0, 100)}"\``);
        //         }
        //         previousTokenizedMessages.push(tokenizedMessage);
        //     }
        // }

        // If the grace period is active, then completely ignore all messages
        if (state.isGracePeriod()) {
            return;
        }

        // If this user is the guest reveiller and the morning has not yet begun, wake the bot up
        const isReveille: boolean = state.getEventType() === DailyEventType.GuestReveille
            && state.getEvent().user === userId
            && !state.isMorning()
            && isAm;
        if (isReveille) {
            await wakeUp(false);
            // Cancel the scheduled fallback timeout
            await cancelTimeoutsWithType(TimeoutType.GuestReveilleFallback);
        }

        if (state.isMorning()) {
            // No matter what the event is, always update 11:59 bait (if user isn't the MRB and sent text)
            if (state.isAcceptingBait() && msg.content && userId !== state.getMostRecentBait()?.userId) {
                // Count this as bait only if it's a novel message
                if (baitR9K.contains(msg.content)) {
                    await reactToMessage(msg, '🌚');
                } else {
                    baitR9K.add(msg.content);
                    state.setMostRecentBait(msg);
                    await dumpState();
                }
            }

            // Reward the user for saying happy birthday (if there are any birthdays today and they haven't already)
            // TODO: Can we detect this better?
            if (state.hasBirthdayBoys() && !state.hasSaidHappyBirthday(userId) && msg.content.toLocaleLowerCase().includes('happy birthday')) {
                state.setSaidHappyBirthday(userId, true);
                // Award the default award as a bonus
                state.awardPoints(userId, config.defaultAward);
                // React specially so they know they were rewarded
                await reactToMessage(msg, '🎁');
            }

            // If the event is an anonymous submission day, then completely ignore the message
            if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
                return;
            }

            // Reset user's "days since last good morning" counter
            state.resetDaysSinceLGM(userId);

            // If the event is popcorn, guarantee they are following the rules before proceeding to process their message
            if (state.getEventType() === DailyEventType.Popcorn) {
                const event = state.getEvent();
                if (event.user && userId !== event.user) {
                    // This turn belongs to someone else, so penalize the user
                    await reactToMessage(msg, '🤫');
                    state.deductPoints(userId, config.defaultAward);
                    await dumpState();
                    return;
                }
                // The user may talk this turn, so proceed...
                if (event.disabled && !event.user) {
                    // The story is OVER, so don't process this message specially...
                    // TODO: Temp logging
                    await logger.log(`Post-story message by **${state.getPlayerDisplayName(userId)}**`);
                } else if (event.disabled && event.user && canonicalizeText(msg.content).endsWith('theend')) {
                    // If the selected user says "the end" near the end of the morning, end the story!
                    // Delete the user to prevent further action
                    delete event.user;
                    // TODO: Do this a better way
                    // Save the last story segment to the state
                    if (!event.storySegments) {
                        event.storySegments = [];
                    }
                    event.storySegments.push(msg.cleanContent);
                    await dumpState();
                    // Notify the channel
                    await messenger.reply(msg, languageGenerator.generate('{popcorn.ending?}'));
                } else {
                    // TODO: Do this a better way
                    // Save the last story segment to the state
                    if (!event.storySegments) {
                        event.storySegments = [];
                    }
                    event.storySegments.push(msg.cleanContent);
                    await dumpState();
                    // Pick out a potential fallback in case this user didn't tag correctly
                    const mentionedUserIds = getMessageMentions(msg);
                    const fallbackUserId = getPopcornFallbackUserId();
                    // If there's no fallback and the user is breaking the rules, force them to try again and abort
                    if (!fallbackUserId) {
                        if (mentionedUserIds.includes(userId)) {
                            await messenger.reply(msg, 'You can\'t popcorn yourself you big dummy! Call on someone else');
                            return;
                        } else if (mentionedUserIds.length === 0) {
                            await messenger.reply(msg, 'Call on someone else!');
                            return;
                        }
                    }
                    // React with popcorn to show that the torch has been passed
                    await reactToMessage(msg, '🍿');
                    // Cancel any existing popcorn fallback timeouts
                    await cancelTimeoutsWithType(TimeoutType.PopcornFallback);
                    // Wipe the set of typing users for the previous turn
                    typingUsers.clear();
                    // Save the latest popcorn message ID in the state
                    event.messageId = msg.id;
                    // Pass the torch to someone else...
                    if (mentionedUserIds.includes(userId)) {
                        // Tried to tag himself, so pass to the fallback user
                        event.user = fallbackUserId;
                        await messenger.reply(msg, `You can\'t popcorn yourself you big dummy, let me pick for you: popcorn <@${fallbackUserId}>!`);
                    } else if (mentionedUserIds.length === 0) {
                        // Didn't tag anyone, so pass to the fallback user
                        event.user = fallbackUserId;
                        await messenger.reply(msg, `Popcorn <@${fallbackUserId}>!`);
                    } else if (mentionedUserIds.length === 1) {
                        // Only one other user was mentioned, so pass the torch to them
                        event.user = mentionedUserIds[0];
                        // TODO: We should do something special if an unknown player is called on
                    } else {
                        // Multiple users were mentioned, so see if there are players who haven't said GM today and are known
                        const preferredUserIds = mentionedUserIds.filter(id => !state.hasDailyRank(id) && state.hasPlayer(id));
                        if (preferredUserIds.length === 0) {
                            // No other preferred players, so let the next turn be up for grabs
                            delete event.user;
                            await messenger.reply(msg, 'You called on more than one person... I\'ll let the next turn be up for grabs!');
                        } else {
                            // Select a random other preferred player
                            const randomUserId = randChoice(...preferredUserIds);
                            event.user = randomUserId;
                            await messenger.reply(msg, `You called on more than one person, so let me pick for you: popcorn <@${randomUserId}>!`);
                        }
                    }
                    await dumpState();
                    // If a user was selected, schedule a fallback timeout
                    if (event.user) {
                        await registerPopcornFallbackTimeout(event.user);
                    }
                }
            }

            // If today is wordle and the game is still active, process the message here (don't process it as a normal message)
            if (state.getEventType() === DailyEventType.Wordle) {
                const event = state.getEvent();
                // Initialize the hi-score map if it somehow doesn't exist
                if (!event.wordleHiScores) {
                    event.wordleHiScores = {};
                }
                if (event.wordle) {
                    // If this user hasn't guessed yet for this puzzle, process their guess
                    if (!event.wordle.guessOwners.includes(userId)) {
                        const wordleGuess = msg.content.trim().toUpperCase();
                        // Ignore this guess if it isn't one single word
                        if (!wordleGuess.match(/^[A-Z]+$/)) {
                            return;
                        }
                        // Ignore the user if they solved the previous puzzle
                        if (userId === event.wordle.blacklistedUserId) {
                            await messenger.reply(msg, 'You solved the previous puzzle, give someone else a chance!');
                            return;
                        }
                        // Cut the user off if their guess isn't the right length
                        if (wordleGuess.length !== event.wordle.solution.length) {
                            await messenger.reply(msg, `Try again but with a **${event.wordle.solution.length}**-letter word`);
                            return;
                        }
                        // Get progress of this guess in relation to the current state of the puzzle
                        const progress = getProgressOfGuess(event.wordle, wordleGuess);
                        // Add this guess
                        event.wordle.guesses.push(wordleGuess);
                        event.wordle.guessOwners.push(userId);
                        // If this guess is correct, end the game
                        if (event.wordle.solution === wordleGuess) {
                            // Wipe the round data to prevent further action until the next round starts (race conditions)
                            const previousWordle = event.wordle;
                            delete event.wordle;
                            // Determine this user's score (1 default + 1 for each new tile + 1 for winning)
                            // We must do this before we show the solved puzzle so their hi-score is reflected accurately.
                            const score = config.defaultAward * (2 + progress);
                            event.wordleHiScores[userId] = Math.max(event.wordleHiScores[userId] ?? 0, score);
                            // Notify the channel
                            await messenger.reply(msg, {
                                content: 'Congrats, you\'ve solved the puzzle!',
                                files: [new AttachmentBuilder(await renderWordleState(previousWordle, {
                                    hiScores: event.wordleHiScores
                                })).setName('wordle.png')]
                            });
                            await messenger.send(msg.channel, `Count how many times your avatar appears, that's your score ${config.defaultGoodMorningEmoji}`);
                            // Schedule the next round with a random word length
                            const arg: WordleRestartData = {
                                nextPuzzleLength: randChoice(5, 6, 7, 8),
                                blacklistedUserId: userId
                            };
                            const wordleRestartDate = new Date();
                            wordleRestartDate.setMinutes(wordleRestartDate.getMinutes() + randInt(5, 25));
                            await registerTimeout(TimeoutType.WordleRestart, wordleRestartDate, { arg, pastStrategy: PastTimeoutStrategy.Delete});
                        } else {
                            // Determine this user's score (1 default + 1 for each new tile)
                            const score = config.defaultAward * (1 + progress);
                            event.wordleHiScores[userId] = Math.max(event.wordleHiScores[userId] ?? 0, score);
                            // Reply letting them know how many letter they've revealed (suppress notifications to reduce spam)
                            await messenger.reply(msg, {
                                content: progress ? `You've revealed ${progress} new letter${progress === 1 ? '' : 's'}!` : 'Hmmmmm...',
                                files: [new AttachmentBuilder(await renderWordleState(event.wordle)).setName('wordle.png')],
                                flags: MessageFlags.SuppressNotifications
                            });
                        }
                        await dumpState();
                    }
                }
                return;
            }

            // Determine some properties related to the contents of the message
            const messageHasVideo: boolean = hasVideo(msg);
            const messageHasVoiceMemo: boolean = msg.flags.has(MessageFlags.IsVoiceMessage);
            const messageHasText: boolean = msg.content.trim().length !== 0;

            // The conditions for triggering MF and GM are separate so that players can post videos-then-messages, vice-versa, or both together
            const triggerMonkeyFriday: boolean = (state.getEventType() === DailyEventType.MonkeyFriday) && messageHasVideo;
            const triggerChimpOutFriday: boolean = (state.getEventType() === DailyEventType.ChimpOutFriday) && messageHasVoiceMemo;
            // Only trigger GM if it contains text, since players often post images/video without text (but reply to reveillers no matter what)
            const triggerStandardGM: boolean = messageHasText || isReveille;

            // Handle MF messages if the conditions are met and its the user's first MF of the day
            if (triggerMonkeyFriday && !state.hasDailyBonusRank(userId)) {
                const bonusRank: number = state.getNextDailyBonusRank();
                state.setDailyBonusRank(userId, bonusRank);
                // Determine if the video provided is novel
                // TODO: Can we do this for attachments too?
                const extractedYouTubeId: string | undefined = extractYouTubeId(msg.content);
                const isNovelVideo: boolean = !extractedYouTubeId || !knownYouTubeIds.has(extractedYouTubeId);
                // If a YouTube ID was extracted, add it to the list of known YouTube IDs
                if (extractedYouTubeId) {
                    knownYouTubeIds.add(extractedYouTubeId);
                }
                // Award no points and always reply if the video is unoriginal
                if (!isNovelVideo) {
                    messenger.reply(msg, languageGenerator.generate('{goodMorningReply.unoriginalVideo?} 🌚'));
                }
                // If original, award points then reply (or react) to the message depending on the video rank
                else if (bonusRank === 1) {
                    state.awardPoints(userId, config.defaultAward);
                    await messenger.reply(msg, languageGenerator.generate('{goodMorningReply.video?} 🐒'));
                } else {
                    state.awardPoints(userId, config.defaultAward / 2);
                    await reactToMessage(msg, '🐒');
                }
                await dumpState();
            }
            // TODO: Can this logic somehow be refactored into the other MF logic?
            if (triggerChimpOutFriday && !state.hasDailyBonusRank(userId)) {
                const bonusRank: number = state.getNextDailyBonusRank();
                state.setDailyBonusRank(userId, bonusRank);
                // Award points and react/reply based on rank
                if (bonusRank === 1) {
                    state.awardPoints(userId, config.defaultAward);
                    await messenger.reply(msg, languageGenerator.generate('{goodMorningReply.chimp?} 🗣️'));
                } else {
                    state.awardPoints(userId, config.defaultAward / 2);
                    // Reply sometimes, but mostly react
                    if (chance(0.25)) {
                        await messenger.reply(msg, languageGenerator.generate('{goodMorningReply.chimp?}'));
                    } else {
                        await reactToMessage(msg, '🗣️');
                    }
                }
                await dumpState();
            }

            // Handle standard GM messages if the conditions are met and its the user's first GM of the day
            if (triggerStandardGM && !state.hasDailyRank(userId)) {
                // If it's a "grumpy" morning and no one has said anything yet, punish the player (but don't assign a rank, so player may still say good morning)
                if (state.getEventType() === DailyEventType.GrumpyMorning && !state.getEvent().disabled) {
                    // Deduct points and update point-related data
                    const penalty = 1;
                    state.deductPoints(userId, penalty);
                    // Disable the grumpy event and dump the state
                    state.getEvent().disabled = true;
                    await dumpState();
                    // React to the user grumpily
                    await reactToMessage(msg, '😡');
                    return;
                }

                // Compute and set this player's daily rank
                const rank: number = state.getNextDailyRank();
                state.setDailyRank(userId, rank);

                const priorPoints: number = state.getPlayerPoints(userId);
                let logStory: string = `<@${userId}> with \`${priorPoints}\` prior said GM ${getRankString(rank)}, `;

                // If user is first, update the combo state accordingly
                let comboDaysBroken: number = 0;
                let sendComboBrokenMessage: boolean = false;
                let comboBreakee: Snowflake | null = null;
                if (rank === 1) {
                    if (state.hasCombo()) {
                        const combo: Combo = state.getCombo() as Combo;
                        if (combo.user === userId) {
                            // If it's the existing combo holder, then increment his combo counter
                            combo.days++;
                            logStory += `increased his combo to ${combo.days} days, `;
                        } else {
                            // Else, reset the combo
                            comboBreakee = combo.user;
                            comboDaysBroken = combo.days;
                            state.setCombo({
                                user: userId,
                                days: 1
                            });
                            // If the broken combo is big enough, then reward the breaker
                            if (comboDaysBroken >= config.minimumComboDays) {
                                sendComboBrokenMessage = true;
                                // Breaker is awarded points for each day of the broken combo (half a "default award" per day)
                                state.awardPoints(userId, comboDaysBroken * config.defaultAward * 0.5);
                                // Increment the breaker's "combos broken" counter
                                state.incrementPlayerCombosBroken(userId);
                            }
                            logStory += `broke <@${comboBreakee}>'s ${comboDaysBroken}-day combo, `;
                        }
                    } else {
                        state.setCombo({
                            user: userId,
                            days: 1
                        });
                    }
                    // Update the max combo record if it's been broken
                    const newCombo: Combo = state.getCombo() as Combo;
                    if (newCombo.days > state.getMaxComboDays()) {
                        state.setMaxCombo({
                            user: newCombo.user,
                            days: newCombo.days
                        });
                        logger.log(`**${state.getPlayerDisplayName(newCombo.user)}** has set the max combo record with **${newCombo.days}** days!`);
                    }
                }

                // If the player said a magic word, reward them and let them know privately
                if (extractedMagicWord) {
                    state.awardPoints(userId, config.bonusAward);
                    await messenger.dm(userId, `You said _"${extractedMagicWord}"_, one of today's magic words! Nice 😉`);
                    logStory += `said a magic word "${extractedMagicWord}", `;
                }

                // If today is wishful wednesday, cut the generic logic off here
                if (state.getEventType() === DailyEventType.WishfulWednesday) {
                    const wishesReceived = state.getEvent().wishesReceived;
                    if (wishesReceived) {
                        // TODO: Remove this try-catch once we're sure this works
                        try {
                            // The wish recipient are the ones tagged in the message
                            const wishRecipients: Snowflake[] = getMessageMentions(msg);
                            if (wishRecipients.length > 0) {
                                if (wishRecipients.includes(userId)) {
                                    // Don't award if they tagged themself
                                    await messenger.reply(msg, 'Who do you think you are? 🌚');
                                } else {
                                    // Award the user with a default award
                                    state.awardPoints(userId, config.defaultAward);
                                    await reactToMessage(msg, state.getGoodMorningEmoji());
                                    // If tagged multiple users, split up the wishes between them
                                    const wishPoints = toFixed(1 / wishRecipients.length);
                                    for (const wishRecipient of wishRecipients) {
                                        // Increment the wish count of the recipient
                                        const oldWishScore = wishesReceived[wishRecipient] ?? 0;
                                        const newWishScore = oldWishScore + wishPoints;
                                        wishesReceived[wishRecipient] = newWishScore;
                                        // If this recipient has the most wishes, reply at certain thresholds
                                        const maxWishes = Math.max(0, ...Object.values(wishesReceived));
                                        if (newWishScore === maxWishes) {
                                            if (oldWishScore < 3 && newWishScore >= 3) {
                                                await messenger.send(goodMorningChannel, `Count your blessings <@${wishRecipient}>, for you have many loving friends!`);
                                            } else if (oldWishScore < 5 && newWishScore >= 5) {
                                                await messenger.send(goodMorningChannel, `Wow, <@${wishRecipient}> is shining bright with the love of his fellow dogs!`);
                                            }
                                        }
                                    }
                                    // Log the updated wish counts
                                    await logger.log('Wishes:\n' + Object.keys(wishesReceived)
                                        .sort((x, y) => wishesReceived[y] - wishesReceived[x])
                                        .map(id => `**${state.getPlayerDisplayName(id)}:** \`${wishesReceived[id]}\``)
                                        .join('\n'));
                                }
                            } else {
                                // Don't award the player if they didn't send any wishes!
                                await reactToMessage(msg, '🌚');
                            }
                        } catch (err) {
                            await logger.log(`Wishful Wednesday logic failed for user **${state.getPlayerDisplayName(userId)}**: \`${err}\``);
                        }
                        await dumpState();
                    } else {
                        await logger.log('WARNING! `event.wishesReceived` is null, aborting WW logic...');
                    }
                    return;
                }

                // Compute beckoning bonus and reset the state beckoning property if needed
                const wasBeckoned: boolean = state.getEventType() === DailyEventType.Beckoning && msg.author.id === state.getEvent().user;
                if (wasBeckoned) {
                    state.awardPoints(userId, config.bonusAward);
                    logStory += 'replied to a beckon, ';
                }

                // Messages are "novel" if the text is unique
                const isNovelMessage: boolean = !r9k.contains(msg.content);

                // Update the user's points and dump the state
                if (state.getEventType() === DailyEventType.ReverseGoodMorning) {
                    state.awardPoints(userId, config.defaultAward / 2);
                    logStory += 'and said GM after the reverse cutoff';
                } else if (isNovelMessage) {
                    const rankedPoints: number = config.awardsByRank[rank] ?? config.defaultAward;
                    const activityPoints: number = config.defaultAward + state.getPlayerActivity(userId).getRating();
                    if (state.doesPlayerNeedNerf(userId)) {
                        state.awardPoints(userId, Math.min(rankedPoints, activityPoints));
                        logStory += `and was awarded \`min(${rankedPoints}, ${activityPoints})\` with leader nerf`;
                    } else {
                        state.awardPoints(userId, Math.max(rankedPoints, activityPoints));
                        logStory += `and was awarded \`max(${rankedPoints}, ${activityPoints})\``;
                    }
                } else {
                    state.awardPoints(userId, config.defaultAward / 2);
                    logStory += 'and sent an unoriginal GM message';
                }
                dailyVolatileLog.push([new Date(), logStory]);
                await dumpState();

                // Add this user's message to the R9K text bank
                r9k.add(msg.content);

                // If it's a combo-breaker, reply with a special message (may result in double replies on Monkey Friday)
                if (sendComboBrokenMessage && comboBreakee) {
                    messenger.reply(msg, languageGenerator.generate('{goodMorningReply.comboBreaker?}', { breakee: `<@${comboBreakee}>`, days: comboDaysBroken.toString() }));
                }
                // If this post is NOT a Monkey Friday post, reply as normal (this is to avoid double replies on Monkey Friday)
                else if (!triggerMonkeyFriday) {
                    // If the game has started and the user is just now joining, greet them specially
                    if (isPlayerNew && state.hasGame()) {
                        messenger.reply(msg, languageGenerator.generate('{goodMorningReply.new?}'));
                    }
                    // If the user was beckoned, reply to them specially
                    else if (wasBeckoned) {
                        messenger.reply(msg, languageGenerator.generate('{beckoning.reply}'));
                    }
                    // Message was unoriginal, so reply (or react) to indicate unoriginal
                    else if (!isNovelMessage) {
                        if (rank === 1) {
                            messenger.reply(msg, languageGenerator.generate('{goodMorningReply.unoriginal?} 🌚'));
                        } else {
                            reactToMessage(msg, '🌚');
                        }
                    }
                    // Always reply with a negative reply if the player had negative points
                    else if (priorPoints < 0) {
                        messenger.reply(msg, languageGenerator.generate('{goodMorningReply.negative?}'));
                    }
                    // Always reply if the player hasn't said GM in over a week
                    else if (state.getPlayerDaysSinceLGM(userId) > 7) {
                        messenger.reply(msg, languageGenerator.generate('{goodMorningReply.absent?}'));
                    }
                    // If this player is one of the first to say GM (or was the last submission winner), reply (or react) specially
                    else if (rank <= config.goodMorningReplyCount || state.isLastSubmissionWinner(userId)) {
                        if (state.getEventType() === DailyEventType.Popcorn || chance(config.replyViaReactionProbability)) {
                            reactToMessage(msg, state.getGoodMorningEmoji());
                        } else if (isQuestion) {
                            // TODO: Can we more intelligently determine what type of question it is?
                            messenger.reply(msg, languageGenerator.generate('{goodMorningReply.question?}'));
                        } else {
                            messenger.reply(msg, languageGenerator.generate('{goodMorningReply.standard?}'));
                        }
                    }
                    // If there's nothing special about this message, just react
                    else {
                        reactToMessage(msg, state.getGoodMorningEmoji());
                    }
                }
            } else if (extractedMagicWord) {
                // If this isn't the user's GM message yet they still said a magic word, let them know...
                if (userId !== guildOwner.id) {
                    await logger.log(`**${state.getPlayerDisplayName(userId)}** just said a magic word _"${extractedMagicWord}"_, though too late...`);
                }
                await messenger.dm(userId, languageGenerator.generate(`You {!said|just said} one of today's {!magic words|secret words}, {!yet|but|though} {!you're a little too late|it wasn't in your GM message} so it doesn't count...`), { immediate: true });
            }

            // Regardless of whether it's their first message or not, react to the magic word with a small probability
            if (extractedMagicWord && chance(config.magicWordReactionProbability)) {
                await reactToMessage(msg, ['😉', '😏', '😜', '😛']);
            }
        } else {
            // If someone is the first to message after the nightmare event goes off, award them points then go back to sleep
            if (state.getEventType() === DailyEventType.Nightmare && !state.getEvent().disabled) {
                state.getEvent().disabled = true;
                state.awardPoints(userId, config.defaultAward);
                await dumpState();
                await messenger.reply(msg, 'Thanks! Alright, now I\'m back off to bed... 🤫');
                await awardPrize(userId, 'nightmare', 'Thanks for comforting me in the wee hours of the night');
                return;
            }
            // If the bot hasn't woken up yet and it's a reverse GM, react and track the rank of each player for now...
            // TODO: Clean this up! Doesn't even take R9K into account
            if (state.getEventType() === DailyEventType.ReverseGoodMorning && isAm) {
                const event = state.getEvent();
                if (event.reverseGMRanks) {
                    if (event.reverseGMRanks[userId] === undefined) {
                        event.reverseGMRanks[userId] = new Date().getTime();
                        await reactToMessage(msg, state.getGoodMorningEmoji());
                        await dumpState();
                    }
                } else {
                    await logger.log('ERROR! `event.reverseGMRanks` is null!');
                }
                return;
            }

            // It's not morning, so punish the player accordingly...
            const isRepeatOffense: boolean = state.wasPlayerPenalizedToday(userId);
            if (isRepeatOffense) {
                // Deduct a half default award for repeat offenses
                state.deductPoints(userId, config.defaultAward / 2);
            } else {
                // If this is the user's first penalty since last morning, react to the message and deduct a default award
                state.deductPoints(userId, config.defaultAward);
                // Reply if the player is new, else react
                if (isPlayerNew) {
                    if (isAm) {
                        await messenger.reply(msg, languageGenerator.generate('{penaltyReply.new.early?}'));
                    } else {
                        await messenger.reply(msg, languageGenerator.generate('{penaltyReply.new.late?}'));
                    }
                } else if (isAm) {
                    await reactToMessage(msg, '😴');
                } else {
                    await reactToMessage(msg, ['😡', '😬', '😒', '😐', '🤫']);
                }
            }
            // If this deduction makes a player delinquent, mute them immediately (hopefully this prevents abuse...)
            if (!state.isPlayerMuted(userId) && state.isPlayerDelinquent(userId)) {
                await revokeGMChannelAccess([userId]);
                await logger.log(`Revoked GM channel access for **${msg.member?.displayName ?? msg.author.id}**`);
            }
            // If someone baited (ignore self-bait), award and notify via DM
            const bait: Bait | undefined = state.getMostRecentBait();
            if (bait && userId !== bait.userId) {
                state.awardPoints(bait.userId, config.defaultAward / 2);
                await logger.log(`Awarded **${state.getPlayerDisplayName(bait.userId)}** for baiting successfully.`);
                await messenger.dm(bait.userId, 'Bait successful.', { immediate: true });
                // If it's the baited's first offense (and it's the afternoon), then reply with some chance
                if (!isAm && !isRepeatOffense && chance(0.5)) {
                    await messenger.reply(msg, languageGenerator.generate('{bait.reply?}', { player: `<@${bait.userId}>` }));
                }
            }
            await dumpState();
            // Reply if the user has hit a certain threshold
            if (state.getPlayerPoints(userId) === -2) {
                await messenger.reply(msg, 'Why are you still talking?');
            } else if (state.getPlayerPoints(userId) === -5) {
                await messenger.reply(msg, 'You have brought great dishonor to this server...');
            }
        }
    } else if (msg.channel instanceof DMChannel && !msg.author.bot) {
        // Always process admin commands if using a certain prefix (only needed to override DM-based events)
        if (guildOwnerDmChannel
            && msg.channel.id === guildOwnerDmChannel.id
            && msg.author.id === guildOwner.id
            && msg.content[0] === '+')
        {
            await safeProcessCommands(msg);
            return;
        }
        // If there's an active game...
        if (state.hasGame()) {
            const game = state.getGame();
            // Attempt to process this DM using the using the non-decision hook
            const replyTexts = game.handleNonDecisionDM(userId, msg.content).filter(t => t);
            // If this DM warranted some sort of reply, then send the reply and return
            if (replyTexts.length > 0) {
                await dumpState();
                for (const replyText of replyTexts) {
                    await messenger.reply(msg, replyText);
                }
                return;
            }
            // Otherwise if accepting game decisions, process this DM as a game decision
            if (state.isAcceptingGameDecisions()) {
                await processGameDecision(userId, msg.content, 'DM', async (response: MessengerPayload) => {
                    await msg.reply(response);
                });
                return;
            }
        }

        // If this DM wasn't processed based on the above game logic, then proceed to process it using other rules.

        // Process DM submissions depending on the submissions phase
        if (state.hasAnonymousSubmissions()) {
            const anonymousSubmissions = state.getAnonymousSubmissions();
            const userId: Snowflake = msg.author.id;
            // Handle voting or submitting depending on what phase of the process we're in
            if (anonymousSubmissions.isVotingPhase()) {
                const pattern: RegExp = /[a-zA-Z]+/g;
                // Grab all possible matches, as the vote processing validates the number of votes
                const submissionCodes: string[] = [...msg.content.matchAll(pattern)].map(x => x[0].toUpperCase());
                await processSubmissionVote(userId, submissionCodes, 'DM', async (text: string) => {
                    await messenger.reply(msg, text);
                });
            } else if (anonymousSubmissions.isSubmissionsPhase()) {
                const redoSubmission: boolean = anonymousSubmissions.isSubmitter(userId);
                // Add the submission
                try {
                    anonymousSubmissions.addSubmission(userId, toSubmission(msg));
                } catch (err) {
                    await messenger.reply(msg, (err as Error).message);
                    return;
                }
                // Reply to the player via DM to let them know their submission was received
                const numSubmissions: number = anonymousSubmissions.getNumSubmissions();
                if (redoSubmission) {
                    await messenger.reply(msg, 'Thanks for the update, I\'ll use this submission instead of your previous one.');
                } else {
                    await messenger.reply(msg, 'Thanks for your submission!');
                    // If the user is on probation, warn them about it
                    if (state.isPlayerOnVotingProbation(userId)) {
                        await messenger.reply(msg, '**BEWARNED!** Since you didn\'t vote last time, you are on _voting probation_! This means I won\'t wait for your vote today, so vote quickly or else 🌚', { immediate: true });
                    }
                    // If we now have a multiple of some number of submissions (and it's currently the morning), notify the server
                    if (numSubmissions % 3 === 0 && state.isMorning()) {
                        await messenger.send(goodMorningChannel, languageGenerator.generate(`{!We now have|I've received|We're now at|I now count|Currently at|I have|Nice} **${numSubmissions}** {!submissions|submissions|entries}! `
                            + `{!DM me|Send me a DM with|Send me} a _${anonymousSubmissions.getPrompt()}_ before ${getSubmissionRevealTimestamp()} to {!participate|be included|join the fun|enter the contest|be a part of the contest|have a chance to win}`));
                    }
                    // This may be the user's first engagement, so refresh display name here
                    // TODO: is there a better, more unified way to do this?
                    state.setPlayerDisplayName(userId, await getDisplayName(userId));
                    await logger.log(`Received submission from player **${state.getPlayerDisplayName(userId)}${state.isPlayerOnVotingProbation(userId) ? ' (PROBATION)' : ''}**, `
                        + `now at **${numSubmissions}** submissions`);
                }
                await dumpState();
            } else {
                await messenger.reply(msg, 'It\'s a little too late to submit something!');
            }
        }
        // Handle writer's block submissions
        else if (!state.isMorning() && state.getEventType() === DailyEventType.WritersBlock && state.getEvent().user === msg.author.id) {
            const content: string = msg.content;
            if (content && content.trim()) {
                const resubmitting: boolean = state.getEvent().customMessage !== undefined;
                // Save the greeting and dump the state
                state.getEvent().customMessage = content;
                await dumpState();
                // Give the user confirmation
                if (resubmitting) {
                    await messenger.reply(msg, 'I\'ll use this message instead of your previous one');
                } else {
                    await messenger.reply(msg, languageGenerator.generate('{!Thanks|Cool|Nice}! This {!will make for|is} a {adjectives.positive?} {!message|greeting}'));
                }
                logger.log(`**${state.getPlayerDisplayName(msg.author.id)}** submitted their writer's block greeting:\n${content}`);
            } else {
                await messenger.reply(msg, 'I can\'t send that...');
            }
        }
        // Process admin commands without the override suffix
        else if (guildOwnerDmChannel && msg.channel.id === guildOwnerDmChannel.id && msg.author.id === guildOwner.id) {
            await safeProcessCommands(msg);
        }
    }
});

client.on('messageUpdate', async (oldMessage: PartialMessage | Message, newMessage: PartialMessage | Message) => {
    if (state.getEventType() === DailyEventType.Popcorn) {
        const event = state.getEvent();
        // Abort if there's no user ID in the state
        if (!event.user) {
            return;
        }
        // If the popcorn message has been edited...
        if (newMessage.id === event.messageId) {
            // Validate that they're not partials
            if (oldMessage.partial || newMessage.partial) {
                await logger.log(`Popcorn message edited, but aborting due to message partiality: old ${oldMessage.partial ? 'partial' : 'full'}, new ${newMessage.partial ? 'partial' : 'full'}`);
                return;
            }
            // Check if the relevant user tag was removed
            const oldTags = getMessageMentions(oldMessage);
            const newTags = getMessageMentions(newMessage);
            // Send a message if the tag was removed
            if (oldTags.includes(event.user) && !newTags.includes(event.user)) {
                await messenger.reply(newMessage, languageGenerator.generate('{popcorn.tagRemoved?}', { player: `<@${event.user}>` }));
            }
            // TODO: Temp logging to see how this works
            await logger.log(`Popcorn message edited. Old tags: \`${JSON.stringify(oldTags)}\`, new tags: \`${JSON.stringify(newTags)}\``);
        }
    }
});

client.login(auth.token);
