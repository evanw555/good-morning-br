import { Client, DMChannel, Intents } from 'discord.js';
import TimeoutManager from './timeout-manager.js';
import { Guild, GuildMember, Message, Snowflake, TextBasedChannels } from 'discord.js';
import { GoodMorningConfig, GoodMorningHistory, GoodMorningState, Season, TimeoutType } from './types.js';

import { loadJson } from './load-json.js';
const auth = loadJson('config/auth.json');
const config: GoodMorningConfig = loadJson('config/config.json');

import FileStorage from './file-storage.js';
const storage = new FileStorage('./data/');

import LanguageGenerator from './language-generator.js';
import { generateKMeansClusters, randChoice, randInt, validateConfig } from './util.js';
const languageConfig = loadJson('config/language.json');
const languageGenerator = new LanguageGenerator(languageConfig);

const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.DIRECT_MESSAGES
    ]
});

let goodMorningChannel: TextBasedChannels;
let guildOwner: GuildMember;
let guildOwnerDmChannel: DMChannel;

let state: GoodMorningState;
let history: GoodMorningHistory;

// Tuples of (user ID, points)
const getTopPlayers = (n: number): any[][] => {
    return Object.entries(state.points)
        .sort((x, y) => y[1] - x[1])
        .slice(0, n);
};

const getTopScore = (): number => {
    return getTopPlayers(1)[0][1];
};

const advanceSeason = async (winner: Snowflake): Promise<void> => {
    // Add new entry for this season
    const newHistoryEntry: Season = {
        season: state.season,
        finishedAt: new Date().toJSON(),
        points: state.points
    };
    history.seasons.push(newHistoryEntry);
    // Award the winner a chicken dinner
    if (history.dinners === undefined) {
        history.dinners = {};
    }
    if (history.dinners[winner] === undefined) {
        history.dinners[winner] = 0;
    }
    history.dinners[winner]++;
    // Reset the state
    state.season++;
    state.points = {};
    // Dump the state and history
    await dumpState();
    await dumpHistory();
};

const sendGoodMorningMessage = async (): Promise<void> => {
    if (goodMorningChannel) {
        const now: Date = new Date();
        switch (now.getDay()) {
        case 0: // Sunday
            // TODO: This logic makes some assumptions... fix it!
            const top: any[] = getTopPlayers(1)[0];
            const second: any[] = getTopPlayers(2)[1];
            // TODO: We definitely should be doing this via parameters in the generation itself...
            goodMorningChannel.send(languageGenerator.generate('{weeklyUpdate}')
                .replace('$season', state.season.toString())
                .replace('$top', top[0])
                .replace('$second', second[0]));
            break;
        case 5: // Friday
            goodMorningChannel.send(languageGenerator.generate('{happyFriday}'));
            break;
        default: // Other days
            if (Math.random() < config.goodMorningMessageProbability) {
                goodMorningChannel.send(languageGenerator.generate('{goodMorning}'));
            }
            break;
        }
    }
}

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
        // Update and dump state
        state.isMorning = true;
        state.dailyStatus = {};
        await dumpState();

        // Set timeout for when morning ends
        const noonToday: Date = new Date();
        noonToday.setHours(12, 0, 0, 0);
        await timeoutManager.registerTimeout(TimeoutType.NextNoon, noonToday);

        // Register timeout for tomorrow's good morning message
        await registerGoodMorningTimeout();

        // Update the bot's status to active
        await setStatus(true);

        // Send the good morning message
        await sendGoodMorningMessage();

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
            goodMorningChannel.send(languageGenerator.generate('{leaderShift?}')
                .replace(/\$old/g, `<@${previousLeader}>`)
                .replace(/\$new/g, `<@${newLeader}>`));
            state.currentLeader = newLeader;
        }

        // Dump state
        await dumpState();

        // Update the bot's status
        await setStatus(false);

        // If anyone's score is above the season goal, then proceed to the next season
        if (getTopScore() >= config.seasonGoal) {
            const prevSeason: number = state.season;
            const winner: Snowflake = getTopPlayers(1)[0][0];
            await advanceSeason(winner);
            const numWins: number = history.dinners[winner];
            // TODO: Better message
            let messageText: string = `It's the end of season **${prevSeason}**, and <@${winner}> is `
                + `the Good Morning king with **${numWins}** win${numWins > 1 ? 's' : ''}!`;
            const top: any[][] = getTopPlayers(3);
            if (top.length >= 1) {
                messageText += `\n\n🥇 <@${top[0][0]}>`;
            }
            if (top.length >= 2) {
                messageText += `\n🥈 <@${top[1][0]}>`;
            }
            if (top.length >= 3) {
                messageText += `\n🥉 <@${top[2][0]}>`;
            }
            goodMorningChannel.send(messageText);
        }
    }
};

const timeoutManager = new TimeoutManager(storage, TIMEOUT_CALLBACKS);

const loadState = async (): Promise<void> => {
    try {
        state = await storage.readJson('state');
    } catch (err) {
        // Specifically check for file-not-found errors to make sure we don't overwrite anything
        if (err.code === 'ENOENT') {
            console.log('Existing state file not found, creating a fresh state...');
            state = {
                season: 1,
                isMorning: false,
                dailyStatus: {},
                points: {}
            };
            await dumpState();
        } else if (guildOwnerDmChannel) {
            guildOwnerDmChannel.send(`Unhandled exception while loading state file:\n\`\`\`${err.message}\`\`\``);
        }
    }
};

const dumpState = async (): Promise<void> => {
    await storage.write('state', JSON.stringify(state, null, 2));
    console.log(`Dumped state as ${JSON.stringify(state)}`);
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
                dinners: {}
            };
            await dumpHistory();
        } else if (guildOwnerDmChannel) {
            guildOwnerDmChannel.send(`Unhandled exception while loading history file:\n\`\`\`${err.message}\`\`\``);
        }
    }
};

const dumpHistory = async (): Promise<void> => {
    await storage.write('history', JSON.stringify(history, null, 2));
    console.log(`Dumped history as ${JSON.stringify(history)}`);
};

client.on('ready', async (): Promise<void> => {
    // First, validate the config file to ensure it conforms to the schema
    validateConfig(config);

    // Then, fetch the guilds and guild channels
    await client.guilds.fetch();
    const guild: Guild = client.guilds.cache.first();
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
    setStatus(false);
});

const processCommands = async (msg: Message): Promise<void> => {
    const sanitizedText: string = msg.content.trim().toLowerCase();
    if (msg.attachments?.some(x => x.contentType.includes('video/')) || msg.embeds?.some(x => x.video)) {
        msg.reply('This message has video!');
    }
    if (sanitizedText.includes('?')) {
        if (sanitizedText.includes('clusters')) {
            // msg.reply(JSON.stringify(generateKMeansClusters(state.points, 3)));
            const k: number = parseInt(sanitizedText.split(' ')[0]);
            msg.reply(JSON.stringify(generateKMeansClusters(state.points, k)));
        }
        if (sanitizedText.includes('order')) {
            msg.reply(Object.keys(state.points).map((key) => {
                return ` - <@${key}>: ${state.points[key]}`;
            }).join('\n'));
        }
        if (sanitizedText.includes('state')) {
            msg.reply(`\`\`\`${JSON.stringify(state, null, 2)}\`\`\``);
        }
        // Asking about points
        else if (sanitizedText.includes('points')) {
            const points: number = state.points[msg.author.id] || 0;
            if (points < 0) {
                msg.reply(`You have **${points}** points this season... bro...`);
            } else if (points === 0) {
                msg.reply(`You have no points this season`);
            } else if (points === 1) {
                msg.reply(`You have **1** point this season`);
            } else {
                msg.reply(`You have **${points}** points this season`);
            }
        }
        // Asking about rankings
        else if (sanitizedText.includes('rank') || sanitizedText.includes('winning') || sanitizedText.includes('standings')) {
            const top: any[][] = getTopPlayers(3);
            let replyText: string = '';
            if (top.length >= 1) {
                replyText += `<@${top[0][0]}> is in first with **${top[0][1]}** points`;
            }
            if (top.length >= 2) {
                replyText += `, then <@${top[1][0]}> with **${top[1][1]}** points`;
            }
            if (top.length >= 3) {
                replyText += `, and finally <@${top[2][0]}> with **${top[2][1]}** points`;
            }
            msg.reply(replyText);
        }
        // Asking about the season
        else if (sanitizedText.includes('season')) {
            msg.reply(`It\'s season **${state.season}**!`);
        }
    }
};

client.on('messageCreate', async (msg: Message): Promise<void> => {
    if (guildOwnerDmChannel && msg.channel.id === guildOwnerDmChannel.id && msg.author.id === guildOwner.id) {
        // Handle "commands" by looking for keywords
        await processCommands(msg);
    } else if (goodMorningChannel && msg.channel.id === goodMorningChannel.id && !msg.author.bot) {
        // Initialize daily status for the user if it doesn't exist
        if (!(msg.author.id in state.dailyStatus)) {
            state.dailyStatus[msg.author.id] = {};
        }

        if (state.isMorning) {
            const isFriday: boolean = (new Date()).getDay() === 5;
            const messageHasVideo: boolean = msg.attachments?.some(x => x.contentType.includes('video/')) || msg.embeds?.some(x => x.video);
            const triggerMonkeyFriday: boolean = isFriday && messageHasVideo;
            // Separately award points and reply for monkey friday attachments (this lets users post videos after saying good morning)
            if (triggerMonkeyFriday && !state.dailyStatus[msg.author.id].hasSentAttachment) {
                state.dailyStatus[msg.author.id].hasSentAttachment = true;
                const attachmentRank = Object.values(state.dailyStatus).filter(x => x.hasSentAttachment).length;
                state.dailyStatus[msg.author.id].attachmentRank = attachmentRank;
                const priorPoints: number = state.points[msg.author.id] || 0;
                state.points[msg.author.id] = priorPoints + Math.max(5 - attachmentRank, 1);
                dumpState();
                // Reply or react to the message depending on the attachment rank
                if (attachmentRank === 1) {
                    msg.reply(languageGenerator.generate('{goodMorningReply.attachment?} 🐒'));
                } else {
                    msg.react('🐒');
                }
            }
            // In the morning, award the player accordingly if it's their first message...
            if (!state.dailyStatus[msg.author.id].hasSaidGoodMorning) {
                const rank: number = Object.keys(state.dailyStatus).length;
                state.dailyStatus[msg.author.id].rank = rank;
                state.dailyStatus[msg.author.id].hasSaidGoodMorning = true;

                let comboDaysBroken: number = 0;
                let comboBreakee: Snowflake;
                if (rank === 1) {
                    if (state.combo) {
                        if (state.combo.user === msg.author.id) {
                            state.combo.days++;
                        } else {
                            comboDaysBroken = state.combo.days;
                            comboBreakee = state.combo.user;
                            state.combo = {
                                user: msg.author.id,
                                days: 1
                            };
                        }
                    } else {
                        state.combo = {
                            user: msg.author.id,
                            days: 1
                        };
                    }
                }

                const firstMessageThisSeason: boolean = !(msg.author.id in state.points);
                const priorPoints: number = state.points[msg.author.id] || 0;
                state.points[msg.author.id] = priorPoints + Math.max(5 - rank, 1) + comboDaysBroken;
                dumpState();
                // If it's a combo-breaker, reply with a special message (may result in double replies on Monkey Friday)
                if (comboDaysBroken > 1) {
                    msg.reply(languageGenerator.generate('{goodMorningReply.comboBreaker?}')
                        .replace(/\$breakee/g, `<@${comboBreakee}>`)
                        .replace(/\$days/g, comboDaysBroken.toString()));
                }
                // If this post is NOT a Monkey Friday post, reply as normal (this is to avoid double replies on Monkey Friday)
                else if (!triggerMonkeyFriday) {
                    // If it's the user's first message this season, reply to them with a special message
                    if (firstMessageThisSeason) {
                        msg.reply(languageGenerator.generate('{goodMorningReply.new?}'));
                    }
                    // Reply (or react) to the user based on how many points they had
                    else if (rank <= config.goodMorningReplyCount) {
                        if (Math.random() < config.replyViaReactionProbability) {
                            msg.react('🌞');
                        } else if (priorPoints < 0) {
                            msg.reply(languageGenerator.generate('{goodMorningReply.negative?}'));
                        } else {
                            msg.reply(languageGenerator.generate('{goodMorningReply.standard?}'));
                        }
                    } else {
                        msg.react('🌞');
                    }
                }
            }
        } else {
            // It's not morning, so punish the player accordingly...
            if (state.dailyStatus[msg.author.id].penalized) {
                // Deduct a half point for repeat offenses
                state.points[msg.author.id] = (state.points[msg.author.id] || 0) - 0.5;
            } else {
                // If this is the user's first penalty since last morning, react to the message and deduct one
                state.dailyStatus[msg.author.id].penalized = true;
                state.points[msg.author.id] = (state.points[msg.author.id] || 0) - 1;
                if (new Date().getHours() < 12) {
                    msg.react('😴');
                } else {
                    msg.react(randChoice('😡', '😬', '😒', '😐'));
                }
            }
            dumpState();
            if (state.points[msg.author.id] === -5) {
                msg.reply('Why are you still talking?');
            } else if (state.points[msg.author.id] === -10) {
                msg.reply('You have brought great dishonor to this server...');
            }
        }
    }
});

client.login(auth.token);
