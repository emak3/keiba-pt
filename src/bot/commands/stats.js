// src/bot/commands/stats.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('あなたの詳細な馬券購入統計を表示します。'),
  
  async execute(interaction, bot) {
    const userId = interaction.user.id;
    const user = await bot.userManager.getUser(userId);
    
    if (!user) {
      return interaction.reply({
        content: 'あなたはまだ登録されていません。`/register`コマンドで登録してください。',
        ephemeral: true
      });
    }
    
    await interaction.deferReply();
    
    // 馬券履歴を取得
    const betHistory = await bot.userManager.getBetHistory(userId);
    
    if (betHistory.length === 0) {
      return interaction.editReply({
        content: '馬券の購入履歴はありません。',
        ephemeral: true
      });
    }
    
    // 馬券統計を計算
    const stats = calculateStats(betHistory);
    
    // 統計情報のEmbed作成
    const embed = new EmbedBuilder()
      .setTitle(`${user.username}さんの馬券購入統計`)
      .setColor('#0099FF')
      .setTimestamp()
      .addFields(
        { name: '総購入点数', value: `${stats.totalBets}点`, inline: true },
        { name: '総購入金額', value: `${stats.totalAmount}pt`, inline: true },
        { name: '総払戻金額', value: `${stats.totalPayout}pt`, inline: true },
        { name: '収支', value: `${stats.profit > 0 ? '+' : ''}${stats.profit}pt`, inline: true },
        { name: '回収率', value: `${stats.returnRate}%`, inline: true },
        { name: '的中率', value: `${stats.hitRate}%`, inline: true }
      );
    
    // 馬券タイプ別の統計
    if (stats.betTypeStats.length > 0) {
      const betTypeText = stats.betTypeStats
        .map(s => `${s.betType}: ${s.hits}/${s.count}点 的中率${s.hitRate}% 回収率${s.returnRate}%`)
        .join('\n');
      
      embed.addFields({ name: '馬券タイプ別成績', value: betTypeText });
    }
    
    // JRA/地方競馬別の統計（レース情報が十分にある場合）
    if (stats.raceTypeStats.jra.count > 0 || stats.raceTypeStats.local.count > 0) {
      let raceTypeText = '';
      
      if (stats.raceTypeStats.jra.count > 0) {
        raceTypeText += `JRA: ${stats.raceTypeStats.jra.hits}/${stats.raceTypeStats.jra.count}点 的中率${stats.raceTypeStats.jra.hitRate}% 回収率${stats.raceTypeStats.jra.returnRate}%\n`;
      }
      
      if (stats.raceTypeStats.local.count > 0) {
        raceTypeText += `地方競馬: ${stats.raceTypeStats.local.hits}/${stats.raceTypeStats.local.count}点 的中率${stats.raceTypeStats.local.hitRate}% 回収率${stats.raceTypeStats.local.returnRate}%`;
      }
      
      embed.addFields({ name: 'レースタイプ別成績', value: raceTypeText });
    }
    
    // 高額払戻馬券を表示
    if (stats.bestBets.length > 0) {
      const bestBetsText = stats.bestBets
        .map((bet, i) => {
          const betTypeDisplay = getBetTypeDisplay(bet.betType);
          const methodDisplay = getBetMethodDisplay(bet.method);
          
          return `${i+1}. ${betTypeDisplay}${methodDisplay ? `(${methodDisplay})` : ''}: ${bet.payout}pt`;
        })
        .join('\n');
      
      embed.addFields({ name: '高額払戻TOP3', value: bestBetsText });
    }
    
    await interaction.editReply({ embeds: [embed] });
  }
};

// 統計情報の計算
function calculateStats(betHistory) {
  // 完了した馬券（won/lost）
  const completedBets = betHistory.filter(bet => bet.status === 'won' || bet.status === 'lost');
  
  // 基本統計
  const totalBets = completedBets.length;
  const totalAmount = completedBets.reduce((sum, bet) => sum + bet.amount, 0);
  const totalPayout = completedBets.reduce((sum, bet) => sum + (bet.payout || 0), 0);
  const profit = totalPayout - totalAmount;
  const returnRate = totalAmount > 0 ? Math.round((totalPayout / totalAmount) * 100 * 10) / 10 : 0;
  
  const wonBets = completedBets.filter(bet => bet.status === 'won');
  const hitRate = totalBets > 0 ? Math.round((wonBets.length / totalBets) * 100 * 10) / 10 : 0;
  
  // 馬券タイプ別統計
  const betTypeGroups = {};
  completedBets.forEach(bet => {
    if (!betTypeGroups[bet.betType]) {
      betTypeGroups[bet.betType] = {
        betType: getBetTypeDisplay(bet.betType),
        count: 0,
        hits: 0,
        amount: 0,
        payout: 0
      };
    }
    
    betTypeGroups[bet.betType].count++;
    betTypeGroups[bet.betType].amount += bet.amount;
    betTypeGroups[bet.betType].payout += bet.payout || 0;
    
    if (bet.status === 'won') {
      betTypeGroups[bet.betType].hits++;
    }
  });
  
  // 計算を完了させる
  const betTypeStats = Object.values(betTypeGroups).map(group => {
    return {
      ...group,
      hitRate: group.count > 0 ? Math.round((group.hits / group.count) * 100 * 10) / 10 : 0,
      returnRate: group.amount > 0 ? Math.round((group.payout / group.amount) * 100 * 10) / 10 : 0
    };
  }).sort((a, b) => b.returnRate - a.returnRate);
  
  // JRA/地方競馬別の統計（レースIDから判断できれば）
  const raceTypeStats = {
    jra: { count: 0, hits: 0, amount: 0, payout: 0, hitRate: 0, returnRate: 0 },
    local: { count: 0, hits: 0, amount: 0, payout: 0, hitRate: 0, returnRate: 0 }
  };
  
  completedBets.forEach(bet => {
    // レースIDから判断（例: JRAは202405xxxx、地方は2024Nxxxx など）
    // ここではレースIDの形式に応じた判定ロジックが必要
    // 実際のデータに合わせて調整
    const isLocal = bet.raceId && bet.raceId.startsWith('2024N');
    const type = isLocal ? 'local' : 'jra';
    
    raceTypeStats[type].count++;
    raceTypeStats[type].amount += bet.amount;
    raceTypeStats[type].payout += bet.payout || 0;
    
    if (bet.status === 'won') {
      raceTypeStats[type].hits++;
    }
  });
  
  // 計算を完了させる
  for (const type in raceTypeStats) {
    const stats = raceTypeStats[type];
    stats.hitRate = stats.count > 0 ? Math.round((stats.hits / stats.count) * 100 * 10) / 10 : 0;
    stats.returnRate = stats.amount > 0 ? Math.round((stats.payout / stats.amount) * 100 * 10) / 10 : 0;
  }
  
  // 高額払戻馬券TOP3
  const bestBets = [...wonBets]
    .sort((a, b) => b.payout - a.payout)
    .slice(0, 3);
  
  return {
    totalBets,
    totalAmount,
    totalPayout,
    profit,
    returnRate,
    hitRate,
    betTypeStats,
    raceTypeStats,
    bestBets
  };
}

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