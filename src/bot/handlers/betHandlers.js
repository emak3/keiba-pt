// src/bot/handlers/betHandlers.js
const { EmbedBuilder } = require('discord.js');
const messageUtils = require('../utils/messageUtils');

// 馬券タイプ選択の処理
async function handleBetTypeSelection(interaction, args) {
  const [raceId] = args;
  const betType = interaction.values[0];
  
  await messageUtils.showBetMethodOptions(interaction, raceId, betType);
}

// 購入方法選択の処理
async function handleBetMethodSelection(interaction, args) {
  const [raceId, betType] = args;
  const method = interaction.values[0];
  
  await messageUtils.showHorseSelectionMenu(interaction, raceId, betType, method);
}

// 馬番選択の処理
async function handleHorseSelection(interaction, args) {
  const [selectionType, raceId, betType, step] = args;
  const selectedValues = interaction.values;
  
  if (selectionType === 'normal' || selectionType === 'box') {
    // 通常またはボックスの場合は金額入力へ
    await messageUtils.showAmountInput(
      interaction, 
      raceId, 
      betType, 
      selectionType, 
      selectedValues.join(',')
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
        'formation'
      );
    } else if (step === 'second') {
      if (['sanrenpuku', 'sanrentan'].includes(betType)) {
        formationState[userId].step = 'third';
        await messageUtils.showHorseSelectionMenu(
          interaction, 
          raceId, 
          betType, 
          'formation'
        );
      } else {
        // 2着までの選択で完了する場合
        const selectionsStr = JSON.stringify(formationState[userId].selections);
        await messageUtils.showAmountInput(
          interaction, 
          raceId, 
          betType, 
          'formation', 
          selectionsStr
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
        selectionsStr
      );
    }
    
    // 状態を保存
    interaction.client.formationState = formationState;
  }
}

// 金額入力の処理
async function handleBetAmountSubmit(interaction, args) {
  const [raceId, betType, method, selectionsStr] = args;
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
    `${raceId}_${betType}_${method}_${selectionsStr}_${amountValue}`
  );
}

module.exports = {
  handleBetTypeSelection,
  handleBetMethodSelection,
  handleHorseSelection,
  handleBetAmountSubmit
};