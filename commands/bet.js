import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { getRaceById } from '../services/database/raceService.js';
import { getUser, saveUser } from '../services/database/userService.js';
import { placeBet } from '../services/database/betService.js';
import logger from '../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('bet')
    .setDescription('馬券を購入します')
    .addStringOption(option =>
      option.setName('race_id')
        .setDescription('レースID')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('type')
        .setDescription('馬券の種類')
        .setRequired(true)
        .addChoices(
          { name: '単勝', value: 'tansho' },
          { name: '複勝', value: 'fukusho' },
          { name: '枠連', value: 'wakuren' },
          { name: '馬連', value: 'umaren' },
          { name: 'ワイド', value: 'wide' },
          { name: '馬単', value: 'umatan' },
          { name: '三連複', value: 'sanrenpuku' },
          { name: '三連単', value: 'sanrentan' }
        ))
    .addStringOption(option =>
      option.setName('method')
        .setDescription('購入方法')
        .setRequired(true)
        .addChoices(
          { name: '通常', value: 'normal' },
          { name: 'ボックス', value: 'box' },
          { name: 'フォーメーション', value: 'formation' }
        ))
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('購入金額（100pt単位）')
        .setRequired(true)
        .setMinValue(100)
        .setMaxValue(10000)),
  
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      // ユーザー情報を保存
      await saveUser(
        interaction.user.id,
        interaction.user.username,
        interaction.user.displayAvatarURL()
      );
      
      // ユーザー情報を取得
      const user = await getUser(interaction.user.id);
      
      if (!user) {
        return await interaction.editReply('ユーザー情報の取得に失敗しました。');
      }
      
      // オプション値の取得
      const raceId = interaction.options.getString('race_id');
      const betType = interaction.options.getString('type');
      const method = interaction.options.getString('method');
      const amount = interaction.options.getInteger('amount');
      
      // 金額チェック
      if (amount % 100 !== 0) {
        return await interaction.editReply('購入金額は100pt単位で指定してください。');
      }
      
      if (amount > user.points) {
        return await interaction.editReply(`ポイントが不足しています。現在のポイント: ${user.points}pt`);
      }
      
      // レース情報を取得
      const race = await getRaceById(raceId);
      
      if (!race) {
        return await interaction.editReply(`レースID ${raceId} の情報が見つかりませんでした。`);
      }
      
      // レースのステータスチェック
      if (race.status === 'completed') {
        return await interaction.editReply('このレースは既に終了しています。');
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
        return await interaction.editReply('このレースは発走2分前を過ぎているため、馬券を購入できません。');
      }
      
      // 馬券情報の表示
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
      
      // 馬券選択用のUIコンポーネントを作成
      if (method === 'normal' || method === 'box') {
        // 馬番選択用のセレクトメニュー
        const selectRow = new ActionRowBuilder()
          .addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`bet_select_${raceId}_${betType}_${method}_${amount}`)
              .setPlaceholder('馬番を選択してください')
              .setMinValues(1)
              .setMaxValues(getMaxSelectionsForBet(betType, method))
              .addOptions(createHorseOptions(race.horses || []))
          );
        
        const embed = new EmbedBuilder()
          .setTitle(`🏇 馬券購入 - ${race.venue} ${race.number}R ${race.name}`)
          .setDescription(`**${betTypeNames[betType]}**（${methodNames[method]}）購入画面\n\n購入金額: **${amount}pt**\n\n下のメニューから馬番を選択してください。`)
          .setColor(0x00b0f4)
          .setTimestamp();
        
        return await interaction.editReply({
          embeds: [embed],
          components: [selectRow]
        });
      } else if (method === 'formation') {
        // フォーメーション購入用のモーダル
        const modal = new ModalBuilder()
          .setCustomId(`bet_formation_${raceId}_${betType}_${amount}`)
          .setTitle(`馬券購入 - ${betTypeNames[betType]}（フォーメーション）`);
        
        // 馬券タイプに応じた入力フィールドを追加
        addFormationInputs(modal, betType);
        
        await interaction.showModal(modal);
        return;
      }
      
    } catch (error) {
      logger.error(`馬券購入中にエラーが発生しました: ${error}`);
      await interaction.editReply({ content: '馬券購入処理中にエラーが発生しました。しばらく経ってからもう一度お試しください。' });
    }
  },
  
  // インタラクションハンドラーとして使用するためにエクスポート
  async handleBetSelection(interaction) {
    try {
      await interaction.deferUpdate();
      
      // カスタムIDからパラメータを解析
      const parts = interaction.customId.split('_');
      // [0]=bet, [1]=select, [2]=raceId, [3]=betType, [4]=method, [5]=amount
      const raceId = parts[2];
      const betType = parts[3];
      const method = parts[4];
      const amount = parseInt(parts[5], 10);
      
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
      
      // レース発走時間の2分前チェック
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
      
      // 馬券表示データ
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
      
      // 選択した馬の情報
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
          { name: '残りポイント', value: `${user.points}pt → ${user.points - amount}pt` }
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
    } catch (error) {
      logger.error(`馬券選択処理中にエラーが発生しました: ${error}`);
      if (interaction.deferred) {
        await interaction.followUp({ 
          content: '処理中にエラーが発生しました。もう一度お試しください。', 
          ephemeral: true 
        });
      } else {
        await interaction.reply({ 
          content: '処理中にエラーが発生しました。もう一度お試しください。', 
          ephemeral: true 
        });
      }
    }
  },
  
  async handleBetConfirmation(interaction) {
    try {
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
      const parts = interaction.customId.split('_');
      // [0]=bet, [1]=confirm, [2]=raceId, [3]=betType, [4]=method, [5]=amount, [6]=horses
      const raceId = parts[2];
      const betType = parts[3];
      const method = parts[4];
      const amount = parseInt(parts[5], 10);
      const horsesString = parts[6];
      
      const selectedHorses = horsesString.split(',').map(num => parseInt(num.trim(), 10));
      
      // レース情報を取得
      const race = await getRaceById(raceId);
      if (!race) {
        return await interaction.followUp({
          content: `レース情報の取得に失敗しました。`,
          ephemeral: true
        });
      }
      
      // 選択内容を処理
      let selections = selectedHorses;
      
      // 順序あり馬券（馬単・三連単）の場合は配列構造を変換
      if (method === 'normal') {
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
      
      // 取消馬チェック
      const canceledHorses = race.horses.filter(h => h.isCanceled && selectedHorses.includes(h.horseNumber));
      if (canceledHorses.length > 0) {
        const canceledNames = canceledHorses.map(h => `${h.horseNumber}番: ${h.horseName}`).join('\n');
        return await interaction.followUp({
          content: `選択した馬に出走取消馬が含まれています。\n${canceledNames}`,
          ephemeral: true
        });
      }
      
      // 馬券購入処理
      const bet = await placeBet(
        interaction.user.id,
        raceId,
        betType,
        selections,
        method,
        amount
      );
      
      // 馬券表示データ
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
      
      // 選択馬表示用テキスト生成
      let selectionsDisplay = '';
      if (method === 'normal' && (betType === 'umatan' || betType === 'sanrentan')) {
        // 順序あり馬券
        if (betType === 'umatan') {
          selectionsDisplay = `${selectedHorses[0]}→${selectedHorses[1]}`;
        } else {
          selectionsDisplay = `${selectedHorses[0]}→${selectedHorses[1]}→${selectedHorses[2]}`;
        }
      } else {
        // その他の馬券
        selectionsDisplay = selectedHorses.join('-');
      }
      
      // 馬券購入結果のエンベッド
      const resultEmbed = new EmbedBuilder()
        .setTitle(`🎫 馬券購入完了`)
        .setDescription(`${betTypeNames[betType]}（${methodNames[method]}）の馬券を購入しました！`)
        .setColor(0x00b0f4)
        .setTimestamp()
        .addFields(
          { name: 'レース', value: `${race.venue} ${race.number}R ${race.name}` },
          { name: '発走時刻', value: race.time },
          { name: '購入金額', value: `${amount}pt` },
          { name: '選択馬番', value: selectionsDisplay },
          { name: '残りポイント', value: `${user.points - amount}pt` }
        );
      
      await interaction.editReply({
        content: `馬券の購入が完了しました！`,
        embeds: [resultEmbed],
        components: []
      });
    } catch (error) {
      logger.error(`馬券購入確定処理中にエラーが発生しました: ${error}`);
      try {
        await interaction.followUp({
          content: `エラーが発生しました: ${error.message}`,
          ephemeral: true
        });
      } catch (followUpError) {
        logger.error(`フォローアップエラー: ${followUpError}`);
      }
    }
  },
  
  async handleFormationBet(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });
      
      // customId から情報を抽出
      const parts = interaction.customId.split('_');
      // [0]=bet, [1]=formation, [2]=raceId, [3]=betType, [4]=amount
      const raceId = parts[2];
      const betType = parts[3];
      const amount = parseInt(parts[4], 10);
      
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
      
      // 取消馬チェック
      const allSelectedHorses = Array.isArray(selections[0]) ? 
        selections.flat() : selections;
        
      const canceledHorses = race.horses.filter(h => 
        h.isCanceled && allSelectedHorses.includes(h.horseNumber)
      );
      
      if (canceledHorses.length > 0) {
        const canceledNames = canceledHorses.map(h => `${h.horseNumber}番: ${h.horseName}`).join('\n');
        return await interaction.editReply(
          `選択した馬に出走取消馬が含まれています。\n${canceledNames}`
        );
      }
      
      // 馬券購入処理
      const bet = await placeBet(
        interaction.user.id,
        raceId,
        betType,
        selections,
        'formation',
        amount
      );
      
      // 馬券情報の表示用データ
      const betTypeNames = {
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
          { name: 'レース', value: `${race.venue} ${race.number}R ${race.name}` },
          { name: '発走時刻', value: race.time },
          { name: '購入金額', value: `${amount}pt` },
          { name: '選択馬番', value: selectionsDisplay },
          { name: '残りポイント', value: `${(await getUser(interaction.user.id)).points}pt` }
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
};

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
 * 馬券タイプに応じた最小選択数を取得
 * @param {string} betType - 馬券タイプ
 * @returns {number} 最小選択数
 */
function getMinSelectionsForBet(betType) {
  // 最小選択数
  const minSelections = {
    tansho: 1,
    fukusho: 1,
    wakuren: 2,
    umaren: 2,
    wide: 2,
    umatan: 2,
    sanrenpuku: 3,
    sanrentan: 3
  };

  return minSelections[betType] || 1;
}

/**
 * 馬リストから選択肢を作成
 * @param {Array} horses - 馬情報の配列
 * @returns {Array} セレクトメニューのオプション配列
 */
function createHorseOptions(horses) {
  // options配列を初期化 - 重要！
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
 * フォーメーション購入用の入力フィールドを追加
 * @param {ModalBuilder} modal - モーダルビルダー
 * @param {string} betType - 馬券タイプ
 */
function addFormationInputs(modal, betType) {
  if (betType === 'tansho' || betType === 'fukusho') {
    // 単勝・複勝はフォーメーション非対応
    return;
  }
  
  if (betType === 'umatan' || betType === 'sanrentan') {
    // 順序あり馬券（馬単・三連単）
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
    } else {
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
    }
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
}