import { Client, DMChannel, Intents, MessageAttachment } from 'discord.js';
import { Guild, GuildMember, Message, Snowflake, TextBasedChannels } from 'discord.js';
import { DailyEvent, DailyEventType, GoodMorningConfig, GoodMorningHistory, Season, TimeoutType, Combo, CalendarDate, PastTimeoutStrategy } from './types.js';
import TimeoutManager from './timeout-manager.js';
import { createMidSeasonUpdateImage, createSeasonResultsImage } from './graphics.js';
import { hasVideo, randInt, validateConfig, getTodayDateString, reactToMessage, getOrderingUpset, sleep, randChoice, toCalendarDate, getTomorrow, generateKMeansClusters, getRankString, naturalJoin, getClockTime } from './util.js';
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
    });
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
    // If it's an even-numbered Wednesday, then do text submissions
    if (date.getDate() % 2 === 0 && date.getDay() === 3) {
        return {
            type: DailyEventType.AnonymousSubmissions,
            // TODO: Add new ones such as "short story", "motivational message" once this has happened a couple times
            submissionType: randChoice("haiku", "limerick", "poem (ABAB)", "2-sentence horror story"),
            submissions: {}
        };
    }
    // If it's an even-numbered Tuesday, then do attachment submissions
    if (date.getDate() % 2 === 0 && date.getDay() === 2) {
        return {
            type: DailyEventType.AnonymousSubmissions,
            // TODO: Add new ones such as "cute wholesome animal pic" once this has happened a couple times
            submissionType: "pic that goes hard",
            isAttachmentSubmission: true,
            submissions: {}
        };
    }
    // Every 2/3 days, take a chance to do some other event
    if (date.getDate() % 3 !== 0) {
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
                beckoning: randChoice(...potentialBeckonees)
            });
        }
        // If anyone is qualified to be a guest reveiller, add guest reveille as a potential event
        const potentialReveillers: Snowflake[] = state.getPotentialReveillers();
        if (potentialReveillers.length > 0) {
            const guestReveiller: Snowflake = randChoice(...potentialReveillers);
            potentialEvents.push({
                type: DailyEventType.GuestReveille,
                reveiller: guestReveiller
            });
        }
        // Now maybe return one of those events
        if (Math.random() < 0.75) {
            return randChoice(...potentialEvents);
        }
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
        case DailyEventType.SleepyMorning:
            await messenger.send(goodMorningChannel, languageGenerator.generate('{sleepyMorning}'));
            break;
        case DailyEventType.AnonymousSubmissions:
            const phrase: string = state.getEvent().isAttachmentSubmission ? 'find a' : 'write a special Good Morning';
            const text = `Good morning! Today is a special one. Rather than sending your good morning messages here for all to see, `
                + `I'd like you to ${phrase} _${state.getEvent().submissionType}_ and send it directly to me via DM! `
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
    const MIN_HOURS: Record<string, number> = {
        [DailyEventType.SleepyMorning]: 10
    };
    const MAX_HOURS: Record<string, number> = {
        [DailyEventType.SleepyMorning]: 11,
        [DailyEventType.AnonymousSubmissions]: 8
    };
    const MIN_HOUR: number = MIN_HOURS[state.getEventType()] ?? 6;
    const MAX_HOUR_EXCLUSIVE: number = MAX_HOURS[state.getEventType()] ?? 10;

    const morningTomorrow: Date = new Date();
    // Set date as tomorrow if it's after the earliest possible morning time
    if (morningTomorrow.getHours() >= MIN_HOUR) {
        morningTomorrow.setDate(morningTomorrow.getDate() + 1);
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

    // Set timeout for anonymous submission reveal
    if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
        const submissionRevealTime = new Date();
        submissionRevealTime.setHours(10, 30, 0, 0);
        // We register this with the "Invoke" strategy since we want it to happen before Pre-Noon (with which it's registered in parallel)
        await timeoutManager.registerTimeout(TimeoutType.AnonymousSubmissionReveal, submissionRevealTime, PastTimeoutStrategy.Invoke);
    }

    // Set timeout for when morning almost ends
    const preNoonToday: Date = new Date();
    preNoonToday.setHours(11, randInt(50, 57), randInt(0, 60), 0);
    // We register this with the "Increment Hour" strategy since its subsequent timeout (Noon) is registered in series
    await timeoutManager.registerTimeout(TimeoutType.NextPreNoon, preNoonToday, PastTimeoutStrategy.IncrementHour);

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

const finalizeAnonymousSubmissions = async () => {
    // First, tally the votes and compute the scores
    const scores: Record<string, number> = {}; // Map (submission number : points)
    const breakdown: Record<string, number[]> = {};
    Object.values(state.getEvent().votes).forEach(submissionNumbers => {
        submissionNumbers.forEach((submissionNumber, i) => {
            scores[submissionNumber] = (scores[submissionNumber] ?? 0) + 3 - i;
            // Take note of the breakdown
            if (breakdown[submissionNumber] === undefined) {
                breakdown[submissionNumber] = [0, 0, 0];
            }
            breakdown[submissionNumber][i]++;
        });
    });

    // Compile the set of those who didn't vote
    const deadbeats: Set<Snowflake> = new Set();
    Object.keys(state.getEvent().submissions).forEach(userId => {
        if (state.getEvent().votes[userId] === undefined) {
            // Add the player to the set
            deadbeats.add(userId);
            // Penalize the player
            state.deductPoints(userId, config.defaultAward);
            state.incrementPlayerPenalties(userId);
        }
    })

    // Deleting certain event data will prevent action taken on further DMs
    delete state.getEvent().submissions;
    delete state.getEvent().votes;
    await dumpState();

    // Then, assign points based on rank in score (excluding those who didn't vote)
    const submissionNumbers: Snowflake[] = Object.keys(scores).filter(n => !deadbeats.has(state.getEvent().submissionOwnersByNumber[n]));
    submissionNumbers.sort((x, y) => scores[y] - scores[x]);
    for (let i = 0; i < submissionNumbers.length; i++) {
        const submissionNumber: string = submissionNumbers[i];
        const rank: number = i + 1;
        const pointsEarned: number = config.largeAwardsByRank[rank] ?? config.defaultAward;
        const userId: Snowflake = state.getEvent().submissionOwnersByNumber[submissionNumber];
        state.awardPoints(userId, pointsEarned);
        state.setDailyRank(userId, rank);
        state.resetDaysSinceLGM(userId);
    }

    // Reveal the winners (and loser) to the channel
    await messenger.send(goodMorningChannel, 'Now, time to reveal the results...');
    if (deadbeats.size > 0) {
        await sleep(5000);
        const deadbeatsText: string = naturalJoin([...deadbeats].map(userId => `<@${userId}>`));
        await messenger.send(goodMorningChannel, `Before anything else, say hello to the deadbeats who were disqualified for not voting! ${deadbeatsText} 👋`);
    }
    for (let i = submissionNumbers.length - 1; i >= 0; i--) {
        const submissionNumber: string = submissionNumbers[i];
        const userId: Snowflake = state.getEvent().submissionOwnersByNumber[submissionNumber];
        const rank: number = i + 1;
        if (i === submissionNumbers.length - 1) {
            await sleep(5000);
            await messenger.send(goodMorningChannel, `In dead last, we have the poor old <@${userId}> with submission **#${submissionNumber}**... better luck next time 😬`);
        } else if (i === 0) {
            await sleep(5000);
            await messenger.send(goodMorningChannel, `And in first place, with submission **#${submissionNumber}**...`);
            await sleep(3000);
            await messenger.send(goodMorningChannel, `Receiving **${breakdown[submissionNumber][0]}** gold votes, **${breakdown[submissionNumber][1]}** silver votes, and **${breakdown[submissionNumber][2]}** bronze votes...`);
            await sleep(6000);
            await messenger.send(goodMorningChannel, `We have our winner, <@${userId}>! Congrats!`);
        } else if (i < 3) {
            await sleep(5000);
            await messenger.send(goodMorningChannel, `In ${getRankString(rank)} place, we have <@${userId}> with submission **#${submissionNumber}**!`);
        }
    }

    // Finally, send DMs to let each user know their ranking
    const totalSubmissions: number = submissionNumbers.length;
    for (let i = 0; i < submissionNumbers.length; i++) {
        const submissionNumber: string = submissionNumbers[i];
        const userId: Snowflake = state.getEvent().submissionOwnersByNumber[submissionNumber];
        const rank: number = i + 1;
        try {
            await messenger.dm(await fetchMember(userId), `Your ${state.getEvent().submissionType} placed **${getRankString(rank)}** of **${totalSubmissions}**, `
                + `receiving **${breakdown[submissionNumber][0]}** gold votes, **${breakdown[submissionNumber][1]}** silver votes, and **${breakdown[submissionNumber][2]}** bronze votes. `
                + `Thanks for participating ${config.defaultGoodMorningEmoji}`);
        } catch (err) {
            await logger.log(`Unable to send results DM to **${state.getPlayerDisplayName(userId)}**: \`${err.toString()}\``);
        }
    }

    // Delete remaining event data
    delete state.getEvent().submissionOwnersByNumber;
    delete state.getEvent().votingMessage;
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
            await finalizeAnonymousSubmissions();

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

        // Register a timeout that will allow the bot to "wake up" tomorrow
        if (state.getEventType() === DailyEventType.GuestReveille) {
            // Register "fallback" timeout to wake up in case the guest reveille doesn't say anything
            await registerGuestReveilleFallbackTimeout();
        } else {
            // Register the normal GM timeout
            await registerGoodMorningTimeout();
        }

        // Dump state and R9K hashes
        await dumpState();
        await dumpR9KHashes();

        // If this is happening at a non-standard time, explicitly warn players (add some tolerance in case of timeout variance)
        const clockTime: string = getClockTime();
        const standardClockTimes: Set<string> = new Set(['11:59', '12:00', '12:01']);
        if (!standardClockTimes.has(clockTime)) {
            await messenger.send(goodMorningChannel, 'The "morning" technically ends now, so SHUT UP 🤫');
        }

        // If anyone's score is above the season goal, then proceed to the next season
        if (state.isSeasonGoalReached()) {
            const previousState: GoodMorningState = state;
            await advanceSeason();
            await sendSeasonEndMessages(goodMorningChannel, previousState);
        }

        // Update the bot's status
        await setStatus(false);
    },
    [TimeoutType.GuestReveilleFallback]: async (): Promise<void> => {
        // Take action if the guest reveiller hasn't said GM
        if (!state.isMorning()) {
            // Penalize the reveiller
            const userId: Snowflake = state.getEvent().reveiller;
            state.deductPoints(userId, 2);
            state.incrementPlayerPenalties(userId);
            // Wake up, then send a message calling out the reveiller (don't tag them, we don't want to give them an advantage...)
            await wakeUp(false);
            await messenger.send(goodMorningChannel, `Good morning! I had to step in because I guess ${state.getPlayerDisplayName(userId)} isn't cut out for the job 😒`);
        }
    },
    [TimeoutType.AnonymousSubmissionReveal]: async (): Promise<void> => {
        // Send the initial message
        const votingMessage: Message = await messenger.sendAndGet(goodMorningChannel,
            `Here are your anonymous submissions! Vote by sending me a DM with your top 3 picks (e.g. _"Hello magnificent GMBR, I vote for 3, 6, and 9"_). `
            + `If you submitted a ${state.getEvent().submissionType}, you _must_ vote otherwise you will be disqualified and penalized.`);
        state.getEvent().votingMessage = votingMessage.id;
        state.getEvent().votes = {};
        state.getEvent().submissionOwnersByNumber = {};
        await dumpState();

        // Get all the relevant user IDs and shuffle them
        const userIds: Snowflake[] = Object.keys(state.getEvent().submissions);
        userIds.sort((x, y) => Math.random() - Math.random());

        // For each submission (in shuffled order)...
        for (let i = 0; i < userIds.length; i++) {
            const userId: Snowflake = userIds[i];
            const submission: string = state.getEvent().submissions[userId];
            const submissionNumber: string = (i + 1).toString();
            
            // Keep track of which user this submission's "number" maps to
            state.getEvent().submissionOwnersByNumber[submissionNumber] = userId;
            await dumpState();

            try {
                // Send the message out
                const messageHeader: string = `**Submission #${submissionNumber}:**`;
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

        // Schedule voting reminders
        [[11, 0], [11, 15], [11, 30]].forEach(([hour, minute]) => {
            const reminderTime: Date = new Date();
            reminderTime.setHours(hour, minute);
            // We register these with the "Delete" strategy since they are terminal and aren't needed if in the past
            timeoutManager.registerTimeout(TimeoutType.AnonymousSubmissionVotingReminder, reminderTime, PastTimeoutStrategy.Delete);
        });
    },
    [TimeoutType.AnonymousSubmissionVotingReminder]: async (): Promise<void> => {
        // Send notification for the public in the channel
        try {
            const votingMessage: Message = await goodMorningChannel.messages.fetch(state.getEvent().votingMessage);
            await messenger.reply(votingMessage, `If you haven't already, please vote on your favorite ${state.getEvent().submissionType}!`);
        } catch (err) {
            logger.log(`Failed to fetch voting message and send reminder: \`${err.toString()}\``);
        }
        // DM players who still haven't voted
        Object.keys(state.getEvent().submissions).forEach(async (userId) => {
            if (state.getEvent().votes[userId] === undefined) {
                try {
                    await messenger.dm(await fetchMember(userId),
                        `You still haven\'t voted! You and your ${state.getEvent().submissionType} will be disqualified if you don't vote. `
                            + 'You can vote by telling me which submissions you liked (e.g. _"I liked 2, 4, and 8"_)');
                } catch (err) {
                    await logger.log(`Unable to send voting reminder DM to **${state.getPlayerDisplayName(userId)}**: \`${err.toString()}\``);
                }
            }
        });
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
        goodMorningChannel = (await client.channels.fetch(config.goodMorningChannelId)) as TextBasedChannels;
    } catch (err) {}
    if (!goodMorningChannel) {
        await logger.log(`Couldn't load good morning channel with Id "${config.goodMorningChannelId}", aborting...`);
        process.exit(1);
    }

    // Load all necessary data from disk
    await loadState();
    await loadHistory();
    await loadR9KHashes();
    await timeoutManager.loadTimeouts();

    if (guildOwner && goodMorningChannel) {
        await logger.log(`Bot rebooting at **${getClockTime()}** with guild owner **${guildOwner.displayName}** and GM channel ${goodMorningChannel.toString()}`);
    }
    await logTimeouts();

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
                    return `- <@${key}>: **${state.getPlayerPoints(key)}** (${state.getPlayerDaysSinceLGM(key)}d)` + (state.getPlayerDeductions(key) ? (' -' + state.getPlayerDeductions(key)) : '');
                })
                .join('\n'));
        }
        // Return the daily status info
        else if (sanitizedText.includes('daily')) {
            msg.reply(state.getOrderedDailyPlayers()
                .map((key) => {
                    return `- **${getRankString(state.getDailyRank(key) ?? 0)}** <@${key}>: **${state.getPointsEarnedToday(key)}** earned` + (state.getPointsLostToday(key) ? `, **${state.getPointsLostToday(key)}** lost` : '');
                })
                .join('\n'));
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
                                // Breakee loses at most one "default award" as a penalty
                                state.deductPoints(comboBreakee, config.defaultAward);
                                // Breaker is awarded points for each day of the broken combo (half a "default award" per day)
                                state.awardPoints(userId, comboDaysBroken * config.defaultAward * 0.5);
                                // Increment the breaker's "combos broken" counter
                                state.incrementPlayerCombosBroken(userId);
                            }
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
                        const joinedUpsettees: string = naturalJoin(orderingUpsets.map(x => `**${state.getPlayerDisplayName(x)}**`));
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
                    reactToMessage(msg, ['😡', '😬', '😒', '😐', '🤫']);
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
        if (state.isMorning() && state.getEventType() === DailyEventType.AnonymousSubmissions) {
            const userId: Snowflake = msg.author.id;
            // Handle voting or submitting depending on what phase of the process we're in
            if (state.getEvent().votes && state.getEvent().submissionOwnersByNumber) {
                const pattern: RegExp = /\d+/g;
                // TODO: Should we validate the exact number of votes? There's no evidence of players griefing without this limitation just yet...
                const submissionNumbers: string[] = [...msg.content.matchAll(pattern)].map(x => x[0]).slice(0, 3);
                const submissionNumberSet: Set<string> = new Set(submissionNumbers);
                const validSubmissionNumbers: Set<string> = new Set(Object.keys(state.getEvent().submissionOwnersByNumber));
                // Do some validation on the vote before processing it further
                if (submissionNumbers.length === 0) {
                    await messenger.reply(msg, `I don\'t understand, please tell me which submissions you\'re voting for. Choose from ${naturalJoin([...validSubmissionNumbers])}.`);
                } else if (submissionNumberSet.size !== submissionNumbers.length) {
                    await messenger.reply(msg, 'You can\'t vote for the same submission twice!');
                } else {
                    // Ensure that all votes are for valid submissions
                    for (let i = 0; i < submissionNumbers.length; i++) {
                        const submissionNumber: string = submissionNumbers[i];
                        if (!validSubmissionNumbers.has(submissionNumber)) {
                            await messenger.reply(msg, `${submissionNumber} is not a valid submission number! Choose from ${naturalJoin([...validSubmissionNumbers])}.`);
                            return;
                        }
                        if (state.getEvent().submissionOwnersByNumber[submissionNumber] === msg.author.id) {
                            await messenger.reply(msg, 'You can\'t vote for your own submission!');
                            return;
                        }
                    }
                    // Cast the vote
                    state.getEvent().votes[msg.author.id] = submissionNumbers;
                    await dumpState();
                    // Notify the user of their vote
                    if (submissionNumbers.length === 1) {
                        await messenger.reply(msg, `Your vote has been cast! You've voted for submission **#${submissionNumbers[0]}**. You can make a correction by sending me another message.`)
                    } else {
                        await messenger.reply(msg, `Your vote has been cast! Your picks (in order) are ${naturalJoin(submissionNumbers.map(n => `**#${n}**`), 'then')}. You can make a correction by sending me another message.`)
                    }

                }
            } else if (state.getEvent().submissions) {
                const redoSubmission: boolean = userId in state.getEvent().submissions;
                // Add the submission
                if (state.getEvent().isAttachmentSubmission) {
                    const url: string = msg.attachments.first()?.url;
                    if (!url) {
                        await messenger.reply(msg, 'Didn\'t you mean to send me an attachment?');
                        return;4
                    }
                    state.getEvent().submissions[userId] = url;
                } else {
                    state.getEvent().submissions[userId] = msg.content;
                }
                await dumpState();
                // Reply to the player via DM to let them know their submission was received
                const numSubmissions: number = Object.keys(state.getEvent().submissions).length;
                if (redoSubmission) {
                    await messenger.reply(msg, 'Thanks for the update, I\'ll use this submission instead of your previous one.');
                } else {
                    await messenger.reply(msg, 'Thanks for your submission!');
                    // If we now have a multiple of some number of submissions, notify the server
                    if (numSubmissions % 3 === 0) {
                        await messenger.send(goodMorningChannel, languageGenerator.generate(`{!We now have|I've received} **${numSubmissions}** submissions! {!DM me|Send me a DM with} a _${state.getEvent().submissionType}_ to {!participate|be included|join the fun}`));
                    }
                    logger.log(`Received submission from player **${state.getPlayerDisplayName(userId)}**, now at **${numSubmissions}** submissions`);
                }
            }
        }
        // Process admin commands
        else if (guildOwnerDmChannel && msg.channel.id === guildOwnerDmChannel.id && msg.author.id === guildOwner.id) {
            await processCommands(msg);
        }
    }
});

client.login(auth.token);
