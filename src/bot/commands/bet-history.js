// src/bot/commands/bet-history.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bet-history')
    .setDescription('あなたの馬券購入履歴を表示します。')
    .addIntegerOption(option => 
      option.setName('count')
        .setDescription('表示する履歴の数 (デフォルト: 10)')
        .setRequired(false)),
  
  async execute(interaction, bot) {
    const userId = interaction.user.id;
    const count = interaction.options.getInteger('count') || 10;
    
    const user = bot.userManager.getUser(userId);
    if (!user) {
      return interaction.reply({
        content: 'あなたはまだ登録されていません。`/register`コマンドで登録してください。',
        ephemeral: true
      });
    }
    
    // 馬券履歴を取得
    const betHistory = bot.userManager.getBetHistory(userId);
    
    if (betHistory.length === 0) {
      return interaction.reply({
        content: '馬券の購入履歴はありません。',
        ephemeral: true
      });
    }
    
    // 最新の履歴を取得
    const recentBets = betHistory
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, count);
    
    const embed = new EmbedBuilder()
      .setTitle(`${user.username}さんの馬券購入履歴`)
      .setColor('#0099FF')
      .setTimestamp();
    
    // 履歴をEmbedに追加
    for (const bet of recentBets) {
      const raceInfo = bot.todayRaces.find(r => r.id === bet.raceId);
      const raceName = raceInfo 
        ? `${raceInfo.track} ${raceInfo.number}R ${raceInfo.name}` 
        : 'レース不明';
      
      const betTypeDisplay = getBetTypeDisplay(bet.betType);
      const methodDisplay = getBetMethodDisplay(bet.method);
      
      let selectionsDisplay = '';
      if (typeof bet.selections === 'object' && !Array.isArray(bet.selections)) {
        // フォーメーション
        const { first, second, third } = bet.selections;
        selectionsDisplay = `1着: ${first.join(',')} - 2着: ${second.join(',')}`;
        if (third) {
          selectionsDisplay += ` - 3着: ${third.join(',')}`;
        }
      } else {
        // 通常・ボックス
        selectionsDisplay = Array.isArray(bet.selections) 
          ? bet.selections.join(',') 
          : bet.selections;
      }
      
      const result = bet.status === 'active'
        ? '🔄 結果待ち'
        : bet.status === 'won'
          ? `🎯 的中 (+${bet.payout}pt)`
          : '❌ 不的中';
      
      embed.addFields({
        name: raceName,
        value: `**${betTypeDisplay}${methodDisplay && ` (${methodDisplay})`}**\n選択: ${selectionsDisplay}\n金額: ${bet.amount}pt\n結果: ${result}`,
        inline: false
      });
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

// 購入方法の表示名を取得
function getBetMethodDisplay(method) {
  const methods = {
    normal: '通常',
    box: 'ボックス',
    formation: 'フォーメーション'
  };
  
  return methods[method] || method;
}