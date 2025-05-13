// src/bot/commands/race.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const raceService = require('../../services/raceService');
const logger = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('race')
    .setDescription('レース情報を表示します')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('開催レース一覧を表示します')
        .addStringOption(option =>
          option.setName('type')
            .setDescription('レースタイプ')
            .setRequired(false)
            .addChoices(
              { name: 'JRA', value: 'JRA' },
              { name: '地方競馬', value: 'NAR' },
              { name: '全て', value: 'ALL' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('detail')
        .setDescription('レース詳細を表示します')
        .addStringOption(option =>
          option.setName('id')
            .setDescription('レースID')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('result')
        .setDescription('レース結果を表示します')
        .addStringOption(option =>
          option.setName('id')
            .setDescription('レースID')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    try {
      switch (subcommand) {
        case 'list':
          await handleRaceList(interaction);
          break;
        case 'detail':
          await handleRaceDetail(interaction);
          break;
        case 'result':
          await handleRaceResult(interaction);
          break;
        default:
          await interaction.reply({ content: '無効なサブコマンドです', ephemeral: true });
      }
    } catch (error) {
      logger.error(`レースコマンド実行中にエラーが発生しました: ${error.message}`, error);
      await interaction.reply({ content: `エラーが発生しました: ${error.message}`, ephemeral: true });
    }
  }
};

/**
 * レース一覧を表示する
 * @param {CommandInteraction} interaction - インタラクション
 */
async function handleRaceList(interaction) {
  // 処理中の通知
  await interaction.deferReply();
  
  try {
    // レースタイプのオプション
    const typeOption = interaction.options.getString('type') || 'ALL';
    const type = typeOption === 'ALL' ? null : typeOption;
    
    // 当日のレース一覧を取得
    const races = await raceService.getRacesByDate(new Date(), type);
    
    if (races.length === 0) {
      await interaction.editReply('本日の開催レースはありません');
      return;
    }
    
    // 開催場所ごとにグループ化
    const racesByVenue = {};
    races.forEach(race => {
      if (!racesByVenue[race.venue]) {
        racesByVenue[race.venue] = [];
      }
      racesByVenue[race.venue].push(race);
    });
    
    // 最初の開催場所のレースリストを表示
    const venues = Object.keys(racesByVenue);
    const firstVenue = venues[0];
    const firstVenueRaces = racesByVenue[firstVenue];
    
    // レース一覧の埋め込みを作成
    const embed = createRaceListEmbed(firstVenue, firstVenueRaces);
    
    // 開催場所選択メニューを作成
    const venueSelectMenu = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('venue_select')
          .setPlaceholder('開催場所を選択')
          .addOptions(
            venues.map(venue => ({
              label: venue,
              value: venue,
              default: venue === firstVenue
            }))
          )
      );
    
    // レース選択ボタンを作成
    const raceButtons = createRaceButtons(firstVenueRaces);
    
    // メッセージを送信
    const response = await interaction.editReply({
      embeds: [embed],
      components: [venueSelectMenu, ...raceButtons]
    });
    
    // インタラクションコレクターを設定
    const collector = response.createMessageComponentCollector({
      time: 600000 // 10分間有効
    });
    
    // 選択メニュー変更時の処理
    collector.on('collect', async i => {
      // インタラクションを行ったユーザーが元のコマンド実行者と同じか確認
      if (i.user.id !== interaction.user.id) {
        await i.reply({ content: 'このメニューは他のユーザーが操作中です', ephemeral: true });
        return;
      }
      
      // 処理中の通知
      await i.deferUpdate();
      
      try {
        if (i.customId === 'venue_select') {
          // 開催場所が選択された場合
          const selectedVenue = i.values[0];
          const selectedVenueRaces = racesByVenue[selectedVenue];
          
          // レース一覧の埋め込みを更新
          const newEmbed = createRaceListEmbed(selectedVenue, selectedVenueRaces);
          
          // レース選択ボタンを更新
          const newRaceButtons = createRaceButtons(selectedVenueRaces);
          
          // メニューのデフォルト値を更新
          const updatedVenueSelectMenu = new ActionRowBuilder()
            .addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('venue_select')
                .setPlaceholder('開催場所を選択')
                .addOptions(
                  venues.map(venue => ({
                    label: venue,
                    value: venue,
                    default: venue === selectedVenue
                  }))
                )
            );
          
          // メッセージを更新
          await i.editReply({
            embeds: [newEmbed],
            components: [updatedVenueSelectMenu, ...newRaceButtons]
          });
        } else if (i.customId.startsWith('race_')) {
          // レースが選択された場合
          const raceId = i.customId.replace('race_', '');
          
          // レース詳細を取得
          const race = await raceService.getRaceById(raceId);
          if (!race) {
            await i.editReply({ content: 'レース情報が見つかりません', components: [] });
            return;
          }
          
          // レース詳細の表示
          await displayRaceDetail(i, race);
        }
      } catch (error) {
        logger.error(`レース一覧インタラクション処理中にエラーが発生しました: ${error.message}`, error);
        await i.editReply({ content: `エラーが発生しました: ${error.message}`, components: [] });
      }
    });
    
    // タイムアウト時の処理
    collector.on('end', async collected => {
      try {
        // コンポーネントを無効化
        const disabledVenueSelectMenu = new ActionRowBuilder()
          .addComponents(
            StringSelectMenuBuilder.from(venueSelectMenu.components[0])
              .setDisabled(true)
          );
        
        const disabledRaceButtons = raceButtons.map(row => {
          return new ActionRowBuilder()
            .addComponents(
              row.components.map(button => {
                return ButtonBuilder.from(button)
                  .setDisabled(true);
              })
            );
        });
        
        await interaction.editReply({
          components: [disabledVenueSelectMenu, ...disabledRaceButtons]
        });
      } catch (error) {
        logger.error('レース一覧のコンポーネント無効化に失敗しました', error);
      }
    });
  } catch (error) {
    logger.error(`レース一覧の取得に失敗しました: ${error.message}`, error);
    await interaction.editReply(`レース一覧の取得に失敗しました: ${error.message}`);
  }
}

/**
 * レース詳細を表示する
 * @param {CommandInteraction} interaction - インタラクション
 */
async function handleRaceDetail(interaction) {
  // 処理中の通知
  await interaction.deferReply();
  
  try {
    // レースIDを取得
    const raceId = interaction.options.getString('id');
    
    // レース詳細を取得
    const race = await raceService.getRaceById(raceId);
    
    if (!race) {
      await interaction.editReply(`レースが見つかりません: ${raceId}`);
      return;
    }
    
    // レース詳細の表示
    await displayRaceDetail(interaction, race);
  } catch (error) {
    logger.error(`レース詳細の取得に失敗しました: ${error.message}`, error);
    await interaction.editReply(`レース詳細の取得に失敗しました: ${error.message}`);
  }
}

/**
 * レース結果を表示する
 * @param {CommandInteraction} interaction - インタラクション
 */
async function handleRaceResult(interaction) {
  // 処理中の通知
  await interaction.deferReply();
  
  try {
    // レースIDを取得
    const raceId = interaction.options.getString('id');
    
    // レース情報を取得
    const race = await raceService.getRaceById(raceId);
    
    if (!race) {
      await interaction.editReply(`レースが見つかりません: ${raceId}`);
      return;
    }
    
    if (race.status !== 'finished') {
      await interaction.editReply(`レース結果がまだ確定していません: ${race.name}`);
      
      // レース結果更新ボタンを表示
      const refreshButton = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`refresh_result_${raceId}`)
            .setLabel('結果を確認する')
            .setStyle(ButtonStyle.Primary)
        );
      
      const response = await interaction.editReply({
        content: `レース結果がまだ確定していません: ${race.name}`,
        components: [refreshButton]
      });
      
      // インタラクションコレクターを設定
      const collector = response.createMessageComponentCollector({
        time: 300000 // 5分間有効
      });
      
      // ボタンクリック時の処理
      collector.on('collect', async i => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({ content: 'このボタンは他のユーザーが操作中です', ephemeral: true });
          return;
        }
        
        await i.deferUpdate();
        
        try {
          // レース結果を更新
          await raceService.updateRaceResult(raceId);
          
          // 最新のレース情報を取得
          const updatedRace = await raceService.getRaceById(raceId);
          
          if (updatedRace.status === 'finished') {
            // レース結果が確定した場合
            await displayRaceResult(i, updatedRace);
          } else {
            // まだ結果が確定していない場合
            await i.editReply(`レース結果がまだ確定していません: ${updatedRace.name}`);
          }
        } catch (error) {
          logger.error(`レース結果の更新に失敗しました: ${error.message}`, error);
          await i.editReply(`レース結果の更新に失敗しました: ${error.message}`);
        }
      });
      
      return;
    }
    
    // レース結果の表示
    await displayRaceResult(interaction, race);
  } catch (error) {
    logger.error(`レース結果の取得に失敗しました: ${error.message}`, error);
    await interaction.editReply(`レース結果の取得に失敗しました: ${error.message}`);
  }
}

/**
 * レース一覧の埋め込みを作成
 * @param {string} venue - 開催場所
 * @param {Array} races - レース情報の配列
 * @returns {EmbedBuilder} - 埋め込み
 */
function createRaceListEmbed(venue, races) {
  // レースを番号順にソート
  const sortedRaces = [...races].sort((a, b) => a.number - b.number);
  
  // 埋め込みを作成
  const embed = new EmbedBuilder()
    .setTitle(`${venue} レース一覧`)
    .setColor('#0099ff')
    .setDescription('本日の開催レース一覧です')
    .setTimestamp();
  
  // レース情報を追加
  const raceInfos = sortedRaces.map(race => {
    // ステータスに応じたアイコン
    const statusIcon = {
      'upcoming': '🔵',
      'closed': '🔴',
      'finished': '✅'
    }[race.status] || '⚪';
    
    return `${statusIcon} ${race.number}R ${race.startTime} **${race.name}** (${race.distance}m ${race.surface})`;
  });
  
  embed.addFields({ name: 'レース情報', value: raceInfos.join('\n') });
  
  return embed;
}

/**
 * レース選択ボタンを作成
 * @param {Array} races - レース情報の配列
 * @returns {Array<ActionRowBuilder>} - ボタン行の配列
 */
function createRaceButtons(races) {
  // レースを番号順にソート
  const sortedRaces = [...races].sort((a, b) => a.number - b.number);
  
  // ボタン行の配列
  const rows = [];
  
  // 1行に5つのボタンを配置
  for (let i = 0; i < sortedRaces.length; i += 5) {
    const row = new ActionRowBuilder();
    
    // 1行分のレースを処理
    for (let j = i; j < i + 5 && j < sortedRaces.length; j++) {
      const race = sortedRaces[j];
      
      // ステータスに応じたスタイル
      const style = {
        'upcoming': ButtonStyle.Primary,
        'closed': ButtonStyle.Secondary,
        'finished': ButtonStyle.Success
      }[race.status] || ButtonStyle.Secondary;
      
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`race_${race.id}`)
          .setLabel(`${race.number}R`)
          .setStyle(style)
      );
    }
    
    rows.push(row);
  }
  
  return rows;
}

/**
 * レース詳細を表示
 * @param {CommandInteraction} interaction - インタラクション
 * @param {Object} race - レース情報
 */
async function displayRaceDetail(interaction, race) {
  // レース情報をフォーマット
  const formattedRace = raceService.formatRaceForDisplay(race);
  
  // 馬番順にソート
  const sortedHorses = [...formattedRace.horses].sort((a, b) => a.number - b.number);
  
  // 埋め込みを作成
  const embed = new EmbedBuilder()
    .setTitle(`${formattedRace.venue} ${formattedRace.number}R ${formattedRace.name}`)
    .setColor('#0099ff')
    .setDescription(`発走時刻: ${formattedRace.startTime}\n距離: ${formattedRace.distance}m (${formattedRace.surface}・${formattedRace.direction})\nステータス: ${formattedRace.status}`)
    .setTimestamp();
  
  // 出走馬情報を追加
  const horseInfos = sortedHorses.map(horse => {
    // 枠番に応じた色のエモジ
    const frameColors = ['⬜', '⬜', '⬜', '🟥', '🟥', '🟨', '🟨', '🟩', '🟩'];
    const frameEmoji = horse.frame <= 8 ? frameColors[horse.frame] : '🟦';
    
    return `${frameEmoji} **${horse.number}番** ${horse.name} (${horse.jockey}) - ${horse.odds}倍 (${horse.popularity}人気)`;
  });
  
  // 1つの埋め込みに収まらない場合は分割
  const chunks = [];
  let currentChunk = [];
  
  for (const horseInfo of horseInfos) {
    currentChunk.push(horseInfo);
    
    // 25頭ごとに分割（Discordの埋め込みフィールドは最大25行）
    if (currentChunk.length >= 25) {
      chunks.push([...currentChunk]);
      currentChunk = [];
    }
  }
  
  // 残りの出走馬情報
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  // 出走馬情報をフィールドとして追加
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    embed.addFields({
      name: i === 0 ? '出走馬' : `出走馬（続き）`,
      value: chunk.join('\n')
    });
  }
  
  // ボタンを作成
  const buttons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`result_${race.id}`)
        .setLabel('結果を確認')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(race.status !== 'finished'),
      new ButtonBuilder()
        .setCustomId(`bet_${race.id}`)
        .setLabel('馬券を購入')
        .setStyle(ButtonStyle.Success)
        .setDisabled(race.status !== 'upcoming')
    );
  
  // メッセージを送信
  const response = await interaction.editReply({
    embeds: [embed],
    components: [buttons]
  });
  
  // インタラクションコレクターを設定
  const collector = response.createMessageComponentCollector({
    time: 300000 // 5分間有効
  });
  
  // ボタンクリック時の処理
  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: 'このボタンは他のユーザーが操作中です', ephemeral: true });
      return;
    }
    
    await i.deferUpdate();
    
    try {
      if (i.customId === `result_${race.id}`) {
        // 結果確認ボタンがクリックされた場合
        const updatedRace = await raceService.getRaceById(race.id);
        
        if (updatedRace.status === 'finished') {
          // レース結果が確定している場合
          await displayRaceResult(i, updatedRace);
        } else {
          // レース結果が確定していない場合
          await i.editReply(`レース結果がまだ確定していません: ${updatedRace.name}`);
        }
      } else if (i.customId === `bet_${race.id}`) {
        // 馬券購入ボタンがクリックされた場合
        // 馬券購入コマンドに誘導
        await i.editReply({
          content: `馬券を購入するには \`/bet race:${race.id}\` コマンドを使用してください`,
          embeds: [embed],
          components: [buttons]
        });
      }
    } catch (error) {
      logger.error(`レース詳細インタラクション処理中にエラーが発生しました: ${error.message}`, error);
      await i.editReply({ content: `エラーが発生しました: ${error.message}`, components: [] });
    }
  });
}

/**
 * レース結果を表示
 * @param {CommandInteraction} interaction - インタラクション
 * @param {Object} race - レース情報
 */
async function displayRaceResult(interaction, race) {
  // レース情報をフォーマット
  const formattedRace = raceService.formatRaceForDisplay(race);
  
  // 着順情報が存在するか確認
  if (!formattedRace.results || !Array.isArray(formattedRace.results) || formattedRace.results.length === 0) {
    await interaction.editReply(`レース結果が確定していません: ${formattedRace.name}`);
    return;
  }
  
  // 払戻情報が存在するか確認
  if (!formattedRace.payouts) {
    await interaction.editReply(`払戻情報が確定していません: ${formattedRace.name}`);
    return;
  }
  
  // 着順でソート
  const sortedResults = [...formattedRace.results].sort((a, b) => a.order - b.order);
  
  // 埋め込みを作成
  const embed = new EmbedBuilder()
    .setTitle(`${formattedRace.venue} ${formattedRace.number}R ${formattedRace.name} 結果`)
    .setColor('#00ff00')
    .setDescription(`レース結果が確定しました\n発走時刻: ${formattedRace.startTime}\n距離: ${formattedRace.distance}m (${formattedRace.surface}・${formattedRace.direction})`)
    .setTimestamp();
  
  // 着順情報を追加
  const resultInfos = sortedResults.slice(0, 5).map(result => {
    return `${result.order}着: **${result.horseNumber}番** ${result.horseName}`;
  });
  
  embed.addFields({ name: '着順', value: resultInfos.join('\n') });
  
  // 払戻情報を追加
  const payouts = formattedRace.payouts;
  
  // 単勝
  if (payouts.tansho && payouts.tansho.length > 0) {
    embed.addFields({
      name: '単勝',
      value: `${payouts.tansho.join(', ')}番: ${payouts.tanshoAmount}円`,
      inline: true
    });
  }
  
  // 複勝
  if (payouts.fukusho && payouts.fukusho.length > 0 && payouts.fukushoAmounts) {
    const fukushoInfo = payouts.fukusho.map((number, index) => {
      return `${number}番: ${payouts.fukushoAmounts[index] || 0}円`;
    });
    
    embed.addFields({
      name: '複勝',
      value: fukushoInfo.join('\n'),
      inline: true
    });
  }
  
  // 枠連
  if (payouts.wakuren && payouts.wakuren.length >= 2 && payouts.wakurenAmount) {
    embed.addFields({
      name: '枠連',
      value: `${payouts.wakuren[0]}-${payouts.wakuren[1]}: ${payouts.wakurenAmount}円`,
      inline: true
    });
  }
  
  // 馬連
  if (payouts.umaren && payouts.umaren.length >= 2 && payouts.umarenAmount) {
    embed.addFields({
      name: '馬連',
      value: `${payouts.umaren[0]}-${payouts.umaren[1]}: ${payouts.umarenAmount}円`,
      inline: true
    });
  }
  
  // ワイド
  if (payouts.wide && Array.isArray(payouts.wide) && payouts.wide.length > 0 && payouts.wideAmounts) {
    const wideInfo = payouts.wide.map((combo, index) => {
      return `${combo[0]}-${combo[1]}: ${payouts.wideAmounts[index] || 0}円`;
    });
    
    embed.addFields({
      name: 'ワイド',
      value: wideInfo.join('\n'),
      inline: true
    });
  }
  
  // 馬単
  if (payouts.umatan && payouts.umatan.length >= 2 && payouts.umatanAmount) {
    embed.addFields({
      name: '馬単',
      value: `${payouts.umatan[0]}→${payouts.umatan[1]}: ${payouts.umatanAmount}円`,
      inline: true
    });
  }
  
  // 三連複
  if (payouts.sanrenpuku && payouts.sanrenpuku.length >= 3 && payouts.sanrenpukuAmount) {
    embed.addFields({
      name: '三連複',
      value: `${payouts.sanrenpuku[0]}-${payouts.sanrenpuku[1]}-${payouts.sanrenpuku[2]}: ${payouts.sanrenpukuAmount}円`,
      inline: true
    });
  }
  
  // 三連単
  if (payouts.sanrentan && payouts.sanrentan.length >= 3 && payouts.sanrentanAmount) {
    embed.addFields({
      name: '三連単',
      value: `${payouts.sanrentan[0]}→${payouts.sanrentan[1]}→${payouts.sanrentan[2]}: ${payouts.sanrentanAmount}円`,
      inline: true
    });
  }
  
  // メッセージを送信
  await interaction.editReply({
    embeds: [embed],
    components: []
  });
}

// レース情報のリロードボタン
async function reloadRaceInfo(interaction, raceId) {
  try {
    // レース詳細を更新
    await raceService.updateRaceDetail(raceId);
    
    // 最新のレース情報を取得
    const race = await raceService.getRaceById(raceId);
    
    if (!race) {
      await interaction.editReply(`レースが見つかりません: ${raceId}`);
      return;
    }
    
    // レース詳細の表示
    await displayRaceDetail(interaction, race);
  } catch (error) {
    logger.error(`レース情報のリロードに失敗しました: ${error.message}`, error);
    await interaction.editReply(`レース情報のリロードに失敗しました: ${error.message}`);
  }
}