// interactionHandlers.js
// Discord Bot のインタラクションを統一的に処理するファイル
import logger from '../utils/logger.js';

export async function setupInteractionHandlers(client) {
  // 全てのインタラクションイベントを処理
  client.on('interactionCreate', async (interaction) => {
    try {
      // スラッシュコマンドの処理は別途行われているため、ここでは処理しない
      if (interaction.isChatInputCommand()) return;
      
      // 馬券タイプ選択のインタラクション
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('bet_select_type_')) {
        await handleBetTypeSelection(interaction, client);
      }
      
      // 馬券馬番選択のインタラクション
      else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('bet_select_')) {
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
 * 馬券タイプ選択メニューのインタラクション処理
 * @param {StringSelectMenuInteraction} interaction - インタラクション
 * @param {Client} client - Discordクライアント
 */
async function handleBetTypeSelection(interaction, client) {
  try {
    // インタラクションはすでに races.js 内で deferUpdate されているため、
    // ここでは即座に処理を行う
    
    // カスタムIDからレースIDと選択された馬券タイプを抽出
    const parts = interaction.customId.split('_');
    const raceId = parts[3];
    const betType = interaction.values[0];
    
    // レース情報を取得
    const { getRaceById } = await import('../services/database/raceService.js');
    const race = await getRaceById(raceId);
    
    if (!race) {
      return await interaction.editReply({
        content: `レースID ${raceId} の情報が見つかりませんでした。`,
        embeds: [],
        components: []
      });
    }
    
    // 馬券情報
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
    
    // 購入方法選択メニュー
    const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = await import('discord.js');
    
    const options = [];
    
    // 単勝・複勝は通常購入のみ
    if (betType === 'tansho' || betType === 'fukusho') {
      options.push({
        label: '通常',
        value: 'normal',
        description: `${betTypeNames[betType]}: 選択した馬を購入`,
        emoji: '🎫'
      });
    } else {
      // 他の馬券タイプは通常・ボックス・フォーメーション
      options.push({
        label: '通常',
        value: 'normal',
        description: `${betTypeNames[betType]}: 選択した馬(枠)を購入`,
        emoji: '🎫'
      });
      
      options.push({
        label: 'ボックス',
        value: 'box',
        description: `${betTypeNames[betType]}: 選択した馬(枠)の組み合わせを購入`,
        emoji: '📦'
      });
      
      options.push({
        label: 'フォーメーション',
        value: 'formation',
        description: `${betTypeNames[betType]}: 1着~3着を軸馬と相手馬で購入`,
        emoji: '📊'
      });
    }
    
    const methodRow = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`bet_select_method_${raceId}_${betType}`)
          .setPlaceholder('購入方法を選択してください')
          .addOptions(options)
      );
    
    // レースエンベッド
    const raceEmbed = new EmbedBuilder()
      .setTitle(`🏇 馬券購入 - ${race.venue} ${race.number}R ${race.name}`)
      .setDescription(`**${betTypeNames[betType]}**の購入方法を選択してください`)
      .setColor(race.type === 'jra' ? 0x00b0f4 : 0xf47200)
      .setTimestamp()
      .addFields(
        { name: '発走時刻', value: race.time },
        { name: 'レースID', value: race.id }
      );
      
    // 応答を更新
    await interaction.editReply({
      content: `${betTypeNames[betType]}の購入方法を選択してください。`,
      embeds: [raceEmbed],
      components: [methodRow]
    });
  } catch (error) {
    logger.error(`馬券タイプ選択インタラクション処理中にエラー: ${error}`);
    throw error; // 上位の例外ハンドラに処理を委譲
  }
}

/**
 * 馬券選択メニューのインタラクション処理
 * @param {StringSelectMenuInteraction} interaction - インタラクション
 * @param {Client} client - Discordクライアント
 */
async function handleBetSelectInteraction(interaction, client) {
  try {
    // カスタムIDを解析して種類を判定
    const customId = interaction.customId;
    
    // 購入方法選択の場合
    if (customId.startsWith('bet_select_method_')) {
      await handleMethodSelection(interaction, client);
      return;
    }
    
    // 馬番選択の場合
    await interaction.deferUpdate().catch(err => {
      logger.warn(`deferUpdate エラー (無視して続行): ${err}`);
    });
    
    // bet コマンドを取得
    const betCommand = client.commands.get('bet');
    
    if (betCommand && typeof betCommand.handleBetSelection === 'function') {
      // bet コマンドの専用ハンドラを呼び出し
      await betCommand.handleBetSelection(interaction);
    } else {
      // コマンドが見つからない場合
      logger.error('bet コマンドまたは handleBetSelection メソッドが見つかりません');
      await interaction.editReply({
        content: '馬券選択処理ができませんでした。システム管理者にお問い合わせください。',
        embeds: [],
        components: []
      });
    }
  } catch (error) {
    logger.error(`馬券選択インタラクション処理中にエラー: ${error}`);
    throw error; // 上位の例外ハンドラに処理を委譲
  }
}

/**
 * 購入方法選択のインタラクション処理
 * @param {StringSelectMenuInteraction} interaction - インタラクション
 * @param {Client} client - Discordクライアント
 */
async function handleMethodSelection(interaction, client) {
  try {
    await interaction.deferUpdate().catch(err => {
      logger.warn(`deferUpdate エラー (無視して続行): ${err}`);
    });
    
    // カスタムIDからパラメータを解析
    const parts = interaction.customId.split('_');
    // [0]=bet, [1]=select, [2]=method, [3]=raceId, [4]=betType
    const raceId = parts[3];
    const betType = parts[4];
    const method = interaction.values[0]; // 選択された購入方法
    
    // レース情報を取得
    const { getRaceById } = await import('../services/database/raceService.js');
    const race = await getRaceById(raceId);
    
    if (!race) {
      return await interaction.editReply({
        content: `レースID ${raceId} の情報が見つかりませんでした。`,
        embeds: [],
        components: []
      });
    }

    // 購入金額の初期値
    const amount = 100;
    
    // 以降の処理は選択した購入方法によって分岐
    
    // 馬券情報
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
    
    if (method === 'formation') {
      // フォーメーション購入はモーダルを表示
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');
      
      const modal = new ModalBuilder()
        .setCustomId(`bet_formation_${raceId}_${betType}_${amount}`)
        .setTitle(`馬券購入 - ${betTypeNames[betType]}（フォーメーション）`);
      
      // 馬券タイプに応じた入力フィールドを追加
      if (betType === 'umatan') {
        // 馬単用フィールド
        const firstHorseInput = new TextInputBuilder()
          .setCustomId('first_horse')
          .setLabel('1着の馬番（複数指定はカンマ区切り）')
          .setPlaceholder('例: 1,2,3')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        
        const secondHorseInput = new TextInputBuilder()
          .setCustomId('second_horse')
          .setLabel('2着の馬番（複数指定はカンマ区切り）')
          .setPlaceholder('例: 4,5,6')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        
        const firstRow = new ActionRowBuilder().addComponents(firstHorseInput);
        const secondRow = new ActionRowBuilder().addComponents(secondHorseInput);
        
        modal.addComponents(firstRow, secondRow);
      } else if (betType === 'sanrentan') {
        // 三連単用フィールド
        const firstHorseInput = new TextInputBuilder()
          .setCustomId('first_horse')
          .setLabel('1着の馬番（複数指定はカンマ区切り）')
          .setPlaceholder('例: 1,2')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        
        const secondHorseInput = new TextInputBuilder()
          .setCustomId('second_horse')
          .setLabel('2着の馬番（複数指定はカンマ区切り）')
          .setPlaceholder('例: 3,4')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        
        const thirdHorseInput = new TextInputBuilder()
          .setCustomId('third_horse')
          .setLabel('3着の馬番（複数指定はカンマ区切り）')
          .setPlaceholder('例: 5,6')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        
        const firstRow = new ActionRowBuilder().addComponents(firstHorseInput);
        const secondRow = new ActionRowBuilder().addComponents(secondHorseInput);
        const thirdRow = new ActionRowBuilder().addComponents(thirdHorseInput);
        
        modal.addComponents(firstRow, secondRow, thirdRow);
      } else {
        // 順序なし馬券（馬連・ワイド・三連複・枠連）
        const horsesInput = new TextInputBuilder()
          .setCustomId('horses')
          .setLabel('馬番を指定（カンマ区切り）')
          .setPlaceholder('例: 1,2,3,4')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        
        const row = new ActionRowBuilder().addComponents(horsesInput);
        modal.addComponents(row);
      }
      
      await interaction.showModal(modal);
      return;
    } else {
      // 通常またはボックス購入
      
      const betCommand = client.commands.get('bet');
      
      if (!betCommand) {
        return await interaction.editReply({
          content: '馬券購入コマンドが見つかりません。',
          embeds: [],
          components: []
        });
      }
      
      // ユーザー情報を取得
      const { getUser } = await import('../services/database/userService.js');
      const user = await getUser(interaction.user.id);
      
      if (!user) {
        return await interaction.editReply({
          content: 'ユーザー情報の取得に失敗しました。',
          embeds: [],
          components: []
        });
      }
      
      // 馬番選択メニューを表示
      const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = await import('discord.js');
      
      // 馬券タイプと購入方法に応じた最大選択数を取得
      const maxSelections = getMaxSelectionsForBet(betType, method);
      
      // 出走馬オプションの作成
      const horseOptions = createHorseOptions(race.horses || []);
      
      const selectRow = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`bet_select_${raceId}_${betType}_${method}_${amount}`)
            .setPlaceholder('馬番を選択してください')
            .setMinValues(1)
            .setMaxValues(maxSelections)
            .addOptions(horseOptions)
        );
      
      const embed = new EmbedBuilder()
        .setTitle(`🏇 馬券購入 - ${race.venue} ${race.number}R ${race.name}`)
        .setDescription(`**${betTypeNames[betType]}**（${methodNames[method]}）購入画面\n\n購入金額: **${amount}pt**\n\n下のメニューから馬番を選択してください。`)
        .setColor(0x00b0f4)
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [embed],
        components: [selectRow]
      });
    }
  } catch (error) {
    logger.error(`購入方法選択処理中にエラー: ${error}`);
    throw error;
  }
}

/**
 * 馬券タイプと購入方法に応じた最大選択数を取得
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 * @returns {number} 最大選択数
 */
function getMaxSelectionsForBet(betType, method) {
  if (method === 'normal') {
    // 通常購入の場合は馬券タイプごとの選択数
    const normalSelections = {
      tansho: 1,
      fukusho: 1,
      wakuren: 2,
      umaren: 2,
      wide: 2,
      umatan: 2,
      sanrenpuku: 3,
      sanrentan: 3
    };
    return normalSelections[betType] || 1;
  } else if (method === 'box') {
    // ボックス購入の場合
    if (betType === 'tansho' || betType === 'fukusho') {
      return 1; // ボックス購入できないが、エラー回避のため
    } else if (betType === 'wakuren' || betType === 'umaren' || betType === 'wide' || betType === 'umatan') {
      return 8; // 二連系は最大8頭まで
    } else {
      return 7; // 三連系は最大7頭まで
    }
  }
  
  return 1;
}

/**
 * 馬リストから選択肢を作成
 * @param {Array} horses - 馬情報の配列
 * @returns {Array} セレクトメニューのオプション配列
 */
function createHorseOptions(horses) {
  // options配列を初期化
  const options = [];
  
  if (!horses || horses.length === 0) {
    // 馬情報がない場合はダミーデータ
    for (let i = 1; i <= 16; i++) {
      options.push({
        label: `${i}番`,
        description: `${i}番の馬`,
        value: `${i}`
      });
    }
    return options;
  }
  
  // 馬番順にソート
  const sortedHorses = [...horses].sort((a, b) => a.horseNumber - b.horseNumber);
  
  // 馬情報に基づいてオプションを作成
  sortedHorses.forEach(horse => {
    if (!horse.isCanceled) {
      options.push({
        label: `${horse.frameNumber || '?'}枠${horse.horseNumber}番: ${horse.horseName}`,
        description: `騎手: ${horse.jockey || '情報なし'}${horse.odds ? ' オッズ: ' + horse.odds : ''}`,
        value: `${horse.horseNumber}`
      });
    } else {
      // 取消馬も表示するが選択不可にする
      options.push({
        label: `${horse.frameNumber || '?'}枠${horse.horseNumber}番: ${horse.horseName} 【取消】`,
        description: `騎手: ${horse.jockey || '情報なし'} - 出走取消`,
        value: `${horse.horseNumber}`,
        disabled: true
      });
    }
  });
  
  return options;
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