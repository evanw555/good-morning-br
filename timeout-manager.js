class TimeoutManager {
    constructor(storage, callbacks) {
        this._storage = storage;
        this._callbacks = callbacks;
        this._previousTimeoutId = 0;
        this._timeouts = {};
    }

    _getNextTimeoutId = () => {
        // Iterate to next available ID and return
        while (this._timeouts.hasOwnProperty(++this._previousTimeoutId)) {}
        return this._previousTimeoutId;
    }

    async loadTimeouts() {
        console.log('Loading up timeouts...');
        const timeouts = await this._storage.readJson('timeouts');
        if (timeouts) {
            for (const id of Object.keys(timeouts)) {
                const timeout = timeouts[id];
                const date = new Date(timeout.date.trim());
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
    }

    async _dumpTimeouts() {
        await this._storage.write('timeouts', JSON.stringify(this._timeouts, null, 2));
        console.log(`Dumped timeouts as ${JSON.stringify(this._timeouts)}`);
    }

    async _addTimeoutForId(id, type, date) {
        const millisUntilMessage = date.getTime() - new Date().getTime();
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

    async registerTimeout(type, date) {
        const id = this._getNextTimeoutId();
        await this._addTimeoutForId(id, type, date);
        await this._dumpTimeouts();
    }

    getDate(type) {
        for (const timeoutInfo of Object.values(this._timeouts)) {
            if (timeoutInfo.type === type) {
                return new Date(timeoutInfo.date.trim());
            }
        }
    }

    hasTimeout(type) {
        return Object.values(this._timeouts).some(t => t.type === type);
    }
}

module.exports = TimeoutManager;
