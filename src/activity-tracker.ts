export default class ActivityTracker {
    private static CAPACITY: number = 10;
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

    getRating(): number {
        if (!this.data) {
            return 0;
        }
        return Math.max(this.getActivityLevel() / 2, this.getStreak() / ActivityTracker.CAPACITY);
    }

    add(active: boolean): void {
        this.data = ((active ? 'x' : '.') + this.data).substring(0, ActivityTracker.CAPACITY);
    }

    dump(): string {
        return this.data;
    }
}