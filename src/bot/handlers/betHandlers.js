// src/bot/handlers/betHandlers.js
const { EmbedBuilder } = require('discord.js');
const messageUtils = require('../utils/messageUtils');

// 馬券タイプ選択の処理
async function handleBetTypeSelection(interaction, args) {
  const [raceId, raceType] = args;
  const betType = interaction.values[0];
  
  await messageUtils.showBetMethodOptions(interaction, raceId, betType, raceType);
}

// 購入方法選択の処理
async function handleBetMethodSelection(interaction, args) {
  const [raceId, betType, raceType] = args;
  const method = interaction.values[0];
  
  await messageUtils.showHorseSelectionMenu(interaction, raceId, betType, method, raceType);
}

// 馬番選択の処理
async function handleHorseSelection(interaction, args) {
  let selectionType, raceId, betType, step, raceType;
  
  if (args.length === 3) {
    // 通常/ボックス形式: [selectionType, raceId, betType]
    [selectionType, raceId, betType] = args;
    raceType = 'jra'; // デフォルトはJRA
  } else if (args.length === 4 && ['normal', 'box'].includes(args[0])) {
    // 通常/ボックス形式: [selectionType, raceId, betType, raceType]
    [selectionType, raceId, betType, raceType] = args;
  } else if (args.length === 4 && args[0] === 'formation') {
    // フォーメーション形式: [selectionType, raceId, betType, step]
    [selectionType, raceId, betType, step] = args;
    raceType = 'jra'; // デフォルトはJRA
  } else if (args.length === 5) {
    // フォーメーション形式: [selectionType, raceId, betType, step, raceType]
    [selectionType, raceId, betType, step, raceType] = args;
  } else {
    return interaction.update({
      content: 'エラーが発生しました。最初からやり直してください。',
      components: []
    });
  }
  
  const selectedValues = interaction.values;
  
  if (selectionType === 'normal' || selectionType === 'box') {
    // 通常またはボックスの場合は金額入力へ
    await messageUtils.showAmountInput(
      interaction, 
      raceId, 
      betType, 
      selectionType, 
      selectedValues.join(','),
      raceType
    );
  } else if (selectionType === 'formation') {
    // フォーメーションの場合は段階ごとに処理
    const userId = interaction.user.id;
    const formationState = interaction.client.formationState || {};
    
    if (!formationState[userId]) {
      return interaction.update({
        content: 'エラーが発生しました。最初からやり直してください。',
        components: []
      });
    }
    
    // 現在のステップの選択を保存
    formationState[userId].selections[step] = selectedValues;
    
    // 次のステップへ進む
    if (step === 'first') {
      formationState[userId].step = 'second';
      await messageUtils.showHorseSelectionMenu(
        interaction, 
        raceId, 
        betType, 
        'formation',
        raceType
      );
    } else if (step === 'second') {
      if (['sanrenpuku', 'sanrentan'].includes(betType)) {
        formationState[userId].step = 'third';
        await messageUtils.showHorseSelectionMenu(
          interaction, 
          raceId, 
          betType, 
          'formation',
          raceType
        );
      } else {
        // 2着までの選択で完了する場合
        const selectionsStr = JSON.stringify(formationState[userId].selections);
        await messageUtils.showAmountInput(
          interaction, 
          raceId, 
          betType, 
          'formation', 
          selectionsStr,
          raceType
        );
      }
    } else if (step === 'third') {
      // 3着までの選択で完了
      const selectionsStr = JSON.stringify(formationState[userId].selections);
      await messageUtils.showAmountInput(
        interaction, 
        raceId, 
        betType, 
        'formation', 
        selectionsStr,
        raceType
      );
    }
    
    // 状態を保存
    interaction.client.formationState = formationState;
  }
}

// 金額入力の処理
async function handleBetAmountSubmit(interaction, args) {
  // [raceId, betType, method, selectionsStr, raceType]
  const raceId = args[0];
  const betType = args[1];
  const method = args[2];
  const selectionsStr = args[3];
  const raceType = args.length > 4 ? args[4] : 'jra'; // デフォルトはJRA
  
  const amount = interaction.fields.getTextInputValue('amount');
  
  // 金額のバリデーション
  const amountValue = parseInt(amount);
  
  if (isNaN(amountValue) || amountValue < 100 || amountValue % 100 !== 0) {
    return interaction.reply({
      content: '金額は100ポイント以上、100ポイント単位で入力してください。',
      ephemeral: true
    });
  }
  
  // 購入確認
  await messageUtils.confirmBet(
    interaction, 
    `${raceId}_${betType}_${method}_${selectionsStr}_${amountValue}_${raceType}`,
    interaction.client.bot
  );
}

module.exports = {
  handleBetTypeSelection,
  handleBetMethodSelection,
  handleHorseSelection,
  handleBetAmountSubmit
};