import { createHash, Hash } from 'crypto';

/**
 * A utility to keep track of text that's previously been used in some context.
 * Santizes and reduces the text so that insignificant modifications don't affect its identity.
 */
export default class R9KTextBank {
    private readonly bank: Set<string>;

    constructor() {
        this.bank = new Set();
    }

    add(text: string): void {
        this.bank.add(R9KTextBank.computeHash(text));
    }

    addRawHashes(rawHashes: string[]): void {
        rawHashes.forEach(rawHash => this.bank.add(rawHash));
    }

    contains(text: string): boolean {
        return this.bank.has(R9KTextBank.computeHash(text));
    }

    getAllEntries(): string[] {
        return Array.from(this.bank).sort();
    }

    private static computeHash(text: string): string {
        const sanitized: string = this.sanitize(text);
        const hash: Hash = createHash('sha1');
        hash.update(sanitized);
        return hash.digest('base64');
    }

    private static sanitize(text: string): string {
        return text.toLowerCase()
            // Remove non-alphanumeric characters
            .replace(/[^0-9a-zA-Z]/g, '')
            // Collapse consecutive repeating characters into one
            .replace(/(.)\1+/g, '$1');
    }
}