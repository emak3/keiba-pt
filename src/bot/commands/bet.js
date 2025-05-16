// bet.js - 馬券購入コマンド
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { getRaceNumberFromRaceId, getTrackNameFromRaceId } = require('../../utils/track-helper');
const { getTodayRaces, getRaceById } = require('../../db/races');
const { getUserByDiscordId } = require('../../db/users');
const { placeBet, getUserRaceBets } = require('../../db/bets');
const { formatter } = require('../../utils/formatter');
const config = require('../../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bet')
    .setDescription('馬券を購入します')
    .addSubcommand(subcommand =>
      subcommand
        .setName('race')
        .setDescription('レースを選択して馬券を購入します')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('history')
        .setDescription('購入した馬券の履歴を表示します')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'race') {
      await this.showRaceSelection(interaction);
    } else if (subcommand === 'history') {
      await this.showBetHistory(interaction);
    }
  },

  /**
   * レース選択画面を表示
   */
  async showRaceSelection(interaction) {
    await interaction.deferReply();

    try {
      // 当日のレース一覧を取得
      const races = await getTodayRaces();

      // 未完了のレースのみをフィルタリング
      const availableRaces = races.filter(race => !race.isCompleted);

      if (availableRaces.length === 0) {
        await interaction.editReply('現在購入可能なレースはありません。');
        return;
      }

      // 会場ごとにグループ化
      const racesByTrack = availableRaces.reduce((acc, race) => {
        if (!acc[race.track]) {
          acc[race.track] = [];
        }
        acc[race.track].push(race);
        return acc;
      }, {});

      // 埋め込みを作成
      const embed = new EmbedBuilder()
        .setTitle('馬券購入 - レース選択')
        .setColor('#0099ff')
        .setDescription('下のメニューから会場を選択してください。')
        .setTimestamp();

      // 会場選択メニューを作成
      const trackOptions = Object.keys(racesByTrack).map(track => ({
        label: track,
        value: track
      }));

      const trackSelect = new StringSelectMenuBuilder()
        .setCustomId('bet:select_track')
        .setPlaceholder('会場を選択')
        .addOptions(trackOptions);

      const row = new ActionRowBuilder().addComponents(trackSelect);

      // 返信
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      console.error('レース選択画面の表示中にエラーが発生しました:', error);
      await interaction.editReply('レース情報の取得中にエラーが発生しました。');
    }
  },

  /**
   * 馬券履歴を表示
   */
  async showBetHistory(interaction) {
    await interaction.deferReply();

    try {
      // ユーザー情報を取得
      const user = await getUserByDiscordId(interaction.user.id);

      if (!user) {
        await interaction.editReply('ユーザー情報が見つかりません。');
        return;
      }

      // 馬券履歴を取得
      const bets = await getUserBets(user.id);

      if (bets.length === 0) {
        await interaction.editReply('馬券購入履歴はありません。');
        return;
      }

      // 埋め込みを作成
      const embed = new EmbedBuilder()
        .setTitle('馬券購入履歴')
        .setColor('#0099ff')
        .setDescription(`${interaction.user.username}さんの最近の馬券購入履歴です。`)
        .setTimestamp();

      // レースごとにグループ化
      const betsByRace = bets.reduce((acc, bet) => {
        if (!acc[bet.raceId]) {
          acc[bet.raceId] = [];
        }
        acc[bet.raceId].push(bet);
        return acc;
      }, {});

      // 各レースの馬券情報をフィールドとして追加
      for (const [raceId, raceBets] of Object.entries(betsByRace)) {
        const race = await getRaceById(raceId);

        if (!race) continue;

        const betContents = raceBets.map(bet => formatter.betContent(bet)).join('\n');

        embed.addFields({
          name: `${race.track} ${race.number}R ${race.name}`,
          value: betContents
        });
      }

      // 返信
      await interaction.editReply({
        embeds: [embed]
      });
    } catch (error) {
      console.error('馬券履歴の表示中にエラーが発生しました:', error);
      await interaction.editReply('馬券履歴の取得中にエラーが発生しました。');
    }
  },

  /**
   * インタラクションを処理
   */
  async handleInteraction(interaction, action, args) {
    switch (action) {
      case 'select_track':
        await this.handleTrackSelection(interaction);
        break;
      case 'select_race':
        await this.handleRaceSelection(interaction);
        break;
      case 'select_bet_type':
        await this.handleBetTypeSelection(interaction);
        break;
      case 'select_bet_method':
        await this.handleBetMethodSelection(interaction);
        break;
      case 'select_horse':
        await this.handleHorseSelection(interaction);
        break;
      case 'confirm':
        await this.handleBetConfirmation(interaction);
        break;
      case 'cancel':
        await this.handleBetCancellation(interaction);
        break;
      case 'start':
        await this.startBetProcess(interaction, args[0]);
        break;
    }
  },

  /**
   * 馬券購入プロセスを開始
   */
  async startBetProcess(interaction, raceId) {
    try {
      const race = await getRaceById(raceId);

      if (!race) {
        await interaction.reply({
          content: 'レース情報が見つかりません。',
          ephemeral: true
        });
        return;
      }

      if (race.isCompleted) {
        await interaction.reply({
          content: 'このレースは既に終了しています。',
          ephemeral: true
        });
        return;
      }

      // 馬券種類選択メニューを表示
      await this.showBetTypeSelection(interaction, race);
    } catch (error) {
      console.error('馬券購入プロセスの開始中にエラーが発生しました:', error);
      await interaction.reply({
        content: 'エラーが発生しました。',
        ephemeral: true
      });
    }
  },

  /**
   * 会場選択の処理
   */
  async handleTrackSelection(interaction) {
    try {
      const selectedTrack = interaction.values[0];

      // 当日の選択した会場のレースを取得
      const races = await getTodayRaces();
      const trackRaces = races
        .filter(race => race.track === selectedTrack && !race.isCompleted)
        .sort((a, b) => parseInt(a.number) - parseInt(b.number));

      if (trackRaces.length === 0) {
        await interaction.update({
          content: `${selectedTrack}の購入可能なレースはありません。`,
          embeds: [],
          components: []
        });
        return;
      }

      // レース選択メニューを作成
      const raceOptions = trackRaces.map(race => ({
        label: `${race.number}R ${race.name}`,
        description: `${race.time}発走`,
        value: race.id
      }));

      const raceSelect = new StringSelectMenuBuilder()
        .setCustomId('bet:select_race')
        .setPlaceholder('レースを選択')
        .addOptions(raceOptions);

      const raceRow = new ActionRowBuilder().addComponents(raceSelect);

      // 埋め込みを更新
      const embed = new EmbedBuilder()
        .setTitle(`馬券購入 - ${selectedTrack}`)
        .setColor('#0099ff')
        .setDescription('購入するレースを選択してください。')
        .addFields(
          trackRaces.map(race => ({
            name: `${race.number}R ${race.name}`,
            value: `${race.time}発走`
          }))
        )
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: [raceRow]
      });
    } catch (error) {
      console.error('会場選択の処理中にエラーが発生しました:', error);
      await interaction.update({
        content: 'エラーが発生しました。',
        embeds: [],
        components: []
      });
    }
  },

  /**
   * レース選択の処理
   */
  async handleRaceSelection(interaction) {
    try {
      const raceId = interaction.values[0];
      const race = await getRaceById(raceId);

      if (!race) {
        await interaction.update({
          content: 'レース情報が見つかりません。',
          embeds: [],
          components: []
        });
        return;
      }

      // 馬券種類選択メニューを表示
      await this.showBetTypeSelection(interaction, race);
    } catch (error) {
      console.error('レース選択の処理中にエラーが発生しました:', error);
      await interaction.update({
        content: 'エラーが発生しました。',
        embeds: [],
        components: []
      });
    }
  },

  /**
   * 馬券種類選択画面を表示
   */
  async showBetTypeSelection(interaction, race) {
    try {
      // 馬券種類選択メニューを作成
      const betTypeOptions = Object.entries(config.betTypes).map(([key, value]) => ({
        label: value.name,
        description: value.description,
        value: `${key}:${race.id}`
      }));

      const betTypeSelect = new StringSelectMenuBuilder()
        .setCustomId('bet:select_bet_type')
        .setPlaceholder('馬券の種類を選択')
        .addOptions(betTypeOptions);

      const row = new ActionRowBuilder().addComponents(betTypeSelect);

      // 埋め込みを作成
      const embed = new EmbedBuilder()
        .setTitle(`馬券購入 - ${getTrackNameFromRaceId(race.id)} ${getRaceNumberFromRaceId(race.id)}R ${race.name}`)
        .setColor('#0099ff')
        .setDescription(`${race.time}発走 | 購入する馬券の種類を選択してください。`)
        .setTimestamp();

      // 出走馬情報を追加
      race.horses.forEach(horse => {
        embed.addFields({
          name: `${horse.gate}枠${horse.number}番 ${horse.name}`,
          value: `騎手: ${horse.jockey}\nオッズ: ${horse.odds || '未定'}`
        });
      });

      // 返信
      await interaction.update({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      console.error('馬券種類選択画面の表示中にエラーが発生しました:', error);
      await interaction.update({
        content: 'エラーが発生しました。',
        embeds: [],
        components: []
      });
    }
  },

  /**
   * 馬券種類選択の処理
   */
  async handleBetTypeSelection(interaction) {
    try {
      const [betType, raceId] = interaction.values[0].split(':');
      const race = await getRaceById(raceId);

      if (!race) {
        await interaction.update({
          content: 'レース情報が見つかりません。',
          embeds: [],
          components: []
        });
        return;
      }

      // 馬券購入方法選択メニューを作成
      const betMethodOptions = Object.entries(config.betMethods).map(([key, value]) => ({
        label: value.name,
        description: value.description,
        value: `${key}:${betType}:${raceId}`
      }));
      console.log('取得したレース情報:', race);
      const betMethodSelect = new StringSelectMenuBuilder()
        .setCustomId('bet:select_bet_method')
        .setPlaceholder('購入方法を選択')
        .addOptions(betMethodOptions);

      const row = new ActionRowBuilder().addComponents(betMethodSelect);

      // 埋め込みを更新
      const embed = new EmbedBuilder()
        .setTitle(`馬券購入 - ${getTrackNameFromRaceId(raceId)} ${getRaceNumberFromRaceId(raceId)}R ${race.name}`)
        .setColor('#0099ff')
        .setDescription(`${formatter.betTypeName(betType)}を選択しました。購入方法を選択してください。`)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      console.error('馬券種類選択の処理中にエラーが発生しました:', error);
      await interaction.update({
        content: 'エラーが発生しました。',
        embeds: [],
        components: []
      });
    }
  },

  /**
   * 馬券購入方法選択の処理
   */
  async handleBetMethodSelection(interaction) {
    try {
      const [method, betType, raceId] = interaction.values[0].split(':');
      const race = await getRaceById(raceId);

      if (!race) {
        await interaction.update({
          content: 'レース情報が見つかりません。',
          embeds: [],
          components: []
        });
        return;
      }

      // 馬番選択を表示
      await this.showHorseSelection(interaction, race, betType, method);
    } catch (error) {
      console.error('馬券購入方法選択の処理中にエラーが発生しました:', error);
      await interaction.update({
        content: 'エラーが発生しました。',
        embeds: [],
        components: []
      });
    }
  },

  /**
   * 馬番選択画面を表示
   */
  async showHorseSelection(interaction, race, betType, method) {
    try {
      // 馬番選択は馬券種類によって異なる
      let selectionTitle, placeholders;

      switch (betType) {
        case 'tansho':
        case 'fukusho':
          selectionTitle = '馬番を選択してください';
          placeholders = ['馬番を選択'];
          break;
        case 'umaren':
        case 'wide':
          selectionTitle = '2頭の馬番を選択してください';
          placeholders = ['1頭目', '2頭目'];
          break;
        case 'umatan':
          selectionTitle = '1着と2着の馬番を順番に選択してください';
          placeholders = ['1着', '2着'];
          break;
        case 'wakuren':
          selectionTitle = '2つの枠番を選択してください';
          placeholders = ['1つ目の枠', '2つ目の枠'];
          break;
        case 'sanrenpuku':
          selectionTitle = '3頭の馬番を選択してください';
          placeholders = ['1頭目', '2頭目', '3頭目'];
          break;
        case 'sanrentan':
          selectionTitle = '1着、2着、3着の馬番を順番に選択してください';
          placeholders = ['1着', '2着', '3着'];
          break;
      }

      // フォーメーション購入の場合はタイトル変更
      if (method === 'formation') {
        if (['umaren', 'wide', 'umatan'].includes(betType)) {
          selectionTitle = '軸馬と相手馬を選択してください';
          placeholders = ['軸馬', '相手馬'];
        } else if (['sanrenpuku', 'sanrentan'].includes(betType)) {
          selectionTitle = '軸馬と相手馬を選択してください';
          placeholders = ['1頭目の軸馬', '2頭目の軸馬', '相手馬'];
        }
      }

      // ボックス購入の場合は選択する馬の数を決定
      let horsesToSelect = 1;
      if (['umaren', 'wide', 'umatan', 'wakuren'].includes(betType)) {
        horsesToSelect = 2;
      } else if (['sanrenpuku', 'sanrentan'].includes(betType)) {
        horsesToSelect = 3;
      }

      // 馬番選択メニューを作成
      const rows = [];

      for (let i = 0; i < horsesToSelect; i++) {
        const horseOptions = race.horses.map(horse => ({
          label: `${horse.gate}枠${horse.number}番 ${horse.name}`,
          value: `${horse.number}:${i}:${betType}:${method}:${race.id}`
        }));

        const horseSelect = new StringSelectMenuBuilder()
          .setCustomId(`bet:select_horse:${i}`)
          .setPlaceholder(placeholders[i])
          .addOptions(horseOptions);

        rows.push(new ActionRowBuilder().addComponents(horseSelect));
      }

      // 金額入力フィールドをモーダルで表示するボタン
      const amountButton = new ButtonBuilder()
        .setCustomId(`bet:amount_modal:${betType}:${method}:${race.id}`)
        .setLabel('購入金額を入力')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true); // 馬番が選択されるまで無効

      const buttonRow = new ActionRowBuilder().addComponents(amountButton);

      // 埋め込みを更新
      const embed = new EmbedBuilder()
        .setTitle(`馬券購入 - ${getTrackNameFromRaceId(race.id)} ${getRaceNumberFromRaceId(race.id)}R ${race.name}`)
        .setColor('#0099ff')
        .setDescription(`${formatter.betTypeName(betType)}（${config.betMethods[method].name}）\n${selectionTitle}`)
        .setFooter({ text: '馬番を選択してから金額を入力してください' })
        .setTimestamp();

      // 選択された馬番を保存するためのフィールド
      embed.addFields({
        name: '選択中の馬番',
        value: '未選択'
      });

      await interaction.update({
        embeds: [embed],
        components: [...rows, buttonRow]
      });
    } catch (error) {
      console.error('馬番選択画面の表示中にエラーが発生しました:', error);
      await interaction.update({
        content: 'エラーが発生しました。',
        embeds: [],
        components: []
      });
    }
  },

  /**
   * 馬番選択の処理
   */
  async handleHorseSelection(interaction) {
    try {
      const selectedIndex = interaction.customId.split(':')[2];
      const [horseNumber, index, betType, method, raceId] = interaction.values[0].split(':');

      // 現在の埋め込みを取得
      const currentEmbed = interaction.message.embeds[0];
      const embed = EmbedBuilder.from(currentEmbed);

      // 選択された馬番を更新
      let selectedHorses = embed.data.fields[0].value;
      if (selectedHorses === '未選択') {
        selectedHorses = {};
      } else {
        selectedHorses = JSON.parse(selectedHorses);
      }

      selectedHorses[index] = horseNumber;

      // フィールドを更新
      embed.spliceFields(0, 1, {
        name: '選択中の馬番',
        value: Object.values(selectedHorses).join(', ') || '未選択'
      });

      // 選択が完了したかチェック
      const requiredSelections = ['tansho', 'fukusho'].includes(betType) ? 1 :
        ['umaren', 'wide', 'umatan', 'wakuren'].includes(betType) ? 2 : 3;

      const isSelectionComplete = Object.keys(selectedHorses).length >= requiredSelections;

      // 金額入力ボタンを有効化
      const components = [...interaction.message.components];
      const lastRow = components[components.length - 1];
      const oldButton = lastRow.components[0];

      // 新しいButtonBuilderを作成
      const newButton = new ButtonBuilder()
        .setCustomId(oldButton.customId)
        .setLabel(oldButton.label)
        .setStyle(oldButton.style)
        .setDisabled(!isSelectionComplete);
      // 新しいActionRowBuilderを作成
      const newRow = new ActionRowBuilder().addComponents(newButton);

      // コンポーネント配列を更新
      components[components.length - 1] = newRow;
      // 更新
      await interaction.update({
        embeds: [embed],
        components
      });

      // 選択データを保存
      interaction.client.betSelections = interaction.client.betSelections || {};
      interaction.client.betSelections[interaction.user.id] = {
        raceId,
        betType,
        method,
        selectedHorses: Object.values(selectedHorses).map(Number)
      };
    } catch (error) {
      console.error('馬番選択の処理中にエラーが発生しました:', error);
      await interaction.update({
        content: 'エラーが発生しました。',
        embeds: [],
        components: []
      });
    }
  },

  /**
   * 金額入力モーダルを表示
   */
  async showAmountModal(interaction, betType, method, raceId) {
    try {
      // モーダルを作成
      const modal = new ModalBuilder()
        .setCustomId(`bet:amount:${betType}:${method}:${raceId}`)
        .setTitle('馬券購入金額');

      // 金額入力フィールド
      const amountInput = new TextInputBuilder()
        .setCustomId('bet_amount')
        .setLabel('購入金額（ポイント）')
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(5)
        .setPlaceholder('100')
        .setRequired(true);

      const actionRow = new ActionRowBuilder().addComponents(amountInput);
      modal.addComponents(actionRow);

      // モーダルを表示
      await interaction.showModal(modal);
    } catch (error) {
      console.error('金額入力モーダルの表示中にエラーが発生しました:', error);
      await interaction.reply({
        content: 'エラーが発生しました。',
        ephemeral: true
      });
    }
  },

  /**
   * 馬券購入確認画面を表示
   */
  async showBetConfirmation(interaction, betType, method, raceId, amount, selectedHorses) {
    try {
      const race = await getRaceById(raceId);

      if (!race) {
        await interaction.reply({
          content: 'レース情報が見つかりません。',
          ephemeral: true
        });
        return;
      }

      // ユーザー情報を取得
      const user = await getUserByDiscordId(interaction.user.id);

      if (!user) {
        await interaction.reply({
          content: 'ユーザー情報が見つかりません。',
          ephemeral: true
        });
        return;
      }

      // 残高チェック
      if (user.points < amount) {
        await interaction.reply({
          content: `ポイント残高が不足しています。現在の残高: ${user.points}pt`,
          ephemeral: true
        });
        return;
      }

      // 選択された馬の情報を取得
      const selectedHorseInfo = selectedHorses.map(number => {
        const horse = race.horses.find(h => h.number === number);
        return horse ? `${horse.gate}枠${horse.number}番 ${horse.name}` : `${number}番`;
      });

      // 購入内容を表示
      let betContent = '';

      switch (betType) {
        case 'tansho':
        case 'fukusho':
          betContent = `${selectedHorseInfo[0]}`;
          break;
        case 'umaren':
        case 'wide':
          betContent = `${selectedHorseInfo[0]}と${selectedHorseInfo[1]}`;
          break;
        case 'umatan':
          betContent = `${selectedHorseInfo[0]}→${selectedHorseInfo[1]}`;
          break;
        case 'wakuren':
          betContent = `${selectedHorseInfo[0]}と${selectedHorseInfo[1]}`;
          break;
        case 'sanrenpuku':
          betContent = `${selectedHorseInfo[0]}、${selectedHorseInfo[1]}、${selectedHorseInfo[2]}`;
          break;
        case 'sanrentan':
          betContent = `${selectedHorseInfo[0]}→${selectedHorseInfo[1]}→${selectedHorseInfo[2]}`;
          break;
      }

      // 購入方法に応じた追加情報
      if (method === 'box') {
        const combinations = calculateCombinations(selectedHorses.length, betType);
        betContent += `\n（BOX ${combinations}通り、各${Math.floor(amount / combinations)}pt）`;
      } else if (method === 'formation') {
        // フォーメーションの計算は複雑なので簡易的に
        betContent += `\n（フォーメーション）`;
      }

      // 埋め込みを作成
      const embed = new EmbedBuilder()
        .setTitle(`馬券購入確認 - ${race.track} ${race.number}R ${race.name}`)
        .setColor('#00ff00')
        .setDescription(`以下の内容で馬券を購入します。よろしければ「購入する」ボタンを押してください。`)
        .addFields(
          { name: '馬券の種類', value: formatter.betTypeName(betType) },
          { name: '購入方法', value: config.betMethods[method].name },
          { name: '購入内容', value: betContent },
          { name: '購入金額', value: `${amount}pt` },
          { name: '残高', value: `${user.points}pt → ${user.points - amount}pt` }
        )
        .setTimestamp();

      // ボタンを作成
      const confirmButton = new ButtonBuilder()
        .setCustomId(`bet:confirm:${betType}:${method}:${raceId}:${amount}:${selectedHorses.join(',')}`)
        .setLabel('購入する')
        .setStyle(ButtonStyle.Success);

      const cancelButton = new ButtonBuilder()
        .setCustomId('bet:cancel')
        .setLabel('キャンセル')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

      // 返信
      await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
      });
    } catch (error) {
      console.error('馬券購入確認画面の表示中にエラーが発生しました:', error);
      await interaction.reply({
        content: 'エラーが発生しました。',
        ephemeral: true
      });
    }
  },

  /**
   * 馬券購入確認の処理
   */
  async handleBetConfirmation(interaction) {
    try {
      const [betType, method, raceId, amountStr, horsesStr] = interaction.customId.split(':').slice(2);
      const amount = parseInt(amountStr, 10);
      const selectedHorses = horsesStr.split(',').map(Number);

      // ユーザー情報を取得
      const user = await getUserByDiscordId(interaction.user.id);

      if (!user) {
        await interaction.update({
          content: 'ユーザー情報が見つかりません。',
          embeds: [],
          components: []
        });
        return;
      }

      // 馬券を購入
      const bet = {
        userId: user.id,
        raceId,
        type: betType,
        numbers: selectedHorses,
        amount,
        method
      };

      if (method === 'formation') {
        // フォーメーションの場合は追加データが必要
        bet.first = [selectedHorses[0]];
        bet.second = selectedHorses.slice(1);
      }

      const result = await placeBet(bet);

      if (!result.success) {
        await interaction.update({
          content: `馬券の購入に失敗しました: ${result.message}`,
          embeds: [],
          components: []
        });
        return;
      }

      // 成功メッセージ
      await interaction.update({
        content: `馬券を購入しました！ ${result.message}`,
        embeds: [],
        components: []
      });
    } catch (error) {
      console.error('馬券購入処理中にエラーが発生しました:', error);
      await interaction.update({
        content: 'エラーが発生しました。',
        embeds: [],
        components: []
      });
    }
  },

  /**
   * 馬券購入キャンセルの処理
   */
  async handleBetCancellation(interaction) {
    await interaction.update({
      content: '馬券の購入をキャンセルしました。',
      embeds: [],
      components: []
    });
  }
};

/**
 * 組み合わせ数を計算するヘルパー関数
 */
function calculateCombinations(n, betType) {
  if (['tansho', 'fukusho'].includes(betType)) {
    return n;
  } else if (['umaren', 'wide', 'wakuren'].includes(betType)) {
    return (n * (n - 1)) / 2; // 順不同の2つ選択
  } else if (betType === 'umatan') {
    return n * (n - 1); // 順序ありの2つ選択
  } else if (betType === 'sanrenpuku') {
    return (n * (n - 1) * (n - 2)) / 6; // 順不同の3つ選択
  } else if (betType === 'sanrentan') {
    return n * (n - 1) * (n - 2); // 順序ありの3つ選択
  }
  return 0;
}