class LanguageGenerator {
    constructor(config) {
        this._config = config;
    }

    _resolve(token) {
        let stripped = token.substring(1, token.length - 1);

        // In the simple case (list of literals), handle this upfront
        if (stripped.startsWith('!')) {
            const options = stripped.substring(1).split('|');
            return options[Math.floor(Math.random() * options.length)];
        }

        // Check if there's a random modifier at the end
        let pickRandom = 0;
        if (stripped.endsWith('?')) {
            pickRandom = 1;
            stripped = stripped.substring(0, stripped.length - 1);
        } else if (stripped.match(/\?\d+$/)) {
            pickRandom = parseInt(stripped.substring(stripped.lastIndexOf('?') + 1));
            stripped = stripped.substring(0, stripped.lastIndexOf('?'));
        }else if (stripped.match(/\?\d+\-\d+$/)) {
            const execResult = /\?(\d+)\-(\d+)$/.exec(stripped);
            const lo = parseInt(execResult[1]);
            const hi = parseInt(execResult[2]);
            pickRandom = Math.floor(Math.random() * (hi - lo + 1)) + lo;
            stripped = stripped.substring(0, stripped.lastIndexOf('?'));
        }

        const segments = stripped.split('.');
        let node = this._config;
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
            let result = ''
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

    generate(input) {
        const p = /{\!?([^{}]+)(\?\d*\-?\d*)?}/;
        let result = input;
        while (result.search(p) !== -1) {
            result = result.replace(p, this._resolve.bind(this));
        }
        return result;
    }

    generateGoodMorning() {
        return this.generate('{goodMorning}');
    }
}

module.exports = LanguageGenerator;
