// src/bot/deploy-commands.js
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../../config/config');
const logger = require('../utils/logger');

// スラッシュコマンドを登録する関数
async function deployCommands() {
  try {
    logger.info('スラッシュコマンドの登録を開始します...');

    // コマンドファイルを読み込む
    const commands = [];
    const commandsPath = path.join(__dirname, 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);
      
      if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
        logger.info(`コマンド ${command.data.name} を読み込みました`);
      } else {
        logger.warn(`${filePath} で必要なプロパティが見つかりません`);
      }
    }

    // REST API クライアントを作成
    const rest = new REST().setToken(config.DISCORD_TOKEN);

    // コマンドを登録
    logger.info(`${commands.length} 個のスラッシュコマンドを登録します...`);

    let data;
    if (config.GUILD_ID) {
      // 特定のギルドにコマンドを登録（開発時に便利）
      data = await rest.put(
        Routes.applicationGuildCommands(config.CLIENT_ID, config.GUILD_ID),
        { body: commands }
      );
      logger.info(`ギルド ${config.GUILD_ID} に ${data.length} 個のコマンドを登録しました`);
    } else {
      // グローバルにコマンドを登録（本番環境用）
      data = await rest.put(
        Routes.applicationCommands(config.CLIENT_ID),
        { body: commands }
      );
      logger.info(`グローバルに ${data.length} 個のコマンドを登録しました`);
    }

    logger.info('スラッシュコマンドの登録が完了しました');
    return data;
  } catch (error) {
    logger.error('スラッシュコマンドの登録中にエラーが発生しました:', error);
    throw error;
  }
}

// スクリプトが直接実行された場合は登録処理を実行
if (require.main === module) {
  deployCommands()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { deployCommands };