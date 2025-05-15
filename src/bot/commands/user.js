// user.js - ユーザー情報コマンド
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../db/firebase');
const { getUserByDiscordId, getPointsRanking } = require('../../db/users');
const { getUserBets } = require('../../db/bets');
const { formatter } = require('../../utils/formatter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('user')
    .setDescription('ユーザー情報を表示します')
    .addSubcommand(subcommand =>
      subcommand
        .setName('info')
        .setDescription('自分の情報を表示します')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('ranking')
        .setDescription('ポイントランキングを表示します')
    ),
  
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'info') {
      await this.showUserInfo(interaction);
    } else if (subcommand === 'ranking') {
      await this.showPointsRanking(interaction);
    }
  },
  
  /**
   * ユーザー情報を表示
   */
  async showUserInfo(interaction) {
    await interaction.deferReply();
    
    try {
      // ユーザー情報を取得
      const user = await getUserByDiscordId(interaction.user.id);
      
      if (!user) {
        await interaction.editReply('ユーザー情報が見つかりませんでした。');
        return;
      }
      
      // 馬券情報を取得
      const bets = await getUserBets(user.id);
      
      // 統計情報を計算
      const completedBets = bets.filter(bet => bet.settled);
      const totalBets = completedBets.length;
      const hitBets = completedBets.filter(bet => bet.payout > 0).length;
      const hitRate = totalBets > 0 ? (hitBets / totalBets * 100).toFixed(1) : 0;
      
      const totalSpent = completedBets.reduce((sum, bet) => sum + bet.amount, 0);
      const totalPayout = completedBets.reduce((sum, bet) => sum + bet.payout, 0);
      const profit = totalPayout - totalSpent;
      
      // 埋め込みを作成
      const embed = new EmbedBuilder()
        .setTitle(`${interaction.user.username}さんの情報`)
        .setColor('#0099ff')
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
          { name: 'ポイント残高', value: `${user.points}pt`, inline: true },
          { name: '購入馬券数', value: `${totalBets}枚`, inline: true },
          { name: '的中率', value: `${hitRate}%（${hitBets}/${totalBets}）`, inline: true },
          { name: '総投資額', value: `${totalSpent}pt`, inline: true },
          { name: '総払戻額', value: `${totalPayout}pt`, inline: true },
          { name: '収支', value: `${profit >= 0 ? '+' : ''}${profit}pt`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: `登録日: ${formatter.formatDate(user.createdAt)}` });
      
      // 最近の馬券を表示
      if (bets.length > 0) {
        const recentBets = bets.slice(0, 5);
        const betContents = recentBets.map(bet => formatter.betContent(bet)).join('\n');
        
        embed.addFields({
          name: '最近の馬券',
          value: betContents
        });
      }
      
      // 返信
      await interaction.editReply({
        embeds: [embed]
      });
    } catch (error) {
      console.error('ユーザー情報の表示中にエラーが発生しました:', error);
      await interaction.editReply('ユーザー情報の取得中にエラーが発生しました。');
    }
  },
  
  /**
   * ポイントランキングを表示
   */
  async showPointsRanking(interaction) {
    await interaction.deferReply();
    
    try {
      // ランキングを取得
      const ranking = await getPointsRanking(10);
      
      if (ranking.length === 0) {
        await interaction.editReply('ランキング情報がありません。');
        return;
      }
      
      // 埋め込みを作成
      const embed = new EmbedBuilder()
        .setTitle('ポイントランキング')
        .setColor('#ffd700')
        .setDescription('ポイント保有数のトップ10です。')
        .setTimestamp();
      
      // ランキング情報を追加
      let rankingText = '';
      
      for (const user of ranking) {
        rankingText += `${user.rank}位: ${user.username} - ${user.points}pt\n`;
      }
      
      embed.addFields({
        name: 'トップ10',
        value: rankingText
      });
      
      // 自分のランキング情報を追加
      const user = await getUserByDiscordId(interaction.user.id);
      
      if (user) {
        // 自分の順位を検索
        const db = getDb();
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('points', '>', user.points).get();
        const userRank = snapshot.size + 1;
        
        embed.addFields({
          name: 'あなたのランキング',
          value: `${userRank}位: ${user.username} - ${user.points}pt`
        });
      }
      
      // 返信
      await interaction.editReply({
        embeds: [embed]
      });
    } catch (error) {
      console.error('ランキングの表示中にエラーが発生しました:', error);
      await interaction.editReply('ランキング情報の取得中にエラーが発生しました。');
    }
  }
};