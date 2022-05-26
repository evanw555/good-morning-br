import { Client, DMChannel, Intents, MessageAttachment, TextChannel } from 'discord.js';
import { Guild, GuildMember, Message, Snowflake, TextBasedChannels } from 'discord.js';
import { DailyEvent, DailyEventType, GoodMorningConfig, GoodMorningHistory, Season, TimeoutType, Combo, CalendarDate, PastTimeoutStrategy, HomeStretchSurprise } from './types.js';
import TimeoutManager from './timeout-manager.js';
import { createHomeStretchImage, createMidSeasonUpdateImage, createSeasonResultsImage } from './graphics.js';
import { hasVideo, randInt, validateConfig, getTodayDateString, reactToMessage, sleep, randChoice, toCalendarDate, getTomorrow, generateKMeansClusters, getRankString, naturalJoin, getClockTime, getOrderingUpsets, toLetterId, toFixed } from './util.js';
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
    ],
    partials: [
        'CHANNEL' // Required to receive DMs
    ]
});

let guild: Guild;

let goodMorningChannel: TextChannel;
let sungazersChannel: TextChannel;
let guildOwner: GuildMember;
let guildOwnerDmChannel: DMChannel;

let state: GoodMorningState;
let history: GoodMorningHistory;

let dailyVolatileLog: [Date, String][] = [];

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

const getBoldNames = (userIds: Snowflake[]): string => {
    return naturalJoin(userIds.map(userId => `**${state.getPlayerDisplayName(userId)}**`));
}

const getJoinedMentions = (userIds: Snowflake[]): string => {
    return naturalJoin(userIds.map(userId => `<@${userId}>`));
}

const grantGMChannelAccess = async (userIds: Snowflake[]): Promise<void> => {
    for (let userId of userIds) {
        try {
            await goodMorningChannel.permissionOverwrites.delete(await fetchMember(userId));
        } catch (err) {
            await logger.log(`Unable to grant GM channel access for user <@${userId}>: \`${err.toString()}\``);
        }
    }
}

const revokeGMChannelAccess = async (userIds: Snowflake[]): Promise<void> => {
    for (let userId of userIds) {
        try {
            await goodMorningChannel.permissionOverwrites.create(await fetchMember(userId), {
                'SEND_MESSAGES': false
            });
        } catch (err) {
            await logger.log(`Unable to revoke GM channel access for user <@${userId}>: \`${err.toString()}\``);
        }
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
    const sungazerChannel: TextBasedChannels = (await guild.channels.fetch(config.sungazers.channel)) as TextBasedChannels;
    const newSungazers: boolean = (winners.gold && history.sungazers[winners.gold] === undefined)
        || (winners.silver && history.sungazers[winners.silver] === undefined)
        || (winners.bronze && history.sungazers[winners.bronze] === undefined);
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
            const member: GuildMember = await guild.members.fetch(userId);
            await member.roles.remove(config.sungazers.role);
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
    });
    // Dump the state and history
    await dumpState();
    await dumpHistory();

    return winners;
};

const chooseEvent = (date: Date): DailyEvent => {
    // Sunday: Recap
    if (date.getDay() === 0) {
        return {
            type: DailyEventType.RecapSunday
        };
    }
    // Friday: Monkey Friday
    if (date.getDay() === 5) {
        return {
            type: DailyEventType.MonkeyFriday
        };
    }
    // Tuesday: Anonymous Submissions
    if (date.getDay() === 2) {
        if (date.getDate() % 2 === 0) {
            // If it's an even-numbered day, do text submissions
            return {
                type: DailyEventType.AnonymousSubmissions,
                // TODO: Add new ones such as "short story", "motivational message" once this has happened a couple times
                submissionType: randChoice("haiku", "limerick", "poem (ABAB)", "2-sentence horror story", "fake movie title", `${randInt(6, 10)}-word story`),
                submissions: {}
            };
        } else {
            // If it's an odd-numbered day, do attachment submissions
            return {
                type: DailyEventType.AnonymousSubmissions,
                // TODO: Add new ones such as "cute wholesome animal pic" once this has happened a couple times
                submissionType: "pic that goes hard",
                isAttachmentSubmission: true,
                submissions: {}
            };
        }
    }
    // If this date has a calendar date message override, then just do a standard GM (don't do any of the nonstandard ones below)
    const calendarDate: CalendarDate = toCalendarDate(date); // e.g. "12/25" for xmas
    if (calendarDate in config.goodMorningMessageOverrides) {
        return undefined;
    }
    // Begin home stretch if we're far enough along and not currently in the home stretch (this will be delayed if an above event needs to happen instead e.g. MF)
    if (state.getSeasonCompletion() >= 0.85 && !state.isHomeStretch()) {
        return {
            type: DailyEventType.BeginHomeStretch,
            homeStretchSurprises: [HomeStretchSurprise.Multipliers, HomeStretchSurprise.LongestComboBonus, HomeStretchSurprise.ComboBreakerBonus]
        };
    }
    // On a rising chance cadence of 5 days, take a chance to do some other event
    const eventChance: number = ((date.getDate() % 5) + 1) / 5;
    if (Math.random() < eventChance) {
        // Compile a list of potential events (include default events)
        const potentialEvents: DailyEvent[] = [
            {
                type: DailyEventType.ReverseGoodMorning,
                reverseGMRanks: {}
            },
            {
                type: DailyEventType.GrumpyMorning
            },
            {
                type: DailyEventType.SleepyMorning
            }
        ];
        // If someone should be beckoned, add beckoning as a potential event
        const potentialBeckonees: Snowflake[] = state.getLeastRecentPlayers(6);
        if (potentialBeckonees.length > 0) {
            potentialEvents.push({
                type: DailyEventType.Beckoning,
                user: randChoice(...potentialBeckonees)
            });
            // Add another one to double the odds of this happening if there are more than one potential beckonees
            if (potentialBeckonees.length > 1) {
                potentialEvents.push({
                    type: DailyEventType.Beckoning,
                    user: randChoice(...potentialBeckonees)
                });
            }
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
        // If anyone is qualified to provide the GM message, add writer's block as a potential event (with 50% odds)
        const potentialWriters: Snowflake[] = state.queryOrderedPlayers({ maxDays: 1, n: 7 });
        if (potentialWriters.length > 0 && Math.random() < 0.5) {
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

const chooseMagicWord = async (): Promise<string> => {
    try {
        const words: string[] = await loadJson('config/words.json');
        return randChoice(...words);
    } catch (err) {
        logger.log(`Failed to choose a word of the day: \`${err.toString()}\``);
    }
}

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
                files: [new MessageAttachment(await createMidSeasonUpdateImage(state, history.medals), 'sunday-recap.png')]
            });
            break;
        case DailyEventType.MonkeyFriday:
            await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage ?? '{happyFriday}'));
            break;
        case DailyEventType.BeginHomeStretch:
            await goodMorningChannel.send({
                content: `WAKE UP MY DEAR FRIENDS! For we are now in the home stretch of season **${state.getSeasonNumber()}**! `
                    + 'There are some surprises which I will reveal in a short while, though in the meantime, please take a look at the current standings...',
                files: [new MessageAttachment(await createHomeStretchImage(state, history.medals), 'home-stretch.png')]
            });
            break;
        case DailyEventType.Beckoning:
            await messenger.send(goodMorningChannel, languageGenerator.generate('{beckoning.goodMorning?}', { player: `<@${state.getEvent().user}>` }));
            break;
        case DailyEventType.GrumpyMorning:
            await messenger.send(goodMorningChannel, languageGenerator.generate('{grumpyMorning}'));
            break;
        case DailyEventType.SleepyMorning:
            await messenger.send(goodMorningChannel, languageGenerator.generate('{sleepyMorning}'));
            break;
        case DailyEventType.WritersBlock:
            // If the guest writer submitted something, use that; otherwise, send the standard GM message
            if (state.getEvent().customMessage) {
                await messenger.send(goodMorningChannel, state.getEvent().customMessage);
            } else {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage ?? '{goodMorning}'));
            }
            break;
        case DailyEventType.AnonymousSubmissions:
            if (overriddenMessage) {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage));
            }
            const phrase: string = state.getEvent().isAttachmentSubmission ? 'find a' : 'write a special Good Morning';
            const intro: string = overriddenMessage ? 'There\'s more!' : 'Good morning! Today is a special one.';
            const text = `${intro} Rather than sending your good morning messages here for all to see, `
                + `I'd like you to ${phrase} _${state.getEvent().submissionType}_ and send it directly to me via DM! `
                + `At 11:00, I'll post them here anonymously and you'll all be voting on your favorites 😉`;
            await messenger.send(goodMorningChannel, text);
            break;
        default:
            // Otherwise, send the standard GM message as normal (do a season intro greeting if today is the first day)
            if (state.getSeasonStartedOn() === getTodayDateString()) {
                await messenger.send(goodMorningChannel, `Good morning everyone and welcome to season **${state.getSeasonNumber()}**! I hope to see many familiar faces, and if I'm lucky maybe even some new ones ${config.defaultGoodMorningEmoji}`);
            } else if (Math.random() < config.goodMorningMessageProbability) {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage ?? '{goodMorning}'));
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
    await messenger.send(channel, 'In the meantime, please congratulate yourselves (penalties are disabled), take a deep breath, and appreciate the friends you\'ve made in this channel 🙂');
    // Send the "final results image"
    await sleep(120000);
    await messenger.send(channel, 'Alright, here are the final standings...');
    try { // TODO: refactor image sending into the messenger class?
        await channel.sendTyping();
    } catch (err) {}
    await sleep(5000);
    const attachment = new MessageAttachment(await createSeasonResultsImage(previousState, history.medals), 'results.png');
    await channel.send({ files: [attachment] });
    await sleep(5000);
    await messenger.send(channel, `Congrats, <@${winner}>!`);
    // Send information about the season rewards
    await sleep(15000);
    await messenger.send(channel, `As a reward, <@${winner}> will get the following perks throughout season **${newSeason}**:`);
    // await messenger.send(channel, ' ⭐ Ability to set a special "good morning" emoji that everyone in the server can use');
    await messenger.send(channel, ' ⭐ Honorary Robert status, with the ability to post in **#robertism**');
    await messenger.send(channel, ' ⭐ Other secret perks...');
    // Wait, then send info about the next season
    await sleep(30000);
    await messenger.send(channel, 'Now that this season is over, I\'ll be taking a vacation for several days. Feel free to post whatever whenever until I return 🌞');
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

const registerGoodMorningTimeout = async (days: number = 1): Promise<void> => {
    const MIN_HOURS: Record<string, number> = {
        [DailyEventType.SleepyMorning]: 10,
        [DailyEventType.ReverseGoodMorning]: 7
    };
    const MAX_HOURS: Record<string, number> = {
        [DailyEventType.SleepyMorning]: 11,
        [DailyEventType.ReverseGoodMorning]: 11,
        [DailyEventType.AnonymousSubmissions]: 8
    };
    const MIN_HOUR: number = MIN_HOURS[state.getEventType()] ?? 6;
    const MAX_HOUR_EXCLUSIVE: number = MAX_HOURS[state.getEventType()] ?? 10;

    const morningTomorrow: Date = new Date();
    // Set date to number of days in the future (1 by default)
    morningTomorrow.setDate(morningTomorrow.getDate() + days);
    // If it's currently before the earliest possible morning time, then rewind the target date by one day
    if (morningTomorrow.getHours() < MIN_HOUR) {
        morningTomorrow.setDate(morningTomorrow.getDate() - 1);
    }
    // Set time as sometime between 7am and 10am
    morningTomorrow.setHours(randInt(MIN_HOUR, MAX_HOUR_EXCLUSIVE), randInt(0, 60), randInt(0, 60));

    // We register this with the "Increment Day" strategy since it happens at a particular time and it's not competing with any other triggers.
    await timeoutManager.registerTimeout(TimeoutType.NextGoodMorning, morningTomorrow, PastTimeoutStrategy.IncrementDay);
};

const registerGuestReveilleFallbackTimeout = async (): Promise<void> => {
    // Schedule tomrrow sometime between 11:30 and 11:45
    const date: Date = getTomorrow();
    date.setHours(11, randInt(30, 45), randInt(0, 60));
    // We register this with the "Invoke" strategy since this way of "waking up" is competing with a user-driven trigger.
    // We want to invoke this ASAP in order to avoid this event when it's no longer needed.
    await timeoutManager.registerTimeout(TimeoutType.GuestReveilleFallback, date, PastTimeoutStrategy.Invoke);
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

    // Give a hint for today's magic word
    if (state.hasMagicWord()) {
        // Get list of all suitable recipients of the magic word (this is a balancing mechanic, so pick players who are behind yet active)
        const potentialMagicWordRecipients: Snowflake[] = state.getPotentialMagicWordRecipients();
        // Determine if we should give out the hint
        const shouldGiveHint: boolean = potentialMagicWordRecipients.length > 0
            && state.getEventType() !== DailyEventType.BeginHomeStretch
            && state.getSeasonCompletion() >= 0.1;
        // If yes, then give out the hint to one randomly selected suitable recipient
        if (shouldGiveHint) {
            const magicWordRecipient: Snowflake = randChoice(...potentialMagicWordRecipients);
            await messenger.dm(await fetchMember(magicWordRecipient), `Psssst.... the magic word of the day is _"${state.getMagicWord()}"_`);
            if (magicWordRecipient !== guildOwner.id) {
                await logger.log(`Magic word _"${state.getMagicWord()}"_ was sent to **${state.getPlayerDisplayName(magicWordRecipient)}**`);
            }
        }
    }

    if (state.getEventType() === DailyEventType.BeginHomeStretch) {
        // Active home stretch mode!
        state.setHomeStretch(true);
        // Set timeout for first home stretch surprise (these events are recursive)
        const surpriseTime = new Date();
        surpriseTime.setMinutes(surpriseTime.getMinutes() + 10);
        await timeoutManager.registerTimeout(TimeoutType.HomeStretchSurprise, surpriseTime, PastTimeoutStrategy.Invoke);
    }

    // Set timeout for anonymous submission reveal
    if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
        const submissionRevealTime = new Date();
        submissionRevealTime.setHours(11, 0, 0, 0);
        // We register this with the "Invoke" strategy since we want it to happen before Pre-Noon (with which it's registered in parallel)
        await timeoutManager.registerTimeout(TimeoutType.AnonymousSubmissionReveal, submissionRevealTime, PastTimeoutStrategy.Invoke);
    }

    // Set timeout for when morning almost ends
    const preNoonToday: Date = new Date();
    preNoonToday.setHours(11, randInt(48, 56), randInt(0, 60), 0);
    // We register this with the "Increment Hour" strategy since its subsequent timeout (Noon) is registered in series
    await timeoutManager.registerTimeout(TimeoutType.NextPreNoon, preNoonToday, PastTimeoutStrategy.IncrementHour);

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

    // Reset the daily state
    state.setMorning(true);
    state.setGracePeriod(false);
    state.resetDailyState();
    dailyVolatileLog = [];
    dailyVolatileLog.push([new Date(), 'GMBR has arisen.']);

    // If we're 10% of the way through the season, determine the nerf threshold for today
    if (state.getSeasonCompletion() > 0.1) {
        state.setNerfThreshold(toFixed(0.9 * state.getTopScore()));
    }

    // If it's a Recap Sunday, then process weekly changes
    if (state.getEventType() === DailyEventType.RecapSunday) {
        const weeklySnapshot: GoodMorningState = await loadWeeklySnapshot();
        // If a snapshot from last week exists (and is from this season), compute and broadcast some weekly stats
        if (weeklySnapshot && weeklySnapshot.getSeasonNumber() === state.getSeasonNumber()) {
            // Broadcast the biggest weekly gainer of points
            let maxPointGains: number = -1;
            let maxGainedPlayer: Snowflake;
            const pointDiffs: Record<Snowflake, number> = {};
            state.getPlayers().forEach(userId => {
                const pointDiff: number = state.getPlayerPoints(userId) - weeklySnapshot.getPlayerPoints(userId);
                pointDiffs[userId] = pointDiff;
                if (pointDiff > maxPointGains) {
                    maxPointGains = pointDiff;
                    maxGainedPlayer = userId;
                }
            });
            if (maxPointGains > 0) {
                await messenger.send(goodMorningChannel, `Nice work to <@${maxGainedPlayer}> for earning the most points in the last week!`);
            }
            // Log any weekly rank upsets. TODO: Actually send this out???
            try {
                const beforeOrderings: Snowflake[] = weeklySnapshot.getOrderedPlayers();
                const afterOrderings: Snowflake[] = state.getOrderedPlayers();
                const upsets: Record<Snowflake, Snowflake[]> = getOrderingUpsets(beforeOrderings, afterOrderings);
                await logger.log(naturalJoin(
                    Object.entries(upsets)
                        .map(([userId, upsettees]) => {
                            return `**${state.getPlayerDisplayName(userId)}** has overtaken ${getBoldNames(upsettees)}`;
                        })
                ));
            } catch (err) {
                logger.log('Failed to compute ordering upsets: ' + err.toString());
            }
            // Log all the nonzero point changes
            await logger.log(Object.keys(pointDiffs)
                .filter(userId => pointDiffs[userId] !== 0)
                .sort((x, y) => pointDiffs[y] - pointDiffs[x])
                .map(userId => `\`${pointDiffs[userId]}\` **${state.getPlayerDisplayName(userId)}**`)
                .join('\n') || 'No point changes this week.');
        }
        // Write the new snapshot
        await dumpWeeklySnapshot(state);
    }

    // Process "reverse" GM ranks
    if (state.getEventType() === DailyEventType.ReverseGoodMorning) {
        const mostRecentUsers: Snowflake[] = Object.keys(state.getEvent().reverseGMRanks);
        mostRecentUsers.sort((x, y) => state.getEvent().reverseGMRanks[y] - state.getEvent().reverseGMRanks[x]);
        // Process the users in order of most recent reverse GM message
        for (let i = 0; i < mostRecentUsers.length; i++) {
            const userId: Snowflake = mostRecentUsers[i];
            const rank: number = i + 1;
            const rankedPoints: number = config.awardsByRank[rank] ?? config.defaultAward;
            // Dump the rank info into the daily status map and assign points accordingly
            state.awardPoints(userId, rankedPoints);
            state.setDailyRank(userId, rank);
            state.resetDaysSinceLGM(userId);
            dailyVolatileLog.push([new Date(), `<@${userId}> was ${getRankString(rank)}-to-last = \`${rankedPoints}\``]);
        }
        // Send a message to the channel tagging the respective players
        if (mostRecentUsers.length >= 3) {
            await messenger.send(goodMorningChannel, `Thanks to <@${mostRecentUsers[2]}>, <@${mostRecentUsers[1]}>, and especially <@${mostRecentUsers[0]}> for paving the way!`);
        }
    }

    // Dump state
    await dumpState();

    // Finally, re-grant access for all players with negative points
    await grantGMChannelAccess(state.getDelinquentPlayers());
};

const finalizeAnonymousSubmissions = async () => {
    if (!state.getEvent().votes || !state.getEvent().submissions) {
        await logger.log('WARNING! Attempting to finalize submissions with the votes and/or submissions already wiped. Aborting!');
        return;
    }

    // Disable voting by deleting the "vote" command
    const guildCommands = await guild.commands.fetch();
    guildCommands.forEach(command => {
        if (command.name === 'vote' && command.applicationId === client.application.id) {
            command.delete();
        }
    });

    // First, tally the votes and compute the scores
    const scores: Record<string, number> = {}; // Map (submission code : points)
    const breakdown: Record<string, number[]> = {};
    // Prime both maps (some submissions may get no votes)
    Object.keys(state.getEvent().submissionOwnersByCode).forEach(code => {
        scores[code] = 0;
        breakdown[code] = [0, 0, 0];
    });
    // Now tally the actual scores and breakdowns
    // Add 0.1 to break ties using total number of votes, 0.01 to ultimately break ties with golds
    const voteValues: number[] = [3.11, 2.1, 1.1];
    Object.values(state.getEvent().votes).forEach(codes => {
        codes.forEach((code, i) => {
            scores[code] = toFixed(scores[code] + (voteValues[i] ?? 0));
            // Take note of the breakdown
            breakdown[code][i]++;
        });
    });

    // Compile the set of those who didn't vote
    const deadbeats: Set<Snowflake> = new Set();
    state.getSubmissionNonVoters().forEach(userId => {
        // Add the player to the set
        deadbeats.add(userId);
        // Penalize the player
        state.deductPoints(userId, config.defaultAward);
    })

    // Deleting certain event data will prevent action taken on further DMs and commands
    delete state.getEvent().submissions;
    delete state.getEvent().votes;
    await dumpState();

    // Then, assign points based on rank in score (excluding those who didn't vote)
    const submissionCodes: Snowflake[] = Object.keys(scores).filter(code => !deadbeats.has(state.getEvent().submissionOwnersByCode[code]));
    submissionCodes.sort((x, y) => scores[y] - scores[x]);
    for (let i = 0; i < submissionCodes.length; i++) {
        const submissionCode: string = submissionCodes[i];
        const rank: number = i + 1;
        const pointsEarned: number = config.largeAwardsByRank[rank] ?? config.defaultAward;
        const userId: Snowflake = state.getEvent().submissionOwnersByCode[submissionCode];
        state.awardPoints(userId, pointsEarned);
        state.setDailyRank(userId, rank);
        state.resetDaysSinceLGM(userId);
    }

    // Reveal the winners (and losers) to the channel
    await messenger.send(goodMorningChannel, 'Now, time to reveal the results...');
    if (deadbeats.size > 0) {
        await sleep(10000);
        const deadbeatsText: string = naturalJoin([...deadbeats].map(userId => `<@${userId}>`));
        await messenger.send(goodMorningChannel, `Before anything else, say hello to the deadbeats who were disqualified for not voting! ${deadbeatsText} 👋`);
    }
    const zeroVoteCodes: string[] = submissionCodes.filter(code => scores[code] === 0);
    if (zeroVoteCodes.length > 0) {
        const zeroVoteUserIds: Snowflake[] = zeroVoteCodes.map(code => state.getEvent().submissionOwnersByCode[code]);
        await sleep(12000);
        await messenger.send(goodMorningChannel, `Now, let us extend our solemn condolences to ${getJoinedMentions(zeroVoteUserIds)}, for they received no votes this fateful morning... 😬`);
    }
    for (let i = submissionCodes.length - 1; i >= 0; i--) {
        const submissionCode: string = submissionCodes[i];
        const userId: Snowflake = state.getEvent().submissionOwnersByCode[submissionCode];
        const rank: number = i + 1;
        if (i === 0) {
            await sleep(12000);
            await messenger.send(goodMorningChannel, `And in first place, with submission **${submissionCode}**...`);
            await sleep(6000);
            await messenger.send(goodMorningChannel, `Receiving **${breakdown[submissionCode][0]}** gold votes, **${breakdown[submissionCode][1]}** silver votes, and **${breakdown[submissionCode][2]}** bronze votes...`);
            await sleep(12000);
            await messenger.send(goodMorningChannel, `We have our winner, <@${userId}>! Congrats!`);
        } else if (i < 3) {
            await sleep(12000);
            await messenger.send(goodMorningChannel, `In ${getRankString(rank)} place, we have <@${userId}> with submission **${submissionCode}**!`);
        }
    }

    // Finally, send DMs to let each user know their ranking
    const totalSubmissions: number = submissionCodes.length;
    for (let i = 0; i < submissionCodes.length; i++) {
        const submissionCode: string = submissionCodes[i];
        const userId: Snowflake = state.getEvent().submissionOwnersByCode[submissionCode];
        const rank: number = i + 1;
        try {
            await messenger.dm(await fetchMember(userId), `Your ${state.getEvent().submissionType} placed **${getRankString(rank)}** of **${totalSubmissions}**, `
                + `receiving **${breakdown[submissionCode][0]}** gold votes, **${breakdown[submissionCode][1]}** silver votes, and **${breakdown[submissionCode][2]}** bronze votes. `
                + `Thanks for participating ${config.defaultGoodMorningEmoji}`);
        } catch (err) {
            await logger.log(`Unable to send results DM to **${state.getPlayerDisplayName(userId)}**: \`${err.toString()}\``);
        }
    }

    // Send the details of the scoring to the sungazers
    // TODO: Remove this try-catch once we're sure it works
    try {
        await messenger.send(sungazersChannel, 'FYI gazers, here are the details of today\'s voting...');
        await messenger.send(sungazersChannel, submissionCodes.map((c, i) => `**${getRankString(i + 1)}**: ${c} <@${state.getEvent().submissionOwnersByCode[c]}> \`${breakdown[c][0]}🥇+${breakdown[c][1]}🥈+${breakdown[c][2]}🥉=${scores[c]}\``).join('\n'));
    } catch (err) {
        await logger.log('Failed to compute and send voting/scoring log...');
    }

    // Delete remaining event data
    delete state.getEvent().submissionOwnersByCode;
    delete state.getEvent().rootSubmissionMessage;
    await dumpState();
};

const TIMEOUT_CALLBACKS = {
    [TimeoutType.NextGoodMorning]: async (): Promise<void> => {
        await wakeUp(true);
    },
    [TimeoutType.NextPreNoon]: async (): Promise<void> => {
        // Set timeout for when morning ends
        const noonToday: Date = new Date();
        noonToday.setHours(12, 0, 0, 0);
        // We register this with the "Increment Hour" strategy since its subsequent timeout (GoodMorning) is registered in series
        await timeoutManager.registerTimeout(TimeoutType.NextNoon, noonToday, PastTimeoutStrategy.IncrementHour);

        // Check the results of anonymous submissions
        if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
            // ...if they haven't been finalized already
            if (state.getEvent().votes) {
                await finalizeAnonymousSubmissions();
                // Sleep to provide a buffer in case more messages need to be sent
                await sleep(10000);
            } else {
                await logger.log('Aborting pre-noon submission finalizing, as the votes have already been wiped.');
            }
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
                await messenger.send(goodMorningChannel, languageGenerator.generate('{reveille.summon}', { player: `<@${nextEvent.user}>` }));
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
        // If attempting to end the morning while already asleep, warn the admin and abort
        if (!state.isMorning()) {
            logger.log('WARNING! Attempted to end the morning while `state.isMorning` is already `false`');
            return;
        }

        // Revoke access for all players with negative points
        await revokeGMChannelAccess(state.getDelinquentPlayers());

        // Update basic state properties
        state.setMorning(false);
        state.clearNerfThreshold();

        // Activate the queued up event
        state.dequeueNextEvent();

        // Set tomorrow's magic word (if it's not an abnormal event)
        state.clearMagicWord();
        const magicWord: string = await chooseMagicWord();
        if (magicWord && !state.isEventAbnormal()) {
            state.setMagicWord(magicWord);
        }

        // Update player activity counters
        state.incrementPlayerActivities();

        // Dump state and R9K hashes
        await dumpState();
        await dumpR9KHashes();

        // If the season is still going...
        if (!state.isSeasonGoalReached()) {
            // Register a timeout that will allow the bot to "wake up" tomorrow
            if (state.getEventType() === DailyEventType.GuestReveille) {
                // Register "fallback" timeout to wake up in case the guest reveille doesn't say anything
                await registerGuestReveilleFallbackTimeout();
            } else {
                // Register the normal GM timeout
                await registerGoodMorningTimeout();
            }
            // Notify the sungazers about tomorrow's event (if applicable)
            if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
                await sungazersChannel.send(`FYI gazers: tomorrow, everyone will be sending me a _${state.getEvent().submissionType}_ ${config.defaultGoodMorningEmoji}`);
            }
        }

        // If this is happening at a non-standard time, explicitly warn players (add some tolerance in case of timeout variance)
        const clockTime: string = getClockTime();
        const standardClockTimes: Set<string> = new Set(['11:59', '12:00', '12:01']);
        if (!standardClockTimes.has(clockTime)) {
            await messenger.send(goodMorningChannel, 'The "morning" technically ends now, so SHUT UP 🤫');
        }

        // If the event for tomorrow is writer's block, then send a message to the guest writer asking them to submit a GM message
        if (!state.isSeasonGoalReached() && state.getEventType() === DailyEventType.WritersBlock) {
            try {
                await messenger.dm(await fetchMember(state.getEvent().user),
                    "Hey, I've been experiencing a little writer's block lately and can't think of a solid greeting for tomorrow. "
                    + "What do you think I should say? Send me something and I'll use it as my Good Morning greeting tomorrow as-is 🤔");
                await logger.log(`Sent writer's block invite to **${state.getPlayerDisplayName(state.getEvent().user)}**`);
            } catch (err) {
                await logger.log(`Unable to send writer's block invite to **${state.getPlayerDisplayName(state.getEvent().user)}**: \`${err.toString()}\``);
            }
        }

        // If anyone's score is above the season goal, then proceed to the next season
        if (state.isSeasonGoalReached()) {
            const previousState: GoodMorningState = state;
            const winners = await advanceSeason();
            await sendSeasonEndMessages(goodMorningChannel, previousState);
            await updateSungazers(winners);
            // Register the next GM timeout for a few days in the future to provide a buffer
            await registerGoodMorningTimeout(5);
        }

        // Update the bot's status
        await setStatus(false);
    },
    [TimeoutType.GuestReveilleFallback]: async (): Promise<void> => {
        // Take action if the guest reveiller hasn't said GM
        if (!state.isMorning()) {
            // Penalize the reveiller
            const userId: Snowflake = state.getEvent().user;
            state.deductPoints(userId, 2);
            // Wake up, then send a message calling out the reveiller (don't tag them, we don't want to give them an advantage...)
            await wakeUp(false);
            await messenger.send(goodMorningChannel, `Good morning! I had to step in because I guess ${state.getPlayerDisplayName(userId)} isn't cut out for the job 😒`);
        }
    },
    [TimeoutType.AnonymousSubmissionReveal]: async (): Promise<void> => {
        // Send the initial message
        const rootSubmissionMessage: Message = await messenger.sendAndGet(goodMorningChannel, `Here are your anonymous submissions! ${config.defaultGoodMorningEmoji}`);
        state.getEvent().rootSubmissionMessage = rootSubmissionMessage.id;
        state.getEvent().votes = {};
        state.getEvent().submissionOwnersByCode = {};
        await dumpState();

        // Get all the relevant user IDs and shuffle them
        const userIds: Snowflake[] = Object.keys(state.getEvent().submissions);
        userIds.sort((x, y) => Math.random() - Math.random());

        // For each submission (in shuffled order)...
        for (let i = 0; i < userIds.length; i++) {
            const userId: Snowflake = userIds[i];
            const submission: string = state.getEvent().submissions[userId];
            const submissionCode: string = toLetterId(i);
            
            // Keep track of which user this submission's "number" maps to
            state.getEvent().submissionOwnersByCode[submissionCode] = userId;
            await dumpState();

            try {
                // Send the message out
                const messageHeader: string = `**Submission ${submissionCode}:**`;
                if (state.getEvent().isAttachmentSubmission) {
                    await goodMorningChannel.send({ content: messageHeader, files: [new MessageAttachment(submission)] });
                } else {
                    await messenger.send(goodMorningChannel, `${messageHeader}\n${submission}`);
                }
                // Take a long pause
                await sleep(30000);
            } catch (err) {
                logger.log(`Failed to send out <@${userId}>'s submission: \`${err.toString()}\``);
            }
        }

        // Register the vote command
        const choices = Object.keys(state.getEvent().submissionOwnersByCode).map(c => { return { name: `Submission ${c}`, value: c }; });
        await guild.commands.create({
            name: 'vote',
            description: `Vote for a ${state.getEvent().submissionType}`,
            options: [
                {
                    type: 'STRING',
                    name: 'first',
                    description: 'Your favorite submission',
                    required: true,
                    choices
                },
                {
                    type: 'STRING',
                    name: 'second',
                    description: 'Your second favorite submission',
                    required: true,
                    choices
                },
                {
                    type: 'STRING',
                    name: 'third',
                    description: 'Your third favorite submission',
                    required: true,
                    choices
                }
            ]
         });

        // Send voting message
        await messenger.send(goodMorningChannel,
            `Alright, that's all of them! Use the \`/vote\` command to vote for your 3 favorite submissions. `
            + `If you submitted a ${state.getEvent().submissionType}, you _must_ vote otherwise you will be disqualified and penalized.`);

        // Schedule voting reminders
        [[11, 20], [11, 40]].forEach(([hour, minute]) => {
            const reminderTime: Date = new Date();
            reminderTime.setHours(hour, minute);
            // We register these with the "Delete" strategy since they are terminal and aren't needed if in the past
            timeoutManager.registerTimeout(TimeoutType.AnonymousSubmissionVotingReminder, reminderTime, PastTimeoutStrategy.Delete);
        });
    },
    [TimeoutType.AnonymousSubmissionVotingReminder]: async (): Promise<void> => {
        if (!state.getEvent().votes) {
            await logger.log('Aborting submission voting reminder, as the votes have already been wiped.');
            return;
        }

        if (state.haveAllSubmittersVoted()) {
            // If all submitters have voted, then we can finalize the submissions early
            await finalizeAnonymousSubmissions();
        } else {
            // Otherwise, send a voting notification to the channel
            try {
                const rootSubmissionMessage: Message = await goodMorningChannel.messages.fetch(state.getEvent().rootSubmissionMessage);
                await messenger.reply(rootSubmissionMessage, `If you haven't already, please vote on your favorite ${state.getEvent().submissionType} with \`/vote\`!`);
            } catch (err) {
                logger.log(`Failed to fetch root submission message and send reminder: \`${err.toString()}\``);
            }
            // Also, DM players who still haven't voted
            const delinquents: Snowflake[] = state.getSubmissionNonVoters();
            if (delinquents.length > 0) {
                await logger.log(`Sending voting reminder DM to ${getBoldNames(delinquents)}...`);
                delinquents.forEach(async (userId) => {
                    try {
                        await messenger.dm(await fetchMember(userId),
                            `You still haven\'t voted! You and your ${state.getEvent().submissionType} will be disqualified if you don't vote by noon. You can vote with the \`/vote\` command.`);
                    } catch (err) {
                        await logger.log(`Unable to send voting reminder DM to **${state.getPlayerDisplayName(userId)}**: \`${err.toString()}\``);
                    }
                });
            }
        }
    },
    [TimeoutType.HomeStretchSurprise]: async (): Promise<void> => {
        const surprises: HomeStretchSurprise[] = state.getEvent()?.homeStretchSurprises;
        if (surprises && surprises.length > 0) {
            // Get the next surprise and dump state
            const surprise: HomeStretchSurprise = surprises.shift();
            await dumpState();
            // Recursively schedule the next timeout
            const nextTimeout: Date = new Date();
            nextTimeout.setMinutes(nextTimeout.getMinutes() + 10);
            await timeoutManager.registerTimeout(TimeoutType.HomeStretchSurprise, nextTimeout, PastTimeoutStrategy.Invoke);
            // Act on this surprise
            switch (surprise) {
            case HomeStretchSurprise.Multipliers:
                const x1players: Snowflake[] = [];
                const x1_5players: Snowflake[] = [];
                const x2players: Snowflake[] = [];
                const orderedPlayers: Snowflake[] = state.getOrderedPlayers();
                // Update player multipliers and dump state
                orderedPlayers.forEach(userId => {
                    if (state.getPlayerPoints(userId) <= 0) {
                        state.setPlayerMultiplier(userId, 0.5);
                    } else if (state.getPlayerCompletion(userId) >= 0.8) {
                        x1players.push(userId);
                    } else if (state.getPlayerCompletion(userId) >= 0.7) {
                        x1_5players.push(userId);
                        state.setPlayerMultiplier(userId, 1.5);
                    } else if (state.getPlayerCompletion(userId) >= 0.5) {
                        x2players.push(userId);
                        state.setPlayerMultiplier(userId, 2);
                    } else {
                        state.setPlayerMultiplier(userId, 3);
                    }
                });
                await dumpState();
                // Notify the channel
                await messenger.send(goodMorningChannel, 'Here is a very special surprise indeed...');
                await messenger.send(goodMorningChannel, 'In order to help some of you catch up, I\'ll be handing out some karma multipliers');
                await sleep(10000);
                await messenger.send(goodMorningChannel, `First and foremost, ${getBoldNames(x1players)} will sadly not be getting any multiplier`);
                await sleep(6000);
                await messenger.send(goodMorningChannel, `${getBoldNames(x1_5players)} will receive 1.5x karma until the end of the season!`);
                await sleep(6000);
                await messenger.send(goodMorningChannel, `For ${getBoldNames(x2players)}, it's DOUBLE XP WEEKEND!`);
                await sleep(6000);
                await messenger.send(goodMorningChannel, `...and everyone else not mentioned will be getting 3x karma 😉`);
                break;
            case HomeStretchSurprise.LongestComboBonus:
                const maxCombo: Combo = state.getMaxCombo();
                if (maxCombo) {
                    await messenger.send(goodMorningChannel, 'It\'s time to announce the winner of the _longest combo_ bonus! This user was first to say good morning the most days in a row...');
                    await sleep(10000);
                    // Award points and dump state
                    const pointsAwarded: number = state.awardPoints(maxCombo.user, config.awardsByRank[1]);
                    await dumpState();
                    // Notify channel
                    await messenger.send(goodMorningChannel, `The winner is <@${maxCombo.user}>, with a streak lasting **${maxCombo.days}** days! This bonus is worth **${state.getNormalizedPoints(pointsAwarded)}%** karma ${config.defaultGoodMorningEmoji}`);
                }
                break;
            case HomeStretchSurprise.ComboBreakerBonus:
                const maxTimesBroken: number = Math.max(...Object.values(state.getPlayerStates()).map(player => player.combosBroken ?? 0));
                const maxBreakers: Snowflake[] = state.getOrderedPlayers().filter(userId => state.getPlayerCombosBroken(userId) === maxTimesBroken);
                if (maxBreakers.length > 0) {
                    const maxBreaker: Snowflake = maxBreakers[0];
                    await messenger.send(goodMorningChannel, 'Now to announce the winner of the _combo breaker_ bonus! This user broke the most Good Morning combos...');
                    await sleep(10000);
                    // Award points and dump state
                    const pointsAwarded: number = state.awardPoints(maxBreaker, config.awardsByRank[1]);
                    await dumpState();
                    // Notify channel
                    await messenger.send(goodMorningChannel, `The winner is <@${maxBreaker}>, who broke **${maxTimesBroken}** streaks! This bonus is worth **${state.getNormalizedPoints(pointsAwarded)}%** karma ${config.defaultGoodMorningEmoji}`);
                }
                break;
            }
        } else {
            await goodMorningChannel.send({
                content: 'Well that\'s all for now! Here are the updated standings, good luck everyone!',
                files: [new MessageAttachment(await createHomeStretchImage(state, history.medals), 'home-stretch2.png')]
            });
        }
    }
};

const timeoutManager = new TimeoutManager(storage, TIMEOUT_CALLBACKS);

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
                goal: config.seasonGoal,
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

const loadWeeklySnapshot = async (): Promise<GoodMorningState> => {
    try {
        return new GoodMorningState(await storage.readJson('weekly-snapshot.json'));
    } catch (err) {
        // Specifically check for file-not-found errors to make sure we don't overwrite anything
        if (err.code === 'ENOENT') {
            await logger.log('Existing weekly snapshot file not found!');
            return undefined;
        } else {
            logger.log(`Unhandled exception while loading weekly snapshot file:\n\`\`\`${err.message}\`\`\``);
        }
    }
    return undefined;
};

const dumpWeeklySnapshot = async (weeklySnapshot: GoodMorningState): Promise<void> => {
    await storage.write('weekly-snapshot.json', weeklySnapshot.toJson());
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

const logTimeouts = async (): Promise<void> => {
    await guildOwnerDmChannel.send(timeoutManager.toStrings().map(entry => `- ${entry}`).join('\n') || '_No timeouts._');
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

    // Load all necessary data from disk
    await loadState();
    await loadHistory();
    await loadR9KHashes();
    await timeoutManager.loadTimeouts();

    if (guildOwner && goodMorningChannel) {
        await logger.log(`Bot rebooting at **${getClockTime()}** with guild owner **${guildOwner.displayName}** and GM channel ${goodMorningChannel.toString()}`);
        dailyVolatileLog.push([new Date(), 'Bot rebooting...']);
    }
    await logTimeouts();

    // Update the bot's status
    await setStatus(state.isMorning());
});

client.on('interactionCreate', async (interaction): Promise<void> => {
    if (interaction.isCommand()) {
        if (interaction.commandName === 'vote') {
            await interaction.deferReply({ ephemeral: true });
            if (state.getEventType() === DailyEventType.AnonymousSubmissions && state.getEvent().votes) {
                const submissionCodes: string[] = [
                    interaction.options.getString('first'),
                    interaction.options.getString('second'),
                    interaction.options.getString('third')
                ];
                const submissionCodeSet: Set<string> = new Set(submissionCodes);
                const validSubmissionCodes: Set<string> = new Set(Object.keys(state.getEvent().submissionOwnersByCode));
                // Do some validation on the vote before processing it further
                if (submissionCodes.length === 0) {
                    await interaction.editReply(`I don\'t understand, please tell me which submissions you\'re voting for. Choose from ${naturalJoin([...validSubmissionCodes])}.`);
                } else if (submissionCodeSet.size !== submissionCodes.length) {
                    await interaction.editReply('You can\'t vote for the same submission twice!');
                } else {
                    // Ensure that all votes are for valid submissions
                    for (let i = 0; i < submissionCodes.length; i++) {
                        const submissionCode: string = submissionCodes[i];
                        if (!validSubmissionCodes.has(submissionCode)) {
                            await interaction.editReply(`${submissionCode} is not a valid submission! Choose from ${naturalJoin([...validSubmissionCodes])}.`);
                            return;
                        }
                        if (state.getEvent().submissionOwnersByCode[submissionCode] === interaction.user.id) {
                            await interaction.editReply('You can\'t vote for your own submission!');
                            return;
                        }
                    }
                    // Cast the vote
                    state.getEvent().votes[interaction.user.id] = submissionCodes;
                    await dumpState();
                    // Notify the user of their vote
                    await interaction.editReply('Your vote has been cast!');
                }
            } else {
                await interaction.editReply('You shouldn\'t be able to vote right now!');
            }
        }
        
    }
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
                    return `- <@${key}>: **${state.getPlayerPoints(key)}**`
                        + (state.getPlayerDaysSinceLGM(key) ? ` ${state.getPlayerDaysSinceLGM(key)}d` : '')
                        + (state.getPlayerDeductions(key) ? (' -' + state.getPlayerDeductions(key)) : '');
                })
                .join('\n') || 'None.');
        }
        // Return the daily status info
        else if (sanitizedText.includes('daily')) {
            msg.reply(state.getOrderedDailyPlayers()
                .map((key) => {
                    return `- **${getRankString(state.getDailyRank(key) ?? 0)}** <@${key}>: **${state.getPlayerActivity(key).getRating()}** ar, **${state.getPointsEarnedToday(key)}** earned` + (state.getPointsLostToday(key) ? `, **${state.getPointsLostToday(key)}** lost` : '');
                })
                .join('\n') || 'None.');
        }
        // Return the state
        else if (sanitizedText.includes('state')) {
            await messenger.sendLargeMonospaced(msg.channel, state.toJson());
        }
        // Return the timeout info
        else if (sanitizedText.includes('timeouts')) {
            await logTimeouts();
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
            try { // TODO: refactor image sending into the messenger class?
                await msg.channel.sendTyping();
            } catch (err) {}
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
            for (let i = 0; i < 21; i++) {
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
        // Activity counter simulation/testing
        else if (sanitizedText.includes('activity')) {
            await msg.reply(state.getOrderedPlayers()
                .sort((x, y) => state.getPlayerActivity(y).getRating() - state.getPlayerActivity(x).getRating())
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
        else if (sanitizedText.includes('log')) {
            await msg.channel.send(dailyVolatileLog.map(entry => `**[${entry[0].toLocaleTimeString('en-US')}]:** ${entry[1]}`).join('\n') || 'Log is empty.');
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

        // If this user is the guest reveiller and the morning has not yet begun, wake the bot up
        const isReveille: boolean = state.getEventType() === DailyEventType.GuestReveille
            && state.getEvent().user === userId
            && !state.isMorning()
            && isAm;
        if (isReveille) {
            await wakeUp(false);
        }

        if (state.isMorning()) {
            // If the event is an anonymous submission day, then completely ignore the message
            if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
                return;
            }

            // Reset user's "days since last good morning" counter
            state.resetDaysSinceLGM(userId);

            // Determine whether a "nerf" should be applied to this player before his points are altered
            const applyLeaderNerf: boolean = state.hasNerfThreshold() && state.getPlayerPoints(userId) > state.getNerfThreshold();

            // Determine some properties related to the contents of the message
            const messageHasVideo: boolean = hasVideo(msg);
            const messageHasText: boolean = msg.content && msg.content.trim().length !== 0;

            // The conditions for triggering MF and GM are separate so that players can post videos-then-messages, vice-versa, or both together
            const triggerMonkeyFriday: boolean = (state.getEventType() === DailyEventType.MonkeyFriday) && messageHasVideo;
            // Only trigger GM if it contains text, since players often post images/video without text (but reply to reveillers no matter what)
            const triggerStandardGM: boolean = messageHasText || isReveille;

            // Handle MF messages if the conditions are met and its the user's first MF of the day
            if (triggerMonkeyFriday && !state.hasDailyVideoRank(userId)) {
                const videoRank: number = state.getNextDailyVideoRank();
                state.setDailyVideoRank(userId, videoRank);
                // Award points then reply (or react) to the message depending on the video rank
                if (videoRank === 1) {
                    state.awardPoints(userId, config.defaultAward);
                    messenger.reply(msg, languageGenerator.generate('{goodMorningReply.video?} 🐒'));
                } else {
                    state.awardPoints(userId, config.defaultAward / 2);
                    reactToMessage(msg, '🐒');
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
                    dumpState();
                    // React to the user grumpily
                    reactToMessage(msg, '😡');
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
                let comboBreakee: Snowflake;
                if (rank === 1) {
                    if (state.hasCombo()) {
                        const combo: Combo = state.getCombo();
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
                    const newCombo: Combo = state.getCombo();
                    if (newCombo.days > state.getMaxComboDays()) {
                        state.setMaxCombo({
                            user: newCombo.user,
                            days: newCombo.days
                        });
                        logger.log(`**${state.getPlayerDisplayName(newCombo.user)}** has set the max combo record with **${newCombo.days}** days!`);
                    }
                }

                // If the player said the magic word, reward them and let them know privately
                if (state.hasMagicWord() && msg.content.toLowerCase().includes(state.getMagicWord().toLowerCase())) {
                    state.awardPoints(userId, config.awardsByRank[1]);
                    await messenger.dm(msg.member, `You said _"${state.getMagicWord()}"_, the magic word of the day! Nice 😉`);
                    logStory += `said the magic word "${state.getMagicWord()}", `;
                }

                // Compute beckoning bonus and reset the state beckoning property if needed
                const wasBeckoned: boolean = state.getEventType() === DailyEventType.Beckoning && msg.author.id === state.getEvent().user;
                if (wasBeckoned) {
                    state.awardPoints(userId, config.awardsByRank[1]);
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
                    if (applyLeaderNerf) {
                        state.awardPoints(userId, Math.min(rankedPoints, activityPoints));
                        logStory += `and was awarded \`min(${rankedPoints}, ${activityPoints})\` with leader nerf`;
                    } else {
                        state.awardPoints(userId, Math.max(rankedPoints, activityPoints));
                        logStory += `and was awarded \`max(${rankedPoints}, ${activityPoints})\``;
                    }
                } else {
                    state.awardPoints(userId, config.defaultAward);
                    logStory += 'and sent an unoriginal GM message';
                }
                dailyVolatileLog.push([new Date(), logStory]);
                dumpState();

                // Add this user's message to the R9K text bank
                r9k.add(msg.content);

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

                // Very last thing to do is to update the player's displayName (only do this here since it may be expensive)
                state.setPlayerDisplayName(userId, await getDisplayName(userId));
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
                    reactToMessage(msg, ['😡', '😬', '😒', '😐', '🤫']);
                }
            }
            dumpState();
            // Reply if the user has hit a certain threshold
            if (state.getPlayerPoints(userId) === -2) {
                messenger.reply(msg, 'Why are you still talking?');
            } else if (state.getPlayerPoints(userId) === -5) {
                messenger.reply(msg, 'You have brought great dishonor to this server...');
            }
        }
    } else if (msg.channel instanceof DMChannel && !msg.author.bot) {
        // Always process admin commands if using the "ADMIN?" suffix (only needed to override DM-based events)
        if (guildOwnerDmChannel
            && msg.channel.id === guildOwnerDmChannel.id
            && msg.author.id === guildOwner.id
            && msg.content.endsWith('ADMIN?'))
        {
            await processCommands(msg);
            return;
        }
        // Process DM submissions depending on the event
        if (state.isMorning() && state.getEventType() === DailyEventType.AnonymousSubmissions) {
            const userId: Snowflake = msg.author.id;
            // Handle voting or submitting depending on what phase of the process we're in
            // TODO: Remove this once we can prove that the "vote" slash command works as expected
            if (state.getEvent().votes && state.getEvent().submissionOwnersByCode) {
                const pattern: RegExp = /[A-Z]+/g;
                // TODO: Should we validate the exact number of votes? There's no evidence of players griefing without this limitation just yet...
                const submissionCodes: string[] = [...msg.content.matchAll(pattern)].map(x => x[0]).slice(0, 3);
                const submissionCodeSet: Set<string> = new Set(submissionCodes);
                const validSubmissionCodes: Set<string> = new Set(Object.keys(state.getEvent().submissionOwnersByCode));
                // Do some validation on the vote before processing it further
                if (submissionCodes.length === 0) {
                    await messenger.reply(msg, `I don\'t understand, please tell me which submissions you\'re voting for. Choose from ${naturalJoin([...validSubmissionCodes])}.`);
                } else if (submissionCodeSet.size !== submissionCodes.length) {
                    await messenger.reply(msg, 'You can\'t vote for the same submission twice!');
                } else {
                    // Ensure that all votes are for valid submissions
                    for (let i = 0; i < submissionCodes.length; i++) {
                        const submissionCode: string = submissionCodes[i];
                        if (!validSubmissionCodes.has(submissionCode)) {
                            await messenger.reply(msg, `${submissionCode} is not a valid submission! Choose from ${naturalJoin([...validSubmissionCodes])}.`);
                            return;
                        }
                        if (state.getEvent().submissionOwnersByCode[submissionCode] === msg.author.id) {
                            await messenger.reply(msg, 'You can\'t vote for your own submission!');
                            return;
                        }
                    }
                    // Cast the vote
                    state.getEvent().votes[msg.author.id] = submissionCodes;
                    await dumpState();
                    // Notify the user of their vote
                    if (submissionCodes.length === 1) {
                        await messenger.reply(msg, `Your vote has been cast! You've voted for submission **${submissionCodes[0]}**. You can make a correction by sending me another message.`)
                    } else {
                        await messenger.reply(msg, `Your vote has been cast! Your picks (in order) are ${naturalJoin(submissionCodes.map(n => `**${n}**`), 'then')}. You can make a correction by sending me another message.`)
                    }

                }
            } else if (state.getEvent().submissions) {
                const redoSubmission: boolean = userId in state.getEvent().submissions;
                // Add the submission
                if (state.getEvent().isAttachmentSubmission) {
                    const url: string = msg.attachments.first()?.url;
                    if (!url) {
                        await messenger.reply(msg, 'Didn\'t you mean to send me an attachment?');
                        return;
                    }
                    state.getEvent().submissions[userId] = url;
                } else {
                    state.getEvent().submissions[userId] = msg.content;
                }
                // Reply to the player via DM to let them know their submission was received
                const numSubmissions: number = Object.keys(state.getEvent().submissions).length;
                if (redoSubmission) {
                    await messenger.reply(msg, 'Thanks for the update, I\'ll use this submission instead of your previous one.');
                } else {
                    await messenger.reply(msg, 'Thanks for your submission!');
                    // If we now have a multiple of some number of submissions, notify the server
                    if (numSubmissions % 3 === 0) {
                        await messenger.send(goodMorningChannel, languageGenerator.generate(`{!We now have|I've received|We're now at|I now count|Currently at|I have} **${numSubmissions}** {!submissions|submissions|entries}! {!DM me|Send me a DM with|Send me} a _${state.getEvent().submissionType}_ to {!participate|be included|join the fun|enter the contest|be a part of the contest}`));
                    }
                    logger.log(`Received submission from player **${state.getPlayerDisplayName(userId)}**, now at **${numSubmissions}** submissions`);
                    // This may be the user's first engagement, so refresh display name here
                    // TODO: is there a better, more unified way to do this?
                    state.setPlayerDisplayName(userId, await getDisplayName(userId));
                }
                await dumpState();
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
                logger.log(`**${state.getPlayerDisplayName(msg.author.id)}** submitted their writer's block greeting`);
            } else {
                await messenger.reply(msg, 'I can\'t send that...');
            }
        }
        // Process admin commands without the override suffix
        else if (guildOwnerDmChannel && msg.channel.id === guildOwnerDmChannel.id && msg.author.id === guildOwner.id) {
            await processCommands(msg);
        }
    }
});

client.login(auth.token);
