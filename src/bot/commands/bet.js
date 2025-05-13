// src/bot/commands/bet.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const raceService = require('../../services/raceService');
const betService = require('../../services/betService');
const userService = require('../../services/userService');
const logger = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bet')
    .setDescription('馬券を購入します')
    .addStringOption(option =>
      option.setName('race')
        .setDescription('レースID')
        .setRequired(true)
    ),

  async execute(interaction) {
    // 処理中の通知
    await interaction.deferReply({ ephemeral: true });
    
    try {
      // レースIDを取得
      const raceId = interaction.options.getString('race');
      
      // レース情報を取得
      const race = await raceService.getRaceById(raceId);
      
      if (!race) {
        await interaction.editReply(`レースが見つかりません: ${raceId}`);
        return;
      }
      
      // レースが受付中かチェック
      if (race.status !== 'upcoming') {
        await interaction.editReply(`このレースは既に締め切られています: ${race.name}`);
        return;
      }
      
      // ユーザー情報を取得
      const user = await userService.getUserById(interaction.user.id);
      
      if (!user) {
        // ユーザーが存在しない場合は登録
        await userService.registerUser(interaction.user.id, interaction.user.username);
      }
      
      // 馬券購入UIを表示
      await displayBetUI(interaction, race);
    } catch (error) {
      logger.error(`馬券購入コマンド実行中にエラーが発生しました: ${error.message}`, error);
      await interaction.editReply(`エラーが発生しました: ${error.message}`);
    }
  }
};

/**
 * 馬券購入UIを表示
 * @param {CommandInteraction} interaction - インタラクション
 * @param {Object} race - レース情報
 */
async function displayBetUI(interaction, race) {
  try {
    // レース情報をフォーマット
    const formattedRace = raceService.formatRaceForDisplay(race);
    
    // ユーザー情報を取得
    const user = await userService.getUserById(interaction.user.id);
    
    // 馬券タイプ一覧
    const betTypes = betService.getBetTypes();
    
    // 埋め込みを作成
    const embed = new EmbedBuilder()
      .setTitle(`馬券購入 - ${formattedRace.venue} ${formattedRace.number}R ${formattedRace.name}`)
      .setColor('#00ff00')
      .setDescription(`発走時刻: ${formattedRace.startTime}\n距離: ${formattedRace.distance}m (${formattedRace.surface}・${formattedRace.direction})\n\n所持ポイント: **${user.points}pt**`)
      .setTimestamp();
    
    // 馬券タイプ選択メニュー
    const betTypeSelect = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('bet_type_select')
          .setPlaceholder('馬券タイプを選択')
          .addOptions(
            betTypes.map(type => ({
              label: type.name,
              value: type.id,
              description: type.description
            }))
          )
      );
    
    // メッセージを送信
    const response = await interaction.editReply({
      embeds: [embed],
      components: [betTypeSelect]
    });
    
    // インタラクションコレクターを設定
    const collector = response.createMessageComponentCollector({
      time: 300000 // 5分間有効
    });
    
    // セッション状態を管理
    const session = {
      raceId: race.id,
      type: null,
      method: null,
      selections: [],
      amount: 100 // デフォルト金額
    };
    
    // 選択メニュー変更時の処理
    collector.on('collect', async i => {
      // インタラクションを行ったユーザーが元のコマンド実行者と同じか確認
      if (i.user.id !== interaction.user.id) {
        await i.reply({ content: 'このメニューは他のユーザーが操作中です', ephemeral: true });
        return;
      }
      
      try {
        if (i.customId === 'bet_type_select') {
          // 馬券タイプが選択された場合
          await handleBetTypeSelect(i, race, session);
        } else if (i.customId === 'bet_method_select') {
          // 購入方法が選択された場合
          await handleBetMethodSelect(i, race, session);
        } else if (i.customId === 'horse_select_done') {
          // 馬選択完了ボタンがクリックされた場合
          await handleHorseSelectDone(i, race, session);
        } else if (i.customId === 'bet_confirm') {
          // 購入確定ボタンがクリックされた場合
          await handleBetConfirm(i, race, session);
        } else if (i.customId === 'bet_cancel') {
          // キャンセルボタンがクリックされた場合
          await i.update({
            content: '馬券購入をキャンセルしました',
            embeds: [],
            components: []
          });
          collector.stop();
        } else if (i.customId === 'bet_amount') {
          // 金額入力ボタンがクリックされた場合
          await showAmountModal(i, session);
        } else if (i.customId.startsWith('horse_select_')) {
          // 馬選択ボタンがクリックされた場合
          await handleHorseSelect(i, race, session);
        }
      } catch (error) {
        logger.error(`馬券購入処理中にエラーが発生しました: ${error.message}`, error);
        await i.update({ content: `エラーが発生しました: ${error.message}`, components: [] });
        collector.stop();
      }
    });
    
    // タイムアウト時の処理
    collector.on('end', async collected => {
      if (collected.size === 0) {
        try {
          await interaction.editReply({
            content: '操作がタイムアウトしました',
            embeds: [],
            components: []
          });
        } catch (error) {
          logger.error('馬券購入UIのタイムアウト処理に失敗しました', error);
        }
      }
    });
  } catch (error) {
    logger.error(`馬券購入UIの表示に失敗しました: ${error.message}`, error);
    await interaction.editReply(`馬券購入UIの表示に失敗しました: ${error.message}`);
  }
}

/**
 * 馬券タイプ選択処理
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {Object} race - レース情報
 * @param {Object} session - セッション情報
 */
async function handleBetTypeSelect(interaction, race, session) {
  await interaction.deferUpdate();
  
  // 選択された馬券タイプ
  const betTypeId = interaction.values[0];
  session.type = betTypeId;
  
  // 馬券タイプの詳細
  const betType = betService.getBetTypes().find(type => type.id === betTypeId);
  
  if (!betType) {
    await interaction.editReply(`無効な馬券タイプです: ${betTypeId}`);
    return;
  }
  
  // 馬券タイプの説明
  const typeDescription = `【${betType.name}】${betType.description}`;
  
  // 購入方法の選択肢
  const methodOptions = [];
  
  if (betType.methods.includes('normal')) {
    methodOptions.push({
      label: '通常',
      value: 'normal',
      description: '指定した馬のみで購入'
    });
  }
  
  if (betType.methods.includes('box')) {
    methodOptions.push({
      label: 'ボックス',
      value: 'box',
      description: '選択した馬の組み合わせで購入（順不同）'
    });
  }
  
  if (betType.methods.includes('formation')) {
    methodOptions.push({
      label: 'フォーメーション',
      value: 'formation',
      description: '1着固定で他の馬を総流し'
    });
  }
  
  // 購入方法選択メニュー
  const methodSelect = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('bet_method_select')
        .setPlaceholder('購入方法を選択')
        .addOptions(methodOptions)
    );
  
  // レース情報を表示
  const formattedRace = raceService.formatRaceForDisplay(race);
  
  // 埋め込みを更新
  const embed = new EmbedBuilder()
    .setTitle(`馬券購入 - ${formattedRace.venue} ${formattedRace.number}R ${formattedRace.name}`)
    .setColor('#00ff00')
    .setDescription(`発走時刻: ${formattedRace.startTime}\n\n${typeDescription}\n\n購入方法を選択してください`)
    .setTimestamp();
  
  await interaction.editReply({
    embeds: [embed],
    components: [methodSelect]
  });
}

/**
 * 購入方法選択処理
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {Object} race - レース情報
 * @param {Object} session - セッション情報
 */
async function handleBetMethodSelect(interaction, race, session) {
  await interaction.deferUpdate();
  
  // 選択された購入方法
  const method = interaction.values[0];
  session.method = method;
  
  // 購入方法の説明
  const methodDescription = {
    'normal': '通常',
    'box': 'ボックス',
    'formation': 'フォーメーション'
  }[method] || method;
  
  // 馬券タイプの詳細
  const betType = betService.getBetTypes().find(type => type.id === session.type);
  
  if (!betType) {
    await interaction.editReply(`無効な馬券タイプです: ${session.type}`);
    return;
  }
  
  // 馬券タイプと購入方法の説明
  const typeDescription = `【${betType.name}】${betType.description}`;
  const fullDescription = `${typeDescription}\n購入方法: ${methodDescription}`;
  
  // 馬選択UIを表示
  await showHorseSelectionUI(interaction, race, session, fullDescription);
}

/**
 * 馬選択UI表示
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {Object} race - レース情報
 * @param {Object} session - セッション情報
 * @param {string} description - 説明文
 */
async function showHorseSelectionUI(interaction, race, session, description) {
  // 馬券タイプの詳細
  const betType = betService.getBetTypes().find(type => type.id === session.type);
  
  // 馬選択の必要数
  const minSelections = betType ? betType.selectionCount.min : 1;
  const maxSelections = session.method === 'normal' ? minSelections : 10;
  
  // レース情報をフォーマット
  const formattedRace = raceService.formatRaceForDisplay(race);
  
  // 出走馬を馬番順にソート
  const sortedHorses = [...formattedRace.horses].sort((a, b) => a.number - b.number);
  
  // 埋め込みを更新
  const embed = new EmbedBuilder()
    .setTitle(`馬券購入 - ${formattedRace.venue} ${formattedRace.number}R ${formattedRace.name}`)
    .setColor('#00ff00')
    .setDescription(`発走時刻: ${formattedRace.startTime}\n\n${description}\n\n馬を選択してください (${minSelections}〜${maxSelections}頭)`)
    .setTimestamp();
  
  // 選択中の馬を表示
  if (session.selections.length > 0) {
    const selectedHorses = session.selections.map(number => {
      const horse = sortedHorses.find(h => h.number === number);
      return horse ? `${number}番: ${horse.name}` : `${number}番`;
    });
    
    embed.addFields({
      name: '選択中の馬',
      value: selectedHorses.join('\n')
    });
  }
  
  // 馬選択ボタンを作成
  const horseButtons = [];
  
  // 1行に5つのボタンを配置
  for (let i = 0; i < sortedHorses.length; i += 5) {
    const row = new ActionRowBuilder();
    
    // 1行分の馬を処理
    for (let j = i; j < i + 5 && j < sortedHorses.length; j++) {
      const horse = sortedHorses[j];
      const isSelected = session.selections.includes(horse.number);
      
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`horse_select_${horse.number}`)
          .setLabel(`${horse.number}`)
          .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
    }
    
    horseButtons.push(row);
  }
  
  // 選択完了・キャンセルボタン
  const actionButtons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('horse_select_done')
        .setLabel('選択完了')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(session.selections.length < minSelections),
      new ButtonBuilder()
        .setCustomId('bet_cancel')
        .setLabel('キャンセル')
        .setStyle(ButtonStyle.Danger)
    );
  
  // UIを更新
  await interaction.editReply({
    embeds: [embed],
    components: [...horseButtons, actionButtons]
  });
}

/**
 * 馬選択処理
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {Object} race - レース情報
 * @param {Object} session - セッション情報
 */
async function handleHorseSelect(interaction, race, session) {
  // 選択された馬番
  const horseNumber = parseInt(interaction.customId.replace('horse_select_', ''));
  
  // 馬券タイプの詳細
  const betType = betService.getBetTypes().find(type => type.id === session.type);
  
  // 馬選択の必要数
  const minSelections = betType ? betType.selectionCount.min : 1;
  const maxSelections = session.method === 'normal' ? minSelections : 10;
  
  // 選択状態を切り替え
  const index = session.selections.indexOf(horseNumber);
  
  if (index >= 0) {
    // 既に選択されている場合は解除
    session.selections.splice(index, 1);
  } else {
    // 選択されていない場合は追加
    if (session.selections.length < maxSelections) {
      session.selections.push(horseNumber);
      
      // 馬番順にソート
      session.selections.sort((a, b) => a - b);
    }
  }
  
  // 購入方法の説明
  const methodDescription = {
    'normal': '通常',
    'box': 'ボックス',
    'formation': 'フォーメーション'
  }[session.method] || session.method;
  
  // 馬券タイプと購入方法の説明
  const typeDescription = `【${betType.name}】${betType.description}`;
  const fullDescription = `${typeDescription}\n購入方法: ${methodDescription}`;
  
  // 馬選択UIを更新
  await showHorseSelectionUI(interaction, race, session, fullDescription);
}

/**
 * 馬選択完了処理
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {Object} race - レース情報
 * @param {Object} session - セッション情報
 */
async function handleHorseSelectDone(interaction, race, session) {
  await interaction.deferUpdate();
  
  // 馬券タイプの詳細
  const betType = betService.getBetTypes().find(type => type.id === session.type);
  
  if (!betType) {
    await interaction.editReply(`無効な馬券タイプです: ${session.type}`);
    return;
  }
  
  // 購入方法の説明
  const methodDescription = {
    'normal': '通常',
    'box': 'ボックス',
    'formation': 'フォーメーション'
  }[session.method] || session.method;
  
  // 馬券タイプと購入方法の説明
  const typeDescription = `【${betType.name}】${betType.description}`;
  
  // レース情報をフォーマット
  const formattedRace = raceService.formatRaceForDisplay(race);
  
  // 選択した馬の情報
  const selectedHorses = session.selections.map(number => {
    const horse = formattedRace.horses.find(h => h.number === number);
    return horse ? `${number}番: ${horse.name}` : `${number}番`;
  }).join('\n');
  
  // 金額入力ボタン
  const amountButton = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('bet_amount')
        .setLabel(`金額設定 (現在: ${session.amount}pt)`)
        .setStyle(ButtonStyle.Primary)
    );
  
  // 確定・キャンセルボタン
  const actionButtons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('bet_confirm')
        .setLabel('購入確定')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('bet_cancel')
        .setLabel('キャンセル')
        .setStyle(ButtonStyle.Danger)
    );
  
  // 埋め込みを更新
  const embed = new EmbedBuilder()
    .setTitle(`馬券購入確認 - ${formattedRace.venue} ${formattedRace.number}R ${formattedRace.name}`)
    .setColor('#00ff00')
    .setDescription(`発走時刻: ${formattedRace.startTime}\n\n${typeDescription}\n購入方法: ${methodDescription}\n\n購入金額: **${session.amount}pt**`)
    .addFields(
      { name: '選択した馬', value: selectedHorses }
    )
    .setTimestamp();
  
  // ユーザー情報を取得
  const user = await userService.getUserById(interaction.user.id);
  
  if (user && user.points < session.amount) {
    embed.addFields(
      { name: 'エラー', value: `所持ポイント(${user.points}pt)が不足しています` }
    );
    
    // 購入確定ボタンを無効化
    actionButtons.components[0].setDisabled(true);
  } else {
    embed.addFields(
      { name: '所持ポイント', value: `${user.points}pt → ${user.points - session.amount}pt` }
    );
  }
  
  // UIを更新
  await interaction.editReply({
    embeds: [embed],
    components: [amountButton, actionButtons]
  });
}

/**
 * 金額入力モーダルを表示
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {Object} session - セッション情報
 */
async function showAmountModal(interaction, session) {
  // 金額入力モーダルを作成
  const modal = new ModalBuilder()
    .setCustomId('bet_amount_modal')
    .setTitle('馬券購入金額');
  
  // 金額入力フィールド
  const amountInput = new TextInputBuilder()
    .setCustomId('amount_input')
    .setLabel('購入金額 (100pt以上、100pt単位)')
    .setPlaceholder('例: 100, 200, 300...')
    .setValue(session.amount.toString())
    .setRequired(true)
    .setStyle(TextInputStyle.Short);
  
  // フォームにフィールドを追加
  const amountRow = new ActionRowBuilder().addComponents(amountInput);
  modal.addComponents(amountRow);
  
  // モーダルを表示
  await interaction.showModal(modal);
  
  try {
    // モーダル送信を待機
    const modalSubmit = await interaction.awaitModalSubmit({
      time: 60000, // 1分間待機
      filter: i => i.customId === 'bet_amount_modal'
    });
    
    // 入力された金額
    const amountStr = modalSubmit.fields.getTextInputValue('amount_input');
    const amount = parseInt(amountStr);
    
    // 金額のバリデーション
    if (isNaN(amount) || amount < 100 || amount % 100 !== 0) {
      await modalSubmit.reply({
        content: '購入金額は100pt以上、100pt単位で指定してください',
        ephemeral: true
      });
      return;
    }
    
    // セッション情報を更新
    session.amount = amount;
    
    // 馬選択完了処理を呼び出して画面を更新
    await handleHorseSelectDone(modalSubmit, await raceService.getRaceById(session.raceId), session);
  } catch (error) {
    logger.error(`金額入力モーダル処理中にエラーが発生しました: ${error.message}`, error);
    // モーダルがタイムアウトした場合は何もしない
  }
}

/**
 * 馬券購入確定処理
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {Object} race - レース情報
 * @param {Object} session - セッション情報
 */
async function handleBetConfirm(interaction, race, session) {
  await interaction.deferUpdate();
  
  try {
    // 馬券購入処理
    const result = await betService.placeBet(
      interaction.user.id,
      session.raceId,
      session.type,
      session.method,
      session.selections,
      session.amount
    );
    
    // レース情報をフォーマット
    const formattedRace = raceService.formatRaceForDisplay(race);
    
    // 馬券タイプの詳細
    const betType = betService.getBetTypes().find(type => type.id === session.type);
    const typeName = betType ? betType.name : session.type;
    
    // 購入方法の説明
    const methodDescription = {
      'normal': '通常',
      'box': 'ボックス',
      'formation': 'フォーメーション'
    }[session.method] || session.method;
    
    // 選択した馬の情報
    const selectedHorses = session.selections.map(number => {
      const horse = formattedRace.horses.find(h => h.number === number);
      return horse ? `${number}番: ${horse.name}` : `${number}番`;
    }).join('\n');
    
    // 埋め込みを更新
    const embed = new EmbedBuilder()
      .setTitle(`馬券購入完了 - ${formattedRace.venue} ${formattedRace.number}R ${formattedRace.name}`)
      .setColor('#00ff00')
      .setDescription(`発走時刻: ${formattedRace.startTime}\n\n${typeName} (${methodDescription}) の馬券を ${session.amount}pt で購入しました`)
      .addFields(
        { name: '選択した馬', value: selectedHorses }
      )
      .setTimestamp();
    
    // UIを更新
    await interaction.editReply({
      embeds: [embed],
      components: []
    });
  } catch (error) {
    logger.error(`馬券購入に失敗しました: ${error.message}`, error);
    
    // エラーメッセージ
    const errorEmbed = new EmbedBuilder()
      .setTitle('馬券購入エラー')
      .setColor('#ff0000')
      .setDescription(`馬券購入に失敗しました: ${error.message}`)
      .setTimestamp();
    
    // UIを更新
    await interaction.editReply({
      embeds: [errorEmbed],
      components: []
    });
  }
}