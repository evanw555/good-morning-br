import { Message, TextBasedChannels } from "discord.js";
import { randInt, sleep } from "./util.js";

interface MessengerBacklogEntry {
    channel: TextBasedChannels,
    message?: Message,
    text: string
}

export default class Messenger {
    private _busy: boolean;
    private readonly _backlog: any[];

    constructor() {
        this._busy = false;
        this._backlog = [];
    }

    async send(channel: TextBasedChannels, text: string): Promise<void> {
        this._send({ channel, text });
    }

    async reply(message: Message, text: string): Promise<void> {
        this._send({ channel: message.channel, message, text });
    }

    private async _send(entry: MessengerBacklogEntry): Promise<void> {
        if (!this._busy) {
            // If the messenger isn't typing/waiting/sending, then go ahead and process the message now
            this._busy = true;
            this._backlog.push(entry);
            while (this._backlog.length > 0) {
                const { channel, message, text } = this._backlog.shift();
                // Take a brief pause
                await sleep(randInt(100, 1500));
                // Send the typing event and wait based on the length of the message
                await channel.sendTyping();
                await sleep(randInt(45, 55) * text.length);
                // Now actually reply/send the message
                if (message) {
                    await message.reply(text);
                } else {
                    await channel.send(text);
                }
            }
            this._busy = false;
        } else {
            // If the messenger is busy, just add the info to the backlog and let the active thread send it when it's done
            this._backlog.push(entry);
        }
    }

    /**
     * TODO: do this better. De-dup logic.
     */
    async sendAndGet(channel: TextBasedChannels, text: string): Promise<Message> {
        // Take a brief pause
        await sleep(randInt(100, 1500));
        // Send the typing event and wait based on the length of the message
        await channel.sendTyping();
        await sleep(randInt(45, 55) * text.length);
        // Now actually reply/send the message
        return channel.send(text);
    }

    /**
     * Send the provided text as a series of boxed (monospaced) messages limited to no more than 2000 characters each.
     * @param channel the target channel
     * @param text the text to send
     */
    async sendLargeMonospaced(channel: TextBasedChannels, text: string): Promise<void> {
        const lines: string[] = text.split('\n');
        let buffer: string = '';
        let segmentIndex: number = 0;
        while (lines.length !== 0) {
            const prefix: string = buffer ? '\n' : '';
            buffer += prefix + lines.shift();
            if (lines.length === 0 || buffer.length + lines[0].length > 1990) {
                try {
                    await channel.send(`\`\`\`${buffer}\`\`\``);
                } catch (err) {
                    await channel.send(`Failed sending segment **${segmentIndex}**`);
                }
                buffer = '';
                segmentIndex++;
            }
        }
    }
}
