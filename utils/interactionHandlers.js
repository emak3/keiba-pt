// utils/interactionHandlers.js
// Discord Bot のインタラクションを統一的に処理するファイル
import logger from './logger.js';
import BetHandler from './betHandler.js';
import { getUser } from '../services/database/userService.js';
import { getUserBets } from '../services/database/betService.js';
import { MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export async function setupInteractionHandlers(client) {
  // 全てのインタラクションイベントを処理
  client.on('interactionCreate', async (interaction) => {
    try {
      // スラッシュコマンドの処理は別途行われているため、ここでは処理しない
      if (interaction.isChatInputCommand()) return;

      // 馬券タイプ選択のインタラクション
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('bet_select_type_')) {
        await BetHandler.handleBetTypeSelection(interaction);
      }

      // 購入方法選択のインタラクション 
      else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('bet_select_method_')) {
        await BetHandler.handleMethodSelection(interaction);
      }

      // 金額選択のインタラクション - 追加
      else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('bet_select_amount_')) {
        await BetHandler.handleAmountSelection(interaction);
      }

      // 馬番選択のインタラクション
      else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('bet_select_horses_')) {
        await BetHandler.handleHorseSelection(interaction);
      }

      // 馬券購入確認ボタン
      else if (interaction.isButton() && interaction.customId.startsWith('bet_confirm_')) {
        await BetHandler.handleBetConfirmation(interaction);
      }

      // 「戻る」ボタン 
      else if (interaction.isButton() && (
        interaction.customId.startsWith('bet_back_to_race_') ||
        interaction.customId.startsWith('bet_back_to_type_') ||
        interaction.customId.startsWith('bet_back_to_method_') // 追加: 購入方法選択に戻る
      )) {
        await BetHandler.handleBackButton(interaction);
      }
      else if (interaction.isStringSelectMenu() && (
        interaction.customId.startsWith('bet_formation_first_') ||
        interaction.customId.startsWith('bet_formation_second_') ||
        interaction.customId.startsWith('bet_formation_third_') ||
        interaction.customId.startsWith('bet_formation_key_') ||
        interaction.customId.startsWith('bet_formation_partner_')
      )) {
        await BetHandler.handleFormationPositionSelection(interaction);
      }
      else if (interaction.isButton() && interaction.customId.startsWith('bet_formation_confirm_')) {
        await BetHandler.handleFormationConfirmation(interaction);
      }
      // キャンセルボタン
      else if (interaction.isButton() && interaction.customId.startsWith('bet_cancel_')) {
        await BetHandler.handleBetConfirmation(interaction);
      }

      // マイページを開くボタン
      else if (interaction.isButton() && interaction.customId === 'mypage_open') {
        await BetHandler.handleMypageButton(interaction, client);
      }

      // マイページの更新ボタン
      else if (interaction.isButton() && interaction.customId === 'mypage_refresh') {
        await handleMypageRefresh(interaction);
      }

      // マイページの履歴をもっと見るボタン
      else if (interaction.isButton() && interaction.customId === 'mypage_more_history') {
        await handleMypageMoreHistory(interaction);
      }

      // ※※※ 以下を追加（金額入力モーダルの処理）※※※
      // 金額入力モーダルの送信処理
      else if (interaction.isModalSubmit() && interaction.customId.startsWith('bet_amount_')) {
        await BetHandler.handleAmountSubmit(interaction);
      }
      // ※※※ 追加終了 ※※※

      // 馬単・三連単用の順序指定モーダル送信
      else if (interaction.isModalSubmit() && interaction.customId.startsWith('bet_ordered_normal_')) {
        await BetHandler.handleOrderedBetSubmit(interaction);
      }

      // フォーメーション馬券のモーダル送信
      else if (interaction.isModalSubmit() && interaction.customId.startsWith('bet_formation_')) {
        await BetHandler.handleFormationBetSubmit(interaction);
      }

      // races.js からのインタラクション
      else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('races_select_venue_')) {
        // races.js で処理されるのでスキップ
        return;
      }
      else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('races_select_race_')) {
        // races.js で処理されるのでスキップ
        return;
      }
      else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('bet_select_frames_')) {
        await BetHandler.handleFrameSelection(interaction);
      }
      else if (interaction.isButton() && (
        interaction.customId.startsWith('races_prev_') ||
        interaction.customId.startsWith('races_next_') ||
        interaction.customId.startsWith('races_back_')
      )) {
        // races.js で処理されるのでスキップ
        return;
      }
    } catch (error) {
      logger.error(`インタラクション処理中にエラーが発生しました: ${error}`);

      try {
        // インタラクションの状態に合わせて適切な方法でエラーを通知
        if (interaction.replied) {
          await interaction.followUp({
            content: 'エラーが発生しました。もう一度お試しください。',
            flags: MessageFlags.Ephemeral
          });
        } else if (interaction.deferred) {
          await interaction.editReply({
            content: 'エラーが発生しました。もう一度お試しください。'
          });
        } else {
          await interaction.reply({
            content: 'エラーが発生しました。もう一度お試しください。',
            flags: MessageFlags.Ephemeral
          });
        }
      } catch (responseError) {
        logger.error(`エラー応答中にさらにエラーが発生しました: ${responseError}`);
      }
    }
  });

  logger.info('インタラクションハンドラーを設定しました。');
}

/**
 * マイページの更新ボタンハンドラ
 * @param {ButtonInteraction} interaction - ボタンインタラクション
 */
async function handleMypageRefresh(interaction) {
  try {
    await interaction.deferUpdate();

    // 最新のユーザー情報を取得
    const user = await getUser(interaction.user.id);
    if (!user) {
      return await interaction.editReply({
        content: 'ユーザー情報の取得に失敗しました。',
        embeds: [],
        components: []
      });
    }

    // 馬券履歴を取得
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
      .setFooter({ text: `1ページ（最新の10件）` })
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

    await interaction.editReply({
      content: `${interaction.user.username} さんのマイページ（更新済み）`,
      embeds: [userEmbed, betHistoryEmbed],
      components: [row]
    });
  } catch (error) {
    logger.error(`マイページ更新中にエラー: ${error}`);
    await interaction.editReply({
      content: 'マイページの更新中にエラーが発生しました。',
      components: []
    });
  }
}

/**
 * マイページの履歴をもっと見るボタンハンドラ
 * @param {ButtonInteraction} interaction - ボタンインタラクション
 */
async function handleMypageMoreHistory(interaction) {
  try {
    await interaction.deferUpdate();

    // ユーザー情報を取得
    const user = await getUser(interaction.user.id);
    if (!user) {
      return await interaction.editReply({
        content: 'ユーザー情報の取得に失敗しました。',
        embeds: [],
        components: []
      });
    }

    // 馬券履歴を取得（30件）
    const moreHistoryLimit = 30;
    const moreBets = await getUserBets(interaction.user.id, moreHistoryLimit);

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
    const moreHistoryEmbed = new EmbedBuilder()
      .setTitle(`${interaction.user.username} さんの馬券購入履歴（詳細）`)
      .setColor(0x00b0f4)
      .setFooter({ text: `詳細表示（最新の${moreHistoryLimit}件）` })
      .setTimestamp();

    // 馬券履歴の整形
    const moreHistoryText = formatBetHistory(moreBets);
    moreHistoryEmbed.setDescription(moreHistoryText);

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

    await interaction.editReply({
      content: `${interaction.user.username} さんのマイページ（詳細表示）`,
      embeds: [userEmbed, moreHistoryEmbed],
      components: [row]
    });
  } catch (error) {
    logger.error(`マイページ詳細表示中にエラー: ${error}`);
    await interaction.editReply({
      content: 'マイページの詳細表示中にエラーが発生しました。',
      components: []
    });
  }
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