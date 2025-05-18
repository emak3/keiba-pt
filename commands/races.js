// commands/races.js
import {
  MessageFlags,
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder
} from 'discord.js';
import { getRacesByDate, getRaceById } from '../services/database/raceService.js';
import { getUser, saveUser } from '../services/database/userService.js';
import dayjs from 'dayjs';
import logger from '../utils/logger.js';
import BetHandler from '../utils/betHandler.js';

// 会場コードと名称のマッピング
const venueCodeMap = {
  '01': '札幌',
  '02': '函館',
  '03': '福島',
  '04': '新潟',
  '05': '東京',
  '06': '中山',
  '07': '中京',
  '08': '京都',
  '09': '阪神',
  '10': '小倉',
  '31': '北見',
  '32': '岩見沢',
  '33': '帯広',
  '34': '旭川',
  '35': '盛岡',
  '36': '水沢',
  '37': '上山',
  '38': '三条',
  '39': '足利',
  '40': '宇都宮',
  '41': '高崎',
  '42': '浦和',
  '43': '船橋',
  '44': '大井',
  '45': '川崎',
  '46': '金沢',
  '47': '笠松',
  '48': '名古屋',
  '49': '(未使用競馬場)',
  '50': '園田',
  '51': '姫路',
  '52': '益田',
  '53': '福山',
  '54': '高知',
  '55': '佐賀',
  '56': '荒尾',
  '57': '中津',
  '58': '札幌(地方競馬)',
  '59': '函館(地方競馬)',
  '60': '新潟(地方競馬)',
  '61': '中京(地方競馬)',
  '65': '帯広(ば)'
};

export default {
  data: new SlashCommandBuilder()
    .setName('races')
    .setDescription('本日のレース一覧を表示します')
    .addStringOption(option =>
      option.setName('date')
        .setDescription('日付（YYYYMMDD形式、空白の場合は今日）')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      // ユーザー情報を保存
      await saveUser(
        interaction.user.id,
        interaction.user.username,
        interaction.user.displayAvatarURL()
      );

      // 日付オプションの処理
      let dateOption = interaction.options.getString('date');
      let targetDate;

      if (dateOption) {
        // 入力された日付の検証
        if (!/^\d{8}$/.test(dateOption)) {
          return await interaction.editReply('日付はYYYYMMDD形式で入力してください。例: 20250517');
        }
        targetDate = dateOption;
      } else {
        // 今日の日付
        targetDate = dayjs().format('YYYYMMDD');
      }

      // 日付の表示用フォーマット
      const displayDate = `${targetDate.slice(0, 4)}年${targetDate.slice(4, 6)}月${targetDate.slice(6, 8)}日`;

      // レース一覧を取得
      const races = await getRacesByDate(targetDate);

      if (races.length === 0) {
        return await interaction.editReply(`${displayDate}のレース情報はありません。`);
      }

      // 会場コード別にレースをグループ化
      const venueGroups = groupRacesByVenueCode(races);

      // 会場リストを作成（JRAとNARで分類）
      const jraVenues = [];
      const narVenues = [];

      for (const venueCode in venueGroups) {
        const firstRace = venueGroups[venueCode][0];
        // 会場名を整形
        const venueName = cleanVenueName(firstRace.venue);

        // 会場コードが1-10ならJRA、それ以外はNAR
        if (parseInt(venueCode) >= 1 && parseInt(venueCode) <= 10) {
          jraVenues.push({
            code: venueCode,
            name: venueCodeMap[venueCode] || venueName,
            type: 'JRA'
          });
        } else {
          narVenues.push({
            code: venueCode,
            name: venueCodeMap[venueCode] || venueName,
            type: 'NAR'
          });
        }
      }

      // 会場選択用のセレクトメニュー
      const selectRow = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`races_select_venue_${targetDate}`)
            .setPlaceholder('会場を選択してください')
            .addOptions([
              ...jraVenues.map(venue => ({
                label: `${venue.name}（JRA）`,
                value: `${venue.code}_${targetDate}`,
                description: `${venue.name}競馬場のレース一覧`,
                emoji: '🏇'
              })),
              ...narVenues.map(venue => ({
                label: `${venue.name}（NAR）`,
                value: `${venue.code}_${targetDate}`,
                description: `${venue.name}競馬場のレース一覧`,
                emoji: '🐎'
              }))
            ])
        );

      // 前日・翌日ボタン
      const prevDate = dayjs(targetDate).subtract(1, 'day').format('YYYYMMDD');
      const nextDate = dayjs(targetDate).add(1, 'day').format('YYYYMMDD');

      const navigationRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`races_prev_${prevDate}`)
            .setLabel('前日')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`races_next_${nextDate}`)
            .setLabel('翌日')
            .setStyle(ButtonStyle.Secondary)
        );

      // JRAとNARの会場数
      const jraCount = jraVenues.length;
      const narCount = narVenues.length;

      // 初期表示（会場一覧）のエンベッド
      const venueListEmbed = new EmbedBuilder()
        .setTitle(`${displayDate}の開催会場一覧`)
        .setColor(0x00b0f4)
        .setTimestamp();

      let description = '';

      if (jraCount > 0) {
        description += `**◆ 中央競馬（JRA）：${jraCount}会場**\n`;
        jraVenues.forEach(venue => {
          const raceCount = venueGroups[venue.code].length;
          description += `・${venue.name}（${raceCount}レース）\n`;
        });
        description += '\n';
      }

      if (narCount > 0) {
        description += `**◆ 地方競馬（NAR）：${narCount}会場**\n`;
        narVenues.forEach(venue => {
          const raceCount = venueGroups[venue.code].length;
          description += `・${venue.name}（${raceCount}レース）\n`;
        });
      }

      if (jraCount === 0 && narCount === 0) {
        description += '開催会場情報が取得できませんでした。\n';
      }

      description += '\n下のメニューから会場を選択してください。';
      venueListEmbed.setDescription(description);

      // レスポンスを送信
      await interaction.editReply({
        content: `${displayDate}のレース一覧（${races.length}件）`,
        embeds: [venueListEmbed],
        components: [selectRow, navigationRow]
      });

      // インタラクションの処理
      const filter = i =>
        i.customId.startsWith('races_prev_') ||
        i.customId.startsWith('races_next_') ||
        i.customId.startsWith('races_select_venue_') ||
        i.customId.startsWith('races_back_') ||
        i.customId.startsWith('races_select_race_') ||
        i.customId.startsWith('bet_select_type_');

      const collector = interaction.channel.createMessageComponentCollector({
        filter,
        time: 600000 // 10分間有効
      });

      // ナビゲーション履歴
      const history = {
        currentDate: targetDate,
        previousStates: [] // 戻るボタン用の履歴
      };

      collector.on('collect', async i => {
        // 別ユーザーのインタラクションを拒否
        if (i.user.id !== interaction.user.id) {
          try {
            await i.reply({ 
              content: 'このメニューは他のユーザーのコマンド結果用です。自分で `/races` コマンドを実行してください。', 
              flags: MessageFlags.Ephemeral 
            });
          } catch (replyError) {
            logger.error(`他ユーザーへの警告メッセージ送信エラー: ${replyError}`);
          }
          return;
        }

        try {
          if (i.customId.startsWith('races_prev_') || i.customId.startsWith('races_next_')) {
            // 日付移動の処理
            await handleDateNavigation(i, interaction, history);
          }
          // 会場選択
          else if (i.customId.startsWith('races_select_venue_')) {
            await handleVenueSelection(i, history);
          }
          // 戻るボタン
          else if (i.customId.startsWith('races_back_')) {
            await handleBackButton(i, interaction, history);
          }
          // レース選択
          else if (i.customId.startsWith('races_select_race_')) {
            await handleRaceSelection(i, history);
          }
          // 馬券タイプ選択は betHandler.js で処理
        } catch (error) {
          logger.error(`インタラクション処理全体でのエラー: ${error}`);
          await handleInteractionError(i, error);
        }
      });

      collector.on('end', () => {
        // コレクターの終了時の処理
      });

    } catch (error) {
      logger.error(`レース一覧表示中にエラーが発生しました: ${error}`);
      await interaction.editReply({ content: 'レース情報の取得中にエラーが発生しました。しばらく経ってからもう一度お試しください。' });
    }
  }
};

/**
 * 日付ナビゲーション処理
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {CommandInteraction} originalInteraction - 元のコマンドインタラクション
 * @param {Object} history - ナビゲーション履歴
 */
async function handleDateNavigation(interaction, originalInteraction, history) {
  const newDate = interaction.customId.split('_')[2];
  history.previousStates.push({
    date: history.currentDate,
    venue: null // 全体表示に戻る
  });
  history.currentDate = newDate;

  try {
    await interaction.deferUpdate();
  } catch (deferError) {
    logger.warn(`deferUpdate エラー (無視して続行): ${deferError}`);
  }

  try {
    await interaction.editReply({ content: '読み込み中...', embeds: [], components: [] });
  } catch (editError) {
    logger.warn(`editReply エラー (無視して続行): ${editError}`);
  }

  // 新しい日付でコマンドを再実行
  const command = originalInteraction.client.commands.get('races');
  const newInteraction = {
    ...originalInteraction,
    options: {
      getString: () => newDate
    },
    editReply: async (options) => {
      try {
        return await interaction.editReply(options);
      } catch (editError) {
        logger.error(`編集エラー: ${editError}`);
        try {
          return await interaction.followUp({ ...options, ephemeral: false });
        } catch (followupError) {
          logger.error(`フォローアップエラー: ${followupError}`);
        }
      }
    }
  };

  await command.execute(newInteraction);
}

/**
 * 会場選択処理
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {Object} history - ナビゲーション履歴
 */
async function handleVenueSelection(interaction, history) {
  const [venueCode, date] = interaction.values[0].split('_');
  
  history.previousStates.push({
    date: history.currentDate,
    venue: null // 全体表示に戻る
  });
  history.currentDate = date;

  try {
    await interaction.deferUpdate();
  } catch (deferError) {
    logger.warn(`deferUpdate エラー (無視して続行): ${deferError}`);
  }

  // レース一覧を取得
  const races = await getRacesByDate(date);
  
  // 選択された会場のレースを表示
  await displayVenueRaces(interaction, venueCode, date, races);
}

/**
 * 戻るボタン処理
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {CommandInteraction} originalInteraction - 元のコマンドインタラクション
 * @param {Object} history - ナビゲーション履歴
 */
async function handleBackButton(interaction, originalInteraction, history) {
  if (history.previousStates.length > 0) {
    const previousState = history.previousStates.pop();

    try {
      await interaction.deferUpdate();
    } catch (deferError) {
      logger.warn(`deferUpdate エラー (無視して続行): ${deferError}`);
    }

    if (previousState.venue) {
      // 特定の会場に戻る
      const races = await getRacesByDate(previousState.date);
      await displayVenueRaces(interaction, previousState.venue, previousState.date, races);
    } else {
      // 会場一覧に戻る
      try {
        await interaction.editReply({ content: '会場一覧に戻ります...', embeds: [], components: [] });
      } catch (editError) {
        logger.warn(`戻る中間メッセージエラー: ${editError}`);
      }

      const command = originalInteraction.client.commands.get('races');
      const newInteraction = {
        ...originalInteraction,
        options: {
          getString: () => previousState.date
        },
        editReply: async (options) => {
          try {
            return await interaction.editReply(options);
          } catch (editError) {
            logger.error(`編集エラー: ${editError}`);
            try {
              return await interaction.followUp({ ...options, ephemeral: false });
            } catch (followupError) {
              logger.error(`フォローアップエラー: ${followupError}`);
            }
          }
        }
      };

      await command.execute(newInteraction);
    }
  } else {
    try {
      await interaction.update({ content: '前の画面に戻れません。' });
    } catch (updateError) {
      logger.warn(`履歴なしエラー (次の処理にフォールバック): ${updateError}`);
      try {
        await interaction.editReply({ content: '前の画面に戻れません。' });
      } catch (editError) {
        logger.error(`履歴なしエラー編集失敗: ${editError}`);
      }
    }
  }
}

/**
 * レース選択処理
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {Object} history - ナビゲーション履歴
 */
async function handleRaceSelection(interaction, history) {
  try {
    await interaction.deferUpdate();
  } catch (deferError) {
    logger.warn(`deferUpdate エラー (無視して続行): ${deferError}`);
  }

  const raceId = interaction.values[0];

  if (!raceId) {
    logger.error('レース選択: レースIDが取得できませんでした');
    await interaction.editReply({
      content: 'レース情報の取得に失敗しました。もう一度お試しください。',
      components: []
    });
    return;
  }

  try {
    await interaction.editReply({
      content: `レース情報を読み込み中...`,
      embeds: [],
      components: []
    });
  } catch (editError) {
    logger.warn(`レース情報読み込み中表示エラー: ${editError}`);
  }

  const currentDate = history.currentDate;
  
  // レース詳細表示 - true は馬券購入メニューを表示する
  await displayRaceDetail(interaction, raceId, true);
}

/**
 * インタラクションエラー処理
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {Error} error - エラーオブジェクト
 */
async function handleInteractionError(interaction, error) {
  try {
    if (interaction.replied) {
      await interaction.followUp({
        content: 'エラーが発生しました。もう一度操作をお試しください。',
        flags: MessageFlags.Ephemeral
      });
    } else if (interaction.deferred) {
      await interaction.editReply({
        content: 'エラーが発生しました。もう一度操作をお試しください。',
      });
    } else {
      if (typeof interaction.update === 'function') {
        try {
          await interaction.update({
            content: 'エラーが発生しました。もう一度操作をお試しください。',
          });
        } catch (updateError) {
          try {
            await interaction.reply({
              content: 'エラーが発生しました。もう一度操作をお試しください。',
              flags: MessageFlags.Ephemeral
            });
          } catch (replyError) {
            logger.error(`応答失敗: ${replyError}`);
          }
        }
      } else {
        try {
          await interaction.reply({
            content: 'エラーが発生しました。もう一度操作をお試しください。',
            flags: MessageFlags.Ephemeral
          });
        } catch (replyError) {
          logger.error(`応答失敗: ${replyError}`);
        }
      }
    }
  } catch (responseError) {
    logger.error(`エラー通知中の二次エラー: ${responseError}`);
  }
}

/**
 * レースを会場コード別にグループ化
 * @param {Array} races - レース一覧
 * @returns {Object} 会場コード別のレース一覧
 */
function groupRacesByVenueCode(races) {
  const venueGroups = {};

  races.forEach(race => {
    // レースIDから会場コードを抽出（5-6桁目）
    const venueCode = extractVenueCode(race.id);

    if (!venueGroups[venueCode]) {
      venueGroups[venueCode] = [];
    }

    // 会場名を更新（会場コードから取得した名前を優先）
    const updatedRace = {
      ...race,
      extractedVenue: venueCodeMap[venueCode] || race.venue // 元の会場名をバックアップ
    };

    venueGroups[venueCode].push(updatedRace);
  });

  // 各グループ内でレース番号順にソート
  for (const venueCode in venueGroups) {
    venueGroups[venueCode].sort((a, b) => a.number - b.number);
  }

  return venueGroups;
}

/**
 * レースIDから会場コードを抽出
 * @param {string} raceId - レースID（例：202504010501）
 * @returns {string} 会場コード（例：04）
 */
function extractVenueCode(raceId) {
  // レースIDは12桁の数字で、5-6桁目が会場コード
  if (raceId && raceId.length >= 6) {
    return raceId.substring(4, 6);
  }
  return '00';
}

/**
 * 会場名から「○回△△△日目」などの余分な情報を削除
 * @param {string} venue - 会場名
 * @returns {string} 整形された会場名
 */
function cleanVenueName(venue) {
  if (!venue) return '不明';

  // 「○回」や「○日目」などのパターンを含まないメイン会場名を抽出
  const mainVenueMatch = venue.match(/(?:[\d]+回)?([^\d]+)(?:[\d]+日目)?/);
  if (mainVenueMatch && mainVenueMatch[1]) {
    return mainVenueMatch[1].trim();
  }

  return venue;
}

/**
 * 会場別のレース一覧を表示
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {string} venueCode - 会場コード
 * @param {string} dateString - 日付
 * @param {Array} allRaces - すべてのレース一覧
 */
async function displayVenueRaces(interaction, venueCode, dateString, allRaces) {
  try {
    // 会場コードに合致するレースを抽出
    const venueRaces = allRaces.filter(race => extractVenueCode(race.id) === venueCode);

    // レースが見つからない場合
    if (venueRaces.length === 0) {
      return await interaction.editReply({
        content: `選択された会場のレース情報が見つかりませんでした。`,
        embeds: [],
        components: []
      });
    }

    // 日付の表示用フォーマット
    const displayDate = `${dateString.slice(0, 4)}年${dateString.slice(4, 6)}月${dateString.slice(6, 8)}日`;

    // 会場名と開催回を取得
    const firstRace = venueRaces[0];
    const venueName = venueCodeMap[venueCode] || cleanVenueName(firstRace.venue);

    // 開催回情報を抽出
    let roundInfo = '';
    const roundMatch = firstRace.venue.match(/([\d]+回.+[\d]+日目)/);
    if (roundMatch) {
      roundInfo = ` (${roundMatch[1]})`;
    }

    // 会場種別（JRAかNARか）
    const venueType = parseInt(venueCode) >= 1 && parseInt(venueCode) <= 10 ? 'JRA' : 'NAR';

    // レース一覧のエンベッド
    const raceListEmbed = new EmbedBuilder()
      .setTitle(`${displayDate} ${venueName}${roundInfo}（${venueType}）レース一覧`)
      .setColor(venueType === 'JRA' ? 0x00b0f4 : 0xf47200)
      .setTimestamp();

    let description = '';

    // レース一覧を整形
    venueRaces.forEach(race => {
      const statusEmoji = getStatusEmoji(race.status);
      description += `${statusEmoji} **${race.number}R** ${race.time} 【${race.name}】\n`;
      description += `→ レースID: \`${race.id}\`\n\n`;
    });

    raceListEmbed.setDescription(description);

    // レース選択メニュー
    const raceSelectRow = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`races_select_race_${dateString}`)
          .setPlaceholder('レースを選択してください')
          .addOptions(
            venueRaces.map(race => ({
              label: `${race.number}R ${race.name.substring(0, 80)}`,
              value: race.id,
              description: `発走時刻: ${race.time}`.substring(0, 100),
              emoji: getStatusEmoji(race.status)
            }))
          )
      );

    // 戻るボタン
    const backRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`races_back_${dateString}`)
          .setLabel('会場一覧に戻る')
          .setStyle(ButtonStyle.Primary)
      );

    // 前日・翌日ボタン
    const prevDate = dayjs(dateString).subtract(1, 'day').format('YYYYMMDD');
    const nextDate = dayjs(dateString).add(1, 'day').format('YYYYMMDD');

    const navigationRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`races_prev_${prevDate}`)
          .setLabel('前日')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`races_next_${nextDate}`)
          .setLabel('翌日')
          .setStyle(ButtonStyle.Secondary)
      );

    // レスポンスを更新
    try {
      await interaction.editReply({
        content: `${displayDate} ${venueName}${roundInfo}（${venueType}）のレース一覧（${venueRaces.length}件）\nレースを選択して馬券を購入できます。`,
        embeds: [raceListEmbed],
        components: [raceSelectRow, backRow, navigationRow]
      });
    } catch (editError) {
      logger.error(`レスポンス更新エラー: ${editError}`);
      // フォールバックとしてフォローアップを試す
      try {
        await interaction.followUp({
          content: `${displayDate} ${venueName}${roundInfo}（${venueType}）のレース一覧（${venueRaces.length}件）\nレースを選択して馬券を購入できます。`,
          embeds: [raceListEmbed],
          components: [raceSelectRow, backRow, navigationRow],
          ephemeral: false
        });
      } catch (followUpError) {
        logger.error(`フォローアップ更新もエラー: ${followUpError}`);
      }
    }
  } catch (error) {
    logger.error(`会場別レース一覧表示中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * レース詳細と馬券購入画面を表示
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {string} raceId - レースID
 * @param {boolean} showBetMenu - 馬券購入メニューを表示するかどうか
 */
async function displayRaceDetail(interaction, raceId, showBetMenu = false) {
  try {
    // レース情報を取得
    const race = await getRaceById(raceId);

    if (!race) {
      return await interaction.editReply({
        content: `レースID ${raceId} の情報が見つかりませんでした。`,
        embeds: [],
        components: []
      });
    }

    // レースステータスチェック
    if (race.status === 'completed') {
      return await interaction.editReply({
        content: `このレースは既に終了しています。結果は \`/result ${raceId}\` で確認できます。`,
        embeds: [],
        components: []
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
      return await interaction.editReply({
        content: `このレースは発走2分前を過ぎているため、馬券を購入できません。`,
        embeds: [],
        components: []
      });
    }

    // レース詳細のエンベッド
    const raceEmbed = new EmbedBuilder()
      .setTitle(`🏇 ${race.venue} ${race.number}R ${race.name}`)
      .setDescription(`発走時刻: ${race.time}\nレースID: ${race.id}`)
      .setColor(race.type === 'jra' ? 0x00b0f4 : 0xf47200)
      .setTimestamp();

    // 出走馬情報
    let horsesInfo = '';
    let horses = race.horses || [];

    // 出走馬情報がない場合
    if (!horses || horses.length === 0) {
      horsesInfo = '出走馬情報を取得できませんでした。';
    } else {
      // 無効なエントリーを除外
      const validHorses = horses.filter(horse =>
        horse.horseNumber > 0 &&
        horse.horseName &&
        horse.horseName !== '番馬' &&
        horse.horseName !== '不明'
      );

      // 馬番でソート
      const sortedHorses = [...validHorses].sort((a, b) => a.horseNumber - b.horseNumber);

      // 適切な見出しを追加
      horsesInfo = `**【出走馬一覧】** (${sortedHorses.length}頭)\n\n`;

      // 各出走馬の情報表示
      sortedHorses.forEach(horse => {
        const horseName = horse.isCanceled ? 
          `~~${horse.frameNumber}枠${horse.horseNumber}番: ${horse.horseName} ${'  ( ' + horse.jockey + ' )'}~~` : 
          `**${horse.frameNumber}枠${horse.horseNumber}番**: ${horse.horseName} ${horse.odds ? '\n' + horse.jockey : '  ( ' + horse.jockey + ' )'}`;
        
        let horseString = `${horseName}  ${horse.odds || ''} ${horse.popularity ? '( ' + horse.popularity + '人気 )' : ''}`;
        horsesInfo += horseString + '\n\n';
      });

      // 長すぎる場合は適切に省略
      if (horsesInfo.length > 1024) {
        horsesInfo = horsesInfo.substring(0, 1000) + '...\n\n(表示しきれない馬がいます)';
      }
    }

    raceEmbed.addFields({ name: '出走馬', value: horsesInfo });

    // コンポーネント配列
    const components = [];

    // 馬券種類選択メニュー（表示する場合のみ）
    if (showBetMenu) {
      const betTypeRow = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`bet_select_type_${raceId}`)
            .setPlaceholder('馬券の種類を選択してください')
            .addOptions([
              { label: '単勝', value: 'tansho', description: '1着になる馬を当てる', emoji: '🥇' },
              { label: '複勝', value: 'fukusho', description: '3着以内に入る馬を当てる', emoji: '🏆' },
              { label: '枠連', value: 'wakuren', description: '1着と2着になる枠を当てる（順不同）', emoji: '🔢' },
              { label: '馬連', value: 'umaren', description: '1着と2着になる馬を当てる（順不同）', emoji: '🐎' },
              { label: 'ワイド', value: 'wide', description: '3着以内に入る2頭の馬を当てる（順不同）', emoji: '📊' },
              { label: '馬単', value: 'umatan', description: '1着と2着になる馬を当てる（順序通り）', emoji: '🎯' },
              { label: '三連複', value: 'sanrenpuku', description: '1着から3着までの馬を当てる（順不同）', emoji: '🔄' },
              { label: '三連単', value: 'sanrentan', description: '1着から3着までの馬を当てる（順序通り）', emoji: '💯' }
            ])
        );
      components.push(betTypeRow);
    }

    // 戻るボタン
    const backRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`races_back_${race.date}`)
          .setLabel('レース一覧に戻る')
          .setStyle(ButtonStyle.Secondary)
      );
    components.push(backRow);

    await interaction.editReply({
      content: showBetMenu ? 
        `レース詳細と馬券購入画面です。馬券を購入するには、まず馬券の種類を選択してください。` : 
        `レース詳細画面です。`,
      embeds: [raceEmbed],
      components: components
    });
  } catch (error) {
    logger.error(`レース詳細表示中にエラーが発生しました: ${error}`);
    await interaction.editReply({ content: '詳細の取得中にエラーが発生しました。' });
  }
}

/**
 * レースのステータスに応じた絵文字を取得
 * @param {string} status - レースステータス
 * @returns {string} 対応する絵文字
 */
function getStatusEmoji(status) {
  switch (status) {
    case 'upcoming':
      return '⏳';
    case 'in_progress':
      return '🏇';
    case 'completed':
      return '✅';
    default:
      return '❓';
  }
}