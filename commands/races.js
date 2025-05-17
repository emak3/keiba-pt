import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { getRacesByDate } from '../services/database/raceService.js';
import { saveUser } from '../services/database/userService.js';
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
  '61': '中京(地方競馬)'
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
        // 会場コードが1-10ならJRA、それ以外はNAR
        if (parseInt(venueCode) >= 1 && parseInt(venueCode) <= 10) {
          jraVenues.push({
            code: venueCode,
            name: venueCodeMap[venueCode] || firstRace.venue,
            type: 'JRA'
          });
        } else {
          narVenues.push({
            code: venueCode,
            name: venueCodeMap[venueCode] || firstRace.venue,
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
        content: `${displayDate}のレース一覧（${races.length}件）\n各レースの馬券購入は \`/bet\` コマンドで行えます。`,
        embeds: [venueListEmbed],
        components: [selectRow, navigationRow]
      });
      
      // インタラクションの処理
      const filter = i => 
        i.customId.startsWith('races_prev_') || 
        i.customId.startsWith('races_next_') ||
        i.customId.startsWith('races_select_venue_') ||
        i.customId.startsWith('races_back_');
      
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
          await i.reply({ content: 'このメニューは他のユーザーのコマンド結果用です。自分で `/races` コマンドを実行してください。', ephemeral: true });
          return;
        }
        
        try {
          if (i.customId.startsWith('races_prev_') || i.customId.startsWith('races_next_')) {
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
              editReply: (options) => i.editReply(options)
            };
            
            await command.execute(newInteraction);
          }
          else if (i.customId.startsWith('races_select_venue_')) {
            // 会場選択の処理
            const [venueCode, date] = i.values[0].split('_');
            history.previousStates.push({
              date: history.currentDate,
              venue: null // 全体表示に戻る
            });
            
            await i.deferUpdate();
            
            // 選択された会場のレースを表示
            await displayVenueRaces(i, venueCode, date, history, races);
          }
          else if (i.customId.startsWith('races_back_')) {
            // 戻るボタンの処理
            if (history.previousStates.length > 0) {
              const previousState = history.previousStates.pop();
              await i.deferUpdate();
              
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
                  editReply: (options) => i.editReply(options)
                };
                
                await command.execute(newInteraction);
              }
            } else {
              // 履歴がない場合は何もしない
              await i.update({ content: '前の画面に戻れません。' });
            }
          }
        } catch (error) {
          logger.error(`レース一覧インタラクション処理中にエラーが発生しました: ${error}`);
          await i.editReply({ content: 'エラーが発生しました。もう一度お試しください。' });
        }
      });
      
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
  
  // 会場名を取得
  const venueName = venueCodeMap[venueCode] || venueRaces[0].venue;
  
  // 会場種別（JRAかNARか）
  const venueType = parseInt(venueCode) >= 1 && parseInt(venueCode) <= 10 ? 'JRA' : 'NAR';
  
  // レース一覧のエンベッド
  const raceListEmbed = new EmbedBuilder()
    .setTitle(`${displayDate} ${venueName}（${venueType}）レース一覧`)
    .setColor(venueType === 'JRA' ? 0x00b0f4 : 0xf47200)
    .setTimestamp();
  
  let description = '';
  
  // レース一覧を整形
  venueRaces.forEach(race => {
    const statusEmoji = getStatusEmoji(race.status);
    const raceLink = race.link || '詳細情報なし';
    description += `${statusEmoji} **${race.number}R** ${race.time} 【${race.name}】\n`;
    description += `→ レースID: \`${race.id}\`\n\n`;
  });
  
  raceListEmbed.setDescription(description);
  
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
    content: `${displayDate} ${venueName}（${venueType}）のレース一覧（${venueRaces.length}件）\n各レースの馬券購入は \`/bet\` コマンドで行えます。`,
    embeds: [raceListEmbed],
    components: [backRow, navigationRow]
  });
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