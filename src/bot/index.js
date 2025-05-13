// src/bot/index.js
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../../config/config');
const { initializeFirebase } = require('../db/firebase');
const { setupScheduler } = require('../utils/scheduler');
const logger = require('../utils/logger');

// Discord クライアントの初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// コマンドとイベントのコレクション初期化
client.commands = new Collection();

// コマンドの読み込み
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    logger.info(`コマンド ${command.data.name} を読み込みました`);
  } else {
    logger.warn(`${filePath} で必要なプロパティが見つかりません`);
  }
}

// イベントの読み込み
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
  
  logger.info(`イベント ${event.name} を読み込みました`);
}

// Firebase の初期化
initializeFirebase();

// スケジューラのセットアップ
setupScheduler();

// Discord への接続
client.login(config.DISCORD_TOKEN)
  .then(() => {
    logger.info('Discord Botが起動しました');
  })
  .catch(error => {
    logger.error('Discord Botの起動に失敗しました', error);
  });

// エラーハンドリング
process.on('unhandledRejection', error => {
  logger.error('未処理のエラーが発生しました:', error);
});

module.exports = client;