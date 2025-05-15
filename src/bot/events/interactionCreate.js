// interactionCreate.js - インタラクションを処理するイベント
const { Events, InteractionType } = require('discord.js');
const { getUserByDiscordId, createUser } = require('../../db/users');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // コマンド実行時
    if (interaction.isChatInputCommand()) {
      // コマンドを取得
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`${interaction.commandName}というコマンドが見つかりません。`);
        return;
      }

      try {
        // ユーザー情報を取得（存在しない場合は作成）
        const user = await getUserByDiscordId(interaction.user.id);
        
        if (!user) {
          await createUser({
            discordId: interaction.user.id,
            username: interaction.user.username
          });
        }
        
        // コマンドを実行
        await command.execute(interaction);
      } catch (error) {
        console.error(`${interaction.commandName}コマンドの実行中にエラーが発生しました:`, error);
        
        const replyOptions = {
          content: 'コマンドの実行中にエラーが発生しました。',
          ephemeral: true
        };
        
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(replyOptions);
        } else {
          await interaction.reply(replyOptions);
        }
      }
    }
    // コンポーネント操作時（ボタン、セレクトメニューなど）
    else if (interaction.isButton() || interaction.isStringSelectMenu()) {
      // カスタムIDを解析
      const [handler, action, ...args] = interaction.customId.split(':');
      
      // 対応するコマンドを取得
      const command = interaction.client.commands.get(handler);
      
      if (!command || !command.handleInteraction) {
        console.error(`${handler}コマンドが見つかりません、またはhandleInteractionメソッドがありません。`);
        return;
      }
      
      try {
        // ユーザー情報を取得（存在しない場合は作成）
        const user = await getUserByDiscordId(interaction.user.id);
        
        if (!user) {
          await createUser({
            discordId: interaction.user.id,
            username: interaction.user.username
          });
        }
        
        // インタラクションを処理
        await command.handleInteraction(interaction, action, args);
      } catch (error) {
        console.error(`インタラクション処理中にエラーが発生しました:`, error);
        
        const replyOptions = {
          content: 'インタラクションの処理中にエラーが発生しました。',
          ephemeral: true
        };
        
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(replyOptions);
        } else {
          await interaction.reply(replyOptions);
        }
      }
    }
  }
};