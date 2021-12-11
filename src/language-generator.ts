import { TextBasedChannels } from "discord.js";

class LanguageGenerator {
    private readonly _config: Record<string, any>;
    private _emergencyLogChannel?: TextBasedChannels;

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
            pickRandom = 1;
            stripped = stripped.substring(0, stripped.length - 1);
        } else if (stripped.match(/\?\d+$/)) {
            pickRandom = parseInt(stripped.substring(stripped.lastIndexOf('?') + 1));
            stripped = stripped.substring(0, stripped.lastIndexOf('?'));
        }else if (stripped.match(/\?\d+\-\d+$/)) {
            const execResult: string[] = /\?(\d+)\-(\d+)$/.exec(stripped);
            const lo: number = parseInt(execResult[1]);
            const hi: number = parseInt(execResult[2]);
            pickRandom = Math.floor(Math.random() * (hi - lo + 1)) + lo;
            stripped = stripped.substring(0, stripped.lastIndexOf('?'));
        }

        const segments: string[] = stripped.split('.');
        let node: any = this._config;
        while (segments.length > 0) {
            const segment = segments.shift();
            if (!node || !node.hasOwnProperty(segment)) {
                return '';
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
                result += node[Math.floor(Math.random() * node.length)].toString();
            }
            return result;
        }
    }

    /**
     * @param input Unresolved input text (may contain tokens)
     * @returns Processed text with all tokens recursively resolved
     */
    generate(input: string): string {
        const p: RegExp = /{\!?([^{}]+)(\?\d*\-?\d*)?}/;
        // This logic can be retried a number of times, in case a bad result is generated
        let attemptsRemaining: number = 15;
        while (attemptsRemaining-- > 0) {
            let result: string = input;
            while (result.search(p) !== -1) {
                result = result.replace(p, this._resolve.bind(this));
            }
            // If the resulting output seems to be malformed, log it and try again!
            if (result.includes('{') || result.includes('}') || result.includes('|')) {
                const errorMessage: string = `LanguageGenerator processed input \`${input}\` and produced a bad output: \`${result}\``;
                console.log(errorMessage);
                this._emergencyLogChannel?.send(errorMessage);
                continue;
            }
            return result;
        }
        // Ultimate fallback text (ideally it should never get here)
        return "Hello";
    }
}

export default LanguageGenerator;
