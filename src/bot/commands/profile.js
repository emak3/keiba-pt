// src/bot/commands/profile.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('あなたのプロフィールを表示します。'),
  
  async execute(interaction, bot) {
    const userId = interaction.user.id;
    const user = bot.userManager.getUser(userId);
    
    if (!user) {
      return interaction.reply({
        content: 'あなたはまだ登録されていません。`/register`コマンドで登録してください。',
        ephemeral: true
      });
    }
    
    // 最近の馬券履歴を取得（最大5件）
    const recentBets = user.betHistory
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
    
    const embed = new EmbedBuilder()
      .setTitle(`${user.username}さんのプロフィール`)
      .addFields(
        { name: '現在のポイント', value: `${user.points}ポイント` },
        { name: '総獲得ポイント', value: `${user.totalWinnings}ポイント` },
        { name: '購入馬券数', value: `${user.betHistory.length}枚` }
      )
      .setColor('#0099FF')
      .setTimestamp();
    
    // 最近の馬券履歴があれば追加
    if (recentBets.length > 0) {
      const historyText = recentBets
        .map(bet => {
          const raceInfo = bot.todayRaces.find(r => r.id === bet.raceId);
          const raceName = raceInfo ? `${raceInfo.track} ${raceInfo.number}R` : 'レース不明';
          const result = bet.status === 'won' ? `的中 (+${bet.payout}pt)` : '不的中';
          return `${raceName}: ${getBetTypeDisplay(bet.betType)} ${bet.amount}pt - ${result}`;
        })
        .join('\n');
      
      embed.addFields({ name: '最近の馬券履歴', value: historyText });
    }
    
    await interaction.reply({ embeds: [embed] });
  }
};

// 馬券タイプの表示名を取得
function getBetTypeDisplay(betType) {
  const types = {
    tansho: '単勝',
    fukusho: '複勝',
    wakuren: '枠連',
    umaren: '馬連',
    umatan: '馬単',
    wide: 'ワイド',
    sanrenpuku: '三連複',
    sanrentan: '三連単'
  };
  
  return types[betType] || betType;
}