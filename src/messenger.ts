import { Message, TextBasedChannels } from "discord.js";
import { randInt } from "./util.js";

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
                await new Promise<void>(r => setTimeout(r, randInt(100, 1500)));
                // Send the typing event and wait based on the length of the message
                await channel.sendTyping();
                await new Promise<void>(r => setTimeout(r, 45 * text.length));
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
}
