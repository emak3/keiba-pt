import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getRacesByDate, getRaceById } from '../services/database/raceService.js';
import { saveUser, getUser } from '../services/database/userService.js';
import { placeBet } from '../services/database/betService.js';
import dayjs from 'dayjs';
import logger from '../utils/logger.js';

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
        i.customId.startsWith('bet_select_type_') ||
        i.customId.startsWith('bet_select_method_') ||
        i.customId.startsWith('bet_select_horses_') ||
        i.customId.startsWith('bet_confirm_') ||
        i.customId.startsWith('bet_cancel_');

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
        if (i.user.id !== interaction.user.id) {
          try {
            await i.reply({ content: 'このメニューは他のユーザーのコマンド結果用です。自分で `/races` コマンドを実行してください。', ephemeral: true });
          } catch (replyError) {
            logger.error(`他ユーザーへの警告メッセージ送信エラー: ${replyError}`);
          }
          return;
        }

        try {
          // 日付移動ボタン
          if (i.customId.startsWith('races_prev_') || i.customId.startsWith('races_next_')) {
            try {
              // 日付移動の処理
              const newDate = i.customId.split('_')[2];
              history.previousStates.push({
                date: history.currentDate,
                venue: null // 全体表示に戻る
              });
              history.currentDate = newDate;

              // 新しい日付でコマンドを再実行
              await i.update({ content: '読み込み中...', embeds: [], components: [] });

              const command = interaction.client.commands.get('races');
              const newInteraction = {
                ...interaction,
                options: {
                  getString: () => newDate
                },
                editReply: async (options) => {
                  try {
                    return await i.editReply(options);
                  } catch (editError) {
                    logger.error(`編集エラー: ${editError}`);
                    // フォールバック
                    try {
                      return await i.followUp({ ...options, ephemeral: false });
                    } catch (followupError) {
                      logger.error(`フォローアップエラー: ${followupError}`);
                    }
                  }
                }
              };

              await command.execute(newInteraction);
            } catch (error) {
              logger.error(`日付移動処理エラー: ${error}`);
              handleInteractionError(i, error);
            }
          }
          // 会場選択
          else if (i.customId.startsWith('races_select_venue_')) {
            try {
              // 会場選択の処理
              const [venueCode, date] = i.values[0].split('_');
              history.previousStates.push({
                date: history.currentDate,
                venue: null // 全体表示に戻る
              });

              // Discordの応答遅延を設定
              try {
                await i.deferUpdate();
              } catch (deferError) {
                logger.error(`deferUpdate エラー: ${deferError}`);
                // 既に応答済みの場合は続行
              }

              // 選択された会場のレースを表示
              await displayVenueRaces(i, venueCode, date, history, races);
            } catch (error) {
              logger.error(`会場選択処理エラー: ${error}`);
              handleInteractionError(i, error);
            }
          }
          // 戻るボタン
          else if (i.customId.startsWith('races_back_')) {
            try {
              // 戻るボタンの処理
              if (history.previousStates.length > 0) {
                const previousState = history.previousStates.pop();

                // Discordの応答遅延を設定
                try {
                  await i.deferUpdate();
                } catch (deferError) {
                  logger.error(`deferUpdate エラー: ${deferError}`);
                  // 既に応答済みの場合は続行
                }

                if (previousState.venue) {
                  // 特定の会場に戻る
                  await displayVenueRaces(i, previousState.venue, previousState.date, history, races);
                } else {
                  // 会場一覧に戻る
                  const command = interaction.client.commands.get('races');
                  const newInteraction = {
                    ...interaction,
                    options: {
                      getString: () => previousState.date
                    },
                    editReply: async (options) => {
                      try {
                        return await i.editReply(options);
                      } catch (editError) {
                        logger.error(`編集エラー: ${editError}`);
                        // フォールバック
                        try {
                          return await i.followUp({ ...options, ephemeral: false });
                        } catch (followupError) {
                          logger.error(`フォローアップエラー: ${followupError}`);
                        }
                      }
                    }
                  };

                  await command.execute(newInteraction);
                }
              } else {
                // 履歴がない場合は何もしない
                await i.update({ content: '前の画面に戻れません。' });
              }
            } catch (error) {
              logger.error(`戻るボタン処理エラー: ${error}`);
              handleInteractionError(i, error);
            }
          }
          // レース選択
          else if (i.customId.startsWith('races_select_race_')) {
            try {
              // Discordの応答遅延を設定
              try {
                await i.deferUpdate();
              } catch (deferError) {
                logger.error(`deferUpdate エラー: ${deferError}`);
                // 既に応答済みの場合は続行
              }

              const raceId = i.values[0];
              await displayRaceDetail(i, raceId, targetDate, history);
            } catch (error) {
              logger.error(`レース選択処理エラー: ${error}`);
              handleInteractionError(i, error);
            }
          }
          // 馬券タイプ選択
          else if (i.customId.startsWith('bet_select_type_')) {
            try {
              // Discordの応答遅延を設定
              try {
                await i.deferUpdate();
              } catch (deferError) {
                logger.error(`deferUpdate エラー: ${deferError}`);
                // 既に応答済みの場合は続行
              }

              const [_, __, ___, raceId] = i.customId.split('_');
              const betType = i.values[0];
              await displayBetMethodSelection(i, raceId, betType);
            } catch (error) {
              logger.error(`馬券タイプ選択処理エラー: ${error}`);
              handleInteractionError(i, error);
            }
          }
          // その他のインタラクション処理...
          // (略)
        } catch (error) {
          logger.error(`インタラクション処理全体でのエラー: ${error}`);
          handleInteractionError(i, error);
        }
      });

      async function handleInteractionError(interaction, error) {
        try {
          // インタラクションの状態に応じて適切な方法でエラーメッセージを表示
          if (interaction.deferred || interaction.replied) {
            // 既に応答済みの場合はフォローアップ
            await interaction.followUp({
              content: 'エラーが発生しました。もう一度操作をお試しください。',
              ephemeral: true
            });
          } else {
            // 未応答の場合は応答
            await interaction.reply({
              content: 'エラーが発生しました。もう一度操作をお試しください。',
              ephemeral: true
            });
          }
        } catch (responseError) {
          logger.error(`エラー通知中の二次エラー: ${responseError}`);
          // これ以上何もできない
        }
      }
      collector.on('end', () => {
        // コレクターの終了時に行う処理（オプション）
      });

    } catch (error) {
      logger.error(`レース一覧表示中にエラーが発生しました: ${error}`);
      await interaction.editReply({ content: 'レース情報の取得中にエラーが発生しました。しばらく経ってからもう一度お試しください。' });
    }
  }
};

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
 * @param {Object} history - ナビゲーション履歴
 * @param {Array} allRaces - すべてのレース一覧（既に取得済み）
 */
async function displayVenueRaces(interaction, venueCode, dateString, history, allRaces) {
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
            label: `${race.number}R ${race.name}`,
            value: race.id,
            description: `発走時刻: ${race.time}`,
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
  await interaction.editReply({
    content: `${displayDate} ${venueName}${roundInfo}（${venueType}）のレース一覧（${venueRaces.length}件）\nレースを選択して馬券を購入できます。`,
    embeds: [raceListEmbed],
    components: [raceSelectRow, backRow, navigationRow]
  });
}

/**
 * レース詳細表示時に出走馬情報を取得
 * @param {string} raceId - レースID
 * @returns {Promise<Array>} 出走馬情報の配列
 */
async function fetchHorsesForRace(raceId) {
  try {
    logger.info(`レース ${raceId} の出走馬情報を取得します`);
    
    // レース種別を判定（最初の3桁が202なら中央、203なら地方）
    const raceType = raceId.substring(0, 3) === '202' ? 'jra' : 'nar';
    
    // オッズ情報を強制的に取得するためのフラグ
    const forceOddsRefresh = true;
    
    // 既存のレース情報を取得
    const existingRace = await getRaceById(raceId);
    const hasExistingHorses = existingRace && existingRace.horses && existingRace.horses.length > 0;
    
    // 馬情報の過去のオッズデータを保持
    let existingOddsMap = new Map();
    if (hasExistingHorses) {
      existingRace.horses.forEach(horse => {
        if (horse.horseNumber > 0 && horse.odds && horse.odds > 0) {
          existingOddsMap.set(horse.horseNumber, {
            odds: horse.odds,
            popularity: horse.popularity
          });
        }
      });
    }
    
    // スクレイピング用のURLを構築
    const baseUrl = raceType === 'jra' 
      ? 'https://race.netkeiba.com/race/shutuba.html?race_id=' 
      : 'https://nar.netkeiba.com/race/shutuba.html?race_id=';
    
    const url = `${baseUrl}${raceId}`;
    logger.info(`スクレイピングURL: ${url}`);
    
    // 出走馬情報の取得
    let horses = [];
    let oddsRefreshed = false;
    
    try {
      // 種別に応じたスクレイピング関数を呼び出し
      if (raceType === 'jra') {
        // JRAの出走馬情報取得のためにモジュールをインポート
        const { fetchJraHorsesEnhanced } = await import('../services/scraper/enhancedScraper.js');
        horses = await fetchJraHorsesEnhanced(raceId);
        
        // オッズ情報が取得できなかった場合、既存データと結合
        if (horses && horses.length > 0) {
          const hasOdds = horses.some(h => h.odds && h.odds > 0);
          if (!hasOdds && existingOddsMap.size > 0) {
            horses = horses.map(horse => {
              if (horse.horseNumber > 0 && existingOddsMap.has(horse.horseNumber)) {
                const oddsData = existingOddsMap.get(horse.horseNumber);
                return {
                  ...horse,
                  odds: oddsData.odds,
                  popularity: oddsData.popularity
                };
              }
              return horse;
            });
          } else if (hasOdds) {
            oddsRefreshed = true;
          }
        }
        
        // オッズページから追加情報を取得（オプション）
        if (forceOddsRefresh && !oddsRefreshed) {
          try {
            const { fetchJraOddsEnhanced } = await import('../services/scraper/enhancedScraper.js');
            const oddsData = await fetchJraOddsEnhanced(raceId);
            
            if (oddsData && oddsData.length > 0) {
              // 馬番ごとのマップを作成
              const oddsMap = new Map();
              oddsData.forEach(item => {
                oddsMap.set(item.horseNumber, item);
              });
              
              // オッズ情報を統合
              horses = horses.map(horse => {
                if (horse.horseNumber > 0 && oddsMap.has(horse.horseNumber)) {
                  const oddsItem = oddsMap.get(horse.horseNumber);
                  return {
                    ...horse,
                    odds: oddsItem.odds || horse.odds,
                    popularity: oddsItem.popularity || horse.popularity
                  };
                }
                return horse;
              });
              
              oddsRefreshed = true;
            }
          } catch (oddsError) {
            logger.error(`オッズ情報の取得中にエラーが発生しました: ${oddsError}`);
          }
        }
      } else {
        // NARの出走馬情報取得のためにモジュールをインポート
        const { fetchNarHorsesEnhanced } = await import('../services/scraper/enhancedScraper.js');
        horses = await fetchNarHorsesEnhanced(raceId);
        
        // オッズ情報が取得できなかった場合、既存データと結合
        if (horses && horses.length > 0) {
          const hasOdds = horses.some(h => h.odds && h.odds > 0);
          if (!hasOdds && existingOddsMap.size > 0) {
            horses = horses.map(horse => {
              if (horse.horseNumber > 0 && existingOddsMap.has(horse.horseNumber)) {
                const oddsData = existingOddsMap.get(horse.horseNumber);
                return {
                  ...horse,
                  odds: oddsData.odds,
                  popularity: oddsData.popularity
                };
              }
              return horse;
            });
          } else if (hasOdds) {
            oddsRefreshed = true;
          }
        }
        
        // NAR用のオッズページから追加情報を取得（オプション）
        if (forceOddsRefresh && !oddsRefreshed) {
          try {
            const { fetchNarOddsEnhanced } = await import('../services/scraper/enhancedScraper.js');
            const oddsData = await fetchNarOddsEnhanced(raceId);
            
            if (oddsData && oddsData.length > 0) {
              // 馬番ごとのマップを作成
              const oddsMap = new Map();
              oddsData.forEach(item => {
                oddsMap.set(item.horseNumber, item);
              });
              
              // オッズ情報を統合
              horses = horses.map(horse => {
                if (horse.horseNumber > 0 && oddsMap.has(horse.horseNumber)) {
                  const oddsItem = oddsMap.get(horse.horseNumber);
                  return {
                    ...horse,
                    odds: oddsItem.odds || horse.odds,
                    popularity: oddsItem.popularity || horse.popularity
                  };
                }
                return horse;
              });
              
              oddsRefreshed = true;
            }
          } catch (oddsError) {
            logger.error(`NARオッズ情報の取得中にエラーが発生しました: ${oddsError}`);
          }
        }
      }
      
      // 無効なエントリーをフィルタリング
      if (horses && horses.length > 0) {
        horses = horses.filter(horse => 
          horse.horseNumber > 0 && 
          horse.horseName && 
          horse.horseName !== '番馬' && 
          horse.horseName !== '不明'
        );
        
        // 出走馬情報の妥当性をチェック
        const maxHorseNumber = Math.max(...horses.map(h => h.horseNumber));
        
        // 馬番が上限を超えるエントリを除外
        if (maxHorseNumber > 0) {
          const raceEntries = horses.filter(h => h.horseNumber <= maxHorseNumber);
          
          // 本当に出走する馬だけを保持
          if (raceEntries.length < horses.length) {
            logger.info(`レース ${raceId} の出走馬情報を整理しました: ${horses.length}頭 → ${raceEntries.length}頭`);
            horses = raceEntries;
          }
        }
      }
      
      // 結果をログに出力
      if (horses && horses.length > 0) {
        logger.info(`レース ${raceId} から ${horses.length}頭の出走馬情報を取得しました`);
        
        // 情報欠落チェック
        const missingOdds = horses.filter(h => !h.odds || h.odds === 0).length;
        const missingJockey = horses.filter(h => !h.jockey || h.jockey === '騎手不明').length;
        
        if (missingOdds > 0 || missingJockey > 0) {
          logger.warn(`情報欠落: オッズなし=${missingOdds}頭, 騎手情報なし=${missingJockey}頭`);
        }
      } else {
        logger.warn(`レース ${raceId} の出走馬情報が取得できませんでした`);
      }
      
      // レース情報を更新
      if (horses && horses.length > 0) {
        const { saveJraRace, saveNarRace } = await import('../services/database/raceService.js');
        
        if (raceType === 'jra') {
          await saveJraRace({
            id: raceId,
            horses: horses,
            type: 'jra'
          });
        } else {
          await saveNarRace({
            id: raceId,
            horses: horses,
            type: 'nar'
          });
        }
        
        logger.info(`レース ${raceId} の出走馬情報をデータベースに保存しました`);
      }
    } catch (scrapingError) {
      logger.error(`出走馬情報のスクレイピング中にエラーが発生しました: ${scrapingError}`);
    }
    
    return horses;
  } catch (error) {
    logger.error(`出走馬情報取得中にエラーが発生しました: ${error}`);
    return [];
  }
}

/**
 * レース詳細と馬券購入画面を表示
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {string} raceId - レースID
 * @param {string} dateString - 日付
 * @param {Object} history - ナビゲーション履歴
 */
async function displayRaceDetail(interaction, raceId, dateString, history) {
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
    
    // 出走馬情報がない場合は取得を試みる
    if (!horses || horses.length === 0) {
      await interaction.editReply({
        content: `レース情報を取得中です...`,
        embeds: [],
        components: []
      });
      
      // 出走馬情報を取得
      horses = await fetchHorsesForRace(raceId);
      
      // レース情報を再取得（horses情報が更新されているはず）
      if (horses && horses.length > 0) {
        const updatedRace = await getRaceById(raceId);
        if (updatedRace && updatedRace.horses && updatedRace.horses.length > 0) {
          race.horses = updatedRace.horses;
          horses = updatedRace.horses;
        } else {
          race.horses = horses;
        }
      }
    }
    
    if (horses && horses.length > 0) {
      // 無効なエントリーを除外
      const validHorses = horses.filter(horse => 
        horse.horseNumber > 0 && 
        horse.horseName && 
        horse.horseName !== '番馬' && 
        horse.horseName !== '不明' &&
        horse.jockey
      );
      
      // 馬番が最大値を超えているエントリを除外
      const maxHorseNumber = Math.max(...validHorses.map(h => h.horseNumber));
      const filteredHorses = validHorses.filter(h => h.horseNumber <= maxHorseNumber);
      
      // 適切な見出しを追加
      horsesInfo = `**【出走馬一覧】** (${filteredHorses.length}頭)\n\n`;
      
      // 馬番でソート
      const sortedHorses = [...filteredHorses].sort((a, b) => a.horseNumber - b.horseNumber);
      
      // 表示を改善
      sortedHorses.forEach(horse => {
        let horseString = `**${horse.horseNumber}番**: ${horse.horseName}\n`;
        horseString += `　騎手: ${horse.jockey || '不明'}\n`;
        
        // オッズ情報を表示（情報があれば）
        if (horse.odds && horse.odds > 0) {
          horseString += `　オッズ: ${horse.odds}倍`;
          if (horse.popularity && horse.popularity > 0) {
            horseString += ` (人気: ${horse.popularity})`;
          }
        } else {
          // オッズがない場合は枠番を表示
          horseString += `　枠番: ${horse.frameNumber || '不明'}`;
        }
        
        horsesInfo += horseString + '\n\n';
      });
      
      // 長すぎる場合は適切に省略
      if (horsesInfo.length > 1024) {
        // 表示限界に合わせて適切に切り詰める
        horsesInfo = horsesInfo.substring(0, 1000) + '...\n\n(表示しきれない馬がいます)';
      }
    } else {
      horsesInfo = '出走馬情報を取得できませんでした。';
    }
    
    raceEmbed.addFields({ name: '出走馬', value: horsesInfo });
    
    // 馬券種類選択メニュー
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
    
    // 戻るボタン
    const backRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`races_back_${dateString}`)
          .setLabel('レース一覧に戻る')
          .setStyle(ButtonStyle.Secondary)
      );
    
    await interaction.editReply({
      content: `レース詳細と馬券購入画面です。馬券を購入するには、まず馬券の種類を選択してください。`,
      embeds: [raceEmbed],
      components: [betTypeRow, backRow]
    });
    
  } catch (error) {
    logger.error(`レース詳細表示中にエラーが発生しました: ${error}`);
    await interaction.editReply({ content: '詳細の取得中にエラーが発生しました。' });
  }
}

/**
 * 馬券購入方法の選択画面を表示
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ
 */
async function displayBetMethodSelection(interaction, raceId, betType) {
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

    // 馬券購入方法選択メニュー
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

    // 戻るボタン（レース詳細に戻る）
    const backRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`races_back_${race.date}`)
          .setLabel('レース詳細に戻る')
          .setStyle(ButtonStyle.Secondary)
      );

    // レース詳細のエンベッド（簡易版）
    const raceEmbed = new EmbedBuilder()
      .setTitle(`🏇 ${race.venue} ${race.number}R ${race.name}`)
      .setDescription(`**${betTypeNames[betType]}**の購入方法を選択してください。`)
      .setColor(race.type === 'jra' ? 0x00b0f4 : 0xf47200)
      .setTimestamp()
      .addFields(
        { name: '発走時刻', value: race.time },
        { name: 'レースID', value: race.id }
      );

    await interaction.editReply({
      content: `${betTypeNames[betType]}の購入方法を選択してください。`,
      embeds: [raceEmbed],
      components: [methodRow, backRow]
    });

  } catch (error) {
    logger.error(`馬券購入方法選択中にエラーが発生しました: ${error}`);
    await interaction.editReply({ content: '馬券購入方法の選択中にエラーが発生しました。' });
  }
}

/**
 * 馬選択画面を表示
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 */
async function displayHorseSelection(interaction, raceId, betType, method) {
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
    
    // 馬券タイプに応じた最大選択数を取得
    const maxSelections = getMaxSelectionsForBet(betType, method);
    
    // 出走馬情報がない場合は取得
    let horses = race.horses && race.horses.length > 0 ? race.horses : [];
    
    if (!horses || horses.length === 0) {
      await interaction.editReply({
        content: `出走馬情報を取得中...`,
        embeds: [],
        components: []
      });
      
      // 出走馬情報を取得
      horses = await fetchHorsesForRace(raceId);
      
      if (!horses || horses.length === 0) {
        // ダミーデータ
        horses = [];
        for (let i = 1; i <= 16; i++) {
          horses.push({
            horseNumber: i,
            horseName: `${i}番の馬`,
            jockey: '騎手情報なし',
            odds: 0,
            popularity: 0
          });
        }
      }
    }
    
    // 無効なエントリーをフィルタリング
    const validHorses = horses.filter(horse => 
      horse.horseNumber > 0 && 
      horse.horseName && 
      horse.horseName !== '番馬' && 
      horse.horseName !== '不明'
    );
    
    // 馬番が最大値を超えているエントリを除外（例：16頭立てなのに17,18があるケース）
    const maxHorseNumber = Math.max(...validHorses.map(h => h.horseNumber));
    const filteredHorses = validHorses.filter(h => h.horseNumber <= maxHorseNumber);
    
    // 出走馬の選択肢を作成
    const horseOptions = [];
    
    // 出走馬情報に基づいてオプションを作成
    filteredHorses.sort((a, b) => a.horseNumber - b.horseNumber);
    
    filteredHorses.forEach(horse => {
      let description = `騎手: ${horse.jockey || '情報なし'}`;
      
      // オッズ情報があれば表示
      if (horse.odds && horse.odds > 0) {
        description += ` / オッズ: ${horse.odds}倍`;
        if (horse.popularity && horse.popularity > 0) {
          description += ` (${horse.popularity}人気)`;
        }
      }
      
      horseOptions.push({
        label: `${horse.horseNumber}番: ${horse.horseName}`,
        description: description,
        value: `${horse.horseNumber}`
      });
    });
    
    // 馬選択メニュー
    const horseSelectRow = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`bet_select_horses_${raceId}_${betType}_${method}`)
          .setPlaceholder('馬番を選択してください')
          .setMinValues(method === 'formation' ? 1 : getMinSelectionsForBet(betType))
          .setMaxValues(maxSelections)
          .addOptions(horseOptions)
      );
    
    // 戻るボタン
    const backRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`races_back_${race.date}`)
          .setLabel('購入方法選択に戻る')
          .setStyle(ButtonStyle.Secondary)
      );
    
    // 馬券選択のエンベッド
    const betEmbed = new EmbedBuilder()
      .setTitle(`🏇 馬券購入 - ${race.venue} ${race.number}R ${race.name}`)
      .setDescription(`**${betTypeNames[betType]}**（${methodNames[method]}）の馬券を購入します。`)
      .setColor(0x00b0f4)
      .setTimestamp();
    
    // 馬券タイプごとの説明
    let explanation = '';
    
    switch (betType) {
      case 'tansho':
        explanation = '「単勝」は、1着になる馬を当てる馬券です。1頭を選択してください。';
        break;
      case 'fukusho':
        explanation = '「複勝」は、3着以内に入る馬を当てる馬券です。1頭を選択してください。';
        break;
      case 'wakuren':
        explanation = '「枠連」は、1着と2着になる枠を当てる馬券です。2つの枠を選択してください（順不同）。';
        break;
      case 'umaren':
        explanation = '「馬連」は、1着と2着になる馬を当てる馬券です。2頭を選択してください（順不同）。';
        break;
      case 'wide':
        explanation = '「ワイド」は、3着以内に入る2頭の馬を当てる馬券です。2頭を選択してください（順不同）。';
        break;
      case 'umatan':
        explanation = '「馬単」は、1着と2着になる馬を順序通りに当てる馬券です。2頭を選択してください（1番目=1着、2番目=2着）。';
        break;
      case 'sanrenpuku':
        explanation = '「三連複」は、1着から3着までの馬を当てる馬券です。3頭を選択してください（順不同）。';
        break;
      case 'sanrentan':
        explanation = '「三連単」は、1着から3着までの馬を順序通りに当てる馬券です。3頭を選択してください（1番目=1着、2番目=2着、3番目=3着）。';
        break;
    }
    
    // 購入方法ごとの追加説明
    if (method === 'box') {
      explanation += '\n\n「ボックス」購入では、選択した馬の全ての組み合わせを購入します。';
    } else if (method === 'formation') {
      if (betType === 'umatan' || betType === 'sanrentan') {
        explanation += '\n\n「フォーメーション」購入では、各着順に複数の馬を指定できます。画面の指示に従って馬を選択してください。';
      } else {
        explanation += '\n\n「フォーメーション」購入では、複数の馬を選択して組み合わせを購入します。';
      }
    }
    
    if (method === 'formation' && (betType === 'umatan' || betType === 'sanrentan')) {
      // フォーメーション特殊処理（次の画面でさらに詳細設定）
      explanation += '\n\n次の画面で1着、2着、3着（三連単の場合）の馬を指定します。この画面では対象となる全ての馬を選択してください。';
    }
    
    betEmbed.addFields(
      { name: '馬券の説明', value: explanation },
      { name: '選択数', value: `最低${getMinSelectionsForBet(betType)}頭、最大${maxSelections}頭まで選択できます。` }
    );
    
    await interaction.editReply({
      content: `${betTypeNames[betType]}（${methodNames[method]}）の馬券購入で、馬を選択してください。`,
      embeds: [betEmbed],
      components: [horseSelectRow, backRow]
    });
    
  } catch (error) {
    logger.error(`馬選択画面表示中にエラーが発生しました: ${error}`);
    await interaction.editReply({ content: '馬選択画面の表示中にエラーが発生しました。' });
  }
}

/**
 * 馬券金額入力画面を表示
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 * @param {Array<number>} selectedHorses - 選択された馬番
 */
async function displayBetAmountInput(interaction, raceId, betType, method, selectedHorses) {
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

    // ユーザー情報を取得
    const user = await getUser(interaction.user.id);

    if (!user) {
      return await interaction.editReply({
        content: `ユーザー情報の取得に失敗しました。`,
        embeds: [],
        components: []
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

    try {
      // 金額入力用モーダル
      const modal = new ModalBuilder()
        .setCustomId(`bet_confirm_${raceId}_${betType}_${method}`)
        .setTitle(`馬券購入 - ${betTypeNames[betType]}（${methodNames[method]}）`);

      // 金額入力フィールド
      const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('購入金額（100pt単位）')
        .setPlaceholder('例: 100')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(5);

      // 選択馬番（非表示）
      const horsesInput = new TextInputBuilder()
        .setCustomId('selected_horses')
        .setLabel('選択した馬番')
        .setValue(selectedHorses.join(','))
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      // 行の追加
      const amountRow = new ActionRowBuilder().addComponents(amountInput);
      const horsesRow = new ActionRowBuilder().addComponents(horsesInput);

      modal.addComponents(amountRow, horsesRow);

      // モーダルを表示
      await interaction.showModal(modal);
    } catch (modalError) {
      logger.error(`モーダル表示中にエラーが発生しました: ${modalError}`);
      if (!interaction.replied) {
        await interaction.editReply({
          content: '購入金額入力画面の表示中にエラーが発生しました。もう一度お試しください。',
          components: []
        });
      }
    }

  } catch (error) {
    logger.error(`馬券金額入力画面表示中にエラーが発生しました: ${error}`);
    if (!interaction.replied) {
      await interaction.editReply({
        content: '馬券金額入力画面の表示中にエラーが発生しました。もう一度お試しください。',
        components: []
      });
    } else {
      try {
        await interaction.followUp({
          content: '馬券金額入力画面の表示中にエラーが発生しました。もう一度お試しください。',
          ephemeral: true
        });
      } catch (followUpError) {
        logger.error(`フォローアップメッセージ送信中にエラーが発生しました: ${followUpError}`);
      }
    }
  }
}

/**
 * 馬券を購入する
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 * @param {Array<number>} selectedHorses - 選択された馬番
 * @param {number} amount - 購入金額
 */
async function processBetPurchase(interaction, raceId, betType, method, selectedHorses, amount) {
  try {
    // レース情報を取得
    const race = await getRaceById(raceId);

    if (!race) {
      return await interaction.followUp({
        content: `レースID ${raceId} の情報が見つかりませんでした。`,
        ephemeral: true
      });
    }

    // ユーザー情報を取得
    const user = await getUser(interaction.user.id);

    if (!user) {
      return await interaction.followUp({
        content: `ユーザー情報の取得に失敗しました。`,
        ephemeral: true
      });
    }

    // ポイントチェック
    if (amount > user.points) {
      return await interaction.followUp({
        content: `ポイントが不足しています。現在のポイント: ${user.points}pt`,
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

    // 購入処理
    // 馬券タイプに応じた選択形式の変換
    let selections = selectedHorses;

    // 順序ありの馬券（馬単・三連単）の場合は2次元配列に変換
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
    } else if (method === 'formation') {
      // フォーメーションの場合は設定に応じて処理
      // （シンプル実装のため、ここではすべての馬を各着順に設定）
      if (betType === 'umatan') {
        // 馬単フォーメーションの例：選択した全馬から2頭を選ぶ
        selections = [
          selectedHorses, // 1着の候補
          selectedHorses  // 2着の候補
        ];
      } else if (betType === 'sanrentan') {
        // 三連単フォーメーションの例：選択した全馬から3頭を選ぶ
        selections = [
          selectedHorses, // 1着の候補
          selectedHorses, // 2着の候補
          selectedHorses  // 3着の候補
        ];
      }
    }

    // 馬券購入
    const bet = await placeBet(
      interaction.user.id,
      raceId,
      betType,
      selections,
      method,
      amount
    );

    // 選択馬表示
    let selectionsDisplay = '';
    if (method === 'normal' && (betType === 'umatan' || betType === 'sanrentan')) {
      // 順序あり馬券（馬単・三連単）
      if (betType === 'umatan') {
        selectionsDisplay = `${selectedHorses[0]}→${selectedHorses[1]}`;
      } else {
        selectionsDisplay = `${selectedHorses[0]}→${selectedHorses[1]}→${selectedHorses[2]}`;
      }
    } else if (method === 'formation') {
      // フォーメーション
      if (betType === 'umatan' || betType === 'sanrentan') {
        selectionsDisplay = `全ての組合せ (${selectedHorses.join(',')})`;
      } else {
        selectionsDisplay = selectedHorses.join(',');
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

    // レース詳細に戻るボタン
    const backToRaceRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`races_select_race_${race.date}_${raceId}`)
          .setLabel('レース詳細に戻る')
          .setStyle(ButtonStyle.Primary)
      );

    try {
      // 既に応答済みかどうかをチェック
      if (interaction.replied) {
        await interaction.editReply({
          content: `馬券の購入が完了しました！`,
          embeds: [resultEmbed],
          components: [backToRaceRow]
        });
      } else {
        await interaction.update({
          content: `馬券の購入が完了しました！`,
          embeds: [resultEmbed],
          components: [backToRaceRow]
        });
      }
    } catch (replyError) {
      logger.error(`購入完了メッセージの送信中にエラーが発生しました: ${replyError}`);
      try {
        // フォローアップメッセージで対応
        await interaction.followUp({
          content: `馬券の購入が完了しました！`,
          embeds: [resultEmbed],
          components: [backToRaceRow],
          ephemeral: false
        });
      } catch (followupError) {
        logger.error(`フォローアップメッセージの送信中にエラーが発生しました: ${followupError}`);
      }
    }
  } catch (error) {
    logger.error(`馬券購入処理中にエラーが発生しました: ${error}`);
    try {
      if (interaction.replied) {
        await interaction.followUp({
          content: `馬券購入中にエラーが発生しました: ${error.message}`,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: `馬券購入中にエラーが発生しました: ${error.message}`,
          ephemeral: true
        });
      }
    } catch (replyError) {
      logger.error(`エラーメッセージの送信中にエラーが発生しました: ${replyError}`);
    }
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
  } else if (method === 'formation') {
    // フォーメーション購入の場合
    if (betType === 'tansho' || betType === 'fukusho') {
      return 1; // フォーメーション購入できないが、エラー回避のため
    } else if (betType === 'wakuren' || betType === 'umaren' || betType === 'wide' || betType === 'umatan') {
      return 10; // 二連系は最大10頭まで
    } else {
      return 10; // 三連系は最大10頭まで
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