// src/bot/utils/messageUtils.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

// レース詳細表示
async function showRaceDetail(interaction, raceDetail) {
  const embed = new EmbedBuilder()
    .setTitle(raceDetail.title)
    .setDescription(`${raceDetail.courseInfo}\n${raceDetail.raceData}`)
    .setColor('#0099FF')
    .setTimestamp();
  
  // 出走馬情報を追加
  let horseFields = [];
  
  for (let i = 0; i < raceDetail.horses.length; i += 5) {
    const fieldHorses = raceDetail.horses.slice(i, i + 5);
    const fieldText = fieldHorses
      .map(horse => `${horse.waku}枠${horse.umaban}番 **${horse.name}** (${horse.jockey}) - ${horse.odds}倍`)
      .join('\n');
    
    horseFields.push(fieldText);
  }
  
  // フィールドの最大数は25個までなので、必要に応じて調整
  for (let i = 0; i < Math.min(horseFields.length, 5); i++) {
    embed.addFields({
      name: `出走馬 (${i * 5 + 1}-${Math.min((i + 1) * 5, raceDetail.horses.length)})`,
      value: horseFields[i],
      inline: false
    });
  }
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`race_bet_${raceDetail.id}`)
        .setLabel('馬券購入')
        .setStyle(ButtonStyle.Success)
    );
  
  await interaction.reply({
    embeds: [embed],
    components: [row]
  });
}

// 馬券タイプ選択メニューの表示
async function showBetTypeOptions(interaction, raceId) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`bettype_${raceId}`)
    .setPlaceholder('馬券の種類を選択してください')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('単勝')
        .setDescription('1着の馬を当てる')
        .setValue('tansho'),
      new StringSelectMenuOptionBuilder()
        .setLabel('複勝')
        .setDescription('3着以内に入る馬を当てる')
        .setValue('fukusho'),
      new StringSelectMenuOptionBuilder()
        .setLabel('枠連')
        .setDescription('1着と2着の枠番を当てる（順不同）')
        .setValue('wakuren'),
      new StringSelectMenuOptionBuilder()
        .setLabel('馬連')
        .setDescription('1着と2着の馬番を当てる（順不同）')
        .setValue('umaren'),
      new StringSelectMenuOptionBuilder()
        .setLabel('馬単')
        .setDescription('1着と2着の馬番を順番通りに当てる')
        .setValue('umatan'),
      new StringSelectMenuOptionBuilder()
        .setLabel('ワイド')
        .setDescription('3着以内に入る2頭の馬番を当てる（順不同）')
        .setValue('wide'),
      new StringSelectMenuOptionBuilder()
        .setLabel('三連複')
        .setDescription('1着、2着、3着の馬番を当てる（順不同）')
        .setValue('sanrenpuku'),
      new StringSelectMenuOptionBuilder()
        .setLabel('三連単')
        .setDescription('1着、2着、3着の馬番を順番通りに当てる')
        .setValue('sanrentan')
    );
  
  const row = new ActionRowBuilder().addComponents(select);
  
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({
      content: '購入する馬券の種類を選択してください：',
      components: [row],
      ephemeral: true
    });
  } else {
    await interaction.reply({
      content: '購入する馬券の種類を選択してください：',
      components: [row],
      ephemeral: true
    });
  }
}

// 馬券の購入方法選択メニューの表示
async function showBetMethodOptions(interaction, raceId, betType) {
  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel('通常')
      .setDescription('通常の馬券購入方法')
      .setValue('normal')
  ];
  
  // ボックスとフォーメーションは特定の馬券タイプのみで利用可能
  if (['umaren', 'umatan', 'sanrenpuku', 'sanrentan'].includes(betType)) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel('ボックス')
        .setDescription('選択した馬の全ての組み合わせで馬券を購入')
        .setValue('box')
    );
    
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel('フォーメーション')
        .setDescription('軸馬と相手馬を指定して馬券を購入')
        .setValue('formation')
    );
  }
  
  const select = new StringSelectMenuBuilder()
    .setCustomId(`betmethod_${raceId}_${betType}`)
    .setPlaceholder('購入方法を選択してください')
    .addOptions(options);
  
  const row = new ActionRowBuilder().addComponents(select);
  
  await interaction.update({
    content: '馬券の購入方法を選択してください：',
    components: [row]
  });
}

// 馬番選択メニューの表示
async function showHorseSelectionMenu(interaction, raceId, betType, method) {
  const bot = interaction.client.bot;
  
  // レース詳細を取得
  if (!bot.raceDetails.has(raceId)) {
    const details = await bot.netkeibaClient.getRaceDetails(raceId);
    if (details) {
      bot.raceDetails.set(raceId, details);
    }
  }
  
  const raceDetail = bot.raceDetails.get(raceId);
  if (!raceDetail) {
    return interaction.update({
      content: 'レース情報を取得できませんでした。',
      components: []
    });
  }
  
  // 馬番選択の処理（馬券タイプと購入方法に応じて変更）
  if (method === 'normal') {
    await showNormalHorseSelection(interaction, raceId, betType, raceDetail);
  } else if (method === 'box') {
    await showBoxHorseSelection(interaction, raceId, betType, raceDetail);
  } else if (method === 'formation') {
    await showFormationHorseSelection(interaction, raceId, betType, raceDetail);
  }
}

// 通常購入時の馬番選択
async function showNormalHorseSelection(interaction, raceId, betType, raceDetail) {
  // 馬券タイプに応じた選択数
  let selectionCount = 1;
  let title = '馬番を選択してください';
  
  if (['wakuren', 'umaren', 'umatan', 'wide'].includes(betType)) {
    selectionCount = 2;
    title = '2頭の馬番を選択してください';
  } else if (['sanrenpuku', 'sanrentan'].includes(betType)) {
    selectionCount = 3;
    title = '3頭の馬番を選択してください';
  }
  
  // 馬番選択メニューの作成
  const options = raceDetail.horses.map(horse => 
    new StringSelectMenuOptionBuilder()
      .setLabel(`${horse.umaban}番 ${horse.name}`)
      .setDescription(`${horse.jockey} - オッズ: ${horse.odds}倍`)
      .setValue(horse.umaban)
  );
  
  const select = new StringSelectMenuBuilder()
    .setCustomId(`horse_normal_${raceId}_${betType}`)
    .setPlaceholder('馬番を選択')
    .setMinValues(selectionCount)
    .setMaxValues(selectionCount)
    .addOptions(options);
  
  const row = new ActionRowBuilder().addComponents(select);
  
  await interaction.update({
    content: title,
    components: [row]
  });
}

// ボックス購入時の馬番選択
async function showBoxHorseSelection(interaction, raceId, betType, raceDetail) {
  // 馬券タイプに応じた選択数
  let minSelections = 2;
  let maxSelections = raceDetail.horses.length;
  let title = '馬番を選択してください（ボックス）';
  
  if (['umaren', 'umatan', 'wide'].includes(betType)) {
    minSelections = 2;
    title = '2頭以上の馬番を選択してください（ボックス）';
  } else if (['sanrenpuku', 'sanrentan'].includes(betType)) {
    minSelections = 3;
    title = '3頭以上の馬番を選択してください（ボックス）';
  }
  
  // 馬番選択メニューの作成
  const options = raceDetail.horses.map(horse => 
    new StringSelectMenuOptionBuilder()
      .setLabel(`${horse.umaban}番 ${horse.name}`)
      .setDescription(`${horse.jockey} - オッズ: ${horse.odds}倍`)
      .setValue(horse.umaban)
  );
  
  const select = new StringSelectMenuBuilder()
    .setCustomId(`horse_box_${raceId}_${betType}`)
    .setPlaceholder('馬番を選択')
    .setMinValues(minSelections)
    .setMaxValues(maxSelections > 25 ? 25 : maxSelections) // Discordの制限
    .addOptions(options);
  
  const row = new ActionRowBuilder().addComponents(select);
  
  await interaction.update({
    content: title,
    components: [row]
  });
}

// フォーメーション購入時の馬番選択
async function showFormationHorseSelection(interaction, raceId, betType, raceDetail) {
  // フォーメーションの段階（1着、2着、3着）を管理
  const formationSteps = {
    first: {
      title: '1着にくる馬を選択してください（フォーメーション）',
      nextStep: 'second'
    },
    second: {
      title: '2着にくる馬を選択してください（フォーメーション）',
      nextStep: ['sanrenpuku', 'sanrentan'].includes(betType) ? 'third' : 'amount'
    },
    third: {
      title: '3着にくる馬を選択してください（フォーメーション）',
      nextStep: 'amount'
    }
  };
  
  // フォーメーションの進行状態を取得
  const formationState = interaction.client.formationState || {};
  const userId = interaction.user.id;
  
  if (!formationState[userId]) {
    formationState[userId] = {
      step: 'first',
      raceId,
      betType,
      selections: {
        first: [],
        second: [],
        third: []
      }
    };
  }
  
  const currentState = formationState[userId];
  const currentStep = currentState.step;
  
  // 馬番選択メニューの作成
  const options = raceDetail.horses.map(horse => 
    new StringSelectMenuOptionBuilder()
      .setLabel(`${horse.umaban}番 ${horse.name}`)
      .setDescription(`${horse.jockey} - オッズ: ${horse.odds}倍`)
      .setValue(horse.umaban)
  );
  
  const select = new StringSelectMenuBuilder()
    .setCustomId(`horse_formation_${raceId}_${betType}_${currentStep}`)
    .setPlaceholder('馬番を選択')
    .setMinValues(1)
    .setMaxValues(options.length > 25 ? 25 : options.length) // Discordの制限
    .addOptions(options);
  
  const row = new ActionRowBuilder().addComponents(select);
  
  await interaction.update({
    content: formationSteps[currentStep].title,
    components: [row]
  });
  
  // 状態を保存
  interaction.client.formationState = formationState;
}

// 金額入力フォームの表示
async function showAmountInput(interaction, raceId, betType, method, selections) {
  const modal = new ModalBuilder()
    .setCustomId(`betamount_${raceId}_${betType}_${method}_${selections}`)
    .setTitle('馬券購入金額');
  
  const amountInput = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel('購入金額（ポイント）')
    .setPlaceholder('100pt単位で入力してください')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(10)
    .setRequired(true);
  
  const row = new ActionRowBuilder().addComponents(amountInput);
  modal.addComponents(row);
  
  await interaction.showModal(modal);
}

// 馬券購入の確認
async function confirmBet(interaction, betDetails) {
  const [raceId, betType, method, selectionsStr, amount] = betDetails.split('_');
  
  const bot = interaction.client.bot;
  const userId = interaction.user.id;
  
  // ユーザー情報の確認
  const user = bot.userManager.getUser(userId);
  if (!user) {
    return interaction.reply({
      content: 'あなたはまだ登録されていません。`/register`コマンドで登録してください。',
      ephemeral: true
    });
  }
  
  // ポイント残高の確認
  const amountValue = parseInt(amount);
  if (user.points < amountValue) {
    return interaction.reply({
      content: `ポイントが不足しています。現在の残高: ${user.points}pt`,
      ephemeral: true
    });
  }
  
  // 選択馬の解析
  let selections;
  
  if (method === 'formation') {
    // フォーメーションの場合
    const formationState = interaction.client.formationState[userId];
    if (!formationState) {
      return interaction.reply({
        content: 'フォーメーションの選択情報が見つかりません。',
        ephemeral: true
      });
    }
    
    selections = formationState.selections;
  } else {
    // 通常・ボックスの場合
    selections = selectionsStr.split(',');
  }
  
  // 馬券の購入
  const result = bot.betManager.placeBet(
    userId,
    raceId,
    betType,
    method,
    selections,
    amountValue
  );
  
  if (result.success) {
    // ポイントを減算
    bot.userManager.updatePoints(userId, -amountValue);
    
    // 馬券履歴に追加
    bot.userManager.addBetHistory(userId, result.bet);
    
    // レース情報
    const race = bot.todayRaces.find(r => r.id === raceId);
    const raceInfo = race 
      ? `${race.track} ${race.number}R ${race.name}` 
      : 'レース不明';
    
    const embed = new EmbedBuilder()
      .setTitle('馬券購入完了')
      .setDescription(`${raceInfo}`)
      .addFields(
        { name: '馬券タイプ', value: getBetTypeDisplay(betType) },
        { name: '購入方法', value: getBetMethodDisplay(method) },
        { name: '選択馬', value: formatSelections(selections) },
        { name: '購入金額', value: `${amountValue}pt` },
        { name: '残りポイント', value: `${user.points}pt` }
      )
      .setColor('#00FF00')
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  } else {
    await interaction.reply({
      content: result.message,
      ephemeral: true
    });
  }
}

// 馬券タイプの表示名を取得
function getBetTypeDisplay(betType) {
  const types = {
    tansho: '単勝',
    fukusho: '複勝',
    wakuren: '枠連',
    umaren: '馬連',
    umatan: '馬単',
    wide: 'ワイド',
    sanrenpuku: '三連複',
    sanrentan: '三連単'
  };
  
  return types[betType] || betType;
}

// 購入方法の表示名を取得
function getBetMethodDisplay(method) {
  const methods = {
    normal: '通常',
    box: 'ボックス',
    formation: 'フォーメーション'
  };
  
  return methods[method] || method;
}

// 選択馬の表示用フォーマット
function formatSelections(selections) {
  if (typeof selections === 'object' && !Array.isArray(selections)) {
    // フォーメーション
    const { first, second, third } = selections;
    let text = `1着: ${first.join(',')} - 2着: ${second.join(',')}`;
    
    if (third && third.length > 0) {
      text += ` - 3着: ${third.join(',')}`;
    }
    
    return text;
  } else {
    // 通常・ボックス
    return Array.isArray(selections) 
      ? selections.join(',') 
      : selections;
  }
}

module.exports = {
  showRaceDetail,
  showBetTypeOptions,
  showBetMethodOptions,
  showHorseSelectionMenu,
  showAmountInput,
  confirmBet,
  getBetTypeDisplay,
  getBetMethodDisplay,
  formatSelections
};