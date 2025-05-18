// index.js の修正版
// エンコーディング問題対応のための変更部分
import { setupInteractionHandlers } from './utils/interactionHandlers.js';
import { Client, GatewayIntentBits, Collection, Events, REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeFirebase } from './config/firebase-config.js';
// 強化版スケジューラーを使用
import { startEnhancedRaceScheduler } from './services/scheduler/enhancedRaceScheduler.js';
import logger from './utils/logger.js';

// 環境変数の読み込み
config();

// __dirname を使えるようにする (ESM環境用)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Discordクライアントの初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// コマンドコレクションの初期化
client.commands = new Collection();

// Firebaseの初期化
initializeFirebase();

// コマンドファイルの読み込み
async function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  const commands = [];

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const commandModule = await import(`file://${filePath}`);
    const command = commandModule.default;

    // コマンドの登録
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      commands.push(command.data.toJSON());
      logger.info(`コマンド ${command.data.name} を登録しました。`);
    } else {
      logger.warn(`${filePath} のコマンドは必要なプロパティを持っていません。`);
    }
  }

  return commands;
}

// コマンドの登録処理
async function registerCommands() {
  try {
    const commands = await loadCommands();

    const rest = new REST().setToken(process.env.BOT_TOKEN);

    logger.info('コマンドを登録中...');

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );

    logger.info('コマンドの登録が完了しました。');
  } catch (error) {
    logger.error('コマンドの登録中にエラーが発生しました:', error);
  }
}

// Discord Bot準備完了時の処理
client.once(Events.ClientReady, () => {
  logger.info(`${client.user.tag} として準備完了！`);
  setupInteractionHandlers(client);
  // 強化版レーススケジューラーの開始
  // 文字エンコーディング修正版を使用する
  startEnhancedRaceScheduler(client);
  logger.info('強化版スケジューラー（文字エンコーディング修正対応）を開始しました。');
});

// インタラクション（スラッシュコマンド）の処理
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    logger.error(`${interaction.commandName} というコマンドは見つかりませんでした。`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(`コマンド実行中にエラーが発生しました: ${error}`);

    const replyOptions = {
      content: 'このコマンドの実行中にエラーが発生しました。',
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(replyOptions);
    } else {
      await interaction.reply(replyOptions);
    }
  }
});

// Discordへのログイン
client.login(process.env.BOT_TOKEN).then(() => {
  registerCommands();
}).catch(error => {
  logger.error('ログイン中にエラーが発生しました:', error);
});

// エラーハンドリング
process.on('unhandledRejection', (error) => {
  logger.error('未処理のPromise拒否:', error);
});

process.on('uncaughtException', (error) => {
  logger.error('未キャッチの例外:', error);
});