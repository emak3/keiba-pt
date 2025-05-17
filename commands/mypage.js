import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getUser, saveUser } from '../../services/database/userService.js';
import { getUserBets } from '../../services/database/betService.js';
import logger from '../../utils/logger.js';

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
      
      // 馬券購入履歴を取得
      const bets = await getUserBets(interaction.user.id, 10);
      
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
        .setTimestamp();
      
      // 馬券履歴の整形
      let betHistoryText = '';
      
      if (bets.length === 0) {
        betHistoryText = '馬券購入履歴はありません。';
      } else {
        bets.forEach((bet, index) => {
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
          
          // 選択馬番の表示
          let selectionsDisplay = '';
          if (Array.isArray(bet.selections[0])) {
            // 順序ありの馬券（馬単・三連単）
            selectionsDisplay = bet.selections.map(s => s.join('-')).join('→');
          } else {
            // 順序なしの馬券
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
        if (i.customId === 'mypage_refresh') {
          // マイページを更新
          await i.update({ content: '更新中...', embeds: [], components: [] });
          
          // コマンドを再実行
          const command = interaction.client.commands.get('mypage');
          await command.execute({
            ...interaction,
            editReply: (options) => i.editReply(options)
          });
        } else if (i.customId === 'mypage_more_history') {
          // より多くの履歴を表示
          await i.deferUpdate();
          
          // 最大30件の履歴を取得
          const moreBets = await getUserBets(interaction.user.id, 30);
          
          // 履歴エンベッドを更新
          let moreHistoryText = '';
          
          if (moreBets.length === 0) {
            moreHistoryText = '馬券購入履歴はありません。';
          } else {
            moreBets.forEach((bet, index) => {
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
              
              moreHistoryText += `**${index + 1}. ${raceInfo}**\n`;
              moreHistoryText += `${betTypeNames[bet.betType] || bet.betType}（${methodNames[bet.method] || bet.method}）: ${selectionsDisplay}\n`;
              moreHistoryText += `購入: ${bet.amount}pt / ${payoutInfo}\n\n`;
            });
          }
          
          const moreHistoryEmbed = new EmbedBuilder()
            .setTitle(`${interaction.user.username} さんの馬券購入履歴（詳細）`)
            .setDescription(moreHistoryText)
            .setColor(0x00b0f4)
            .setTimestamp();
          
          await i.editReply({
            embeds: [userEmbed, moreHistoryEmbed],
            components: [row]
          });
        }
      });
      
      collector.on('end', () => {
        // コレクターの終了時に行う処理（オプション）
      });
      
    } catch (error) {
      logger.error(`マイページ表示中にエラーが発生しました: ${error}`);
      await interaction.editReply({ content: 'マイページの表示中にエラーが発生しました。しばらく経ってからもう一度お試しください。' });
    }
  }
};

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