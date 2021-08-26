const { Client, Intents } = require('discord.js');
const auth = require('./config/auth.json');

const Storage = require('./storage');
const storage = new Storage('./data/');

const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES
    ]
});

let goodMorningChannel;

let standings;
let nextMessageDate;

const randInt = (lo, hi) => {
    return parseInt(Math.random() * (hi - lo)) + lo;
};

const advanceDate = () => {
    // Set date to tomorrow
    nextMessageDate.setDate(nextMessageDate.getDate() + 1);
    // Set time to somewhere between 7am and 10am
    nextMessageDate.setHours(randInt(7, 11));
    nextMessageDate.setMinutes(randInt(0, 60));
    nextMessageDate.setSeconds(randInt(0, 60));
    // Write the new date
    storage.write('nextDate', nextMessageDate.toJSON());
};

const sayGoodMorning = () => {
    if (goodMorningChannel) {
        goodMorningChannel.send('Have a blessed morning!');
        advanceDate();

        // Notify channel
        goodMorningChannel.send(`Next date is ${nextMessageDate.toString()}`);

        const millisUntilMessage = nextMessageDate.getTime() - new Date().getTime();
        console.log(`Waiting ${millisUntilMessage} millis until next message`);
        setTimeout(sayGoodMorning, millisUntilMessage);
    }
};

client.on('ready', async () => {
    await client.guilds.fetch();
    const guild = client.guilds.cache.first();

    await guild.channels.fetch();

    goodMorningChannel = guild.channels.cache.filter(channel => channel.name === 'bot-testing').first();
    if (goodMorningChannel) {
        nextMessageDate = new Date((await storage.read('nextDate')).trim());
        console.log(`Loaded up next message date as ${nextMessageDate.toString()}`);

        // Repeatedly advance the date until it's in the future
        while (nextMessageDate.getTime() < (new Date()).getTime()) {
          advanceDate();
          console.log(`Date is in the past, advanced to ${nextMessageDate.toJSON()}`);
        }

        const millisUntilMessage = nextMessageDate.getTime() - (new Date()).getTime();
        console.log(`Waiting ${millisUntilMessage} millis until next message`);
        goodMorningChannel.send(`Bot had to restart... next date is ${nextMessageDate.toString()}`);
        setTimeout(sayGoodMorning, millisUntilMessage);
    } else {
        console.log('Failed to find good morning channel!');
    }
});

client.on('messageCreate', (msg) => {
    if (goodMorningChannel && msg.channel.id === goodMorningChannel.id && !msg.author.bot) {
        msg.reply('Good morning! Your message sending privileges have been revoked');
        /*msg.channel.overwritePermissions(msg.author, {
            SEND_MESSAGES: false
        }).then((updated) => {
            console.log(updated);
        });*/
    }
});

client.login(auth.token);
