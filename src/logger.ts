import { TextBasedChannels } from "discord.js";

/**
 * Unified logger for logging both to console and to the designated text channel, if it exists.
 */
class Logger {
    private channel?: TextBasedChannels;

    setChannel(channel: TextBasedChannels): void {
        this.channel = channel;
    }

    async log(text: string): Promise<void> {
        if (text.length > 1990) {
            text = text.substring(0, 1990) + '...';
        }
        console.log(text);
        if (this.channel) {
            await this.channel.send(text);
        }
    }
}

export default new Logger();
