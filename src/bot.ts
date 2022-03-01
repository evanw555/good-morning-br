import { Client, DMChannel, Intents, MessageAttachment } from 'discord.js';
import { Guild, GuildMember, Message, Snowflake, TextBasedChannels } from 'discord.js';
import { DailyEvent, DailyEventType, GoodMorningConfig, GoodMorningHistory, Season, TimeoutType, Combo, CalendarDate } from './types.js';
import TimeoutManager from './timeout-manager.js';
import { createMidSeasonUpdateImage, createSeasonResultsImage } from './graphics.js';
import { hasVideo, randInt, validateConfig, getTodayDateString, reactToMessage, getOrderingUpset, sleep, randChoice, toCalendarDate, getTomorrow, generateKMeansClusters } from './util.js';
import GoodMorningState from './state.js';
import logger from './logger.js';

import { loadJson } from './load-json.js';
const auth = loadJson('config/auth.json');
const config: GoodMorningConfig = loadJson('config/config.json');

import FileStorage from './file-storage.js';
const storage = new FileStorage('./data/');

import LanguageGenerator from './language-generator.js';
const languageConfig = loadJson('config/language.json');
const languageGenerator = new LanguageGenerator(languageConfig);

import R9KTextBank from './r9k.js';
const r9k = new R9KTextBank();

import Messenger from './messenger.js';
const messenger = new Messenger();

const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
        Intents.FLAGS.DIRECT_MESSAGES
    ]
});

let guild: Guild;

let goodMorningChannel: TextBasedChannels;
let guildOwner: GuildMember;
let guildOwnerDmChannel: DMChannel;

let state: GoodMorningState;
let history: GoodMorningHistory;

const getDisplayName = async (userId: Snowflake): Promise<string> => {
    try {
        const member = await guild.members.fetch(userId);
        return member.displayName;
    } catch (err) {
        return `User ${userId}`;
    }
}

const fetchMember = async (userId: Snowflake): Promise<GuildMember> => {
    try {
        return await guild.members.fetch(userId);
    } catch (err) {
        return undefined;
    }
}

const advanceSeason = async (): Promise<Season> => {
    // Add new entry for this season
    const newHistoryEntry: Season = state.toHistorySeasonEntry();
    history.seasons.push(newHistoryEntry);
    // Compute medals
    const orderedUserIds = state.getOrderedPlayers();
    const winners = {
        gold: orderedUserIds[0],
        silver: orderedUserIds[1],
        bronze: orderedUserIds[2]
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
    // Send the final state to the guild owner one last time before wiping it
    if (guildOwnerDmChannel) {
        await guildOwnerDmChannel.send(`The final state of season **${state.getSeasonNumber()}** before it's wiped:`);
        await messenger.sendLargeMonospaced(guildOwnerDmChannel, state.toJson());
    }
    // Reset the state
    const nextSeason: number = state.getSeasonNumber() + 1;
    state = new GoodMorningState({
        season: nextSeason,
        goal: config.seasonGoal,
        startedOn: getTodayDateString(),
        isMorning: false,
        isGracePeriod: true,
        goodMorningEmoji: config.defaultGoodMorningEmoji,
        dailyStatus: {},
        players: {}
    }, getDisplayName);
    // Dump the state and history
    await dumpState();
    await dumpHistory();

    return newHistoryEntry;
};

const chooseEvent = (date: Date): DailyEvent => {
    // Sunday standings recap
    if (date.getDay() === 0) {
        return {
            type: DailyEventType.RecapSunday
        };
    }
    // If this date has a calendar date message override, use that
    const calendarDate: CalendarDate = toCalendarDate(date); // e.g. "12/25" for xmas
    if (calendarDate in config.goodMorningMessageOverrides) {
        return {
            type: DailyEventType.OverriddenMessage
        };
    }
    // Monkey Friday
    if (date.getDay() === 5) {
        return {
            type: DailyEventType.MonkeyFriday
        };
    }
    // Determine which player (if any) should be beckoned on this date
    const potentialBeckonees: Snowflake[] = state.getLeastRecentPlayers(6);
    if (potentialBeckonees.length > 0 && Math.random() < 0.25) {
        return {
            type: DailyEventType.Beckoning,
            beckoning: randChoice(...potentialBeckonees)
        };
    }
    // Assign a random guest reveiller
    if (Math.random() < 0.15) {
        const potentialReveillers: Snowflake[] = state.getPotentialReveillers();
        if (potentialReveillers.length > 0) {
            const guestReveiller: Snowflake = randChoice(...potentialReveillers);
            return {
                type: DailyEventType.GuestReveille,
                reveiller: guestReveiller
            };
        }
    }
    // Do a "reverse" good morning
    if (Math.random() < 0.1) {
        return {
            type: DailyEventType.ReverseGoodMorning,
            reverseGMRanks: {}
        };
    }
    // Do anonymous submissions
    if (Math.random() < 0.1) {
        return {
            type: DailyEventType.AnonymousSubmissions,
            submissionType: randChoice("haiku", "poem"), // TODO: Add new ones such as "short story", "motivational message" once this has happened a couple times
            submissions: {}
        };
    }
    // Do a grumpy morning
    if (Math.random() < 0.1) {
        return {
            type: DailyEventType.GrumpyMorning
        };
    }
};

const chooseMagicWord = async (): Promise<string> => {
    try {
        const words: string[] = await loadJson('config/words.json');
        return randChoice(...words);
    } catch (err) {
        logger.log(`Failed to choose a word of the day: \`${err.toString()}\``);
    }
}

const sendGoodMorningMessage = async (): Promise<void> => {
    if (goodMorningChannel) {
        switch (state.getEventType()) {
        case DailyEventType.RecapSunday:
            // TODO: This logic makes some assumptions... fix it!
            const orderedPlayers: Snowflake[] = state.getOrderedPlayers();
            const top: Snowflake = orderedPlayers[0];
            const second: Snowflake = orderedPlayers[1];

            const attachment = new MessageAttachment(await createMidSeasonUpdateImage(state, history.medals), 'results.png');

            await messenger.send(goodMorningChannel, languageGenerator.generate('{weeklyUpdate}', { season: state.getSeasonNumber().toString(), top: `<@${top}>`, second: `<@${second}>` }));
            await goodMorningChannel.send({ files: [attachment] });
            break;
        case DailyEventType.MonkeyFriday:
            await messenger.send(goodMorningChannel, languageGenerator.generate('{happyFriday}'));
            break;
        case DailyEventType.OverriddenMessage:
            await messenger.send(goodMorningChannel, languageGenerator.generate(config.goodMorningMessageOverrides[toCalendarDate(new Date())] ?? '{goodMorning}'));
            break;
        case DailyEventType.Beckoning:
            await messenger.send(goodMorningChannel, languageGenerator.generate('{beckoning.goodMorning?}', { player: `<@${state.getEvent().beckoning}>` }));
            break;
        case DailyEventType.GrumpyMorning:
            await messenger.send(goodMorningChannel, languageGenerator.generate('{grumpyMorning}'));
            break;
        case DailyEventType.AnonymousSubmissions:
            const text = `Good morning! Today is a special one. Rather than sending your good morning messages here for all to see, `
                + `I'd like you write a special Good Morning ${state.getEvent().submissionType} and send it directly to me via DM! `
                + `At 10:30, I'll post them here anonymously and you'll all be voting on your favorites 😉`;
            await messenger.send(goodMorningChannel, text);
            break;
        default:
            // Otherwise, send the standard GM message as normal
            if (Math.random() < config.goodMorningMessageProbability) {
                await messenger.send(goodMorningChannel, languageGenerator.generate('{goodMorning}'));
            }
            break;
        }
    }
};

const sendSeasonEndMessages = async (channel: TextBasedChannels, previousState: GoodMorningState): Promise<void> => {
    const winner: Snowflake = previousState.getTopPlayer();
    const newSeason: number = previousState.getSeasonNumber() + 1;
    await messenger.send(channel, `Well everyone, season **${previousState.getSeasonNumber()}** has finally come to an end!`);
    await messenger.send(channel, 'Thanks to all those who have participated. You have made these mornings bright and joyous for not just me, but for everyone here 🌞');
    await sleep(10000);
    await messenger.send(channel, 'In a couple minutes, I\'ll reveal the winners and the final standings...');
    await messenger.send(channel, 'In the meantime, please congratulate yourselves, take a deep breath, and appreciate the friends you\'ve made in this channel 🙂');
    await messenger.send(channel, '(penalties are disabled until tomorrow morning)');
    // Send the "final results image"
    await sleep(120000);
    await messenger.send(channel, 'Alright, here are the final standings...');
    await channel.sendTyping();
    await sleep(5000);
    const attachment = new MessageAttachment(await createSeasonResultsImage(previousState, history.medals), 'results.png');
    await channel.send({ files: [attachment] });
    await sleep(5000);
    await messenger.send(channel, `Congrats, <@${winner}>!`);
    // Send information about the season rewards
    await sleep(15000);
    await messenger.send(channel, `As a reward, <@${winner}> will get the following perks throughout season **${newSeason}**:`);
    await messenger.send(channel, ' ⭐ Ability to set a special "good morning" emoji that everyone in the server can use');
    await messenger.send(channel, ' ⭐ Honorary Robert status, with the ability to post in **#robertism**');
    await messenger.send(channel, ' ⭐ More TBD perks that will be announced soon!');
    // Wait, then send info about the next season
    await sleep(30000);
    await messenger.send(channel, `See you all in season **${newSeason}** 😉`);
};

const setStatus = async (active: boolean): Promise<void> => {
    if (active) {
        client.user.setPresence({
            status: 'online',
            activities: [{
                name: 'GOOD MORNING! 🌞',
                type: 'PLAYING'
            }]
        });
    } else {
        client.user.setPresence({
            status: 'idle',
            activities: []
        });
    }
};

const registerGoodMorningTimeout = async (): Promise<void> => {
    const MIN_HOUR: number = 6;
    const MAX_HOUR_EXCLUSIVE: number = (state.getEventType() === DailyEventType.AnonymousSubmissions) ? 8 : 10;

    const morningTomorrow: Date = new Date();
    // Set date as tomorrow if it's after the earliest possible morning time
    if (morningTomorrow.getHours() >= MIN_HOUR) {
        morningTomorrow.setDate(morningTomorrow.getDate() + 1);
    }
    // Set time as sometime between 7am and 10am
    morningTomorrow.setHours(randInt(MIN_HOUR, MAX_HOUR_EXCLUSIVE), randInt(0, 60), randInt(0, 60));

    await timeoutManager.registerTimeout(TimeoutType.NextGoodMorning, morningTomorrow);
};

const wakeUp = async (sendMessage: boolean): Promise<void> => {
    // If attempting to wake up while already awake, warn the admin and abort
    if (state.isMorning()) {
        logger.log('WARNING! Attempted to wake up while `state.isMorning` is already `true`');
        return;
    }

    // Increment "days since last good morning" counters for all participating users
    state.incrementAllLGMs();

    // Set today's positive react emoji
    state.setGoodMorningEmoji(config.goodMorningEmojiOverrides[toCalendarDate(new Date())] ?? config.defaultGoodMorningEmoji);

    // Set today's magic word (if it's not an abnormal event)
    state.clearMagicWord();
    const magicWord: string = await chooseMagicWord();
    if (magicWord && !state.isEventAbnormal()) {
        state.setMagicWord(magicWord);
        // Get list of all suitable recipients of the magic word
        const potentialMagicWordRecipients: Snowflake[] = state.getPotentialMagicWordRecipients();
        if (potentialMagicWordRecipients.length > 0) {
            // If there are any potential recipients, choose one at random and send them the hint
            const magicWordRecipient: Snowflake = randChoice(...potentialMagicWordRecipients);
            await messenger.dm(await fetchMember(magicWordRecipient), `Psssst.... the magic word of the day is _"${state.getMagicWord()}"_`);
            await logger.log(`Magic word _"${state.getMagicWord()}"_ was sent to **${state.getPlayerDisplayName(magicWordRecipient)}**`);
        }
    }

    // Set timeout for when morning ends (if they're in the future)
    const now = new Date();
    const preNoonToday: Date = new Date();
    preNoonToday.setHours(11, randInt(50, 58), randInt(0, 60), 0);
    if (preNoonToday > now) {
        await timeoutManager.registerTimeout(TimeoutType.NextPreNoon, preNoonToday);
    }
    const noonToday: Date = new Date();
    noonToday.setHours(12, 0, 0, 0);
    if (noonToday > now) {
        await timeoutManager.registerTimeout(TimeoutType.NextNoon, noonToday);
    }

    // Set timeout for anonymous submission reveal
    if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
        const submissionRevealTime = new Date();
        submissionRevealTime.setHours(10, 30, 0, 0);
        await timeoutManager.registerTimeout(TimeoutType.AnonymousSubmissionReveal, submissionRevealTime);
    }

    // Update the bot's status to active
    await setStatus(true);

    // Send the good morning message
    if (sendMessage) {
        await sendGoodMorningMessage();
    }

    // Reset the daily state
    state.setMorning(true);
    state.setGracePeriod(false);
    state.resetDailyState();

    // Process "reverse" GM ranks
    if (state.getEventType() === DailyEventType.ReverseGoodMorning) {
        const mostRecentUsers: Snowflake[] = Object.keys(state.getEvent().reverseGMRanks);
        mostRecentUsers.sort((x, y) => state.getEvent().reverseGMRanks[y] - state.getEvent().reverseGMRanks[x]);
        // Process the users in order of most recent reverse GM message
        for (let i = 0; i < mostRecentUsers.length; i++) {
            const userId: Snowflake = mostRecentUsers[i];
            const rank: number = i + 1;
            const pointsEarned: number = config.awardsByRank[rank] ?? config.defaultAward;
            // Dump the rank info into the daily status map and assign points accordingly
            state.awardPoints(userId, pointsEarned);
            state.setDailyRank(userId, rank);
            state.resetDaysSinceLGM(userId);
        }
        // Send a message to the channel tagging the respective players
        if (mostRecentUsers.length >= 3) {
            await messenger.send(goodMorningChannel, `Thanks to <@${mostRecentUsers[2]}>, <@${mostRecentUsers[1]}>, and especially <@${mostRecentUsers[0]}> for paving the way!`);
        }
    }

    // Dump state
    await dumpState();
};

const TIMEOUT_CALLBACKS = {
    [TimeoutType.NextGoodMorning]: async (): Promise<void> => {
        await wakeUp(true);
    },
    [TimeoutType.NextPreNoon]: async (): Promise<void> => {
        // TODO: Can we do an "emergency bot wake-up" here? (in case of slacking reveiller)

        // Before anything else, check the results of anonymous submissions
        if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
            const scores: Record<Snowflake, number> = {};
            const messages: Record<Snowflake, Message> = {};

            // First, count the reacts and compute the score
            const userIds: Snowflake[] = Object.keys(state.getEvent().anonymousMessagesByOwner);
            let scoresLogMessage: string = 'Submission Scores:'
            for (let i = 0; i < userIds.length; i++) {
                const userId: Snowflake = userIds[i];
                try {
                    const messageId: Snowflake = state.getEvent().anonymousMessagesByOwner[userId];
                    const message: Message = await goodMorningChannel.messages.fetch(messageId);
                    const upvotes: number = message.reactions.resolve(config.defaultGoodMorningEmoji).count;
                    const downvotes: number = message.reactions.resolve(config.downvoteEmoji).count;
                    const score: number = upvotes - (downvotes / 2);
                    scores[userId] = score;
                    messages[userId] = message;
                    scoresLogMessage += `\n**${state.getPlayerDisplayName(userId)}**: \`${upvotes}u - ${downvotes}d = ${score}\``;
                } catch (err) {
                    logger.log(`Failed to compute score for <@${userId}>'s message: \`${err.toString()}\``);
                }
            }
            logger.log(scoresLogMessage);

            // Then, assign points based on rank in score
            userIds.sort((x, y) => scores[y] - scores[x]);
            for (let i = 0; i < userIds.length; i++) {
                const userId: Snowflake = userIds[i];
                const score: number = scores[userId];
                const rank: number = i + 1;
                // If the player received a negative score, award no points
                const pointsEarned: number = score < 0 ? 0 : (config.largeAwardsByRank[rank] ?? config.defaultAward);
                state.awardPoints(userId, pointsEarned);
                state.setDailyRank(userId, rank);
                state.resetDaysSinceLGM(userId);
            }

            // Finally, send congrats messages
            if (userIds[0]) {
                await messenger.reply(messages[userIds[0]], `Congrats to <@${userIds[0]}> for sending the best Good Morning ${state.getEvent().submissionType}!`);
            }
            if (userIds[1] && userIds[2]) {
                await messenger.send(goodMorningChannel, `Congrats as well to the runners-up <@${userIds[1]}> and <@${userIds[2]}>!`);
            }
            if (Math.min(...Object.values(scores)) < 0) {
                const userId: Snowflake = userIds[userIds.length - 1];
                await messenger.reply(messages[userId], `...and <@${userId}>, hope you do better next time 😬`);
            }

            // Sleep to provide a buffer in case more messages need to be sent
            await sleep(10000);
        }

        // Update current leader property
        const previousLeader: Snowflake = state.getCurrentLeader();
        const leaderUpset: boolean = state.updateCurrentLeader();
        if (leaderUpset) {
            const newLeader: Snowflake = state.getCurrentLeader();
            // If it's not the end of the season, notify the channel of the leader shift
            if (!state.isSeasonGoalReached()) {
                await messenger.send(goodMorningChannel, languageGenerator.generate('{leaderShift?}', { old: `<@${previousLeader}>`, new: `<@${newLeader}>` }));
            }
            // Sleep to provide a buffer in case more messages need to be sent
            await sleep(10000);
        }

        // Determine event for tomorrow
        const nextEvent: DailyEvent = chooseEvent(getTomorrow());
        if (nextEvent && !state.isSeasonGoalReached()) {
            state.setNextEvent(nextEvent);
            // TODO: temporary message to tell admin when a special event has been selected, remove this soon
            await logger.log(`Event for tomorrow has been selected: \`${JSON.stringify(nextEvent)}\``);
            // Depending on the type of event chosen for tomorrow, send out a special message
            if (nextEvent.type === DailyEventType.GuestReveille) {
                await messenger.send(goodMorningChannel, languageGenerator.generate('{reveille.summon}', { player: `<@${nextEvent.reveiller}>` }));
            } else if (nextEvent.type === DailyEventType.ReverseGoodMorning) {
                const text = 'Tomorrow morning will be a _Reverse_ Good Morning! '
                    + 'Instead of saying good morning after me, you should say good morning _before_ me. '
                    + 'The last ones to say it before I wake up will be the most appreciated 🙂';
                await messenger.send(goodMorningChannel, text);
            }
        }

        // Dump state
        await dumpState();
    },
    [TimeoutType.NextNoon]: async (): Promise<void> => {
        // Update basic state properties
        state.setMorning(false);

        // Activate the queued up event
        state.dequeueNextEvent();

        // Register timeout for tomorrow's good morning message (if not waiting on a reveiller)
        if (state.getEventType() !== DailyEventType.GuestReveille) {
            await registerGoodMorningTimeout();
        }

        // Dump state and R9K hashes
        await dumpState();
        await dumpR9KHashes();

        // If anyone's score is above the season goal, then proceed to the next season
        if (state.isSeasonGoalReached()) {
            const previousState: GoodMorningState = state;
            await advanceSeason();
            await sendSeasonEndMessages(goodMorningChannel, previousState);
        }

        // Update the bot's status
        await setStatus(false);
    },
    [TimeoutType.AnonymousSubmissionReveal]: async (): Promise<void> => {
        await messenger.send(goodMorningChannel, `Here are your anonymous submissions! Use ${config.defaultGoodMorningEmoji} to upvote and ${config.downvoteEmoji} to downvote...`);

        // Get all the relevant user IDs and shuffle them
        const userIds: Snowflake[] = Object.keys(state.getEvent().submissions);
        userIds.sort((x, y) => Math.random() - Math.random());

        // For each submission (in shuffled order)...
        state.getEvent().anonymousMessagesByOwner = {};
        for (let i = 0; i < userIds.length; i++) {
            const userId: Snowflake = userIds[i];
            const submission: string = state.getEvent().submissions[userId];

            try {
                // Send the message out and provide the expected emoji reacts
                const message: Message = await messenger.sendAndGet(goodMorningChannel, submission);
                await reactToMessage(message, config.defaultGoodMorningEmoji);
                await reactToMessage(message, config.downvoteEmoji);

                // Track the message ID keyed by user ID
                state.getEvent().anonymousMessagesByOwner[userId] = message.id;

                // Take a long pause
                await sleep(30000);
            } catch (err) {
                logger.log(`Failed to send out <@${userId}>'s submission: \`${err.toString()}\``);
            }
        }

        // Deleting the submissions map will prevent action taken on further DMs
        delete state.getEvent().submissions;
    }
};

const timeoutManager = new TimeoutManager(storage, TIMEOUT_CALLBACKS);

const loadState = async (): Promise<void> => {
    try {
        state = new GoodMorningState(await storage.readJson('state'), getDisplayName);
        // Temporary logic to initialize newly introduced properties
        // ...
    } catch (err) {
        // Specifically check for file-not-found errors to make sure we don't overwrite anything
        if (err.code === 'ENOENT') {
            await logger.log('Existing state file not found, creating a fresh state...');
            state = new GoodMorningState({
                season: 1,
                goal: config.seasonGoal,
                startedOn: getTodayDateString(),
                isMorning: false,
                isGracePeriod: true,
                goodMorningEmoji: config.defaultGoodMorningEmoji,
                dailyStatus: {},
                players: {}
            }, getDisplayName);
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
    } catch (err) {
        // Specifically check for file-not-found errors to make sure we don't overwrite anything
        if (err.code === 'ENOENT') {
            await logger.log('Existing history file not found, creating a fresh history...');
            history = {
                seasons: [],
                medals: {}
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

client.on('ready', async (): Promise<void> => {
    // First, validate the config file to ensure it conforms to the schema
    validateConfig(config);

    // Then, fetch the guilds and guild channels
    await client.guilds.fetch();
    guild = client.guilds.cache.first();
    await guild.channels.fetch();

    // Determine the guild owner and the guild owner's DM channel
    guildOwner = await guild.fetchOwner();
    if (guildOwner) {
        guildOwnerDmChannel = await guildOwner.createDM();
        logger.setChannel(guildOwnerDmChannel);
        await logger.log(`Determined guild owner: **${guildOwner.displayName}**`);
    } else {
        await logger.log('Could not determine the guild\'s owner!');
    }

    // Attempt to load the good morning channel (abort if not successful)
    try {
        goodMorningChannel = (await client.channels.fetch(config.goodMorningChannelId)) as TextBasedChannels;
    } catch (err) {}
    if (!goodMorningChannel) {
        await logger.log(`Couldn't load good morning channel with Id "${config.goodMorningChannelId}", aborting...`);
        process.exit(1);
    }
    await logger.log(`Found good morning channel as \`${goodMorningChannel.id}\``);

    // Load all necessary data from disk
    await loadState();
    await loadHistory();
    await loadR9KHashes();
    await timeoutManager.loadTimeouts();

    if (timeoutManager.hasTimeout(TimeoutType.NextGoodMorning)) {
        await logger.log(`Bot had to restart... next date is ${timeoutManager.getDate(TimeoutType.NextGoodMorning).toString()}`);
    } else {
        await logger.log('Bot had to restart... _no good morning timeout scheduled!_');
    }

    // Update the bot's status
    await setStatus(state.isMorning());
});

const processCommands = async (msg: Message): Promise<void> => {
    // Test out hashing of raw text input
    if (msg.content.startsWith('#')) {
        const exists = r9k.contains(msg.content);
        r9k.add(msg.content);
        messenger.reply(msg, `\`${msg.content}\` ${exists ? 'exists' : 'does *not* exist'} in the R9K text bank.`);
        return;
    }
    // Test out language generation
    if (msg.content.startsWith('$')) {
        if (Math.random() < .5) {
            messenger.reply(msg, languageGenerator.generate(msg.content.substring(1), { player: `<@${msg.author.id}>` }));
        } else {
            messenger.send(msg.channel, languageGenerator.generate(msg.content.substring(1), { player: `<@${msg.author.id}>` }));
        }
        return;
    }
    // Handle sanitized commands
    const sanitizedText: string = msg.content.trim().toLowerCase();
    if (hasVideo(msg)) {
        messenger.reply(msg, 'This message has video!');
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
            msg.reply(state.getOrderedPlayers()
                .map((key) => {
                    return ` - <@${key}>: **${state.getPlayerPoints(key)}** (${state.getPlayerDaysSinceLGM(key)}d)` + (state.getPlayerDeductions(key) ? (' -' + state.getPlayerDeductions(key)) : '');
                })
                .join('\n'));
        }
        // Return the state
        else if (sanitizedText.includes('state')) {
            await messenger.sendLargeMonospaced(msg.channel, state.toJson());
        }
        // Return the timeout info
        else if (sanitizedText.includes('timeouts')) {
            guildOwnerDmChannel.send(timeoutManager.toStrings().map(entry => `- ${entry}`).join('\n') || '_No timeouts._');
        }
        // Schedule the next good morning
        else if (sanitizedText.includes('schedule')) {
            if (timeoutManager.hasTimeout(TimeoutType.NextGoodMorning)) {
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
            messenger.reply(msg, `It\'s season **${state.getSeasonNumber()}**, and we're **${Math.floor(100 * state.getSeasonCompletion())}%** complete!`);
        }
        // Canvas stuff
        else if (sanitizedText.includes('canvas')) {
            await msg.channel.sendTyping();
            const attachment = new MessageAttachment(await createMidSeasonUpdateImage(state, {}), 'results.png');
            msg.reply({ files: [attachment] });
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
            let message: string = '';
            const date: Date = getTomorrow();
            for (let i = 0; i < 14; i++) {
                message += `\`${toCalendarDate(date)}\`: \`${JSON.stringify(chooseEvent(date))}\`\n`;
                date.setDate(date.getDate() + 1);
            }
            await msg.reply(message);
        }
        // Return the max score
        else if (sanitizedText.includes('max')) {
            await msg.reply(`The top score is \`${state.getTopScore()}\``);
        }
        // Choose a magic word and show potential recipients
        else if (sanitizedText.includes('magic word')) {
            const magicWord: string = await chooseMagicWord();
            const potentialRecipients: Snowflake[] = state.getPotentialMagicWordRecipients();
            const recipient: string = potentialRecipients.length > 0 ? state.getPlayerDisplayName(randChoice(...potentialRecipients)) : 'N/A';
            await msg.reply(`The test magic word is _${magicWord}_, and send the hint to **${recipient}** (Out of **${potentialRecipients.length}** choices)`);
        }
    }
};

client.on('messageCreate', async (msg: Message): Promise<void> => {
    if (goodMorningChannel && msg.channel.id === goodMorningChannel.id && !msg.author.bot) {
        const userId: Snowflake = msg.author.id;
        const firstMessageThisSeason: boolean = !state.hasPlayer(userId);
        const isAm: boolean = new Date().getHours() < 12;

        // If the grace period is active, then completely ignore all messages
        if (state.isGracePeriod()) {
            return;
        }

        // Using this to test ordering logic. TODO: actually send out updates?
        const beforeOrderings: Snowflake[] = state.getOrderedPlayers();

        // Initialize daily status for the user if it doesn't exist
        state.initializeDailyStatus(userId);

        // Initialize player data if it doesn't exist
        await state.initializePlayer(userId);

        // If this user is the guest reveiller and the morning has not yet begun, wake the bot up
        if (state.getEventType() === DailyEventType.GuestReveille && state.getEvent().reveiller === userId && !state.isMorning() && isAm) {
            await wakeUp(false);
        }

        if (state.isMorning()) {
            // If the event is an anonymous submission day, then completely ignore the message
            if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
                return;
            }

            // Reset user's "days since last good morning" counter
            state.resetDaysSinceLGM(userId);

            // Determine some MF-related conditions
            const messageHasVideo: boolean = hasVideo(msg);
            const triggerMonkeyFriday: boolean = (state.getEventType() === DailyEventType.MonkeyFriday) && messageHasVideo;

            // Messages are "novel" if the text is unique or if the message contains a video (is there a better way to handle attachments?)
            const isNovelMessage: boolean = !r9k.contains(msg.content) || messageHasVideo;

            // Separately award points and reply for monkey friday videos (this lets users post videos after saying good morning)
            if (triggerMonkeyFriday && !state.hasDailyVideoRank(userId)) {
                const videoRank: number = state.getNextDailyVideoRank();
                state.setDailyVideoRank(userId, videoRank);
                // Award MF points and update point-related data
                const pointsEarned: number = config.awardsByRank[videoRank] ?? config.defaultAward;
                state.awardPoints(userId, pointsEarned);
                dumpState();
                // Reply or react to the message depending on the video rank
                if (videoRank === 1) {
                    messenger.reply(msg, languageGenerator.generate('{goodMorningReply.video?} 🐒'));
                } else {
                    reactToMessage(msg, '🐒');
                }
            }
            // In the morning, award the player accordingly if it's their first message...
            if (!state.hasDailyRank(userId)) {
                // Very first thing to do is to update the player's displayName (only do this here since it's pretty expensive)
                state.getPlayer(userId).displayName = await getDisplayName(userId);

                // If it's a "grumpy" morning and no one has said anything yet, punish the player (but don't assign a rank, so player may still say good morning)
                if (state.getEventType() === DailyEventType.GrumpyMorning && !state.getEvent().disabled) {
                    // Deduct points and update point-related data
                    const penalty = 1;
                    state.deductPoints(userId, penalty);
                    state.incrementPlayerPenalties(userId);
                    // Disable the grumpy event and dump the state
                    state.getEvent().disabled = true;
                    dumpState();
                    // React to the user grumpily
                    reactToMessage(msg, '😡');
                    return;
                }

                const rank: number = state.getNextDailyRank();
                state.setDailyRank(userId, rank);

                // If user is first, update the combo state accordingly
                let comboDaysBroken: number = 0;
                let sendComboBrokenMessage: boolean = false;
                let comboBreakee: Snowflake;
                if (rank === 1) {
                    if (state.hasCombo()) {
                        const combo: Combo = state.getCombo();
                        if (combo.user === userId) {
                            // If it's the existing combo holder, then increment his combo counter
                            combo.days++;
                        } else {
                            // Else, reset the combo
                            comboBreakee = combo.user;
                            comboDaysBroken = combo.days;
                            state.setCombo({
                                user: userId,
                                days: 1
                            });
                            // If the broken combo is big enough, then penalize/reward the users involved
                            if (comboDaysBroken >= config.minimumComboDays) {
                                sendComboBrokenMessage = true;
                                // Breakee loses at most 1 point
                                state.deductPoints(comboBreakee, 1);
                                // Breaker is awarded 1 point for each day of the broken combo (and increment their combos broken count)
                                state.awardPoints(userId, comboDaysBroken);
                                state.incrementPlayerCombosBroken(userId);
                            }
                        }
                    } else {
                        state.setCombo({
                            user: userId,
                            days: 1
                        });
                    }
                }

                // If the player said the magic word, reward them and let them know privately
                if (state.hasMagicWord() && msg.content.toLowerCase().includes(state.getMagicWord().toLowerCase())) {
                    state.awardPoints(userId, config.awardsByRank[1]);
                    await messenger.dm(msg.member, `You said _"${state.getMagicWord()}"_, the magic word of the day! Nice 😉`);
                }

                // Compute beckoning bonus and reset the state beckoning property if needed
                const wasBeckoned: boolean = state.getEventType() === DailyEventType.Beckoning && msg.author.id === state.getEvent().beckoning;
                if (wasBeckoned) {
                    state.awardPoints(userId, config.awardsByRank[1]);
                }

                // Update the user's points and dump the state
                const priorPoints: number = state.getPlayerPoints(userId);
                const awarded: number = isNovelMessage ? (config.awardsByRank[rank] ?? config.defaultAward) : config.defaultAward;
                state.awardPoints(userId, awarded);
                dumpState();
                // Add this user's message to the R9K text bank
                r9k.add(msg.content);

                // Get and compare the after orderings. TODO: actually send this out?
                try {
                    const afterOrderings: Snowflake[] = state.getOrderedPlayers();
                    const orderingUpsets: string[] = getOrderingUpset(userId, beforeOrderings, afterOrderings);
                    if (orderingUpsets.length > 0) {
                        const joinedUpsettees = orderingUpsets.map(x => `**${state.getPlayerDisplayName(x)}**`).join(', ');
                        logger.log(`**${state.getPlayerDisplayName(userId)}** has overtaken ${joinedUpsettees}`);
                    }
                } catch (err) {
                    logger.log('Failed to compute ordering upsets: ' + err.message);
                }

                // If it's a combo-breaker, reply with a special message (may result in double replies on Monkey Friday)
                if (sendComboBrokenMessage) {
                    messenger.reply(msg, languageGenerator.generate('{goodMorningReply.comboBreaker?}', { breakee: `<@${comboBreakee}>`, days: comboDaysBroken.toString() }));
                }
                // If this post is NOT a Monkey Friday post, reply as normal (this is to avoid double replies on Monkey Friday)
                else if (!triggerMonkeyFriday) {
                    // If it's the user's first message this season (and we're at least 10% in), reply to them with a special message
                    if (firstMessageThisSeason && state.getSeasonCompletion() > 0.1) {
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
                    // Reply (or react) to the user based on their rank (and chance)
                    else if (rank <= config.goodMorningReplyCount) {
                        if (Math.random() < config.replyViaReactionProbability) {
                            reactToMessage(msg, state.getGoodMorningEmoji());
                        } else {
                            messenger.reply(msg, languageGenerator.generate('{goodMorningReply.standard?}'));
                        }
                    } else {
                        reactToMessage(msg, state.getGoodMorningEmoji());
                    }
                }
            }
        } else {
            // If the bot hasn't woken up yet and it's a reverse GM, react and track the rank of each player for now...
            // TODO: Clean this up! Doesn't even take R9K into account
            if (state.getEventType() === DailyEventType.ReverseGoodMorning && isAm) {
                if (state.getEvent().reverseGMRanks[userId] === undefined) {
                    state.getEvent().reverseGMRanks[userId] = new Date().getTime();
                    reactToMessage(msg, state.getGoodMorningEmoji());
                    dumpState();
                }
                return;
            }

            let pointsDeducted: number = 0;
            // It's not morning, so punish the player accordingly...
            if (state.wasPlayerPenalizedToday(userId)) {
                // Deduct a half point for repeat offenses
                state.deductPoints(userId, 0.5);
            } else {
                // If this is the user's first penalty since last morning, react to the message and deduct one
                state.deductPoints(userId, 1);
                if (isAm) {
                    reactToMessage(msg, '😴');
                } else {
                    reactToMessage(msg, ['😡', '😬', '😒', '😐']);
                }
            }
            // Increment user's penalty count then dump the state
            state.incrementPlayerPenalties(userId);
            dumpState();
            // Reply if the user has hit a certain threshold
            if (state.getPlayerPoints(userId) === -2) {
                messenger.reply(msg, 'Why are you still talking?');
            } else if (state.getPlayerPoints(userId) === -5) {
                messenger.reply(msg, 'You have brought great dishonor to this server...');
            }
        }
    } else if (msg.channel instanceof DMChannel && !msg.author.bot) {
        // Process DM submissions depending on the event
        if (state.isMorning() && state.getEventType() === DailyEventType.AnonymousSubmissions && state.getEvent().submissions) {
            const userId: Snowflake = msg.author.id;
            if (userId in state.getEvent().submissions) {
                await messenger.reply(msg, 'Thanks for the update, I\'ll use this submission instead of your previous one.');
            } else {
                await messenger.reply(msg, 'Thanks for your submission!');
            }
            state.getEvent().submissions[userId] = msg.content;
            dumpState();
        }
        // Process admin commands
        else if (guildOwnerDmChannel && msg.channel.id === guildOwnerDmChannel.id && msg.author.id === guildOwner.id) {
            await processCommands(msg);
        }
    }
});

client.login(auth.token);
