const Discord = require('discord.js');
const auth = require('./config/auth.json');

const Storage = require('./storage');
const storage = new Storage('./data/');

const client = new Discord.Client();

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
    // Notify channel
    goodMorningChannel.send(`Next date is ${nextMessageDate.toString()}`);
};

const sayGoodMorning = () => {
    if (goodMorningChannel) {
        goodMorningChannel.send('Have a blessed morning!');
        advanceDate();
        const millisUntilMessage = nextMessageDate.getTime() - new Date().getTime();
        console.log(`Waiting ${millisUntilMessage} millis until next message`);
        setTimeout(sayGoodMorning, millisUntilMessage);
    }
};

client.on('ready', async () => {
    goodMorningChannel = client.channels.filter(channel => channel.type === 'text' && channel.name === 'bot-testing').first();
    if (goodMorningChannel) {
        goodMorningChannel.send('Bot had to restart...');

        nextMessageDate = new Date((await storage.read('nextDate')).trim());
        console.log(nextMessageDate.toString());

        const millisUntilMessage = nextMessageDate.getTime() - new Date().getTime();
        console.log(`Waiting ${millisUntilMessage} millis until next message`);
        goodMorningChannel.send(`Next date is ${nextMessageDate.toString()}`);
        setTimeout(sayGoodMorning, millisUntilMessage);
    } else {
        console.log('Failed to find good morning channel!');
    }
});

client.on('message', (msg) => {
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
