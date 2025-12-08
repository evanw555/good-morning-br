import { TextBasedChannel } from "discord.js";

/**
 * Unified logger for logging both to console and to the designated text channel, if it exists.
 */
class Logger {
    private channel?: TextBasedChannel;
    private pendingMessages: string[];

    setChannel(channel: TextBasedChannel): void {
        this.channel = channel;
        this.pendingMessages = [];
    }

    async log(text: string): Promise<void> {
        if (text.length > 1990) {
            text = text.substring(0, 1990) + '...';
        }
        console.log(text);
        if (this.channel) {
            try {
                await this.channel.send(text);
                // Succeeded, so try to push the pending messages out too
                if (this.pendingMessages.length > 0) {
                    await this.channel.send('The following log statements failed to send previously:');
                    for (const m of this.pendingMessages) {
                        await this.channel.send(m);
                    }
                    // Clear it
                    this.pendingMessages = [];
                }
            } catch (err) {
                // Failed to send log, so add to pending list
                this.pendingMessages.push(text);
            }
        }
    }
}

export default new Logger();
