// src/deploy-commands.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, 'bot', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if ('data' in command) {
        commands.push(command.data.toJSON());
    } else {
        console.log(`[警告] ${filePath} のコマンドには "data" プロパティがありません。`);
    }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`${commands.length} 個のアプリケーションコマンドを登録しています...`);

        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );

        console.log(`${data.length} 個のアプリケーションコマンドを登録しました。`);
    } catch (error) {
        console.error('コマンド登録中にエラーが発生しました:', error);
    }
})();