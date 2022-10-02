export default class ActivityTracker {
    public static CAPACITY: number = 10;
    private data: string;

    constructor(data: string | undefined) {
        this.data = data ?? '';
    }

    getActivityLevel(): number {
        if (!this.data) {
            return 0;
        }
        return this.data.replace(/[^x]/g, '').length / ActivityTracker.CAPACITY;
    }

    getStreak(): number {
        if (!this.data) {
            return 0;
        }
        return this.data.replace(/^(x*).*$/, '$1').length;
    }

    hasFullStreak(): boolean {
        return this.getStreak() === ActivityTracker.CAPACITY;
    }

    getRating(): number {
        if (!this.data) {
            return 0;
        }
        return Math.max(this.getActivityLevel() / 2, this.getStreak() / ActivityTracker.CAPACITY);
    }

    /**
     * Update the activity tracker by adding an activity value.
     * @param active the activity value to add (true if there was activity)
     * @returns true if this operation changed the state from an incomplete streak to a full streak
     */
    add(active: boolean): boolean {
        const fullBefore: boolean = this.hasFullStreak();
        this.data = ((active ? 'x' : '.') + this.data).substring(0, ActivityTracker.CAPACITY);
        const fullAfter: boolean = this.hasFullStreak();
        return !fullBefore && fullAfter;
    }

    dump(): string {
        return this.data;
    }

    toString(): string {
        return `\`${this.data.padEnd(ActivityTracker.CAPACITY)}\` **${this.getRating()}**R = **${this.getActivityLevel() * 100}%** + **${this.getStreak()}**d`
    }
}