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
 * 馬リストから選択肢を作成
 * @param {Array} horses - 馬情報の配列
 * @returns {Array} セレクトメニューのオプション配列
 */
function createHorseOptions(horses) {
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
  
  // 馬情報に基づいてオプションを作成
  horses.forEach(horse => {
    options.push({
      label: `${horse.horseNumber}番: ${horse.horseName}`,
      description: `騎手: ${horse.jockey || '情報なし'} / オッズ: ${horse.odds || '?'}`,
      value: `${horse.horseNumber}`
    });
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