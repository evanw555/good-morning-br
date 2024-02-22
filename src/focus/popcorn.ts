import { Message, PartialMessage, Snowflake, Typing } from "discord.js";
import AbstractFocusHandler from "./abstract-focus";
import { canonicalizeText, generateSynopsisWithAi, getMessageMentions, getSimpleScaledPoints, reactToMessage } from "../util";
import { MessengerPayload, TimeoutType } from "../types";
import { PastTimeoutStrategy, getRankString, getRelativeDateTimeString, naturalJoin, randChoice, randInt, splitTextNaturally } from "evanw555.js";

import { CONFIG } from '../constants';

import controller from "../controller";
import logger from "../logger";

export default class PopcornFocusGame extends AbstractFocusHandler {
    override async getGoodMorningMessage(intro: string): Promise<MessengerPayload> {
        return `${intro} Today we'll be playing _Popcorn_! You may only send a message once you've been called on. `
            + 'To call on a friend, simply tag them in your message. I\'ll let the first spot be up for grabs... Who wants to start today\'s Good Morning story?'
    }
    override async onMorningMessage(message: Message<boolean>): Promise<void> {
        const { state, languageGenerator, messenger } = controller.getAllReferences();

        const popcorn = state.getFocusGame();
        if (popcorn.type !== 'POPCORN') {
            return;
        }

        // Even if the message is invalid, give them zero points to mark them as "active" for the day
        const userId = message.author.id;
        popcorn.scores[userId] = (popcorn.scores[userId] ?? 0);

        if (popcorn.userId && userId !== popcorn.userId) {
            // This turn belongs to someone else, so penalize the user
            await reactToMessage(message, '🤫');
            // state.deductPoints(userId, config.defaultAward);
            // TODO: Should this be an actual deduction?
            popcorn.scores[userId] = (popcorn.scores[userId] ?? 0) - 1;
            await controller.dumpState();
            return;
        }
        // The user may talk this turn, so proceed...
        if (popcorn.ended && !popcorn.userId) {
            // The story is OVER, so don't process this message specially...
            // TODO: Temp logging
            await logger.log(`Post-story message by **${state.getPlayerDisplayName(userId)}**`);
        } else if (popcorn.ended && popcorn.userId && canonicalizeText(message.content).endsWith('theend')) {
            // If the selected user says "the end" near the end of the morning, end the story!
            // Delete the user to prevent further action
            delete popcorn.userId;
            // TODO: Do this a better way
            // Save the last story segment to the state
            popcorn.storySegments.push(message.cleanContent);
            await controller.dumpState();
            // Notify the channel
            await messenger.reply(message, languageGenerator.generate('{popcorn.ending?}'));
        } else {
            // TODO: Do this a better way
            // Save the last story segment to the state
            popcorn.storySegments.push(message.cleanContent);
            await controller.dumpState();
            // Pick out a potential fallback in case this user didn't tag correctly
            const mentionedUserIds = getMessageMentions(message);
            const fallbackUserId = this.getPopcornFallbackUserId();
            // If there's no fallback and the user is breaking the rules, force them to try again and abort
            if (!fallbackUserId) {
                if (mentionedUserIds.includes(userId)) {
                    await messenger.reply(message, 'You can\'t popcorn yourself you big dummy! Call on someone else');
                    return;
                } else if (mentionedUserIds.length === 0) {
                    await messenger.reply(message, 'Call on someone else!');
                    return;
                }
            }
            // React with popcorn to show that the torch has been passed
            await reactToMessage(message, '🍿');
            // Cancel any existing popcorn fallback timeouts
            await controller.cancelTimeoutsWithType(TimeoutType.FocusCustom);
            // Wipe the set of typing users for the previous turn
            controller.typingUsers.clear();
            // Save the latest popcorn message ID in the state
            popcorn.messageId = message.id;
            // Pass the torch to someone else...
            if (mentionedUserIds.includes(userId)) {
                // Tried to tag himself, so pass to the fallback user
                popcorn.userId = fallbackUserId;
                await messenger.reply(message, `You can\'t popcorn yourself you big dummy, let me pick for you: popcorn <@${fallbackUserId}>!`);
            } else if (mentionedUserIds.length === 0) {
                // Didn't tag anyone, so pass to the fallback user
                popcorn.userId = fallbackUserId;
                await messenger.reply(message, `Popcorn <@${fallbackUserId}>!`);
            } else if (mentionedUserIds.length === 1) {
                // Only one other user was mentioned, so pass the torch to them
                popcorn.userId = mentionedUserIds[0];
                // TODO: We should do something special if an unknown player is called on
            } else {
                // Multiple users were mentioned, so see if there are players who haven't said GM today and are known
                const preferredUserIds = mentionedUserIds.filter(id => !state.hasDailyRank(id) && state.hasPlayer(id));
                if (preferredUserIds.length === 0) {
                    // No other preferred players, so let the next turn be up for grabs
                    delete popcorn.userId;
                    await messenger.reply(message, 'You called on more than one person... I\'ll let the next turn be up for grabs!');
                } else {
                    // Select a random other preferred player
                    const randomUserId = randChoice(...preferredUserIds);
                    popcorn.userId = randomUserId;
                    await messenger.reply(message, `You called on more than one person, so let me pick for you: popcorn <@${randomUserId}>!`);
                }
            }
            await controller.dumpState();
            // If a user was selected, schedule a fallback timeout
            if (popcorn.userId) {
                await this.registerPopcornFallbackTimeout(popcorn.userId);
            }
        }

        // Award the user a point for participating correctly
        popcorn.scores[userId] = (popcorn.scores[userId] ?? 0) + 1;
    }

    private getPopcornFallbackUserId(): Snowflake | undefined {
        const { state } = controller.getAllReferences();

        const event = state.getEvent();
        // First, give priority to typing users who haven't had a turn yet
        const turnlessTypingUsers = Array.from(controller.typingUsers).filter(id => !state.hasDailyRank(id) && id !== event.user);
        if (turnlessTypingUsers.length > 0) {
            return randChoice(...turnlessTypingUsers);
        }
        // Next, give priority to typing users who may have had a turn already
        const otherTypingUsers = Array.from(controller.typingUsers).filter(id => id !== event.user);
        if (otherTypingUsers.length > 0) {
            return randChoice(...otherTypingUsers);
        }
        // Last priority goes to the most active user who hasn't had a turn yet
        return state.getActivityOrderedPlayers().filter(id => !state.hasDailyRank(id) && id !== event.user)[0];
    };

    override async onMorningTyping(typing: Typing): Promise<void> {
        const { state, timeoutManager, languageGenerator, messenger, goodMorningChannel } = controller.getAllReferences();

        const popcorn = state.getFocusGame();
        if (popcorn.type !== 'POPCORN') {
            return;
        }

        const userId = typing.user.id;
        if (popcorn.userId && popcorn.userId === userId) {
            // It's currently this user's turn, so postpone the fallback.
            // Determine the postponed fallback time
            const inFiveMinutes = new Date();
            inFiveMinutes.setMinutes(inFiveMinutes.getMinutes() + 5);
            // Determine the existing fallback time
            const existingFallbackTime = timeoutManager.getDateForTimeoutWithType(TimeoutType.FocusCustom);
            if (!existingFallbackTime) {
                await logger.log('Cannot postpone the popcorn fallback, as no existing fallback date was found!');
                return;
            }
            // Only postpone if the existing fallback is sooner than 1m from now (otherwise, it would be moved up constantly with lots of spam)
            if (existingFallbackTime.getTime() - new Date().getTime() < 1000 * 60) {
                const ids = await timeoutManager.postponeTimeoutsWithType(TimeoutType.FocusCustom, inFiveMinutes);
                // TODO: Temp logging to see how this is working
                await logger.log(`**${state.getPlayerDisplayName(userId)}** started typing, postpone fallback ` + naturalJoin(ids.map(id => `**${id}** to **${timeoutManager.getDateForTimeoutWithId(id)?.toLocaleTimeString()}**`)));
            }
        } else if (!popcorn.ended && !popcorn.userId) {
            // It's not this user's turn, but it's up for grabs so let them have it!
            popcorn.userId = userId;
            await controller.dumpState();
            await messenger.send(goodMorningChannel, languageGenerator.generate('{popcorn.typing?}', { player: `<@${userId}>` }));
            // Wipe the typing users map
            controller.typingUsers.clear();
            // Register a fallback for this user's turn
            await this.registerPopcornFallbackTimeout(userId);
        } else {
            // In all other cases, add the user to this turn's set of typing users
            controller.typingUsers.add(userId);
        }
    }

    override async onMorningMessageUpdate(oldMessage: PartialMessage | Message<boolean>, newMessage: PartialMessage | Message<boolean>): Promise<void> {
        const { state, languageGenerator, messenger } = controller.getAllReferences();

        const popcorn = state.getFocusGame();
        if (popcorn.type !== 'POPCORN') {
            return;
        }

        // Abort if there's no user ID in the state
        if (!popcorn.userId) {
            return;
        }
        // If the popcorn message has been edited...
        if (newMessage.id === popcorn.messageId) {
            // Validate that they're not partials
            if (oldMessage.partial || newMessage.partial) {
                await logger.log(`Popcorn message edited, but aborting due to message partiality: old ${oldMessage.partial ? 'partial' : 'full'}, new ${newMessage.partial ? 'partial' : 'full'}`);
                return;
            }
            // Check if the relevant user tag was removed
            const oldTags = getMessageMentions(oldMessage);
            const newTags = getMessageMentions(newMessage);
            // Send a message if the tag was removed
            if (oldTags.includes(popcorn.userId) && !newTags.includes(popcorn.userId)) {
                await messenger.reply(newMessage, languageGenerator.generate('{popcorn.tagRemoved?}', { player: `<@${popcorn.userId}>` }));
            }
            // TODO: Temp logging to see how this works
            await logger.log(`Popcorn message edited. Old tags: \`${JSON.stringify(oldTags)}\`, new tags: \`${JSON.stringify(newTags)}\``);
        }
    }

    private async registerPopcornFallbackTimeout(userId: Snowflake) {
        const { state, timeoutManager } = controller.getAllReferences();

        // If the player is more active, give them more time (5-9 default, +1-4 when in-game, +1m for each day of streak)
        let fallbackDate = new Date();
        fallbackDate.setMinutes(fallbackDate.getMinutes() + randInt(5, 10));
        if (state.hasPlayer(userId)) {
            fallbackDate.setMinutes(fallbackDate.getMinutes() + randInt(1, 5) + state.getPlayerActivity(userId).getStreak());
        }
        await timeoutManager.registerTimeout(TimeoutType.FocusCustom, fallbackDate, { pastStrategy: PastTimeoutStrategy.Invoke});
        // TODO: Temp logging to see how this goes
        await logger.log(`Scheduled popcorn fallback for **${state.getPlayerDisplayName(userId)}** at **${getRelativeDateTimeString(fallbackDate)}**`);
    };

    override async onPreNoon(): Promise<void> {
        const { state, languageGenerator, messenger, goodMorningChannel } = controller.getAllReferences();

        const popcorn = state.getFocusGame();
        if (popcorn.type !== 'POPCORN') {
            return;
        }

        // Cancel the fallback timeout to prevent weird race conditions at the end of the game
        await controller.cancelTimeoutsWithType(TimeoutType.FocusCustom);
        // "Disabling" the event allows the current user to end the story, and if there's no user then it prevents further action
        popcorn.ended = true;
        // Prompt the user to end the story or cut it off there
        if (popcorn.userId) {
            await messenger.send(goodMorningChannel, `<@${popcorn.userId}> my friend, pass the torch to someone else or complete this story by ending your message with _"The End"_!`);
        } else {
            await messenger.send(goodMorningChannel, languageGenerator.generate('My, what a truly {adjectives.positive?} story! Thank you all for weaving the threads of imagination this morning...'));
        }
    }

    override async onBaitingStart(): Promise<void> {
        const { state, languageGenerator, messenger, goodMorningChannel } = controller.getAllReferences();

        const popcorn = state.getFocusGame();
        if (popcorn.type !== 'POPCORN') {
            return;
        }

        // If there's still a user on the hook, tell them to hurry up!
        if (popcorn.userId) {
            await messenger.send(goodMorningChannel, languageGenerator.generate('{popcorn.hurry?}'));
        }
    }

    override async onNoon(): Promise<void> {
        const { state, messenger, goodMorningChannel } = controller.getAllReferences();

        const popcorn = state.getFocusGame();
        if (popcorn.type !== 'POPCORN') {
            return;
        }

        if (popcorn.userId) {
            // state.deductPoints(popcorn.userId, CONFIG.defaultAward);
            // TODO: Should this be an actual deduction?
            popcorn.scores[popcorn.userId] = (popcorn.scores[popcorn.userId] ?? 0) - 1;
            await messenger.send(goodMorningChannel, `Looks like our dear friend <@${popcorn.userId}> wasn't able to complete today's Good Morning story... 😔`);
        }

        // TODO: Rework the scoring system, since this may be a little unfair and doesn't take uniqueness into account
        // Award points
        const sortedUserIds: Snowflake[] = Object.keys(popcorn.scores).sort((x, y) => (popcorn.scores[y] ?? 0) - (popcorn.scores[x] ?? 0));
        // TODO: Using max points of 1.5 rather than 3.5 here until the scoring is reworked
        const scaledPoints = getSimpleScaledPoints(sortedUserIds, { maxPoints: 1.5, order: 2 });
        const rows: string[] = [];
        // Award players points based on their score ranking
        for (const scaledPointsEntry of scaledPoints) {
            const { userId, points, rank } = scaledPointsEntry;
            const score = popcorn.scores[userId] ?? 0;
            state.awardPoints(userId, points);
            rows.push(`_${getRankString(rank)}:_ **${score}** <@${userId}>`);
        }
        // TODO: Just logging this for now, what should we do with this information?
        await logger.log(`Popcorn Results:__\n` + rows.join('\n') + '\n(_Disclaimer:_ these are not your literal points earned)');

        // Summarize the story
        if (popcorn.storySegments.length > 0) {
            // TODO: Remove this try-catch once we're sure it's working
            try {
                const summary = splitTextNaturally(await generateSynopsisWithAi(popcorn.storySegments.join('\n')), 1500);
                for (const summarySegment of summary) {
                    await messenger.send(goodMorningChannel, summarySegment);
                }
            } catch (err) {
                await logger.log(`Failed to summarize popcorn story: \`${err}\``);
            }
        }
    }

    override async onTimeout(arg: any): Promise<void> {
        const { state, messenger, goodMorningChannel } = controller.getAllReferences();

        const popcorn = state.getFocusGame();
        if (popcorn.type !== 'POPCORN') {
            return;
        }

        // Abort if there's no current popcorn user
        if (!popcorn.userId) {
            return;
        }

        // Clear the current turn and notify
        delete popcorn.userId;
        await controller.dumpState();
        await messenger.send(goodMorningChannel, 'I don\'t think we\'re gonna hear back... next turn is up for grabs!');
    }
}