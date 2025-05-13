// src/bot/events/interactionCreate.js
const { Events } = require('discord.js');
const logger = require('../../utils/logger');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // コマンド以外の相互作用は無視
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      logger.error(`コマンド ${interaction.commandName} が見つかりません`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error(`コマンド ${interaction.commandName} の実行中にエラーが発生しました`, error);
      
      // 既に応答済みでなければエラーメッセージを送信
      const replyContent = {
        content: 'このコマンドの実行中にエラーが発生しました。',
        ephemeral: true
      };
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(replyContent);
      } else {
        await interaction.reply(replyContent);
      }
    }
  }
};