import { Message, MessageAttachment } from "discord.js";
import { createMidSeasonUpdateImage } from "./graphics.js";
import LanguageGenerator from "./language-generator.js";
import Messenger from "./messenger.js";
import R9KTextBank from "./r9k.js";
import { GoodMorningState } from "./types.js";
import { generateKMeansClusters, getLeastRecentPlayers, getOrderedPlayers, getOrderingUpsets, hasVideo, reactToMessage, toPointsMap } from "./util.js";

export default async function processCommands(msg: Message, state: GoodMorningState, messenger: Messenger, languageGenerator: LanguageGenerator, r9k: R9KTextBank): Promise<void> {
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
                    return ` - <@${key}>: **${state.players[key].points}** (${state.players[key].daysSinceLastGoodMorning ?? 0}d)`;
                })
                .join('\n'));
        }
        else if (sanitizedText.includes('state')) {
            await messenger.sendLargeMonospaced(msg.channel, JSON.stringify(state, null, 2));
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
        // Asking about the season
        else if (sanitizedText.includes('season')) {
            messenger.reply(msg, `It\'s season **${state.season}**!`);
        }
        // Canvas stuff
        else if (sanitizedText.includes('canvas')) {
            await msg.channel.sendTyping();
            const attachment = new MessageAttachment(await createMidSeasonUpdateImage(state, {}), 'results.png');
            msg.reply({ files: [attachment] });
        }
        else if (sanitizedText.includes('react')) {
            await reactToMessage(msg, ['🌚', '❤️', '☘️', '🌞']);
        }
        else if (sanitizedText.includes('test')) {
            messenger.send(msg.channel, languageGenerator.generate('{beckoning.goodMorning?}').replace('$player', `<@${state.currentLeader}>`));
        }
    }
};
