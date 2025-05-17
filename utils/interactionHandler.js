import { getRaceById } from '../services/database/raceService.js';
import { placeBet } from '../services/database/betService.js';
import { getUser } from '../services/database/userService.js';
import { EmbedBuilder } from 'discord.js';
import logger from '../utils/logger.js';

/**
 * 全インタラクションを処理する関数
 * @param {Interaction} interaction - Discord インタラクション
 */
export async function handleInteraction(interaction) {
  try {
    // セレクトメニューの処理
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('bet_select_')) {
        await handleBetSelection(interaction);
      }
    }
    
    // ボタンの処理
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('bet_confirm_')) {
        await handleBetConfirmation(interaction);
      }
    }
    
    // モーダルの処理
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('bet_formation_')) {
        await handleFormationBet(interaction);
      }
    }
  } catch (error) {
    logger.error(`インタラクション処理中にエラーが発生しました: ${error}`);
    
    // エラーメッセージの送信
    try {
      const errorMessage = { 
        content: 'エラーが発生しました。しばらく経ってからもう一度お試しください。', 
        ephemeral: true 
      };
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    } catch (followupError) {
      logger.error(`エラー応答中にさらにエラーが発生しました: ${followupError}`);
    }
  }
}

/**
 * 馬券選択の処理
 * @param {StringSelectMenuInteraction} interaction - セレクトメニューインタラクション
 */
async function handleBetSelection(interaction) {
  await interaction.deferUpdate();
  
  // customId から情報を抽出
  const [_, __, raceId, betType, method, amount] = interaction.customId.split('_');
  
  // 選択された馬番
  const selectedHorses = interaction.values.map(value => parseInt(value, 10));
  
  // ユーザー情報を取得
  const user = await getUser(interaction.user.id);
  
  if (!user) {
    return await interaction.followUp({
      content: 'ユーザー情報の取得に失敗しました。',
      ephemeral: true
    });
  }
  
  // レース情報を取得
  const race = await getRaceById(raceId);
  
  if (!race) {
    return await interaction.followUp({
      content: `レースID ${raceId} の情報が見つかりませんでした。`,
      ephemeral: true
    });
  }
  
  // レースのステータスチェック
  if (race.status === 'completed') {
    return await interaction.followUp({
      content: 'このレースは既に終了しています。',
      ephemeral: true
    });
  }
  
  // レース発走時間の2分前かどうかをチェック
  const now = new Date();
  const raceTime = new Date(
    race.date.slice(0, 4), 
    parseInt(race.date.slice(4, 6)) - 1, 
    race.date.slice(6, 8), 
    race.time.split(':')[0], 
    race.time.split(':')[1]
  );
  
  const twoMinutesBefore = new Date(raceTime.getTime() - 2 * 60 * 1000);
  
  if (now > twoMinutesBefore) {
    return await interaction.followUp({
      content: 'このレースは発走2分前を過ぎているため、馬券を購入できません。',
      ephemeral: true
    });
  }
  
  // 馬券情報の表示用データ
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
  
  // 選択した馬の情報を表示
  const horseInfos = selectedHorses.map(horseNumber => {
    const horse = race.horses?.find(h => h.horseNumber === horseNumber);
    return horse ? 
      `${horseNumber}番: ${horse.horseName} (騎手: ${horse.jockey})` : 
      `${horseNumber}番`;
  });
  
  // 確認エンベッド
  const confirmEmbed = new EmbedBuilder()
    .setTitle(`🏇 馬券購入確認 - ${race.venue} ${race.number}R ${race.name}`)
    .setDescription(`**${betTypeNames[betType]}**（${methodNames[method]}）の購入を確定しますか？`)
    .setColor(0x00b0f4)
    .setTimestamp()
    .addFields(
      { name: '選択した馬番', value: horseInfos.join('\n') },
      { name: '購入金額', value: `${amount}pt` },
      { name: '残りポイント', value: `${user.points}pt → ${user.points - parseInt(amount)}pt` }
    );
  
  // 確認ボタン
  const confirmRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`bet_confirm_${raceId}_${betType}_${method}_${amount}_${selectedHorses.join(',')}`)
        .setLabel('馬券を購入する')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`bet_cancel`)
        .setLabel('キャンセル')
        .setStyle(ButtonStyle.Secondary)
    );
  
  await interaction.editReply({
    embeds: [confirmEmbed],
    components: [confirmRow]
  });
}

/**
 * 馬券購入確認の処理
 * @param {ButtonInteraction} interaction - ボタンインタラクション
 */
async function handleBetConfirmation(interaction) {
  // キャンセルボタンの場合
  if (interaction.customId === 'bet_cancel') {
    return await interaction.update({
      content: '馬券購入をキャンセルしました。',
      embeds: [],
      components: []
    });
  }
  
  await interaction.deferUpdate();
  
  // customId から情報を抽出
  const [_, __, raceId, betType, method, amount, horsesString] = interaction.customId.split('_');
  const selectedHorses = horsesString.split(',').map(num => parseInt(num, 10));
  
  try {
    // 通常購入の場合
    let selections = selectedHorses;
    
    // 馬単・三連単の場合は2次元配列に変換（順序あり馬券）
    if (method === 'normal' && (betType === 'umatan' || betType === 'sanrentan')) {
      if (betType === 'umatan') {
        selections = [
          [selectedHorses[0]],
          [selectedHorses[1]]
        ];
      } else if (betType === 'sanrentan') {
        selections = [
          [selectedHorses[0]],
          [selectedHorses[1]],
          [selectedHorses[2]]
        ];
      }
    }
    
    // 馬券購入処理
    const bet = await placeBet(
      interaction.user.id,
      raceId,
      betType,
      selections,
      method,
      parseInt(amount, 10)
    );
    
    // 馬券情報の表示用データ
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
    
    // 馬券購入結果のエンベッド
    const resultEmbed = new EmbedBuilder()
      .setTitle(`🎫 馬券購入完了`)
      .setDescription(`${betTypeNames[betType]}（${methodNames[method]}）の馬券を購入しました！`)
      .setColor(0x00b0f4)
      .setTimestamp()
      .addFields(
        { name: 'レース', value: `${bet.raceId} - ${race.venue} ${race.number}R ${race.name}` },
        { name: '購入金額', value: `${bet.amount}pt` },
        { name: '選択馬番', value: Array.isArray(selectedHorses[0]) ? 
                                 selectedHorses.map(arr => arr.join('-')).join('→') : 
                                 selectedHorses.join('-') }
      );
    
    await interaction.editReply({
      content: '馬券の購入が完了しました！',
      embeds: [resultEmbed],
      components: []
    });
    
  } catch (error) {
    logger.error(`馬券購入確認中にエラーが発生しました: ${error}`);
    
    await interaction.editReply({
      content: `馬券購入中にエラーが発生しました: ${error.message}`,
      embeds: [],
      components: []
    });
  }
}

/**
 * フォーメーション馬券の処理
 * @param {ModalSubmitInteraction} interaction - モーダル送信インタラクション
 */
async function handleFormationBet(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  // customId から情報を抽出
  const [_, __, raceId, betType, amount] = interaction.customId.split('_');
  
  try {
    // レース情報を取得
    const race = await getRaceById(raceId);
    
    if (!race) {
      return await interaction.editReply(`レースID ${raceId} の情報が見つかりませんでした。`);
    }
    
    // フォーメーション情報の解析
    let selections = [];
    
    if (betType === 'umatan') {
      // 馬単フォーメーション
      const firstHorses = interaction.fields.getTextInputValue('first_horse')
        .split(',')
        .map(num => parseInt(num.trim(), 10))
        .filter(num => !isNaN(num));
        
      const secondHorses = interaction.fields.getTextInputValue('second_horse')
        .split(',')
        .map(num => parseInt(num.trim(), 10))
        .filter(num => !isNaN(num));
      
      selections = [firstHorses, secondHorses];
    } else if (betType === 'sanrentan') {
      // 三連単フォーメーション
      const firstHorses = interaction.fields.getTextInputValue('first_horse')
        .split(',')
        .map(num => parseInt(num.trim(), 10))
        .filter(num => !isNaN(num));
        
      const secondHorses = interaction.fields.getTextInputValue('second_horse')
        .split(',')
        .map(num => parseInt(num.trim(), 10))
        .filter(num => !isNaN(num));
        
      const thirdHorses = interaction.fields.getTextInputValue('third_horse')
        .split(',')
        .map(num => parseInt(num.trim(), 10))
        .filter(num => !isNaN(num));
      
      selections = [firstHorses, secondHorses, thirdHorses];
    } else {
      // 順序なし馬券（馬連・ワイド・三連複・枠連）
      const horses = interaction.fields.getTextInputValue('horses')
        .split(',')
        .map(num => parseInt(num.trim(), 10))
        .filter(num => !isNaN(num));
      
      selections = horses;
    }
    
    // 馬券購入処理
    const bet = await placeBet(
      interaction.user.id,
      raceId,
      betType,
      selections,
      'formation',
      parseInt(amount, 10)
    );
    
    // 馬券情報の表示用データ
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
    
    // フォーメーション選択の表示
    let selectionsDisplay = '';
    
    if (Array.isArray(selections[0])) {
      // 馬単・三連単フォーメーション
      selectionsDisplay = selections.map(group => `[${group.join(',')}]`).join(' → ');
    } else {
      // その他のフォーメーション
      selectionsDisplay = selections.join(',');
    }
    
    // 馬券購入結果のエンベッド
    const resultEmbed = new EmbedBuilder()
      .setTitle(`🎫 馬券購入完了`)
      .setDescription(`${betTypeNames[betType]}（フォーメーション）の馬券を購入しました！`)
      .setColor(0x00b0f4)
      .setTimestamp()
      .addFields(
        { name: 'レース', value: `${bet.raceId} - ${race.venue} ${race.number}R ${race.name}` },
        { name: '購入金額', value: `${bet.amount}pt` },
        { name: '選択馬番', value: selectionsDisplay }
      );
    
    await interaction.editReply({
      content: '馬券の購入が完了しました！',
      embeds: [resultEmbed]
    });
    
  } catch (error) {
    logger.error(`フォーメーション馬券処理中にエラーが発生しました: ${error}`);
    
    await interaction.editReply({
      content: `馬券購入中にエラーが発生しました: ${error.message}`
    });
  }
}