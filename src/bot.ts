import { Client, DMChannel, Intents, MessageAttachment } from 'discord.js';
import { Guild, GuildMember, Message, Snowflake, TextBasedChannels } from 'discord.js';
import { GoodMorningConfig, GoodMorningHistory, GoodMorningState, PlayerState, Season, TimeoutType } from './types.js';
import TimeoutManager from './timeout-manager.js';
import { createSeasonResultsImage } from './graphics.js';
import { hasVideo, generateKMeansClusters, randInt, validateConfig, getTodayDateString, getOrderedPlayers, reactToMessage, getOrderingUpset, getOrderingUpsets, sleep, toPointsMap } from './util.js';

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

// Tuples of (user ID, points)
const getTopPlayers = (n: number): any[][] => {
    return Object.entries(state.players)
        .sort((x, y) => y[1].points - x[1].points)
        .slice(0, n);
};

const getTopScore = (): number => {
    return getTopPlayers(1)[0][1];
};

const advanceSeason = async (): Promise<Season> => {
    // Add new entry for this season
    const newHistoryEntry: Season = {
        season: state.season,
        startedOn: state.startedOn,
        finishedOn: getTodayDateString(),
        points: toPointsMap(state.players),
        goal: config.seasonGoal
    };
    history.seasons.push(newHistoryEntry);
    // Compute medals
    const orderedUserIds = getOrderedPlayers(state.players);
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
        await guildOwnerDmChannel.send(`The final state of season **${state.season}** before it's wiped:`);
        await messenger.sendLargeMonospaced(guildOwnerDmChannel, JSON.stringify(state, null, 2));
    }
    // Reset the state
    const nextSeason: number = state.season + 1;
    state = {
        season: nextSeason,
        startedOn: getTodayDateString(),
        isMorning: false,
        isGracePeriod: true,
        goodMorningEmoji: config.defaultGoodMorningEmoji,
        dailyStatus: {},
        players: {}
    };
    // Dump the state and history
    await dumpState();
    await dumpHistory();

    return newHistoryEntry;
};

const sendGoodMorningMessage = async (calendarDate: string): Promise<void> => {
    if (goodMorningChannel) {
        const now: Date = new Date();

        // Handle dates with specific good morning message overrides specified in the config
        if (calendarDate in config.goodMorningMessageOverrides) {
            await messenger.send(goodMorningChannel, languageGenerator.generate(config.goodMorningMessageOverrides[calendarDate]));
            return;
        }

        // For all other days, handle based on the day of the week
        switch (now.getDay()) {
        case 0: // Sunday
            // TODO: This logic makes some assumptions... fix it!
            const top: any[] = getTopPlayers(1)[0];
            const second: any[] = getTopPlayers(2)[1];
            // TODO: We definitely should be doing this via parameters in the generation itself...
            await messenger.send(goodMorningChannel, languageGenerator.generate('{weeklyUpdate}')
                .replace('$season', state.season.toString())
                .replace('$top', top[0])
                .replace('$second', second[0]));
            break;
        case 5: // Friday
            await messenger.send(goodMorningChannel, languageGenerator.generate('{happyFriday}'));
            break;
        default: // Other days
            if (Math.random() < config.goodMorningMessageProbability) {
                await messenger.send(goodMorningChannel, languageGenerator.generate('{goodMorning}'));
            }
            break;
        }
    }
};

const sendSeasonEndMessages = async (channel: TextBasedChannels, previousSeason: Season, winner: Snowflake): Promise<void> => {
    const newSeason: number = previousSeason.season + 1;
    await messenger.send(channel, `Well everyone, season **${previousSeason.season}** has finally come to an end!`);
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
    const attachment = new MessageAttachment(await createSeasonResultsImage(previousSeason, history.medals, getDisplayName), 'results.png');
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
    const MAX_HOUR_EXCLUSIVE: number = 11;

    const morningTomorrow: Date = new Date();
    // Set date as tomorrow if it's after the earliest possible morning time
    if (morningTomorrow.getHours() >= MIN_HOUR) {
        morningTomorrow.setDate(morningTomorrow.getDate() + 1);
    }
    // Set time as sometime between 7am and 10am
    morningTomorrow.setHours(randInt(MIN_HOUR, MAX_HOUR_EXCLUSIVE), randInt(0, 60), randInt(0, 60));

    await timeoutManager.registerTimeout(TimeoutType.NextGoodMorning, morningTomorrow);
};

const TIMEOUT_CALLBACKS = {
    [TimeoutType.NextGoodMorning]: async (): Promise<void> => {
        // Increment "days since last good morning" counters for all participating users
        Object.keys(state.players).forEach((userId) => {
            state.players[userId].daysSinceLastGoodMorning++;
        });

        // Set today's positive react emoji
        const now: Date = new Date();
        const calendarDate: string = `${now.getMonth() + 1}/${now.getDate()}`; // e.g. "12/25" for xmas
        state.goodMorningEmoji = config.goodMorningEmojiOverrides[calendarDate] ?? config.defaultGoodMorningEmoji;

        // Set timeout for when morning ends
        const noonToday: Date = new Date();
        noonToday.setHours(12, 0, 0, 0);
        await timeoutManager.registerTimeout(TimeoutType.NextNoon, noonToday);

        // Register timeout for tomorrow's good morning message
        await registerGoodMorningTimeout();

        // Update the bot's status to active
        await setStatus(true);

        // Send the good morning message
        await sendGoodMorningMessage(calendarDate);

        // Reset the daily state
        state.isMorning = true;
        state.isGracePeriod = false;
        state.dailyStatus = {};

        // Dump state
        await dumpState();

        console.log('Said good morning!');
    },
    [TimeoutType.NextNoon]: async (): Promise<void> => {
        // Update basic state properties
        state.isMorning = false;

        // Update current leader property (and notify if anything has changed)
        const newLeader = getTopPlayers(1)[0][0];
        state.currentLeader = state.currentLeader || newLeader;
        if (newLeader !== state.currentLeader) {
            const previousLeader = state.currentLeader;
            await messenger.send(goodMorningChannel, languageGenerator.generate('{leaderShift?}')
                .replace(/\$old/g, `<@${previousLeader}>`)
                .replace(/\$new/g, `<@${newLeader}>`));
            state.currentLeader = newLeader;
        }

        // Dump state and R9K hashes
        await dumpState();
        await dumpR9KHashes();

        // If anyone's score is above the season goal, then proceed to the next season
        if (getTopScore() >= config.seasonGoal) {
            const previousSeason: Season = await advanceSeason();
            await sendSeasonEndMessages(goodMorningChannel, previousSeason, newLeader);
        }

        // Update the bot's status
        await setStatus(false);
    }
};

const timeoutManager = new TimeoutManager(storage, TIMEOUT_CALLBACKS);

const loadState = async (): Promise<void> => {
    try {
        state = await storage.readJson('state');
        // Temporary logic to initialize newly introduced properties
        if (state.players === undefined) {
            state.players = {};
        }
        if (state.goodMorningEmoji === undefined) {
            state.goodMorningEmoji = config.defaultGoodMorningEmoji;
        }
        if (state['points']) {
            delete state['points'];
        }
        if (state['daysSinceLastGoodMorning']) {
            delete state['daysSinceLastGoodMorning'];
        }
    } catch (err) {
        // Specifically check for file-not-found errors to make sure we don't overwrite anything
        if (err.code === 'ENOENT') {
            console.log('Existing state file not found, creating a fresh state...');
            state = {
                season: 1,
                startedOn: getTodayDateString(),
                isMorning: false,
                isGracePeriod: true,
                goodMorningEmoji: config.defaultGoodMorningEmoji,
                dailyStatus: {},
                players: {}
            };
            await dumpState();
        } else if (guildOwnerDmChannel) {
            guildOwnerDmChannel.send(`Unhandled exception while loading state file:\n\`\`\`${err.message}\`\`\``);
        }
    }
};

const dumpState = async (): Promise<void> => {
    await storage.write('state', JSON.stringify(state, null, 2));
};

const loadHistory = async (): Promise<void> => {
    try {
        history = await storage.readJson('history');
    } catch (err) {
        // Specifically check for file-not-found errors to make sure we don't overwrite anything
        if (err.code === 'ENOENT') {
            console.log('Existing history file not found, creating a fresh history...');
            history = {
                seasons: [],
                medals: {}
            };
            await dumpHistory();
        } else if (guildOwnerDmChannel) {
            guildOwnerDmChannel.send(`Unhandled exception while loading history file:\n\`\`\`${err.message}\`\`\``);
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
            console.log('Existing R9K hashes file not found, starting with a fresh text bank...');
            await dumpR9KHashes();
        } else if (guildOwnerDmChannel) {
            guildOwnerDmChannel.send(`Unhandled exception while loading R9K hashes file:\n\`\`\`${err.message}\`\`\``);
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
        languageGenerator.setEmergencyLogChannel(guildOwnerDmChannel);
        console.log(`Determined guild owner: ${guildOwner.displayName}`);
    } else {
        console.log('Could not determine the guild\'s owner!');
    }

    // Attempt to load the good morning channel (abort if not successful)
    try {
        goodMorningChannel = (await client.channels.fetch(config.goodMorningChannelId)) as TextBasedChannels;
    } catch (err) {}
    if (!goodMorningChannel) {
        console.log(`Couldn't load good morning channel with Id "${config.goodMorningChannelId}", aborting...`);
        process.exit(1);
    }
    console.log(`Found good morning channel as ${goodMorningChannel.id}`);

    // Load all necessary data from disk
    await loadState();
    await loadHistory();
    await loadR9KHashes();
    await timeoutManager.loadTimeouts();

    // Register the next good morning callback if it doesn't exist
    if (!timeoutManager.hasTimeout(TimeoutType.NextGoodMorning)) {
        console.log('Found no existing timeout for the next good morning, so registering a new one...');
        await registerGoodMorningTimeout();
    }

    if (guildOwnerDmChannel) {
        guildOwnerDmChannel.send(`Bot had to restart... next date is ${timeoutManager.getDate(TimeoutType.NextGoodMorning).toString()}`);
    }

    // Update the bot's status
    setStatus(state.isMorning);
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
            messenger.reply(msg, languageGenerator.generate(msg.content.substring(1)));
        } else {
            messenger.send(msg.channel, languageGenerator.generate(msg.content.substring(1)));
        }
        return;
    }
    if (msg.content.startsWith('^')) {
        const sanitized = msg.content.substring(1).trim();
        const [before, after] = sanitized.split(' ');
        messenger.reply(msg, JSON.stringify(getOrderingUpsets(before.split(','), after.split(','))));
    }
    // Handle sanitized commands
    const sanitizedText: string = msg.content.trim().toLowerCase();
    if (hasVideo(msg)) {
        messenger.reply(msg, 'This message has video!');
    }
    if (sanitizedText.includes('?')) {
        if (sanitizedText.includes('clusters')) {
            // msg.reply(JSON.stringify(generateKMeansClusters(state.points, 3)));
            const k: number = parseInt(sanitizedText.split(' ')[0]);
            msg.reply(JSON.stringify(generateKMeansClusters(toPointsMap(state.players), k)));
        }
        else if (sanitizedText.includes('order') || sanitizedText.includes('rank') || sanitizedText.includes('winning') || sanitizedText.includes('standings')) {
            msg.reply(getOrderedPlayers(state.players)
                .map((key) => {
                    return ` - <@${key}>: **${state.players[key].points}** (${state.players[key].daysSinceLastGoodMorning}d)`;
                })
                .join('\n'));
        }
        else if (sanitizedText.includes('dump state')) {
            await dumpState();
        }
        else if (sanitizedText.includes('state')) {
            await messenger.sendLargeMonospaced(guildOwnerDmChannel, JSON.stringify(state, null, 2));
        }
        // Asking about points
        else if (sanitizedText.includes('points')) {
            const points: number = state.players[msg.author.id]?.points ?? 0;
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
        // Send mock season end messages
        else if (sanitizedText.includes('season end')) {
            const mockSeason: Season = {
                season: state.season,
                startedOn: state.startedOn,
                finishedOn: getTodayDateString(),
                points: toPointsMap(state.players),
                goal: config.seasonGoal
            };
            await sendSeasonEndMessages(guildOwnerDmChannel, mockSeason, guildOwner.id);
        }
        // Asking about the season
        else if (sanitizedText.includes('season')) {
            messenger.reply(msg, `It\'s season **${state.season}**!`);
        }
        // Canvas stuff
        else if (sanitizedText.includes("canvas")) {
            await msg.channel.sendTyping();
            const attachment = new MessageAttachment(await createSeasonResultsImage({
                    startedOn: state.startedOn,
                    finishedOn: getTodayDateString(),
                    goal: config.seasonGoal,
                    points: toPointsMap(state.players),
                    season: state.season
                }, history.medals, getDisplayName),
                'results.png');
            msg.reply({ files: [attachment] });
        }
        else if (sanitizedText.includes('react')) {
            await reactToMessage(msg, ['🌚', '❤️', '☘️', '🌞']);
        }
    }
};

client.on('messageCreate', async (msg: Message): Promise<void> => {
    if (guildOwnerDmChannel && msg.channel.id === guildOwnerDmChannel.id && msg.author.id === guildOwner.id) {
        // Handle "commands" by looking for keywords
        await processCommands(msg);
    } else if (goodMorningChannel && msg.channel.id === goodMorningChannel.id && !msg.author.bot) {
        const userId: Snowflake = msg.author.id;

        // If the grace period is active, then completely ignore all messages
        if (state.isGracePeriod) {
            return;
        }

        // Using this to test ordering logic. TODO: actually send out updates?
        const beforeOrderings: Snowflake[] = getOrderedPlayers(state.players);

        // Initialize daily status for the user if it doesn't exist
        if (!(userId in state.dailyStatus)) {
            state.dailyStatus[userId] = {
                pointsEarned: 0
            };
        }

        // Initialize player data if it doesn't exist
        if (state.players[userId] === undefined) {
            state.players[userId] = {
                displayName: await getDisplayName(userId),
                points: 0,
                penalties: 0,
                daysSinceLastGoodMorning: 0
            };
        }
        const player: PlayerState = state.players[userId];

        if (state.isMorning) {
            // Reset user's "days since last good morning" counter
            player.daysSinceLastGoodMorning = 0;

            const isNovelMessage: boolean = !r9k.contains(msg.content);
            const isFriday: boolean = (new Date()).getDay() === 5;
            const messageHasVideo: boolean = hasVideo(msg);
            const triggerMonkeyFriday: boolean = isFriday && messageHasVideo;
            // Separately award points and reply for monkey friday videos (this lets users post videos after saying good morning)
            if (triggerMonkeyFriday && !state.dailyStatus[userId].hasSentVideo) {
                state.dailyStatus[userId].hasSentVideo = true;
                const videoRank = Object.values(state.dailyStatus).filter(x => x.hasSentVideo).length;
                state.dailyStatus[userId].videoRank = videoRank;
                const priorPoints: number = player.points || 0;
                player.points = priorPoints + (config.awardsByRank[videoRank] ?? config.defaultAward);
                dumpState();
                // Reply or react to the message depending on the video rank
                if (videoRank === 1) {
                    messenger.reply(msg, languageGenerator.generate('{goodMorningReply.video?} 🐒'));
                } else {
                    reactToMessage(msg, '🐒');
                }
            }
            // In the morning, award the player accordingly if it's their first message...
            if (!state.dailyStatus[userId].hasSaidGoodMorning) {
                // Very first thing to do is to update the player's displayName (only do this here since it's pretty expensive)
                state.players[userId].displayName = await getDisplayName(userId);

                const rank: number = Object.keys(state.dailyStatus).length;
                state.dailyStatus[userId].rank = rank;
                state.dailyStatus[userId].hasSaidGoodMorning = true;

                let comboDaysBroken: number = 0;
                let comboBreakee: Snowflake;
                if (rank === 1) {
                    if (state.combo) {
                        if (state.combo.user === userId) {
                            state.combo.days++;
                        } else {
                            comboDaysBroken = state.combo.days;
                            comboBreakee = state.combo.user;
                            state.combo = {
                                user: userId,
                                days: 1
                            };
                            // Penalize the combo breakee for losing his combo
                            if (comboDaysBroken > 1) {
                                state.players[comboBreakee].points--;
                            }
                        }
                    } else {
                        state.combo = {
                            user: userId,
                            days: 1
                        };
                    }
                }
                // Update the user's points and dump the state
                const priorPoints: number = player.points || 0;
                const awarded: number = isNovelMessage ? (config.awardsByRank[rank] ?? config.defaultAward) : config.defaultAward;
                // TODO: This number doesn't take into account monkey friday points. Remove?
                const pointsEarned: number = awarded + comboDaysBroken;
                player.points = priorPoints + pointsEarned;
                state.dailyStatus[userId].pointsEarned += pointsEarned;
                dumpState();
                // Add this user's message to the R9K text bank
                r9k.add(msg.content);

                // Get and compare the after orderings. TODO: actually send this out?
                try {
                    const afterOrderings: Snowflake[] = getOrderedPlayers(state.players);
                    const orderingUpsets: string[] = getOrderingUpset(userId, beforeOrderings, afterOrderings);
                    if (orderingUpsets.length > 0) {
                        const joinedUpsettees = orderingUpsets.map(x => `<@${x}>`).join(', ');
                        messenger.send(guildOwnerDmChannel, `<@${userId}> has overtaken ${joinedUpsettees}`);
                    }
                } catch (err) {
                    messenger.send(guildOwnerDmChannel, 'Failed to compute ordering upsets: ' + err.message);
                }

                // If it's a combo-breaker, reply with a special message (may result in double replies on Monkey Friday)
                if (comboDaysBroken > 1) {
                    messenger.reply(msg, languageGenerator.generate('{goodMorningReply.comboBreaker?}')
                        .replace(/\$breakee/g, `<@${comboBreakee}>`)
                        .replace(/\$days/g, comboDaysBroken.toString()));
                }
                // If this post is NOT a Monkey Friday post, reply as normal (this is to avoid double replies on Monkey Friday)
                else if (!triggerMonkeyFriday) {
                    // If it's the user's first message this season, reply to them with a special message
                    const firstMessageThisSeason: boolean = !(userId in state.players);
                    if (firstMessageThisSeason) {
                        messenger.reply(msg, languageGenerator.generate('{goodMorningReply.new?}'));
                    }
                    // Message was unoriginal, so reply (or react) to indicate unoriginal
                    else if (!isNovelMessage) {
                        if (rank === 1) {
                            messenger.reply(msg, languageGenerator.generate('{goodMorningReply.unoriginal?} 🌚'));
                        } else {
                            reactToMessage(msg, '🌚');
                        }
                    }
                    // Reply (or react) to the user based on how many points they had
                    else if (rank <= config.goodMorningReplyCount) {
                        if (Math.random() < config.replyViaReactionProbability) {
                            reactToMessage(msg, state.goodMorningEmoji);
                        } else if (priorPoints < 0) {
                            messenger.reply(msg, languageGenerator.generate('{goodMorningReply.negative?}'));
                        } else {
                            messenger.reply(msg, languageGenerator.generate('{goodMorningReply.standard?}'));
                        }
                    } else {
                        reactToMessage(msg, state.goodMorningEmoji);
                    }
                }
            }
        } else {
            let pointsDeducted: number = 0;
            // It's not morning, so punish the player accordingly...
            if (state.dailyStatus[userId].penalized) {
                // Deduct a half point for repeat offenses
                pointsDeducted = 0.5;
            } else {
                // If this is the user's first penalty since last morning, react to the message and deduct one
                pointsDeducted = 1;
                state.dailyStatus[userId].penalized = true;
                if (new Date().getHours() < 12) {
                    reactToMessage(msg, '😴');
                } else {
                    reactToMessage(msg, ['😡', '😬', '😒', '😐']);
                }
            }
            player.points -= pointsDeducted;
            state.dailyStatus[userId].pointsEarned -= pointsDeducted;
            // Increment user's penalty count then dump the state
            state.players[userId].penalties++;
            dumpState();
            // Reply if the user has hit a certain threshold
            if (player.points === -5) {
                messenger.reply(msg, 'Why are you still talking?');
            } else if (player.points === -10) {
                messenger.reply(msg, 'You have brought great dishonor to this server...');
            }
        }
    }
});

client.login(auth.token);
