const { Client, Intents } = require('discord.js');
const auth = require('./config/auth.json');

const Storage = require('./storage');
const storage = new Storage('./data/');

const TimeoutManager = require('./timeout-manager');

const LanguageGenerator = require('./language-generator');
const languageConfig = require('./config/language.json');
const languageGenerator = new LanguageGenerator(languageConfig);

const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES
    ]
});

let goodMorningChannel;

let state;
let history;

// Tuples of (user ID, points)
const getTopPlayers = (n) => {
    return Object.entries(state.points)
        .sort((x, y) => y[1] - x[1])
        .slice(0, n);
};

const sendGoodMorningMessage = async () => {
    if (goodMorningChannel) {
        const now = new Date();
        switch (now.getDay()) {
        case 0: // Sunday
            const top = getTopPlayers(1)[0];
            goodMorningChannel.send(`Good morning! We are deep into season **${state.season}**, and <@${top[0]}> is leading with **${top[1]}** points.`);
            break;
        case 5: // Friday
            goodMorningChannel.send('Happy Friday! I wish each of you a blessed morning 🐒');
            break;
        default: // Other days
            goodMorningChannel.send(languageGenerator.generateGoodMorning());
            break;
        }
    }
}

const setStatus = async (active) => {
    if (active) {
        client.user.setPresence({
            status: 'online',
            activities: [{
                name: 'GOOD MORNING! 🌞',
                type: 'PLAYING'
            }]
        });
    } else {
        client.user.setPresence({
            status: 'idle',
            activities: []
        });
    }
}

const registerGoodMorningTimeout = async () => {
    const MIN_HOUR = 7;
    const MAX_HOUR_EXCLUSIVE = 11;

    const morningTomorrow = new Date();
    // Set date as tomorrow if it's after the earliest possible morning time
    if (morningTomorrow.getHours() >= MIN_HOUR) {
        morningTomorrow.setDate(morningTomorrow.getDate() + 1);
    }
    // Set time as sometime between 7am and 10am
    morningTomorrow.setHours(randInt(MIN_HOUR, MAX_HOUR_EXCLUSIVE), randInt(0, 60), randInt(0, 60));

    await timeoutManager.registerTimeout(NEXT_GOOD_MORNING, morningTomorrow);
};

const NEXT_GOOD_MORNING = 'NEXT_GOOD_MORNING';
const NEXT_NOON = 'NEXT_NOON';

const TIMEOUT_CALLBACKS = {
    [NEXT_GOOD_MORNING]: async (id) => {
        // Update and dump state
        state.isMorning = true;
        state.dailyStatus = {};
        await dumpState();

        // Set timeout for when morning ends
        const noonToday = new Date();
        noonToday.setHours(12, 0, 0, 0);
        await timeoutManager.registerTimeout(NEXT_NOON, noonToday);

        // Register timeout for tomorrow's good morning message
        await registerGoodMorningTimeout();

        // Update the bot's status to active
        await setStatus(true);

        // Send the good morning message
        await sendGoodMorningMessage();

        console.log('Said good morning!');
    },
    [NEXT_NOON]: async (id) => {
        // Update and dump state
        state.isMorning = false;
        await dumpState();

        // Update the bot's status
        await setStatus(false);
    }
};

const timeoutManager = new TimeoutManager(storage, TIMEOUT_CALLBACKS);

const randInt = (lo, hi) => {
    return parseInt(Math.random() * (hi - lo)) + lo;
};

const randChoice = (...choices) => {
    return choices[randInt(0, choices.length)];
};

const loadState = async () => {
    state = await storage.readJson('state');
};

const dumpState = async () => {
    await storage.write('state', JSON.stringify(state, null, 2));
    console.log(`Dumped state as ${JSON.stringify(state)}`);
};

const loadHistory = async () => {
    history = await storage.readJson('history');
};

const dumpHistory = async () => {
    await storage.write('history', JSON.stringify(history, null, 2));
    console.log(`Dumped history as ${JSON.stringify(history)}`);
};

client.on('ready', async () => {
    await client.guilds.fetch();
    const guild = client.guilds.cache.first();

    await guild.channels.fetch();

    goodMorningChannel = guild.channels.cache.filter(channel => channel.name === 'bot-testing').first();
    if (goodMorningChannel) {
        console.log(`Found good morning channel as ${goodMorningChannel.id}`);

        await loadState();
        await loadHistory();
        await timeoutManager.loadTimeouts();

        // Register the next good morning callback if it doesn't exist
        if (!timeoutManager.hasTimeout(NEXT_GOOD_MORNING)) {
            console.log('Found no existing timeout for the next good morning, so registering a new one...');
            await registerGoodMorningTimeout();
        }

        goodMorningChannel.send(`Bot had to restart... next date is ${timeoutManager.getDate(NEXT_GOOD_MORNING).toString()}`);

        // Update the bot's status
        setStatus(false);
    } else {
        console.log('Failed to find good morning channel!');
    }
});

client.on('messageCreate', async (msg) => {
    if (goodMorningChannel && msg.channel.id === goodMorningChannel.id && !msg.author.bot) {
        if (state.isMorning || msg.content.includes('MORNING')) {
            // Handle "commands" by looking for keywords
            const sanitizedText = msg.content.trim().toLowerCase();
            if (sanitizedText.includes('?')) {
                // Asking about points
                if (sanitizedText.includes('points')) {
                    const points = state.points[msg.author.id] || 0;
                    if (points < 0) {
                        msg.reply(`You have **${points}** points this season... bro...`);
                    } else if (points === 0) {
                        msg.reply(`You have no points this season`);
                    } else if (points === 1) {
                        msg.reply(`You have **1** point this season`);
                    } else {
                        msg.reply(`You have **${points}** points this season`);
                    }
                }
                // Asking about rankings
                else if (sanitizedText.includes('rank') || sanitizedText.includes('winning') || sanitizedText.includes('standings')) {
                    const top = getTopPlayers(3);
                    let replyText = '';
                    if (top.length >= 1) {
                        replyText += `<@${top[0][0]}> is in first with **${top[0][1]}** points`;
                    }
                    if (top.length >= 2) {
                        replyText += `, then <@${top[1][0]}> with **${top[1][1]}** points`;
                    }
                    if (top.length >= 3) {
                        replyText += `, and finally <@${top[2][0]}> with **${top[2][1]}** points`;
                    }
                    msg.reply(replyText);
                }
                // Asking about the season
                else if (sanitizedText.includes('season')) {
                    msg.reply(`It\'s season **${state.season}**!`);
                }
            }

            // In the morning, award the player accordingly if it's their first message...
            if (!state.dailyStatus.hasOwnProperty(msg.author.id)) {
                const rank = Object.keys(state.dailyStatus).length + 1;
                state.dailyStatus[msg.author.id] = { rank };
                state.points[msg.author.id] = (state.points[msg.author.id] || 0) + Math.max(5 - rank, 1);
                dumpState();
                // TODO: Disabling for now, perhaps we should enable this or do it at another time?
                /*
                switch (rank) {
                case 1:
                    msg.react('🥇');
                    break;
                case 2:
                    msg.react('🥈');
                    break;
                case 3:
                    msg.react('🥉');
                    break;
                }
                */
            }
        } else {
            // It's not morning, so punish the player accordingly...
            if (!state.dailyStatus.hasOwnProperty(msg.author.id)) {
                if (new Date().getHours() < 12) {
                    msg.react('😴');
                } else {
                    msg.react(randChoice('😡', '😬', '😒', '😐'));
                }
            }
            if (!state.dailyStatus.hasOwnProperty(msg.author.id)) {
                state.dailyStatus[msg.author.id] = {};
            }
            state.dailyStatus[msg.author.id].penalized = true ;
            state.points[msg.author.id] = (state.points[msg.author.id] || 0) - 1;
            dumpState();
            if (state.points[msg.author.id] == -5) {
                msg.reply('Why are you still talking?');
            } else if (state.points[msg.author.id] == -10) {
                msg.reply('You have brought great dishonor to this server...');
            }
        }
    }
});

client.login(auth.token);
