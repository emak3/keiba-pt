// src/index.js
require('dotenv').config();
const RaceBot = require('./bot');

// ボットの起動
console.log('起動しています...');
const bot = new RaceBot();
bot.start();