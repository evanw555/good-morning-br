import FileStorage from "./file-storage";
import { Timeout, TimeoutType } from "./types";

class TimeoutManager {
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
            // Repeatedly advance the date until it's in the future
            // TODO: set policies for different timeout types
            while (date.getTime() < (new Date()).getTime()) {
                date.setDate(date.getDate() + 1);
                console.log(`Date for ${timeout.type} is in the past, advancing to ${date.toJSON()}`);
            }
            await this._addTimeoutForId(id, timeout.type, date);
        };
        await this._dumpTimeouts();
    }

    async _dumpTimeouts(): Promise<void> {
        await this._storage.write('timeouts', JSON.stringify(this._timeouts, null, 2));
        console.log(`Dumped timeouts as ${JSON.stringify(this._timeouts)}`);
    }

    async _addTimeoutForId(id: string, type: TimeoutType, date: Date): Promise<void> {
        const millisUntilMessage: number = date.getTime() - new Date().getTime();
        this._timeouts[id] = {
            type,
            date: date.toJSON()
        };
        setTimeout(async () => {
            // Perform the actual callback
            await this._callbacks[type]();
            // Clear the timeout info
            delete this._timeouts[id];
            // Dump the timeouts
            await this._dumpTimeouts();
        }, millisUntilMessage);
        console.log(`Added timeout for ${type} at ${date.toString()}`);
    }

    async registerTimeout(type: TimeoutType, date: Date): Promise<void> {
        const id = this._getNextTimeoutId();
        await this._addTimeoutForId(id, type, date);
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
            return `\`${timeout.type}\`: ${new Date(timeout.date).toLocaleString()}`
        });
    }
}

export default TimeoutManager;
