import FileStorage from "./file-storage";
import { PastTimeoutStrategy, Timeout, TimeoutType } from "./types.js";

class TimeoutManager {
    private static readonly DEFAULT_PAST_STRATEGY: PastTimeoutStrategy = PastTimeoutStrategy.Delete;

    private readonly _storage: FileStorage;
    private readonly _callbacks: Record<string, () => Promise<void>>;
    private readonly _timeouts: Record<string, Timeout>;
    private _previousTimeoutId: number;

    constructor(storage: FileStorage, callbacks: Record<string, () => Promise<void>>) {
        this._storage = storage;
        this._callbacks = callbacks;
        this._timeouts = {};
        this._previousTimeoutId = 0;
    }

    _getNextTimeoutId(): string {
        // Iterate to next available ID and return
        while (this._timeouts.hasOwnProperty(++this._previousTimeoutId)) {}
        return this._previousTimeoutId.toString();
    }

    async loadTimeouts(): Promise<void> {
        console.log('Loading up timeouts...');
        
        let timeouts: Record<string, any> = {};
        try {
            timeouts = await this._storage.readJson('timeouts');
        } catch (err) {}
        
        for (const id of Object.keys(timeouts)) {
            const timeout: Timeout = timeouts[id];
            const date: Date = new Date(timeout.date.trim());
            await this._addTimeoutForId(id, timeout.type, date, timeout.pastStrategy ?? TimeoutManager.DEFAULT_PAST_STRATEGY);
        };
        await this._dumpTimeouts();
    }

    async _dumpTimeouts(): Promise<void> {
        await this._storage.write('timeouts', JSON.stringify(this._timeouts, null, 2));
        console.log(`Dumped timeouts as ${JSON.stringify(this._timeouts)}`);
    }

    async _addTimeoutForId(id: string, type: TimeoutType, date: Date, pastStrategy: PastTimeoutStrategy): Promise<void> {
        const millisUntilMessage: number = date.getTime() - new Date().getTime();
        if (millisUntilMessage > 0) {
            // If timeout is in the future, then set a timeout for it as per usual
            this._timeouts[id] = {
                type,
                date: date.toJSON(),
                pastStrategy
            };
            setTimeout(async () => {
                // Perform the actual callback
                await this._callbacks[type]();
                // Clear the timeout info
                delete this._timeouts[id];
                // Dump the timeouts
                await this._dumpTimeouts();
            }, millisUntilMessage);
            console.log(`Added timeout for \`${type}\` at ${date.toLocaleString()}`);
        } else if (pastStrategy === PastTimeoutStrategy.Invoke) {
            // Timeout is in the past, so just invoke the callback now
            await this._callbacks[type]();
        } else if (pastStrategy === PastTimeoutStrategy.IncrementDay) {
            // Timeout is in the past, so try again with the day incremented
            const tomorrow: Date = new Date(date);
            tomorrow.setDate(tomorrow.getDate() + 1);
            console.log(`Incrementing timeout for \`${type}\` at ${date.toLocaleString()} by 1 day`);
            await this._addTimeoutForId(id, type, tomorrow, pastStrategy);
        } else if (pastStrategy === PastTimeoutStrategy.IncrementHour) {
            // Timeout is in the past, so try again with the hour incremented
            const nextHour: Date = new Date(date);
            nextHour.setHours(nextHour.getHours() + 1);
            console.log(`Incrementing timeout for \`${type}\` at ${date.toLocaleString()} by 1 hour`);
            await this._addTimeoutForId(id, type, nextHour, pastStrategy);
        } else if (pastStrategy === PastTimeoutStrategy.Delete) {
            // Timeout is in the past, so just delete the timeout altogether
            console.log(`Deleted timeout for \`${type}\` at ${date.toLocaleString()}`);
        }
    }

    async registerTimeout(type: TimeoutType, date: Date, pastStrategy: PastTimeoutStrategy): Promise<void> {
        const id = this._getNextTimeoutId();
        await this._addTimeoutForId(id, type, date, pastStrategy);
        await this._dumpTimeouts();
    }

    getDate(type: TimeoutType): Date {
        for (const timeoutInfo of Object.values(this._timeouts)) {
            if (timeoutInfo.type === type) {
                return new Date(timeoutInfo.date.trim());
            }
        }
    }

    hasTimeout(type: TimeoutType): boolean {
        return Object.values(this._timeouts).some(t => t.type === type);
    }

    /**
     * @returns list of human-readable strings representing each timeout (in ascending date order)
     */
    toStrings(): string[] {
        return Object.values(this._timeouts)
            .sort((x, y) => new Date(x.date).getTime() - new Date(y.date).getTime())
            .map(timeout => {
            return `\`${timeout.type}\`: ${new Date(timeout.date).toLocaleString()} (\`${timeout.pastStrategy ?? 'N/A'}\`)`
        });
    }
}

export default TimeoutManager;
