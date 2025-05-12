// src/bot/commands/profile.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('あなたのプロフィールを表示します。'),
  
  async execute(interaction, bot) {
    try {
      const userId = interaction.user.id;
      const user = await bot.userManager.getUser(userId);
      
      if (!user) {
        return interaction.reply({
          content: 'あなたはまだ登録されていません。`/register`コマンドで登録してください。',
          ephemeral: true
        });
      }
      
      // 最近の馬券履歴を取得（最大5件）
      const recentBets = await bot.userManager.getBetHistory(userId, 5);
      
      const embed = new EmbedBuilder()
        .setTitle(`${user.username}さんのプロフィール`)
        .addFields(
          { name: '現在のポイント', value: `${user.points}ポイント` },
          { name: '総獲得ポイント', value: `${user.totalWinnings}ポイント` },
          { name: '購入馬券数', value: `${recentBets ? recentBets.length : 0}枚` }
        )
        .setColor('#0099FF')
        .setTimestamp();
      
      // 最近の馬券履歴があれば追加
      if (recentBets && recentBets.length > 0) {
        const historyText = recentBets
          .map(bet => {
            // レース情報の取得を試みる
            const raceInfo = bot.todayRaces.find(r => r.id === bet.raceId);
            const raceName = raceInfo ? `${raceInfo.track} ${raceInfo.number}R` : 'レース不明';
            const result = bet.status === 'won' ? `的中 (+${bet.payout}pt)` : bet.status === 'lost' ? '不的中' : '結果待ち';
            return `${raceName}: ${getBetTypeDisplay(bet.betType)} ${bet.amount}pt - ${result}`;
          })
          .join('\n');
        
        if (historyText.trim()) {
          embed.addFields({ name: '最近の馬券履歴', value: historyText });
        }
      } else {
        embed.addFields({ name: '馬券履歴', value: 'まだ馬券を購入していません。' });
      }
      
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('プロフィールコマンドエラー:', error);
      await interaction.reply({
        content: 'プロフィール情報の取得中にエラーが発生しました。',
        ephemeral: true
      });
    }
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