const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('ポイントランキングを表示します。')
    .addIntegerOption(option => 
      option.setName('count')
        .setDescription('表示するランキングの数 (デフォルト: 10)')
        .setRequired(false)),
  
  async execute(interaction, bot) {
    const count = interaction.options.getInteger('count') || 10;
    
    try {
      // ランキングを取得
      const ranking = await bot.userManager.getPointsRanking(count);
      
      if (!ranking || !Array.isArray(ranking) || ranking.length === 0) {
        return interaction.reply({
          content: 'ランキングを表示するためのユーザーデータがありません。まずは`/register`コマンドで登録してください。',
          ephemeral: true
        });
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🏆 ポイントランキング')
        .setColor('#FFD700')
        .setTimestamp();
      
      // ランキング情報を追加
      const rankingText = ranking
        .map(user => {
          const medal = getMedalEmoji(user.rank);
          return `${medal} **${user.rank}位** ${user.username} - ${user.points}pt (総獲得: ${user.totalWinnings}pt)`;
        })
        .join('\n');
      
      // ランキングデータがなければ、デフォルトテキストを設定
      embed.setDescription(rankingText || 'まだランキングデータはありません。');
      
      // 自分のランキング情報を追加
      const userId = interaction.user.id;
      const user = await bot.userManager.getUser(userId);
      
      if (user) {
        // 全ユーザーからランキングを計算
        const allUsers = await bot.userManager.getAllUsers();
        if (allUsers && Array.isArray(allUsers) && allUsers.length > 0) {
          const sortedUsers = allUsers.sort((a, b) => b.points - a.points);
          const userRank = sortedUsers.findIndex(u => u.id === userId) + 1;
          
          if (userRank > 0) {
            embed.addFields({
              name: 'あなたのランキング',
              value: `${getMedalEmoji(userRank)} **${userRank}位** ${user.username} - ${user.points}pt (総獲得: ${user.totalWinnings}pt)`
            });
          }
        }
      }
      
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('ランキングコマンドエラー:', error);
      await interaction.reply({ 
        content: 'ランキングの取得中にエラーが発生しました。しばらく経ってからお試しください。',
        ephemeral: true 
      });
    }
  }
};

// ランキングに応じた絵文字を取得
function getMedalEmoji(rank) {
  switch (rank) {
    case 1: return '🥇';
    case 2: return '🥈';
    case 3: return '🥉';
    default: return '🏅';
  }
}