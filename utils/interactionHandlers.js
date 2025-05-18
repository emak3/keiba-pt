// utils/interactionHandlers.js
// Discord Bot のインタラクションを統一的に処理するファイル
import logger from './logger.js';
import BetHandler from './betHandler.js';

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
      else if (interaction.isStringSelectMenu() && (
        interaction.customId.startsWith('bet_select_method_') || 
        interaction.customId.startsWith('bet_select_amount_')
      )) {
        await BetHandler.handleMethodSelection(interaction);
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
        interaction.customId.startsWith('bet_back_to_type_')
      )) {
        await BetHandler.handleBackButton(interaction);
      }
      
      // キャンセルボタン
      else if (interaction.isButton() && interaction.customId.startsWith('bet_cancel_')) {
        await BetHandler.handleBetConfirmation(interaction);
      }
      
      // マイページを開くボタン
      else if (interaction.isButton() && interaction.customId === 'mypage_open') {
        await BetHandler.handleMypageButton(interaction, client);
      }
      
      // フォーメーション馬券のモーダル送信
      else if (interaction.isModalSubmit() && interaction.customId.startsWith('bet_formation_')) {
        await BetHandler.handleFormationBet(interaction);
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
            ephemeral: true
          });
        } else if (interaction.deferred) {
          await interaction.editReply({
            content: 'エラーが発生しました。もう一度お試しください。'
          });
        } else {
          await interaction.reply({
            content: 'エラーが発生しました。もう一度お試しください。',
            ephemeral: true
          });
        }
      } catch (responseError) {
        logger.error(`エラー応答中にさらにエラーが発生しました: ${responseError}`);
      }
    }
  });
  
  logger.info('インタラクションハンドラーを設定しました。');
}