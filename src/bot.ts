import { Client, DMChannel, Intents, MessageAttachment } from 'discord.js';
import { Guild, GuildMember, Message, Snowflake, TextBasedChannels } from 'discord.js';
import { DailyEvent, DailyEventType, GoodMorningConfig, GoodMorningHistory, GoodMorningState, PlayerState, Season, TimeoutType } from './types.js';
import TimeoutManager from './timeout-manager.js';
import { createMidSeasonUpdateImage, createSeasonResultsImage } from './graphics.js';
import { hasVideo, randInt, validateConfig, getTodayDateString, getOrderedPlayers, reactToMessage, getOrderingUpset, sleep, toPointsMap, getLeastRecentPlayers, randChoice, getMonthDayString, getTomorrow } from './util.js';
import processCommands from './admin.js';

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

const getTopScore = (): number => {
    return state.players[getOrderedPlayers(state.players)[0]].points;
};

const advanceSeason = async (): Promise<Season> => {
    // Add new entry for this season
    const newHistoryEntry: Season = {
        season: state.season,
        startedOn: state.startedOn,
        finishedOn: getTodayDateString(),
        points: toPointsMap(state.players),
        goal: state.goal
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
        goal: config.seasonGoal,
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

const chooseEvent = (date: Date): DailyEvent => {
    // Sunday standings recap
    if (date.getDay() === 0) {
        return {
            type: DailyEventType.RecapSunday
        };
    }
    // If this date has a calendar date message override, use that
    const calendarDate: string = getMonthDayString(date); // e.g. "12/25" for xmas
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
    const potentialBeckonees: Snowflake[] = getLeastRecentPlayers(state.players, 5);
    if (potentialBeckonees.length > 0 && Math.random() < 0.2) {
        return {
            type: DailyEventType.Beckoning,
            beckoning: randChoice(...potentialBeckonees)
        };
    }
    // Assign a random guest reveiller
    if (Math.random() < 0.1) {
        const orderedPlayers: Snowflake[] = getOrderedPlayers(state.players);
        const potentialReveillers = orderedPlayers
            // The first-place player cannot be the guest reveiller (and neither can the bottom quarter of players)
            .slice(1, Math.floor(orderedPlayers.length * 0.75))
            // Only players who said good morning today can be reveillers
            .filter((userId) => state.players[userId].daysSinceLastGoodMorning === undefined);

        if (potentialReveillers.length > 0) {
            const guestReveiller: Snowflake = randChoice(...potentialReveillers);
            return {
                type: DailyEventType.GuestReveille,
                reveiller: guestReveiller
            };
        }
    }
};

const sendGoodMorningMessage = async (): Promise<void> => {
    if (goodMorningChannel) {
        switch (state.event?.type) {
        case DailyEventType.RecapSunday:
            // TODO: This logic makes some assumptions... fix it!
            const orderedPlayers: Snowflake[] = getOrderedPlayers(state.players);
            const top: Snowflake = orderedPlayers[0];
            const second: Snowflake = orderedPlayers[1];

            const attachment = new MessageAttachment(await createMidSeasonUpdateImage(state, history.medals), 'results.png');

            // TODO: We definitely should be doing this via parameters in the generation itself...
            await messenger.send(goodMorningChannel, languageGenerator.generate('{weeklyUpdate}')
                .replace(/\$season/g, state.season.toString())
                .replace(/\$top/g, top)
                .replace(/\$second/g, second));
            await goodMorningChannel.send({ files: [attachment] });
            break;
        case DailyEventType.MonkeyFriday:
            await messenger.send(goodMorningChannel, languageGenerator.generate('{happyFriday}'));
            break;
        case DailyEventType.OverriddenMessage:
            await messenger.send(goodMorningChannel, languageGenerator.generate(config.goodMorningMessageOverrides[getMonthDayString(new Date())] ?? '{goodMorning}'));
            break;
        case DailyEventType.Beckoning:
            await messenger.send(goodMorningChannel, languageGenerator.generate('{beckoning.goodMorning?}').replace(/\$player/g, `<@${state.event.beckoning}>`));
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
    const winner: Snowflake = getOrderedPlayers(previousState.players)[0];
    const newSeason: number = previousState.season + 1;
    await messenger.send(channel, `Well everyone, season **${previousState.season}** has finally come to an end!`);
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

const wakeUp = async (sendMessage: boolean): Promise<void> => {
    // Increment "days since last good morning" counters for all participating users
    Object.keys(state.players).forEach((userId) => {
        state.players[userId].daysSinceLastGoodMorning = (state.players[userId].daysSinceLastGoodMorning ?? 0) + 1;
    });

    // Set today's positive react emoji
    state.goodMorningEmoji = config.goodMorningEmojiOverrides[getMonthDayString(new Date())] ?? config.defaultGoodMorningEmoji;

    // Set timeout for when morning ends
    const noonToday: Date = new Date();
    noonToday.setHours(12, 0, 0, 0);
    await timeoutManager.registerTimeout(TimeoutType.NextNoon, noonToday);

    // Update the bot's status to active
    await setStatus(true);

    // Send the good morning message
    if (sendMessage) {
        await sendGoodMorningMessage();
        console.log('Said good morning!');
    }

    // Reset the daily state
    state.isMorning = true;
    state.isGracePeriod = false;
    state.dailyStatus = {};

    // Dump state
    await dumpState();
};

const TIMEOUT_CALLBACKS = {
    [TimeoutType.NextGoodMorning]: async (): Promise<void> => {
        await wakeUp(true);
    },
    [TimeoutType.NextNoon]: async (): Promise<void> => {
        // First, determine if the end of the season has come
        const seasonGoalReached: boolean = getTopScore() >= state.goal;

        // Update basic state properties
        state.isMorning = false;

        // Update current leader property
        const newLeader: Snowflake = getOrderedPlayers(state.players)[0];
        state.currentLeader = state.currentLeader ?? newLeader;
        if (newLeader !== state.currentLeader) {
            const previousLeader = state.currentLeader;
            // If it's not the end of the season, notify the channel of the leader shift
            if (!seasonGoalReached) {
                await messenger.send(goodMorningChannel, languageGenerator.generate('{leaderShift?}')
                    .replace(/\$old/g, `<@${previousLeader}>`)
                    .replace(/\$new/g, `<@${newLeader}>`));
            }
            // Update the state property so it can be compared tomorrow
            state.currentLeader = newLeader;
        }

        // Determine event for tomorrow
        state.event = chooseEvent(getTomorrow());
        if (state.event) {
            // TODO: temporary message to tell admin when a special event has been selected, remove this soon
            await messenger.send(guildOwnerDmChannel, `Event for tomorrow has been selected: \`${JSON.stringify(state.event)}\``);
            // Depending on the type of event chosen for tomorrow, send out a special message
            if (state.event.type === DailyEventType.GuestReveille) {
                await messenger.send(goodMorningChannel, languageGenerator.generate('{reveille.summon}').replace(/\$player/g, `<@${state.event.reveiller}>`));
            }
        }

        // Register timeout for tomorrow's good morning message (depending on the event)
        if (state.event?.type !== DailyEventType.GuestReveille) {
            await registerGoodMorningTimeout();
        }

        // Dump state and R9K hashes
        await dumpState();
        await dumpR9KHashes();

        // If anyone's score is above the season goal, then proceed to the next season
        if (seasonGoalReached) {
            const previousState: GoodMorningState = state;
            await advanceSeason();
            await sendSeasonEndMessages(goodMorningChannel, previousState);
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
        if (state.goal === undefined) {
            state.goal = config.seasonGoal;
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
                goal: config.seasonGoal,
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

    // Register the next good morning callback if it doesn't exist (and if not waiting on a guest reveille)
    if (!timeoutManager.hasTimeout(TimeoutType.NextGoodMorning) && state.event?.type !== DailyEventType.GuestReveille) {
        console.log('Found no existing timeout for the next good morning, so registering a new one...');
        await registerGoodMorningTimeout();
    }

    await guildOwnerDmChannel?.send(`Bot had to restart... next date is ${timeoutManager.getDate(TimeoutType.NextGoodMorning).toString()}`);

    // Update the bot's status
    await setStatus(state.isMorning);
});

client.on('messageCreate', async (msg: Message): Promise<void> => {
    if (guildOwnerDmChannel && msg.channel.id === guildOwnerDmChannel.id && msg.author.id === guildOwner.id) {
        // TODO: move this to the admin file
        if (msg.content === 'event?') {
            let message: string = '';
            const date: Date = getTomorrow();
            for (let i = 0; i < 14; i++) {
                message += `\`${getMonthDayString(date)}\`: \`${JSON.stringify(chooseEvent(date))}\`\n`;
                date.setDate(date.getDate() + 1);
            }
            await msg.reply(message);
        }
        // Handle "commands" by looking for keywords
        await processCommands(msg, state, messenger, languageGenerator, r9k);
    } else if (goodMorningChannel && msg.channel.id === goodMorningChannel.id && !msg.author.bot) {
        const userId: Snowflake = msg.author.id;
        const firstMessageThisSeason: boolean = !(userId in state.players);
        const isAm: boolean = new Date().getHours() < 12;

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
                points: 0
            };
        }
        const player: PlayerState = state.players[userId];

        // If this user is the guest reveiller and the morning has not yet begun, wake the bot up
        if (state.event?.reveiller === userId && !state.isMorning && isAm) {
            await wakeUp(false);
        }

        if (state.isMorning) {
            // Reset user's "days since last good morning" counter
            delete player.daysSinceLastGoodMorning;

            const isNovelMessage: boolean = !r9k.contains(msg.content);
            // TODO: Use the state.event property instead of computing this here...
            const isFriday: boolean = (new Date()).getDay() === 5;
            const messageHasVideo: boolean = hasVideo(msg);
            const triggerMonkeyFriday: boolean = isFriday && messageHasVideo;
            // Separately award points and reply for monkey friday videos (this lets users post videos after saying good morning)
            if (triggerMonkeyFriday && state.dailyStatus[userId].videoRank === undefined) {
                const videoRank = Object.values(state.dailyStatus).filter(x => x.videoRank !== undefined).length + 1;
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
            if (state.dailyStatus[userId].rank === undefined) {
                // Very first thing to do is to update the player's displayName (only do this here since it's pretty expensive)
                state.players[userId].displayName = await getDisplayName(userId);

                const rank: number = Object.keys(state.dailyStatus).length;
                state.dailyStatus[userId].rank = rank;

                // If user is first, update the combo state accordingly
                let comboDaysBroken: number = 0;
                let comboBreakingPoints: number = 0;
                let comboBreakee: Snowflake;
                if (rank === 1) {
                    if (state.combo) {
                        if (state.combo.user === userId) {
                            // If it's the existing combo holder, then increment his combo counter
                            state.combo.days++;
                        } else {
                            // Else, reset the combo
                            comboBreakee = state.combo.user;
                            comboDaysBroken = state.combo.days;
                            state.combo = {
                                user: userId,
                                days: 1
                            };
                            // If the broken combo is big enough, then penalize/reward the users involved
                            if (comboDaysBroken >= config.minimumComboDays) {
                                // Breakee loses at most 1 point
                                state.players[comboBreakee].points--;
                                // Breaker is awarded 1 point for each day of the broken combo (and increment their combos broken count)
                                comboBreakingPoints = comboDaysBroken;
                                state.players[userId].combosBroken = (state.players[userId].combosBroken ?? 0) + 1;
                            }
                        }
                    } else {
                        state.combo = {
                            user: userId,
                            days: 1
                        };
                    }
                }

                // Compute beckoning bonus and reset the state beckoning property if needed
                const wasBeckoned: boolean = msg.author.id === state.event?.beckoning;
                const beckonedBonus: number = wasBeckoned ? config.awardsByRank[1] : 0;

                // Update the user's points and dump the state
                const priorPoints: number = player.points || 0;
                const awarded: number = isNovelMessage ? (config.awardsByRank[rank] ?? config.defaultAward) : config.defaultAward;
                // TODO: This number doesn't take into account monkey friday points. Remove?
                const pointsEarned: number = awarded + comboBreakingPoints + beckonedBonus;
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
                        guildOwnerDmChannel.send(`<@${userId}> has overtaken ${joinedUpsettees}`);
                    }
                } catch (err) {
                    guildOwnerDmChannel.send('Failed to compute ordering upsets: ' + err.message);
                }

                // If it's a combo-breaker, reply with a special message (may result in double replies on Monkey Friday)
                if (comboBreakingPoints > 0) {
                    messenger.reply(msg, languageGenerator.generate('{goodMorningReply.comboBreaker?}')
                        .replace(/\$breakee/g, `<@${comboBreakee}>`)
                        .replace(/\$days/g, comboDaysBroken.toString()));
                }
                // If this post is NOT a Monkey Friday post, reply as normal (this is to avoid double replies on Monkey Friday)
                else if (!triggerMonkeyFriday) {
                    // If it's the user's first message this season, reply to them with a special message
                    if (firstMessageThisSeason) {
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
                if (isAm) {
                    reactToMessage(msg, '😴');
                } else {
                    reactToMessage(msg, ['😡', '😬', '😒', '😐']);
                }
            }
            player.points -= pointsDeducted;
            state.dailyStatus[userId].pointsEarned -= pointsDeducted;
            // Increment user's penalty count then dump the state
            state.players[userId].penalties = (state.players[userId].penalties ?? 0) + 1;
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
