// interactionHandlers.js
// Discord Bot のインタラクションを統一的に処理するファイル
import logger from '../utils/logger.js';

export async function setupInteractionHandlers(client) {
  // 全てのインタラクションイベントを処理
  client.on('interactionCreate', async (interaction) => {
    try {
      // スラッシュコマンドの処理は別途行われているため、ここでは処理しない
      if (interaction.isChatInputCommand()) return;
      
      // 馬券選択のインタラクション
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('bet_select_')) {
        await handleBetSelectInteraction(interaction, client);
      }
      
      // 馬券購入確認ボタン
      else if (interaction.isButton() && interaction.customId.startsWith('bet_confirm_')) {
        await handleBetConfirmInteraction(interaction, client);
      }
      
      // 馬券購入キャンセルボタン
      else if (interaction.isButton() && interaction.customId === 'bet_cancel') {
        await handleBetCancelInteraction(interaction);
      }
      
      // フォーメーション馬券のモーダル送信
      else if (interaction.isModalSubmit() && interaction.customId.startsWith('bet_formation_')) {
        await handleFormationBetInteraction(interaction, client);
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

/**
 * 馬券選択メニューのインタラクション処理
 * @param {StringSelectMenuInteraction} interaction - インタラクション
 * @param {Client} client - Discordクライアント
 */
async function handleBetSelectInteraction(interaction, client) {
  try {
    // bet コマンドを取得
    const betCommand = client.commands.get('bet');
    
    if (betCommand && typeof betCommand.handleBetSelection === 'function') {
      // bet コマンドの専用ハンドラを呼び出し
      await betCommand.handleBetSelection(interaction);
    } else {
      // コマンドが見つからない場合
      logger.error('bet コマンドまたは handleBetSelection メソッドが見つかりません');
      await interaction.reply({
        content: '馬券選択処理ができませんでした。システム管理者にお問い合わせください。',
        ephemeral: true
      });
    }
  } catch (error) {
    logger.error(`馬券選択インタラクション処理中にエラー: ${error}`);
    throw error; // 上位の例外ハンドラに処理を委譲
  }
}

/**
 * 馬券購入確認ボタンのインタラクション処理
 * @param {ButtonInteraction} interaction - インタラクション
 * @param {Client} client - Discordクライアント
 */
async function handleBetConfirmInteraction(interaction, client) {
  try {
    // bet コマンドを取得
    const betCommand = client.commands.get('bet');
    
    if (betCommand && typeof betCommand.handleBetConfirmation === 'function') {
      // bet コマンドの専用ハンドラを呼び出し
      await betCommand.handleBetConfirmation(interaction);
    } else {
      // コマンドが見つからない場合
      logger.error('bet コマンドまたは handleBetConfirmation メソッドが見つかりません');
      await interaction.reply({
        content: '馬券購入処理ができませんでした。システム管理者にお問い合わせください。',
        ephemeral: true
      });
    }
  } catch (error) {
    logger.error(`馬券確認インタラクション処理中にエラー: ${error}`);
    throw error; // 上位の例外ハンドラに処理を委譲
  }
}

/**
 * 馬券購入キャンセルボタンのインタラクション処理
 * @param {ButtonInteraction} interaction - インタラクション
 */
async function handleBetCancelInteraction(interaction) {
  try {
    await interaction.update({
      content: '馬券購入をキャンセルしました。',
      embeds: [],
      components: []
    });
  } catch (error) {
    logger.error(`馬券キャンセルインタラクション処理中にエラー: ${error}`);
    throw error; // 上位の例外ハンドラに処理を委譲
  }
}

/**
 * フォーメーション馬券のモーダル送信処理
 * @param {ModalSubmitInteraction} interaction - インタラクション
 * @param {Client} client - Discordクライアント
 */
async function handleFormationBetInteraction(interaction, client) {
  try {
    // bet コマンドを取得
    const betCommand = client.commands.get('bet');
    
    if (betCommand && typeof betCommand.handleFormationBet === 'function') {
      // bet コマンドの専用ハンドラを呼び出し
      await betCommand.handleFormationBet(interaction);
    } else {
      // コマンドが見つからない場合
      logger.error('bet コマンドまたは handleFormationBet メソッドが見つかりません');
      await interaction.reply({
        content: 'フォーメーション馬券処理ができませんでした。システム管理者にお問い合わせください。',
        ephemeral: true
      });
    }
  } catch (error) {
    logger.error(`フォーメーション馬券インタラクション処理中にエラー: ${error}`);
    throw error; // 上位の例外ハンドラに処理を委譲
  }
}