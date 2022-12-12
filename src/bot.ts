import { Client, DMChannel, Intents, MessageAttachment, MessageEmbedOptions, TextChannel } from 'discord.js';
import { Guild, GuildMember, Message, Snowflake, TextBasedChannels } from 'discord.js';
import { DailyEvent, DailyEventType, GoodMorningConfig, GoodMorningHistory, Season, TimeoutType, Combo, CalendarDate, HomeStretchSurprise, PrizeType, Bait, AnonymousSubmission, GameState } from './types';
import { hasVideo, validateConfig, reactToMessage, extractYouTubeId, toSubmissionEmbed, toSubmission } from './util';
import GoodMorningState from './state';
import logger from './logger';

import { addReactsSync, chance, FileStorage, generateKMeansClusters, getClockTime, getPollChoiceKeys, getRandomDateBetween, getRankString, getRelativeDateTimeString, getTodayDateString, getTomorrow, LanguageGenerator, loadJson, Messenger, naturalJoin, PastTimeoutStrategy, R9KTextBank, randChoice, randInt, shuffle, sleep, TimeoutManager, toCalendarDate, toFixed, toLetterId } from 'evanw555.js';
import DungeonCrawler from './games/dungeon';
import ActivityTracker from './activity-tracker';
import AbstractGame from './games/abstract-game';
import ClassicGame from './games/classic';

const auth = loadJson('config/auth.json');
const config: GoodMorningConfig = loadJson('config/config.json');

const storage = new FileStorage('./data/');
const languageConfig = loadJson('config/language.json');
const languageGenerator = new LanguageGenerator(languageConfig);
languageGenerator.setLogger((message) => {
    logger.log(message);
});
const r9k = new R9KTextBank();
const baitR9K = new R9KTextBank();
const knownYouTubeIds: Set<string> = new Set();
const messenger = new Messenger();
messenger.setLogger((message) => {
    logger.log(message);
});
messenger.setMemberResolver(async (id) => {
    return await guild.members.fetch(id);
});

const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MEMBERS,
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

const fetchMembers = async (userIds: Snowflake[]): Promise<Record<Snowflake, GuildMember>> => {
    const members = await guild.members.fetch({ user: userIds });
    const result = {};
    for (const [userId, member] of members.entries()) {
        result[userId] = member;
    }
    return result;
}

const getBoldNames = (userIds: Snowflake[]): string => {
    return naturalJoin(userIds.map(userId => `**${state.getPlayerDisplayName(userId)}**`));
}

const getJoinedMentions = (userIds: Snowflake[]): string => {
    return naturalJoin(userIds.map(userId => `<@${userId}>`));
}

const reactToMessageById = async (messageId: Snowflake, emoji: string | string[]): Promise<void> => {
    try {
        const message = await goodMorningChannel.messages.fetch(messageId);
        await reactToMessage(message, emoji);
    } catch (err) {
        await logger.log(`Failed to react with ${emoji} to message with ID \`${messageId}\`: \`${err}\``);
    }
}

/**
 * For each player currently in the state, fetch their current member info and update it everywhere in the state (e.g. display name, avatar).
 */
const refreshStateMemberInfo = async (): Promise<void> => {
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
            await goodMorningChannel.permissionOverwrites.delete(await fetchMember(userId));
        } catch (err) {
            await logger.log(`Unable to grant GM channel access for user <@${userId}>: \`${err.toString()}\``);
        }
        state.setPlayerMute(userId, false);
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
        state.setPlayerMute(userId, true);
    }
}

/**
 * For a given user, return how many seasons are remaining in their sungazer term (or 0 if not on the council).
 */
const getSungazerTerm = (userId: Snowflake): number => {
    return history.sungazers[userId] ?? 0;
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
    // Send the final state to the guild owner one last time before wiping it
    if (guildOwnerDmChannel) {
        await guildOwnerDmChannel.send(`The final state of season **${state.getSeasonNumber()}** before it's wiped:`);
        await messenger.sendLargeMonospaced(guildOwnerDmChannel, state.toJson());
    }
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

const chooseEvent = (date: Date): DailyEvent | undefined => {
    // Sunday: Game Update
    if (date.getDay() === 0) {
        return {
            type: DailyEventType.GameUpdate
        };
    }
    // Saturday: Game Decision
    if (date.getDay() === 6) {
        return {
            type: DailyEventType.GameDecision
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
        return {
            type: DailyEventType.AnonymousSubmissions,
            // TODO: Add new ones such as "short story", "motivational message" once this has happened a couple times
            submissionType: randChoice(
                // 50% chance to suggest a text prompt
                randChoice("haiku", "limerick", "poem (ABAB)", "2-sentence horror story", "fake movie title", `${randInt(6, 12)}-word story`),
                // 50% chance to suggest an image prompt
                randChoice("pic that goes hard", "cursed image", "dummy stupid pic", "pic that goes adorable", randChoice("pic that goes ruh", "pic that goes buh"))
            ),
            submissions: {}
        };
    }
    // If this date has a calendar date message override, then just do a standard GM (don't do any of the nonstandard ones below)
    const calendarDate: CalendarDate = toCalendarDate(date); // e.g. "12/25" for xmas
    if (calendarDate in config.goodMorningMessageOverrides) {
        return undefined;
    }
    // Begin home stretch if we're far enough along and not currently in the home stretch (this will be delayed if an above event needs to happen instead e.g. MF)
    // TODO (2.0): Re-enable this?
    // if (state.getSeasonCompletion() >= 0.85 && !state.isHomeStretch()) {
    //     return {
    //         type: DailyEventType.BeginHomeStretch,
    //         homeStretchSurprises: [HomeStretchSurprise.Multipliers, HomeStretchSurprise.LongestComboBonus, HomeStretchSurprise.ComboBreakerBonus]
    //     };
    // }
    // High chance of a random event 2/3 days, low chance 1/3 days
    const eventChance: number = (date.getDate() % 3 === 0) ? 0.3 : 0.9;
    if (chance(eventChance)) {
        // Compile a list of potential events (include default events)
        const potentialEvents: DailyEvent[] = [
            // TODO (2.0): Should I re-enable these?
            // {
            //     type: DailyEventType.GrumpyMorning
            // },
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
        if (potentialWriters.length > 0 && chance(0.5)) {
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
        const prizeText: string = state.getGame().awardPrize(userId, type, intro);
        await dumpState();
        if (prizeText) {
            await messenger.dm(userId, prizeText, { immediate: true });
            await logger.log(`Sent _${type}_ prize DM to **${state.getPlayerDisplayName(userId)}**`);
        }
    } catch (err) {
        await logger.log(`Unable to award _${type}_ prize to **${state.getPlayerDisplayName(userId)}**: \`${err.toString()}\``);
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
                files: [] // TODO (2.0): Should we just delete this?
            });
            break;
        case DailyEventType.MonkeyFriday:
            await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage ?? '{happyFriday}'));
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
        case DailyEventType.AnonymousSubmissions:
            // If there's an overridden message, just send it naively upfront
            if (overriddenMessage) {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage));
            }
            // Send the standard submission prompt
            const intro: string = overriddenMessage ? 'There\'s more!' : 'Good morning! Today is a special one.';
            const text = `${intro} Rather than sending your good morning messages here for all to see, `
                + `I'd like you to come up with a _${state.getEvent().submissionType}_ and send it directly to me via DM! `
                + `At 11:00, I'll post them here anonymously and you'll all be voting on your favorites 😉`;
            await messenger.send(goodMorningChannel, text);
            // Also, let players know they can forfeit
            await sleep(10000);
            await messenger.send(goodMorningChannel, 'If you won\'t be able to vote, then you can use `/forfeit` to avoid the no-vote penalty. '
                + `Your _${state.getEvent().submissionType}_ will still be presented, but you won't be rewarded if you win big.`);
            break;
        case DailyEventType.GameDecision:
            // If there's an overridden message, just send it naively upfront
            if (overriddenMessage) {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage));
            }
            // Send the game state plus header text and basic instructions
            let decisionHeader = `Turn **${state.getGame().getTurn()}** has begun!`;
            if (state.getGame().getTurn() === 1) {
                decisionHeader = state.getGame().getIntroductionText();
            }
            await goodMorningChannel.send({
                content: decisionHeader,
                files: [new MessageAttachment(await state.getGame().renderState({ season: state.getSeasonNumber() }), `game-turn${state.getGame().getTurn()}-decision.png`)]
            });
            await messenger.send(goodMorningChannel, state.getGame().getInstructionsText(), { immediate: true });
            break;
        case DailyEventType.GameUpdate:
            if (!state.hasGame()) {
                await logger.log('Attempted to send out the game update Sunday GM message with no game instance! Aborting...');
                return;
            }
            await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage ?? '{goodMorning}'));
            await goodMorningChannel.send({
                content: 'Here\'s where we\'re all starting from. In just a few minutes, we\'ll be seeing the outcome of this week\'s turn...',
                files: [new MessageAttachment(await state.getGame().renderState({ season: state.getSeasonNumber() }), `game-turn${state.getGame().getTurn()}-begin.png`)]
            });
            break;
        default:
            // Otherwise, send the standard GM message as normal (do a season intro greeting if today is the first day)
            if (state.getSeasonStartedOn() === getTodayDateString()) {
                const text = `Good morning everyone and welcome to season **${state.getSeasonNumber()}**! `
                    + 'This season will be very different from seasons past, you\'ll see what I mean on Saturday... '
                    + `I hope to see many familiar faces, and if I\'m lucky maybe even some new ones ${config.defaultGoodMorningEmoji}`;
                await messenger.send(goodMorningChannel, text);
            } else if (chance(config.goodMorningMessageProbability)) {
                await messenger.send(goodMorningChannel, languageGenerator.generate(overriddenMessage ?? '{goodMorning}'));
            }
            break;
        }
    }
};

const sendSeasonEndMessages = async (channel: TextBasedChannels, previousState: GoodMorningState): Promise<void> => {
    // TODO (2.0): We should do this a little more safely...
    const winner: Snowflake = previousState.getGame().getWinners()[0];
    const newSeason: number = previousState.getSeasonNumber() + 1;
    await messenger.send(channel, `Well everyone, season **${previousState.getSeasonNumber()}** has finally come to an end!`);
    await messenger.send(channel, 'Thanks to all those who have participated. You have made these mornings bright and joyous for not just me, but for everyone here 🌞');
    await sleep(10000);
    // await messenger.send(channel, 'In a couple minutes, I\'ll reveal the winners and the final standings...');
    // await messenger.send(channel, 'In the meantime, please congratulate yourselves (penalties are disabled), take a deep breath, and appreciate the friends you\'ve made in this channel 🙂');
    // Send the "final results image"
    // await sleep(120000);
    // await messenger.send(channel, 'Alright, here are the final standings...');
    // try { // TODO: refactor image sending into the messenger class?
    //     await channel.sendTyping();
    // } catch (err) {}
    // await sleep(5000);
    // const attachment = new MessageAttachment(await createSeasonResultsImage(previousState, history.medals), 'results.png');
    // await channel.send({ files: [attachment] });
    // await sleep(5000);
    await messenger.send(channel, `Congrats to the winner of this season, <@${winner}>!`);
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

const chooseGoodMorningTime = (eventType: DailyEventType | undefined): Date => {
    // Hour-minute overrides of the earliest/latest possible time of a particular event
    const MIN_HOURS: Record<string, [number, number]> = {
        [DailyEventType.SleepyMorning]: [10, 0],
        [DailyEventType.ReverseGoodMorning]: [7, 0]
    };
    const MAX_HOURS: Record<string, [number, number]> = {
        [DailyEventType.SleepyMorning]: [11, 30],
        [DailyEventType.ReverseGoodMorning]: [11, 15],
        [DailyEventType.AnonymousSubmissions]: [8, 0],
        [DailyEventType.GameUpdate]: [9, 0]
    };
    const MIN_HOUR: [number, number] = MIN_HOURS[eventType] ?? [6, 0];
    const MAX_HOUR_EXCLUSIVE: [number, number] = MAX_HOURS[eventType] ?? [10, 45];

    // Set boundary of possible date a number of days in the future (1 by default)
    const lowDate: Date = new Date();
    lowDate.setDate(lowDate.getDate());
    lowDate.setHours(...MIN_HOUR, 0, 0);
    const highDate: Date = new Date();
    highDate.setDate(highDate.getDate());
    highDate.setHours(...MAX_HOUR_EXCLUSIVE, 0, 0);

    // Choose a random time between those two times with a 2nd degree Bates distribution
    return getRandomDateBetween(lowDate, highDate, 2);
};

const registerGoodMorningTimeout = async (): Promise<void> => {
    // Choose a random time based on the event type
    const nextMorning: Date = chooseGoodMorningTime(state.getEventType());

    // If the chosen morning time has already past, then advance the date to tomorrow
    if (nextMorning.getTime() < new Date().getTime()) {
        nextMorning.setDate(nextMorning.getDate() + 1);
    }

    // We register this with the "Increment Day" strategy since it happens at a particular time and it's not competing with any other triggers.
    await timeoutManager.registerTimeout(TimeoutType.NextGoodMorning, nextMorning, { pastStrategy: PastTimeoutStrategy.IncrementDay });
};

const registerGuestReveilleFallbackTimeout = async (): Promise<void> => {
    // Schedule tomrrow sometime between 11:30 and 11:45
    const date: Date = getTomorrow();
    date.setHours(11, randInt(30, 45), randInt(0, 60));
    // We register this with the "Invoke" strategy since this way of "waking up" is competing with a user-driven trigger.
    // We want to invoke this ASAP in order to avoid this event when it's no longer needed.
    await timeoutManager.registerTimeout(TimeoutType.GuestReveilleFallback, date, { pastStrategy: PastTimeoutStrategy.Invoke });
};

const wakeUp = async (sendMessage: boolean): Promise<void> => {
    // If attempting to wake up while already awake, warn the admin and abort
    if (state.isMorning()) {
        logger.log('WARNING! Attempted to wake up while `state.isMorning` is already `true`');
        return;
    }

    // If today is the first decision of the season, instantiate the game...
    if (state.getEventType() === DailyEventType.GameDecision && !state.hasGame()) {
        // Fetch all participating members, ordered by performance in the first week
        const participatingUserIds: Snowflake[] = state.getOrderedPlayers();
        const members = [];
        for (const userId of participatingUserIds) {
            try {
                const member = await guild.members.fetch(userId);
                members.push(member);
            } catch (err) {
                await logger.log(`Failed to fetch member <@${userId}> when creating game: \`${err}\``);
            }
        }
        // Create the dungeon using these initial members
        // TODO (2.0): Eventually, this should be more generic for other game types
        const dungeon = DungeonCrawler.createSectional(members, { sectionSize: 11, sectionsAcross: 3 });
        state.setGame(dungeon);
        // For all starting players, add the points they earned before the game was instantiated
        for (const userId of participatingUserIds) {
            state.getGame().addPoints(userId, state.getPlayerPoints(userId));
        }
    }

    // If today is a decision day
    const newlyAddedPlayers: Snowflake[] = [];
    if (state.getEventType() === DailyEventType.GameDecision && state.hasGame()) {
        // First, attempt to refresh state member info
        await refreshStateMemberInfo();
        // Add new players to the game
        const addPlayerLogs: string[] = [];
        const newPlayers: Snowflake[] = state.getPlayers().filter(userId => !state.getGame().hasPlayer(userId));
        const newMembersById = await fetchMembers(newPlayers);
        for (const [userId, member] of Object.entries(newMembersById)) {
            // Add player to the game (for the first week, this should be handled by the dungeon initialization logic above)
            const addPlayerLog: string = state.getGame().addPlayer(member);
            addPlayerLogs.push(addPlayerLog);
            newlyAddedPlayers.push(userId);
            // Add all points earned before this player was added to the game
            state.getGame().addPoints(userId, state.getPlayerPoints(userId));
        }
        await logger.log(addPlayerLogs.join('\n') || 'No new players were added this week.');
        // Begin this week's turn
        state.getGame().beginTurn();
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

    // Give a hint for today's magic word
    if (state.hasMagicWord()) {
        // Get list of all suitable recipients of the magic word (this is a balancing mechanic, so pick players who are behind yet active)
        const potentialMagicWordRecipients: Snowflake[] = state.getPotentialMagicWordRecipients();
        // Determine if we should give out the hint
        const shouldGiveHint: boolean = potentialMagicWordRecipients.length > 0
            && state.getEventType() !== DailyEventType.BeginHomeStretch;
        // If yes, then give out the hint to one randomly selected suitable recipient
        if (shouldGiveHint) {
            const magicWordRecipient: Snowflake = randChoice(...potentialMagicWordRecipients);
            await messenger.dm(magicWordRecipient, `Psssst.... the magic word of the day is _"${state.getMagicWord()}"_`);
            if (magicWordRecipient !== guildOwner.id) {
                await logger.log(`Magic word _"${state.getMagicWord()}"_ was sent to **${state.getPlayerDisplayName(magicWordRecipient)}**`);
            }
        }
    }

    // Set timeout to prime the game processing loop
    if (state.getEventType() === DailyEventType.GameUpdate) {
        const firstDecisionProcessDate: Date = new Date();
        firstDecisionProcessDate.setMinutes(firstDecisionProcessDate.getMinutes() + 5);
        await timeoutManager.registerTimeout(TimeoutType.ProcessGameDecisions, firstDecisionProcessDate, { pastStrategy: PastTimeoutStrategy.Invoke });
    }

    if (state.getEventType() === DailyEventType.BeginHomeStretch) {
        // Activate home stretch mode!
        state.setHomeStretch(true);
        // Set timeout for first home stretch surprise (these events are recursive)
        const surpriseTime = new Date();
        surpriseTime.setMinutes(surpriseTime.getMinutes() + 10);
        await timeoutManager.registerTimeout(TimeoutType.HomeStretchSurprise, surpriseTime, { pastStrategy: PastTimeoutStrategy.Invoke });
    }

    if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
        // Set timeout for anonymous submission reveal
        const submissionRevealTime = new Date();
        submissionRevealTime.setHours(11, 0, 0, 0);
        // We register this with the "Invoke" strategy since we want it to happen before Pre-Noon (with which it's registered in parallel)
        await timeoutManager.registerTimeout(TimeoutType.AnonymousSubmissionReveal, submissionRevealTime, { pastStrategy: PastTimeoutStrategy.Invoke });
        // Also, create the forfeit command
        await guild.commands.create({
            name: 'forfeit',
            description: `Forfeit the ${state.getEvent().submissionType} contest to avoid a penalty`
        });
    }

    const minutesEarly: number = state.getEventType() === DailyEventType.EarlyEnd ? (state.getEvent().minutesEarly ?? 0) : 0;
    // Set timeout for when morning almost ends
    const preNoonToday: Date = new Date();
    preNoonToday.setHours(11, randInt(48, 56) - minutesEarly, randInt(0, 60), 0);
    // We register this with the "Increment Hour" strategy since its subsequent timeout (Noon) is registered in series
    await timeoutManager.registerTimeout(TimeoutType.NextPreNoon, preNoonToday, { pastStrategy: PastTimeoutStrategy.IncrementHour });

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

    // Let the channel know of all the newly joined players
    if (newlyAddedPlayers.length === 1) {
        await messenger.send(goodMorningChannel, `Let's all give a warm welcome to ${getJoinedMentions(newlyAddedPlayers)}, for this puppy is joining the game this week!`)
    } else if (newlyAddedPlayers.length > 1) {
        await messenger.send(goodMorningChannel, `Let's all give a warm welcome to ${getJoinedMentions(newlyAddedPlayers)}, for they are joining the game this week!`);
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

    // If we're 20% of the way through the season, determine the nerf threshold for today
    // TODO (2.0): Do we want this?
    // if (state.getSeasonCompletion() > 0.2) {
    //     // Threshold is 2 top awards below the top score
    //     const nerfThreshold: number = toFixed(state.getTopScore() - (2 * config.bonusAward));
    //     state.setNerfThreshold(nerfThreshold);
    //     dailyVolatileLog.push([new Date(), `Set nerf threshold to ${nerfThreshold}`]);
    // }

    // Process "reverse" GM ranks
    if (state.getEventType() === DailyEventType.ReverseGoodMorning) {
        const mostRecentUsers: Snowflake[] = Object.keys(state.getEvent().reverseGMRanks);
        mostRecentUsers.sort((x, y) => state.getEvent().reverseGMRanks[y] - state.getEvent().reverseGMRanks[x]);
        // Process the users in order of most recent reverse GM message
        for (let i = 0; i < mostRecentUsers.length; i++) {
            const userId: Snowflake = mostRecentUsers[i];
            const rank: number = i + 1;
            const rankedPoints: number = config.mediumAwardsByRank[rank] ?? config.defaultAward;
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

    // Finally, re-grant access for all muted players
    await grantGMChannelAccess(state.getMutedPlayers());

    // Dump state
    await dumpState();
};

const finalizeAnonymousSubmissions = async () => {
    const event = state.getEvent();

    if (!event.votes || !event.submissions) {
        await logger.log('WARNING! Attempting to finalize submissions with the votes and/or submissions already wiped. Aborting!');
        return;
    }

    // First and foremost, hold onto all the state data locally
    const votes = event.votes;
    const submissions: Record<Snowflake, AnonymousSubmission> = event.submissions;
    const submissionOwnersByCode = event.submissionOwnersByCode;
    const allCodes = Object.keys(submissionOwnersByCode);
    const deadbeats: Snowflake[] = state.getSubmissionDeadbeats();
    const forfeiters: Snowflake[] = event.forfeiters ?? [];
    const deadbeatSet: Set<Snowflake> = new Set(deadbeats);
    const disqualifiedCodes: string[] = allCodes.filter(code => deadbeatSet.has(submissionOwnersByCode[code]));

    // Now that all the data has been gathered, delete everything from the state to prevent further action
    delete event.votes;
    delete event.submissions;
    delete event.submissionOwnersByCode;
    delete event.forfeiters;
    await dumpState(); // Just in case anything below fails

    // Disable voting and forfeiting by deleting commands
    const guildCommands = await guild.commands.fetch();
    guildCommands.forEach(command => {
        if ((command.name === 'vote' || command.name === 'forfeit') && command.applicationId === client.application.id) {
            command.delete();
        }
    });

    // First, tally the votes and compute the scores
    const scores: Record<string, number> = {}; // Map (submission code : points)
    const breakdown: Record<string, number[]> = {};
    // Prime both maps (some submissions may get no votes)
    const GAZER_TERM_BONUS: number = 0.001;
    for (const code of allCodes) {
        const userId: Snowflake = submissionOwnersByCode[code];
        // Prime with a base score to ultimately break ties based on previous GMBR wins
        scores[code] = getSungazerTerm(userId) * GAZER_TERM_BONUS;
        breakdown[code] = [0, 0, 0];
    }
    // Now tally the actual scores and breakdowns
    // Add 0.1 to break ties using total number of votes, 0.01 to ultimately break ties with golds
    const GOLD_VOTE_VALUE = 3.11;
    const SILVER_VOTE_VALUE = 2.1;
    const BRONZE_VOTE_VALUE = 1.1;
    const VOTE_VALUES: number[] = [GOLD_VOTE_VALUE, SILVER_VOTE_VALUE, BRONZE_VOTE_VALUE];
    for (const codes of Object.values(votes)) {
        codes.forEach((code, i) => {
            scores[code] = toFixed(scores[code] + (VOTE_VALUES[i] ?? 0), 3);
            // Take note of the breakdown
            breakdown[code][i]++;
        });
    }

    // Penalize the submitters who didn't vote (but didn't forfeit)
    for (const userId of deadbeats) {
        state.deductPoints(userId, config.defaultAward);
    }

    // Then, assign points based on rank in score (excluding those who didn't vote or forfeit)
    const validCodesSorted: string[] = allCodes.filter(code => !deadbeatSet.has(submissionOwnersByCode[code]));
    validCodesSorted.sort((x, y) => scores[y] - scores[x]);
    const winners: Snowflake[] = [];
    const handicapReceivers: Set<string> = new Set();
    for (let i = 0; i < validCodesSorted.length; i++) {
        const submissionCode: string = validCodesSorted[i];
        const rank: number = i + 1;
        const userId: Snowflake = submissionOwnersByCode[submissionCode];
        const pointsEarned: number = forfeiters.includes(userId) ? config.defaultAward : config.largeAwardsByRank[rank] ?? config.defaultAward;
        // If the player placed in the top 3 and needs a handicap, give them double points
        if (rank <= 3 && state.doesPlayerNeedHandicap(userId)) {
            state.awardPoints(userId, 2 * pointsEarned);
            handicapReceivers.add(userId);
        } else {
            state.awardPoints(userId, pointsEarned);
        }
        state.setDailyRank(userId, rank);
        state.resetDaysSinceLGM(userId);
        winners.push(userId);
    }
    await dumpState(); // Just in case anything below fails

    // Reveal the winners (and losers) to the channel
    await messenger.send(goodMorningChannel, 'Now, time to reveal the results...');
    if (deadbeats.length > 0) {
        await sleep(10000);
        await messenger.send(goodMorningChannel, `Before anything else, say hello to the deadbeats who were disqualified for not voting! ${getJoinedMentions(deadbeats)} 👋`);
    }
    const zeroVoteCodes: string[] = validCodesSorted.filter(code => scores[code] < BRONZE_VOTE_VALUE);
    if (zeroVoteCodes.length > 0) {
        const zeroVoteUserIds: Snowflake[] = zeroVoteCodes.map(code => submissionOwnersByCode[code]);
        await sleep(12000);
        await messenger.send(goodMorningChannel, `Now, let us extend our solemn condolences to ${getJoinedMentions(zeroVoteUserIds)}, for they received no votes this fateful morning... 😬`);
    }
    for (let i = validCodesSorted.length - 1; i >= 0; i--) {
        const code: string = validCodesSorted[i];
        const userId: Snowflake = submissionOwnersByCode[code];
        const rank: number = i + 1;
        const submission: AnonymousSubmission = submissions[userId];
        if (i === 0) {
            await sleep(12000);
            await messenger.send(goodMorningChannel, `And in first place, with submission **${code}**...`);
            await sleep(6000);
            await messenger.send(goodMorningChannel, `Receiving **${breakdown[code][0]}** gold votes, **${breakdown[code][1]}** silver votes, and **${breakdown[code][2]}** bronze votes...`);
            await sleep(12000);
            if (forfeiters.includes(userId)) {
                await messenger.send(goodMorningChannel, 'Being awarded only participation points on account of them sadly forfeiting...');
                await sleep(6000);
            }
            // TODO: Integrate this into the Messenger utility
            await goodMorningChannel.send({
                content: `We have our winner, <@${userId}>! Congrats!`,
                embeds: [ toSubmissionEmbed(submission) ]
            });
        } else if (i < 3) {
            await sleep(12000);
            const headerText: string = forfeiters.includes(userId)
                ? `In ${getRankString(rank)} place yet only receiving participation points, we have the forfeiting <@${userId}> with submission **${code}**!`
                : `In ${getRankString(rank)} place, we have <@${userId}> with submission **${code}**!`;
            // TODO: Integrate this into the Messenger utility
            await goodMorningChannel.send({
                content: headerText,
                embeds: [ toSubmissionEmbed(submission) ]
            });
        }
    }

    // Send DMs to let each user know their ranking
    const numValidSubmissions: number = validCodesSorted.length;
    for (let i = 0; i < validCodesSorted.length; i++) {
        const code: string = validCodesSorted[i];
        const userId: Snowflake = submissionOwnersByCode[code];
        const rank: number = i + 1;
        // Calculate number of each medal earned
        const numGold = breakdown[code][0];
        const numSilver = breakdown[code][1];
        const numBronze = breakdown[code][2];
        // Send the DM (let them know about forfeiting and handicapping too)
        await messenger.dm(userId,
            `Your ${state.getEvent().submissionType} placed **${getRankString(rank)}** of **${numValidSubmissions}**, receiving `
                + `**${numGold}** gold vote${numGold === 1 ? '' : 's'}, `
                + `**${numSilver}** silver vote${numSilver === 1 ? '' : 's'}, and `
                + `**${numBronze}** bronze vote${numBronze === 1 ? '' : 's'}. `
                + `Thanks for participating ${config.defaultGoodMorningEmoji}`
                + (forfeiters.includes(userId) ? ' (and sorry that you had to forfeit)' : '')
                + (handicapReceivers.has(userId) ? ' (since you\'re a little behind, I\'ve doubled the points earned for this win!)' : ''),
            { immediate: true });
    }

    // Award special prizes and notify via DM
    if (winners[0]) {
        await awardPrize(winners[0], 'submissions1', 'Congrats on your victory');
    }
    if (winners[1]) {
        await awardPrize(winners[1], 'submissions2', 'Congrats on snagging 2nd place');
    }
    if (winners[2]) {
        await awardPrize(winners[2], 'submissions3', 'Congrats on snagging 3rd place');
    }

    // Send the details of the scoring to the sungazers
    // TODO: Remove this try-catch once we're sure it works
    await messenger.send(sungazersChannel, 'FYI gazers, here are the details of today\'s voting...');
    try {
        const allCodesSorted: string[] = validCodesSorted.concat(disqualifiedCodes);
        const scoringDetails: string = allCodesSorted.map((c, i) => {
            const medalsText: string = ('🥇'.repeat(breakdown[c][0]) + '🥈'.repeat(breakdown[c][1]) + '🥉'.repeat(breakdown[c][2])) || '🌚';
            const userId: Snowflake = submissionOwnersByCode[c];
            if (deadbeatSet.has(userId)) {
                return `**DQ**: ${c} ~~<@${userId}>~~ \`${medalsText}=${scores[c]}\``;
            } else if (forfeiters.includes(userId)) {
                return `**${getRankString(i + 1)}(F)**: ${c} ~~<@${userId}>~~ \`${medalsText}=${scores[c]}\``;
            } else {
                return `**${getRankString(i + 1)}**: ${c} <@${userId}> \`${medalsText}=${scores[c]}\``;
            }
        }).join('\n');
        await messenger.send(sungazersChannel, scoringDetails);
        // Let them know how the score is calculated
        await messenger.send(sungazersChannel, `(\`score = ${GOLD_VOTE_VALUE}🥇 + ${SILVER_VOTE_VALUE}🥈 + ${BRONZE_VOTE_VALUE}🥉 + ${GAZER_TERM_BONUS}🌞\`)`);
    } catch (err) {
        await messenger.send(sungazersChannel, 'Nvm, my brain is melting');
        await logger.log(`Failed to compute and send voting/scoring log: \`${err}\``);
    }

    // Misc logging
    if (handicapReceivers.size > 0) {
        await logger.log(`Awarded handicap points to ${getBoldNames(Array.from(handicapReceivers))}!`);
    }

    await dumpState();
};

const TIMEOUT_CALLBACKS = {
    [TimeoutType.NextGoodMorning]: async (): Promise<void> => {
        await wakeUp(true);
    },
    [TimeoutType.NextPreNoon]: async (): Promise<void> => {
        const minutesEarly: number = state.getEventType() === DailyEventType.EarlyEnd ? (state.getEvent().minutesEarly ?? 0) : 0;
        // Set timeout for when morning ends
        const noonToday: Date = new Date();
        noonToday.setHours(12, 0, 0, 0);
        noonToday.setMinutes(noonToday.getMinutes() - minutesEarly);
        // We register this with the "Increment Hour" strategy since its subsequent timeout (GoodMorning) is registered in series
        await timeoutManager.registerTimeout(TimeoutType.NextNoon, noonToday, { pastStrategy: PastTimeoutStrategy.IncrementHour });
        // Set timeout for when baiting starts
        const baitingStartTime: Date = new Date();
        baitingStartTime.setHours(11, 59, 0, 0);
        baitingStartTime.setMinutes(baitingStartTime.getMinutes() - minutesEarly);
        // We register this with the "Delete" strategy since it doesn't schedule any events and it's non-critical
        await timeoutManager.registerTimeout(TimeoutType.BaitingStart, baitingStartTime, { pastStrategy: PastTimeoutStrategy.Delete });


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
        // TODO (2.0): Should this be re-enabled?
        if (false && leaderUpset) {
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
    [TimeoutType.BaitingStart]: async (): Promise<void> => {
        // Start accepting bait
        state.setAcceptingBait(true);
        await dumpState();
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
        const newStreakUsers: Snowflake[] = state.incrementPlayerActivities();
        // Award prizes to all players who just achieved full streaks
        for (const userId of newStreakUsers) {
            await awardPrize(userId, 'streak', `Thank you for bringing us Good Morning cheer for **${ActivityTracker.CAPACITY}** consecutive days`);
        }

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

        // Dump state and R9K hashes
        await dumpState();
        await dumpR9KHashes();
        await dumpBaitR9KHashes();
        await dumpYouTubeIds();

        // Revoke access for all players who should be muted (based on their track record / penalty history)
        await revokeGMChannelAccess(state.getDelinquentPlayers());

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
            // If there's a nightmare event, schedule the timeout for it
            if (state.getEventType() === DailyEventType.Nightmare) {
                // Sometime between 1am-4am
                const nightmareDate: Date = getTomorrow();
                nightmareDate.setHours(randInt(1, 4), randInt(0, 60), randInt(0, 60), 0);
                // If this event was missed, simply delete it (nothing will be impacted if it's skipped)
                await timeoutManager.registerTimeout(TimeoutType.Nightmare, nightmareDate, { pastStrategy: PastTimeoutStrategy.Delete });
                await logger.log(`Scheduled nightmare event for **${getRelativeDateTimeString(nightmareDate)}**`);
            }
            // Notify the sungazers about tomorrow's event (if applicable)
            if (state.getEventType() === DailyEventType.AnonymousSubmissions) {
                const fyiText: string = `FYI gazers: tomorrow, everyone will be sending me a _${state.getEvent().submissionType}_. `
                    + `If you have another idea, reply to this message with an alternative prompt ${config.defaultGoodMorningEmoji}`;
                const fyiMessage = await sungazersChannel.send(fyiText);
                // In an hour, fetch replies to this message and start a poll for the submission type
                const pollStartDate = new Date();
                pollStartDate.setHours(pollStartDate.getHours() + 2);
                // Use the delete strategy because it's not required and we want to ensure it's before the morning date
                await timeoutManager.registerTimeout(TimeoutType.AnonymousSubmissionTypePollStart, pollStartDate, { arg: fyiMessage.id, pastStrategy: PastTimeoutStrategy.Delete });
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
            try {
                await messenger.dm(state.getEvent().user,
                    "Hey, I've been experiencing a little writer's block lately and can't think of a solid greeting for tomorrow. "
                    + "What do you think I should say? Send me something and I'll use it as my Good Morning greeting tomorrow as-is 🤔");
                await logger.log(`Sent writer's block invite to **${state.getPlayerDisplayName(state.getEvent().user)}**`);
            } catch (err) {
                await logger.log(`Unable to send writer's block invite to **${state.getPlayerDisplayName(state.getEvent().user)}**: \`${err.toString()}\``);
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
            await timeoutManager.registerTimeout(TimeoutType.NextGoodMorning, nextSeasonStart, { pastStrategy: PastTimeoutStrategy.IncrementDay });
            await logger.log(`Registered next season's first GM for **${getRelativeDateTimeString(nextSeasonStart)}**`);
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
        shuffle(userIds);

        // For each submission (in shuffled order)...
        for (let i = 0; i < userIds.length; i++) {
            const userId: Snowflake = userIds[i];
            const submission = state.getEvent().submissions[userId];
            const submissionCode: string = toLetterId(i);
            
            // Keep track of which user this submission's "number" maps to
            state.getEvent().submissionOwnersByCode[submissionCode] = userId;
            await dumpState();

            try {
                // Send the message out
                await goodMorningChannel.send({
                    content: `**Submission ${submissionCode}:**`,
                    embeds: [ toSubmissionEmbed(submission) ]
                })
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
            timeoutManager.registerTimeout(TimeoutType.AnonymousSubmissionVotingReminder, reminderTime, { pastStrategy: PastTimeoutStrategy.Delete });
        });
    },
    [TimeoutType.AnonymousSubmissionVotingReminder]: async (): Promise<void> => {
        if (!state.getEvent().votes) {
            await logger.log('Aborting submission voting reminder, as the votes have already been wiped.');
            return;
        }
        const delinquents: Snowflake[] = state.getSubmissionDeadbeats();
        if (delinquents.length === 1) {
            // Send voting reminder targeting the one remaining user
            await messenger.send(goodMorningChannel, `Ahem <@${delinquents[0]}>... Please vote.`);
        } else if (delinquents.length > 1) {
            // Send a voting notification to the channel
            try {
                const rootSubmissionMessage: Message = await goodMorningChannel.messages.fetch(state.getEvent().rootSubmissionMessage);
                await messenger.reply(rootSubmissionMessage, `If you haven't already, please vote on your favorite ${state.getEvent().submissionType} with \`/vote\`!`);
            } catch (err) {
                logger.log(`Failed to fetch root submission message and send reminder: \`${err.toString()}\``);
            }
            // Also, DM players who still haven't voted
            if (delinquents.length > 0) {
                await logger.log(`Sending voting reminder DM to ${getBoldNames(delinquents)}...`);
                delinquents.forEach(async (userId) => {
                    try {
                        await messenger.dm(userId,
                            `You still haven\'t voted! You and your ${state.getEvent().submissionType} will be disqualified if you don't vote by noon. You can vote with the \`/vote\` command.`);
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
        if (state.getEventType() !== DailyEventType.AnonymousSubmissions) {
            await logger.log(`Aborting anonymous submission type poll start, as the current event type is \`${state.getEventType()}\``);
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

        // If there are no proposed alternatives, abort...
        if (proposalSet.size === 0) {
            await logger.log('Aborting anonymous submission type poll start, there were no proposals...');
            return;
        }

        // If there are too many, trim it down to 10
        const maxAlternatives: number = 10;
        if (proposalSet.size > maxAlternatives) {
            await logger.log(`Too many anonymous submission type proposals, truncating from **${proposalSet.size}** to **${maxAlternatives}**`);
            proposalSet = new Set(Array.from(proposalSet).slice(0, maxAlternatives));
        }

        // Add the original proposed prompt
        proposalSet.add(state.getEvent().submissionType);
        // Shuffle all the prompts
        const proposedTypes: string[] = Array.from(proposalSet);
        shuffle(proposedTypes);

        // Construct the poll data
        const choiceKeys: string[] = getPollChoiceKeys(proposedTypes);
        const choices: Record<string, string> = {};
        for (let i = 0; i < proposedTypes.length; i++) {
            choices[choiceKeys[i]] = proposedTypes[i];
        }

        // Send the poll message and prime the choices
        const pollMessage = await sungazersChannel.send('What should people submit tomorrow?\n' + Object.entries(choices).map(([key, value]) => `${key} _${value}_`).join('\n'));
        await addReactsSync(pollMessage, choiceKeys, { delay: 500 });

        // Schedule the end of the poll
        const pollEndDate = new Date();
        pollEndDate.setHours(pollEndDate.getHours() + 5);
        const arg = {
            messageId: pollMessage.id,
            choices
        }
        // Use the delete strategy because it's not required and we want to ensure it's before the morning date
        await timeoutManager.registerTimeout(TimeoutType.AnonymousSubmissionTypePollEnd, pollEndDate, { arg, pastStrategy: PastTimeoutStrategy.Delete });
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
        if (state.getEventType() !== DailyEventType.AnonymousSubmissions) {
            await logger.log(`Aborting anonymous submission type poll end, as the current event type is \`${state.getEventType()}\``);
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

        // Update the submission type in the state
        state.getEvent().submissionType = randChoice(...winningChoices);
        await dumpState();

        // Notify the channel
        await pollMessage.reply(`The results are in, everyone will be sending me a _${state.getEvent().submissionType}_ ${config.defaultGoodMorningEmoji}`);
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
        const surprises: HomeStretchSurprise[] = state.getEvent()?.homeStretchSurprises;
        if (surprises && surprises.length > 0) {
            // Get the next surprise and dump state
            const surprise: HomeStretchSurprise = surprises.shift();
            await dumpState();
            // Recursively schedule the next timeout
            const nextTimeout: Date = new Date();
            nextTimeout.setMinutes(nextTimeout.getMinutes() + 10);
            await timeoutManager.registerTimeout(TimeoutType.HomeStretchSurprise, nextTimeout, { pastStrategy: PastTimeoutStrategy.Invoke });
            // Act on this surprise
            switch (surprise) {
            case HomeStretchSurprise.Multipliers:
                const x1players: Snowflake[] = [];
                const x1_5players: Snowflake[] = [];
                const x2players: Snowflake[] = [];
                const orderedPlayers: Snowflake[] = state.getOrderedPlayers();
                // Update player multipliers and dump state
                orderedPlayers.forEach(userId => {
                    // TODO (2.0): Re-enable this using some accurate form of completion?
                    // if (state.getPlayerPoints(userId) <= 0) {
                    //     state.setPlayerMultiplier(userId, 0.5);
                    // } else if (state.getPlayerCompletion(userId) >= 0.8) {
                    //     x1players.push(userId);
                    // } else if (state.getPlayerCompletion(userId) >= 0.7) {
                    //     x1_5players.push(userId);
                    //     state.setPlayerMultiplier(userId, 1.5);
                    // } else if (state.getPlayerCompletion(userId) >= 0.5) {
                    //     x2players.push(userId);
                    //     state.setPlayerMultiplier(userId, 2);
                    // } else {
                    //     state.setPlayerMultiplier(userId, 3);
                    // }
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
                    const pointsAwarded: number = state.awardPoints(maxCombo.user, config.bonusAward);
                    await dumpState();
                    // Notify channel
                    await messenger.send(goodMorningChannel, `The winner is <@${maxCombo.user}>, with a streak lasting **${maxCombo.days}** days! This bonus is worth **${pointsAwarded}%** karma ${config.defaultGoodMorningEmoji}`);
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
                    const pointsAwarded: number = state.awardPoints(maxBreaker, config.bonusAward);
                    await dumpState();
                    // Notify channel
                    await messenger.send(goodMorningChannel, `The winner is <@${maxBreaker}>, who broke **${maxTimesBroken}** streaks! This bonus is worth **${pointsAwarded}%** karma ${config.defaultGoodMorningEmoji}`);
                }
                break;
            }
        } else {
            await goodMorningChannel.send({
                content: 'Well that\'s all for now! Here are the updated standings, good luck everyone!',
                files: [] // TODO (2.0): Should we just delete this?
            });
        }
    },
    [TimeoutType.ProcessGameDecisions]: async (): Promise<void> => {
        if (!state.hasGame()) {
            await logger.log('Tried to invoke the game decision processing loop with no game instance! Aborting...');
            return;
        }

        // Start sending the typing event
        try {
            await goodMorningChannel.sendTyping();
        } catch (err) {
            await logger.log(`Failed to send typing on game processing loop: ${err}`);
        }

        // Process player decisions
        const game = state.getGame();
        const processingResult = game.processPlayerDecisions();
        await dumpState();

        // Sleep based on the length of the text
        // TODO: This should be integrated into the messenger tool
        try {
            await sleep(processingResult.summary.length * randInt(45, 55));
        } catch (err) {
            await logger.log(`Failed to sleep on game processing loop: ${err}`);
        }

        // Render the updated state and send it out
        const attachment = new MessageAttachment(await game.renderState({ season: state.getSeasonNumber() }), `game-week${game.getTurn()}.png`);
        await goodMorningChannel.send({ content: processingResult.summary, files: [attachment] });

        if (processingResult.continueProcessing) {
            // If there are more decisions to be processed, schedule the next processing timeout
            const nextProcessDate: Date = new Date();
            // Schedule the next processing time to be sooner if it's later in the day
            if (new Date().getHours() >= 11) {
                nextProcessDate.setMinutes(nextProcessDate.getMinutes() + randInt(1, 5));
            } else if (new Date().getHours() >= 10) {
                nextProcessDate.setMinutes(nextProcessDate.getMinutes() + randInt(3, 10));
            } else {
                nextProcessDate.setMinutes(nextProcessDate.getMinutes() + randInt(5, 15));
            }
            await timeoutManager.registerTimeout(TimeoutType.ProcessGameDecisions, nextProcessDate, { pastStrategy: PastTimeoutStrategy.Invoke });
        } else {
            // Otherwise, let the people know that the turn is over
            await messenger.send(goodMorningChannel, languageGenerator.generate('{!Well|Alright,} that\'s {!all|it} for this {!week|turn}! Are you all {!proud of your actions|happy with the outcome|optimistic|feeling good}?'));
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

    // Update the bot's status
    await setStatus(state.isMorning());
});

client.on('guildMemberRemove', async (member): Promise<void> => {
    // Remove this user from the state
    state.removePlayer(member.id);
    await logger.log(`**${member.displayName}** left the guild, removed from state`);
});

client.on('interactionCreate', async (interaction): Promise<void> => {
    if (interaction.isCommand() && interaction.applicationId === client.application.id) {
        const userId: Snowflake = interaction.user.id;
        await interaction.deferReply({ ephemeral: true });
        if (interaction.commandName === 'vote') {
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
                        if (state.getEvent().submissionOwnersByCode[submissionCode] === userId) {
                            await interaction.editReply('You can\'t vote for your own submission!');
                            return;
                        }
                    }
                    // Cast the vote
                    state.getEvent().votes[userId] = submissionCodes;
                    await dumpState();

                    if (state.haveAllSubmittersVoted()) {
                        // If all the votes have been cast, then finalize the voting
                        await interaction.editReply('Thanks, but you were the last to vote (no penalty, but be quicker next time) 🌚');
                        await finalizeAnonymousSubmissions();
                    } else {
                        // Otherwise, just send confirmation to the voter
                        await interaction.editReply('Your vote has been cast!');
                        // Notify the admin of how many votes remain
                        await logger.log(`**${state.getPlayerDisplayName(userId)}** just voted, waiting on **${state.getSubmissionDeadbeats().length}** more votes.`);
                    }
                }
            } else {
                await interaction.editReply('You shouldn\'t be able to vote right now!');
            }
        } else if (interaction.commandName === 'forfeit') {
            if (state.getEventType() === DailyEventType.AnonymousSubmissions && state.getEvent().submissions) {
                // If voting has started, notify and abort
                if (state.getEvent().votes) {
                    await interaction.editReply('You can\'t forfeit now, it\'s too late! Now please vote.');
                    return;
                }
                // If they haven't submitted anything, notify and abort
                if (!state.getEvent().submissions[userId]) {
                    await interaction.editReply('Why are you trying to forfeit? You haven\'t even submitted anything!');
                    return;
                }
                // If the forfeiters list isn't initialized, create it
                if (!state.getEvent().forfeiters) {
                    state.getEvent().forfeiters = [];
                }
                // Add the player to the forefeiters list if they're not already on it
                if (state.getEvent().forfeiters.includes(userId)) {
                    await interaction.editReply(languageGenerator.generate('{!Uhhh|Erm|Um}... you\'ve already forfeited, {!bonehead|blockhead|silly}.'));
                } else {
                    state.getEvent().forfeiters.push(userId);
                    await interaction.editReply('You have forfeited today\'s contest. This cannot be undone. You will still be able to vote, though.');
                    await logger.log(`**${state.getPlayerDisplayName(userId)}** has forfeited!`);
                }
                await dumpState();
            } else {
                await interaction.editReply('You can\'t forfeit right now!');
            }
        } else {
            await interaction.editReply(`Unknown command: \`${interaction.commandName}\``);
        }
    }
});

let tempDungeon: AbstractGame<GameState> = null;
let awaitingGameCommands = false;
let awaitingSubmission = false;

const processCommands = async (msg: Message): Promise<void> => {
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
    if (awaitingGameCommands) {
        // Emergency abort temp dungeon
        if (msg.content.replace(/^\+/, '').toLowerCase() === 'exit') {
            tempDungeon = null;
            awaitingGameCommands = false;
            await msg.reply('Exiting temp dungeon mode...');
            return;
        }
        if (tempDungeon) {
            const skipRenderingActions = msg.content.endsWith('!');
            if (msg.content.toLowerCase().includes('auto')) {
                await msg.reply('Using auto-actions...');
            } else {
                try {
                    const response = tempDungeon.addPlayerDecision(msg.author.id, msg.content.replace(/^\+/, '').replace(/!$/, ''));
                    try { // TODO: refactor typing event to somewhere else?
                        await msg.channel.sendTyping();
                    } catch (err) {}
                    // const randomOrdering: Snowflake[] = tempDungeon.getDecisionShuffledPlayers();
                    await msg.reply({
                        content: response, // + `\nHere's a sample random ordering: ${randomOrdering.map(x => tempDungeon.getDisplayName(x)).join(', ')}`,
                        files: [new MessageAttachment(await tempDungeon.renderState({ showPlayerDecision: msg.author.id, season: 99 }), 'confirmation.png')]
                    });
                    await sleep(5000);
                } catch (err) {
                    await msg.reply(err.toString());
                    return;
                }
            }

            // Process decisions and render state
            while (true) {
                const processingData = tempDungeon.processPlayerDecisions();
                if (!skipRenderingActions) {
                    try { // TODO: refactor typing event to somewhere else?
                        await msg.channel.sendTyping();
                    } catch (err) {}
                    const attachment = new MessageAttachment(await tempDungeon.renderState({ season: 99 }), 'dungeon.png');
                    await msg.channel.send({ content: processingData.summary.slice(0, 1990), files: [attachment] });
                    await sleep(2500);
                }
                if (!processingData.continueProcessing) {
                    break;
                }
            }
            await msg.channel.send('Turn is over!');

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
                tempDungeon.addPoints(otherId, randInt(0, state.getPlayerDisplayName(otherId).length));
            }
            tempDungeon.beginTurn();
            try { // TODO: refactor typing event to somewhere else?
                await msg.channel.sendTyping();
            } catch (err) {}
            const attachment = new MessageAttachment(await tempDungeon.renderState({ admin: true, season: 99 }), 'dungeon.png');
            await msg.channel.send({ content: tempDungeon.getInstructionsText(), files: [attachment] });

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
                    const gamePoints = (state.hasGame() && state.getGame().hasPlayer(key)) ? state.getGame().getPoints(key) : '???';
                    return `- <@${key}>: **${gamePoints}/${state.getPlayerPoints(key)}**`
                        + (state.isPlayerInGame(key) ? '' : ' _(NEW)_')
                        + (state.doesPlayerNeedHandicap(key) ? ' ♿' : '')
                        + (state.getPlayerDaysSinceLGM(key) ? ` ${state.getPlayerDaysSinceLGM(key)}d` : '')
                        + (state.getPlayerDeductions(key) ? (' -' + state.getPlayerDeductions(key)) : '');
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
                const event: DailyEvent | undefined = chooseEvent(eventTime);
                // Choose time for this event (have to reset days, annoying)
                eventTime = chooseGoodMorningTime(event?.type);
                eventTime.setDate(eventTime.getDate() + i);
                const eventString = event ? (Object.keys(event).length === 1 ? event.type : JSON.stringify(event)) : 'None'
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
                    new MessageAttachment(await state.getGame().renderState({ admin: true, season: state.getSeasonNumber() }), 'game-test-admin.png')
                ]});
            } else {
                await msg.reply('The game hasn\'t been created yet!');
            }
        } else if (sanitizedText.includes('temp')) {
            await msg.reply('Populating members...');
            const members = (await guild.members.list({ limit: randInt(10, 20) })).toJSON();
            // Add self if not already in the fetched members list
            if (members.every(m => m.id !== msg.author.id)) {
                members.push(await guild.members.fetch(msg.author.id));
            }
            await msg.reply(`Generating new game with **${members.length}** player(s)...`);
            awaitingGameCommands = true;
            if (sanitizedText.includes('dungeon')) {
                // tempDungeon = DungeonCrawler.createBest(members, 20, 40);
                tempDungeon = DungeonCrawler.createSectional(members, { sectionSize: 33, sectionsAcross: 1 }); // Before: size=11,across=3
                (tempDungeon as DungeonCrawler).addPlayerItem(msg.author.id, 'trap', 5);
                (tempDungeon as DungeonCrawler).addPlayerItem(msg.author.id, 'boulder', 3);
                (tempDungeon as DungeonCrawler).addPlayerItem(msg.author.id, 'seal', 3);
                (tempDungeon as DungeonCrawler).addPlayerItem(msg.author.id, 'key', 2);
                (tempDungeon as DungeonCrawler).addPlayerItem(msg.author.id, 'star', 1);
            } else {
                tempDungeon = ClassicGame.create(members);
            }
            tempDungeon.addPoints(msg.author.id, 10);
            tempDungeon.beginTurn();
            try { // TODO: refactor typing event to somewhere else?
                await msg.channel.sendTyping();
            } catch (err) {}
            const attachment = new MessageAttachment(await tempDungeon.renderState({ season: 99 }), 'dungeon.png');
            await msg.channel.send({ content: 'Here\'s the game', files: [attachment] }); // `Map Fairness: ${tempDungeon.getMapFairness().description}`
        } else if (sanitizedText.includes('submission')) {
            awaitingSubmission = true;
            await msg.reply('Awaiting submission...');
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

const saidMagicWord = (message: Message): boolean => {
    return state.hasMagicWord() && message.content?.toLowerCase().includes(state.getMagicWord().toLowerCase());
};

client.on('messageCreate', async (msg: Message): Promise<void> => {
    const userId: Snowflake = msg.author.id;
    if (goodMorningChannel && msg.channel.id === goodMorningChannel.id && !msg.author.bot) {
        const isAm: boolean = new Date().getHours() < 12;
        const isPlayerNew: boolean = !state.hasPlayer(userId);
        const isQuestion: boolean = msg.content && msg.content.trim().endsWith('?');

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
            // No matter what the event is, always update 11:59 bait (if user isn't the MRB and sent text)
            if (state.isAcceptingBait() && msg.content && userId !== state.getMostRecentBait()?.userId) {
                // Count this as bait only if it's a novel message
                if (baitR9K.contains(msg.content)) {
                    reactToMessage(msg, '🌚');
                } else {
                    baitR9K.add(msg.content);
                    state.setMostRecentBait(msg);
                    await dumpState();
                }
            }

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
                else if (videoRank === 1) {
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
                if (saidMagicWord(msg)) {
                    state.awardPoints(userId, config.bonusAward);
                    await messenger.dm(msg.member, `You said _"${state.getMagicWord()}"_, the magic word of the day! Nice 😉`);
                    logStory += `said the magic word "${state.getMagicWord()}", `;
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
                    if (applyLeaderNerf) {
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
                dumpState();

                // Add this user's message to the R9K text bank
                r9k.add(msg.content);

                // If it's a combo-breaker, reply with a special message (may result in double replies on Monkey Friday)
                if (sendComboBrokenMessage) {
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
                    // Reply (or react) to the user based on their rank (and chance)
                    else if (rank <= config.goodMorningReplyCount) {
                        if (chance(config.replyViaReactionProbability)) {
                            reactToMessage(msg, state.getGoodMorningEmoji());
                        } else if (isQuestion) {
                            // TODO: Can we more intelligently determine what type of question it is?
                            messenger.reply(msg, languageGenerator.generate('{goodMorningReply.question?}'));
                        } else {
                            messenger.reply(msg, languageGenerator.generate('{goodMorningReply.standard?}'));
                        }
                    } else {
                        reactToMessage(msg, state.getGoodMorningEmoji());
                    }
                }
            } else if (saidMagicWord(msg)) {
                // If this isn't the user's GM message yet they still said the magic word, let them know...
                await logger.log(`**${state.getPlayerDisplayName(userId)}** just said the magic word _"${state.getMagicWord()}"_, though too late...`);
                await messenger.dm(msg.member, languageGenerator.generate(`You {!said|just said} the {!magic word|word of the day|secret word|magic word of the day}, {!yet|but|though} {!you're a little too late|it wasn't in your GM message} so it doesn't count...`));
            }

            // Regardless of whether it's their first message or not, react to the magic word with a small probability
            if (saidMagicWord(msg) && chance(config.magicWordReactionProbability)) {
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
                if (state.getEvent().reverseGMRanks[userId] === undefined) {
                    state.getEvent().reverseGMRanks[userId] = new Date().getTime();
                    await reactToMessage(msg, state.getGoodMorningEmoji());
                    await dumpState();
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
            // If this player has more deductions than cumulative points, mute them immediately (hopefully this prevents abuse...)
            if (!state.isPlayerMuted(userId) && state.getPlayerDeductions(userId) > state.getPlayerPoints(userId)) {
                await revokeGMChannelAccess([userId]);
                await logger.log(`Revoked GM channel access for **${msg.member.displayName}**`);
            }
            // If someone baited and it's the afternoon, award and notify via DM
            const bait: Bait | undefined = state.getMostRecentBait();
            if (!isAm && bait) {
                state.awardPoints(bait.userId, config.defaultAward / 2);
                await logger.log(`Awarded **${state.getPlayerDisplayName(bait.userId)}** for baiting successfully.`);
                await messenger.dm(bait.userId, 'Bait successful.', { immediate: true });
                // If it's the baited's first offense, then reply with some chance
                if (!isRepeatOffense && chance(0.5)) {
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
        // Process game decisions via DM
        if (state.isAcceptingGameDecisions()) {
            if (state.hasGame()) {
                if (!state.getGame().hasPlayer(userId)) {
                    await msg.reply('You aren\'t in the game! Participate more if you want to play.');
                    return;
                }
                // Handle help requests
                if (msg.content.trim().toLowerCase() === 'help') {
                    await logger.log(`<@${userId}> asked for help!`);
                    await msg.reply(state.getGame().getHelpText());
                    return;
                }
                try {
                    // Validate decision string
                    const response: string = state.getGame().addPlayerDecision(userId, msg.content);
                    // If it succeeds, dump the state and reply with the validation response
                    await dumpState();
                    try { // TODO: refactor typing event to somewhere else?
                        await msg.channel.sendTyping();
                    } catch (err) {}
                    await msg.reply({
                        content: response,
                        files: [new MessageAttachment(await state.getGame().renderState({ showPlayerDecision: userId, season: state.getSeasonNumber() }), `game-turn${state.getGame().getTurn()}-confirmation.png`)]
                    });
                    await logger.log(`**${state.getPlayerDisplayName(userId)}** made a valid decision!`);
                } catch (err) {
                    // Validation failed, notify the user why it failed
                    await messenger.reply(msg, err.toString());
                }
            } else {
                await messenger.reply(msg, 'Oh dear... Looks like the game hasn\'t started yet. Please tell the admin.');
            }
        }
        // Process DM submissions depending on the event
        else if (state.isMorning() && state.getEventType() === DailyEventType.AnonymousSubmissions) {
            const userId: Snowflake = msg.author.id;
            // Handle submissions via DM only before voting has started
            if (state.getEvent().submissions && !state.getEvent().votes) {
                const redoSubmission: boolean = userId in state.getEvent().submissions;
                // Add the submission
                try {
                    state.getEvent().submissions[userId] = toSubmission(msg);
                } catch (err) {
                    await messenger.reply(msg, (err as Error).message);
                    return;
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
                    // This may be the user's first engagement, so refresh display name here
                    // TODO: is there a better, more unified way to do this?
                    state.setPlayerDisplayName(userId, await getDisplayName(userId));
                    logger.log(`Received submission from player **${state.getPlayerDisplayName(userId)}**, now at **${numSubmissions}** submissions`);
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

client.login(auth.token);
