// deploy-commands.js - コマンドの登録
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../../config');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(config.token);

// コマンドを登録する関数
async function deployCommands() {
  try {
    console.log(`${commands.length}個のコマンドを登録しています...`);
    
    // グローバルコマンドとして登録
    const data = await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: commands },
    );
    
    console.log(`${data.length}個のコマンドを登録しました`);
    return true;
  } catch (error) {
    console.error('コマンド登録中にエラーが発生しました:', error);
    return false;
  }
}

// 開発環境でのみ特定のギルドにコマンドを登録する関数
async function deployCommandsToGuild() {
  try {
    console.log(`${commands.length}個のコマンドを特定のギルドに登録しています...`);
    
    // 特定のギルドにコマンドを登録
    const data = await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands },
    );
    
    console.log(`${data.length}個のコマンドをギルドに登録しました`);
    return true;
  } catch (error) {
    console.error('ギルドへのコマンド登録中にエラーが発生しました:', error);
    return false;
  }
}

module.exports = {
  deployCommands,
  deployCommandsToGuild
};

// このファイルが直接実行された場合はコマンドを登録
if (require.main === module) {
  deployCommands().catch(console.error);
}