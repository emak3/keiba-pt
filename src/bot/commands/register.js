// src/bot/commands/register.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('競馬シミュレーションに登録します。'),
  
  async execute(interaction, bot) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    
    // ユーザー登録
    const result = bot.userManager.registerUser(userId, username);
    
    if (result.success) {
      const embed = new EmbedBuilder()
        .setTitle('登録完了')
        .setDescription(`${username}さん、競馬シミュレーションへようこそ！`)
        .addFields(
          { name: '初期ポイント', value: `${result.user.points}ポイント` }
        )
        .setColor('#00FF00')
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
    } else {
      await interaction.reply({
        content: result.message,
        ephemeral: true
      });
    }
  }
};