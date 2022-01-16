import { TextBasedChannels } from "discord.js";

class LanguageGenerator {
    private readonly _config: Record<string, any>;
    private _emergencyLogChannel?: TextBasedChannels;
    private _lastErrorMessage?: string;

    constructor(config: Record<string, any>) {
        this._config = config;
    }

    setEmergencyLogChannel(emergencyLogChannel: TextBasedChannels): void {
        this._emergencyLogChannel = emergencyLogChannel;
    }

    private _resolve(token: string): string {
        let stripped: string = token.substring(1, token.length - 1);

        // In the simple case (list of literals), handle this upfront
        if (stripped.startsWith('!')) {
            const options: string[] = stripped.substring(1).split('|');
            return options[Math.floor(Math.random() * options.length)];
        }

        // Check if there's a random modifier at the end
        let pickRandom: number = 0;
        if (stripped.endsWith('?')) {
            // e.g. "{foo.bar?}"
            pickRandom = 1;
            stripped = stripped.substring(0, stripped.length - 1);
        } else if (stripped.match(/\?\d+$/)) {
            // e.g. "{foo.bar?3}"
            pickRandom = parseInt(stripped.substring(stripped.lastIndexOf('?') + 1));
            stripped = stripped.substring(0, stripped.lastIndexOf('?'));
        }else if (stripped.match(/\?\d+\-\d+$/)) {
            // e.g. "{foo.bar?2-3}"
            const execResult: string[] = /\?(\d+)\-(\d+)$/.exec(stripped);
            const lo: number = parseInt(execResult[1]);
            const hi: number = parseInt(execResult[2]);
            pickRandom = Math.floor(Math.random() * (hi - lo + 1)) + lo;
            stripped = stripped.substring(0, stripped.lastIndexOf('?'));
        }

        // Resolve the language config node that this selector points to
        const segments: string[] = stripped.split('.');
        let node: any = this._config;
        while (segments.length > 0) {
            const segment = segments.shift();
            if (!node || !node.hasOwnProperty(segment)) {
                throw new Error(`Token \`${token}\` has bad selector \`${stripped}\` which failed on segment \`${segment}\``);
            }
            node = node[segment];
        }

        // Resolve list using the pick-random logic
        if (pickRandom === 0) {
            return node.toString();
        } else if (pickRandom === 1) {
            return node[Math.floor(Math.random() * node.length)].toString();
        } else if (pickRandom > 1) {
            let result: string = ''
            for (let i = 0; i < pickRandom; i++) {
                if (pickRandom === 2 && i === 1) {
                    result += ' and ';
                } else if (i === pickRandom - 1) {
                    result += ', and ';
                } else if (i > 0) {
                    result += ', ';
                }
                // TODO: Pick nodes randomly without any duplicates
                result += node[Math.floor(Math.random() * node.length)].toString();
            }
            return result;
        }
    }

    /**
     * Report language generation failure by logging and sending a message to the emergency log channel.
     * Refuses to log the failure if it's the same as the previous error message (to avoid retry spamming).
     * @param message error message to report
     */
    private _reportFailure(message: string): void {
        if (message !== this._lastErrorMessage) {
            this._lastErrorMessage = message;
            const errorMessage: string = `LanguageGenerator encountered an error: ${message}`;
            console.log(errorMessage);
            this._emergencyLogChannel?.send(errorMessage);
        }
    }

    /**
     * @param input Unresolved input text (may contain tokens)
     * @returns Processed text with all tokens recursively resolved
     */
    generate(input: string): string {
        const p: RegExp = /{\!?([^{}]+)(\?\d*\-?\d*)?}/;
        // This logic can be retried a number of times, in case a bad result is generated
        let attemptsRemaining: number = 10;
        while (attemptsRemaining-- > 0) {
            // Iteratively resolve all existing tokens until none are left (handles recursive tokens)
            let result: string = input;
            try {
                while (result.search(p) !== -1) {
                    result = result.replace(p, this._resolve.bind(this));
                }
            } catch (err) {
                this._reportFailure(err.message);
                continue;
            }
            // If the resulting output seems to be malformed, log it and try again!
            if (result.includes('{') || result.includes('}') || result.includes('|')) {
                this._reportFailure(`Processed input \`${input}\` and produced a bad output \`${result}\``);
                continue;
            }
            return result;
        }
        // Ultimate fallback text (ideally it should never get here)
        return "Hello";
    }
}

export default LanguageGenerator;
