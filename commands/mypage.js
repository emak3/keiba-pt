// commands/mypage.js
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getUser, saveUser } from '../services/database/userService.js';
import { getUserBets } from '../services/database/betService.js';
import logger from '../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('mypage')
    .setDescription('自分の情報と馬券購入履歴を表示します'),
  
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      // ユーザー情報を保存
      await saveUser(
        interaction.user.id,
        interaction.user.username,
        interaction.user.displayAvatarURL()
      );
      
      // ユーザー情報を取得
      const user = await getUser(interaction.user.id);
      
      if (!user) {
        return await interaction.editReply('ユーザー情報の取得に失敗しました。');
      }
      
      await displayMypage(interaction, user);
    } catch (error) {
      logger.error(`マイページ表示中にエラーが発生しました: ${error}`);
      await interaction.editReply({ content: 'マイページの表示中にエラーが発生しました。しばらく経ってからもう一度お試しください。' });
    }
  }
};

/**
 * マイページを表示する
 * @param {CommandInteraction|ButtonInteraction} interaction - インタラクション
 * @param {Object} user - ユーザー情報
 * @param {number} [historyLimit=10] - 表示する履歴の数
 */
export async function displayMypage(interaction, user, historyLimit = 10) {
  try {
    // 馬券購入履歴を取得
    const bets = await getUserBets(interaction.user.id, historyLimit);
    
    // ユーザー情報のエンベッド
    const userEmbed = new EmbedBuilder()
      .setTitle(`${interaction.user.username} さんのマイページ`)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setColor(0x00b0f4)
      .setTimestamp()
      .addFields(
        { name: '現在のポイント', value: `${user.points}pt` },
        { name: '登録日', value: formatDate(user.createdAt) }
      );
    
    // 馬券履歴のエンベッド
    const betHistoryEmbed = new EmbedBuilder()
      .setTitle(`${interaction.user.username} さんの馬券購入履歴`)
      .setColor(0x00b0f4)
      .setFooter({ text: `1ページ（最新の${historyLimit}件）` })
      .setTimestamp();
    
    // 馬券履歴の整形
    const betHistoryText = formatBetHistory(bets);
    betHistoryEmbed.setDescription(betHistoryText);
    
    // ボタン
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('mypage_refresh')
          .setLabel('更新')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('mypage_more_history')
          .setLabel('履歴をもっと見る')
          .setStyle(ButtonStyle.Secondary)
      );
    
    // レスポンスを送信
    await interaction.editReply({
      embeds: [userEmbed, betHistoryEmbed],
      components: [row]
    });
    
    // ボタンのインタラクションコレクター
    const filter = i => i.customId.startsWith('mypage_') && i.user.id === interaction.user.id;
    
    const collector = interaction.channel.createMessageComponentCollector({ 
      filter, 
      time: 600000 // 10分間有効
    });
    
    collector.on('collect', async i => {
      try {
        if (i.customId === 'mypage_refresh') {
          // マイページを更新
          await i.update({ content: '更新中...', embeds: [], components: [] });
          
          // 最新のユーザー情報を取得
          const updatedUser = await getUser(interaction.user.id);
          if (!updatedUser) {
            await i.editReply('ユーザー情報の取得に失敗しました。');
            return;
          }
          
          // 最新の表示を行う
          await displayMypage(
            { 
              ...i, 
              user: interaction.user,
              editReply: options => i.editReply(options)
            }, 
            updatedUser, 
            historyLimit
          );
        } else if (i.customId === 'mypage_more_history') {
          // より多くの履歴を表示
          await i.deferUpdate();
          
          // 最大30件の履歴を取得
          const moreHistoryLimit = 30;
          const moreBets = await getUserBets(interaction.user.id, moreHistoryLimit);
          
          // 履歴エンベッドを更新
          const moreHistoryText = formatBetHistory(moreBets);
          
          const moreHistoryEmbed = new EmbedBuilder()
            .setTitle(`${interaction.user.username} さんの馬券購入履歴（詳細）`)
            .setDescription(moreHistoryText)
            .setFooter({ text: `詳細表示（最新の${moreHistoryLimit}件）` })
            .setColor(0x00b0f4)
            .setTimestamp();
          
          await i.editReply({
            embeds: [userEmbed, moreHistoryEmbed],
            components: [row]
          });
        }
      } catch (error) {
        logger.error(`マイページボタン処理中にエラー: ${error}`);
        await i.reply({ content: 'エラーが発生しました。もう一度お試しください。', ephemeral: true });
      }
    });
    
    collector.on('end', () => {
      // 必要に応じてボタンを無効化
    });
  } catch (error) {
    logger.error(`マイページ表示処理中にエラー: ${error}`);
    throw error;
  }
}

/**
 * 馬券履歴を整形するヘルパー関数
 * @param {Array} bets - 馬券履歴配列
 * @returns {string} 整形された履歴テキスト
 */
function formatBetHistory(bets) {
  // 表示用定数
  const betTypeNames = {
    tansho: '単勝',
    fukusho: '複勝',
    wakuren: '枠連',
    umaren: '馬連',
    wide: 'ワイド',
    umatan: '馬単',
    sanrenpuku: '三連複',
    sanrentan: '三連単'
  };
  
  const methodNames = {
    normal: '通常',
    box: 'ボックス',
    formation: 'フォーメーション'
  };
  
  // 馬券履歴の整形
  let betHistoryText = '';
  
  if (bets.length === 0) {
    betHistoryText = '馬券購入履歴はありません。';
  } else {
    bets.forEach((bet, index) => {
      // 選択馬番の表示
      let selectionsDisplay = '';
      if (Array.isArray(bet.selections[0])) {
        selectionsDisplay = bet.selections.map(s => s.join('-')).join('→');
      } else {
        selectionsDisplay = bet.selections.join('-');
      }
      
      // レース情報
      const raceInfo = bet.race ? 
        `${bet.race.date.slice(0, 4)}/${bet.race.date.slice(4, 6)}/${bet.race.date.slice(6, 8)} ${bet.race.venue} ${bet.race.number}R ${bet.race.name}` : 
        'レース情報なし';
      
      // 払戻情報
      let payoutInfo = '';
      if (bet.status === 'processed') {
        payoutInfo = bet.payout > 0 ? 
          `✅ **${bet.payout}pt獲得!**` : 
          '❌ はずれ';
      } else {
        payoutInfo = '⏳ 結果待ち';
      }
      
      betHistoryText += `**${index + 1}. ${raceInfo}**\n`;
      betHistoryText += `${betTypeNames[bet.betType] || bet.betType}（${methodNames[bet.method] || bet.method}）: ${selectionsDisplay}\n`;
      betHistoryText += `購入: ${bet.amount}pt / ${payoutInfo}\n\n`;
    });
  }
  
  return betHistoryText;
}

/**
 * 日付文字列をフォーマット
 * @param {string} dateString - ISO形式の日付文字列
 * @returns {string} フォーマットされた日付文字列
 */
function formatDate(dateString) {
  try {
    const date = new Date(dateString);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
  } catch (error) {
    return dateString || '不明';
  }
}