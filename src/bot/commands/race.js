// race.js - レース情報表示コマンド
const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTodayRaces, getRaceById } = require('../../db/races');
const { getUserByDiscordId } = require('../../db/users');
const { getUserRaceBets } = require('../../db/bets');
const { formatter } = require('../../utils/formatter');
const { getDb } = require('../../db/firebase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('race')
    .setDescription('競馬のレース情報を表示します')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('本日のレース一覧を表示します')
        .addStringOption(option =>
          option
            .setName('type')
            .setDescription('レースの種類')
            .setRequired(false)
            .addChoices(
              { name: 'JRA', value: 'jra' },
              { name: '地方競馬', value: 'nar' },
              { name: 'すべて', value: 'all' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('info')
        .setDescription('特定のレースの詳細情報を表示します')
        .addStringOption(option =>
          option
            .setName('race_id')
            .setDescription('レースID')
            .setRequired(true)
        )
    ),
  
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'list') {
      await this.showRaceList(interaction);
    } else if (subcommand === 'info') {
      const raceId = interaction.options.getString('race_id');
      await this.showRaceInfo(interaction, raceId);
    }
  },
  
  /**
   * レース一覧を表示
   */
  async showRaceList(interaction) {
    await interaction.deferReply();
    
    const raceType = interaction.options.getString('type') || 'all';
    
    try {
      // レース一覧を取得
      const races = await getTodayRaces();
      
      // フィルタリング
      const filteredRaces = raceType === 'all' 
        ? races 
        : races.filter(race => race.type === raceType);
      
      if (filteredRaces.length === 0) {
        await interaction.editReply(`本日の${raceType === 'jra' ? 'JRA' : raceType === 'nar' ? '地方競馬' : ''}レースはありません。`);
        return;
      }
      
      // 会場ごとにグループ化
      const racesByTrack = filteredRaces.reduce((acc, race) => {
        if (!acc[race.track]) {
          acc[race.track] = [];
        }
        acc[race.track].push(race);
        return acc;
      }, {});
      
      // 埋め込みを作成
      const embed = new EmbedBuilder()
        .setTitle(`本日の${raceType === 'jra' ? 'JRA' : raceType === 'nar' ? '地方競馬' : '競馬'}レース一覧`)
        .setColor('#00ff00')
        .setDescription('下のメニューから会場を選択すると、レース一覧が表示されます。')
        .setTimestamp();
      
      // 会場選択メニューを作成（空文字列のフィルタリングを追加）
      const trackOptions = Object.keys(racesByTrack)
        .filter(track => track && track.trim() !== '') // 空の会場名をフィルタリング
        .map(track => ({
          label: track || '不明な会場',
          value: track || 'unknown'
        }));
      
      // オプションが空の場合の対応
      if (trackOptions.length === 0) {
        await interaction.editReply('利用可能なレース会場がありません。');
        return;
      }
      
      const trackSelect = new StringSelectMenuBuilder()
        .setCustomId('race:select_track')
        .setPlaceholder('会場を選択してください')
        .addOptions(trackOptions);
      
      const row = new ActionRowBuilder().addComponents(trackSelect);
      
      // 返信
      const response = await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
      
      // メニュー選択時のコレクター
      const filter = i => i.customId === 'race:select_track' && i.user.id === interaction.user.id;
      const collector = response.createMessageComponentCollector({ filter, time: 300000 });
      
      // 会場選択時の処理
      collector.on('collect', async i => {
        await this.handleTrackSelection(i);
      });
      
      // レース選択時の処理
      const raceFilter = i => i.customId === 'race:select_race' && i.user.id === interaction.user.id;
      const raceCollector = response.createMessageComponentCollector({ filter: raceFilter, time: 300000 });
      
      raceCollector.on('collect', async i => {
        const raceId = i.values[0];
        await this.showRaceInfo(i, raceId, true);
      });
    } catch (error) {
      console.error('レース一覧の表示中にエラーが発生しました:', error);
      await interaction.editReply('レース情報の取得中にエラーが発生しました。');
    }
  },
  
  /**
   * 会場選択の処理
   */
  async handleTrackSelection(interaction) {
    try {
      const selectedTrack = interaction.values[0];
      
      // 当日のレース一覧を再取得（この部分が重要）
      const races = await getTodayRaces();
      const trackRaces = races
        .filter(race => race.track === selectedTrack)
        .sort((a, b) => parseInt(a.number) - parseInt(b.number));
      
      if (!trackRaces || trackRaces.length === 0) {
        await interaction.update({
          content: `${selectedTrack}のレースが見つかりませんでした。`,
          embeds: [],
          components: []
        });
        return;
      }
      
      // レース選択メニューを作成
      const raceOptions = trackRaces.map(race => ({
        label: `${race.number}R ${race.name}`,
        description: `${race.time}発走${race.isCompleted ? ' [終了]' : ''}`,
        value: race.id
      }));
      
      const raceSelect = new StringSelectMenuBuilder()
        .setCustomId('race:select_race')
        .setPlaceholder('レースを選択してください')
        .addOptions(raceOptions);
      
      const raceRow = new ActionRowBuilder().addComponents(raceSelect);
      
      // 会場情報を表示
      const trackEmbed = new EmbedBuilder()
        .setTitle(`${selectedTrack}のレース一覧`)
        .setColor('#00ff00')
        .setDescription('下のメニューからレースを選択すると、詳細が表示されます。')
        .addFields(
          trackRaces.map(race => ({
            name: `${race.number}R ${race.name}`,
            value: `${race.time}発走${race.isCompleted ? ' [終了]' : ''}`
          }))
        )
        .setTimestamp();
      
      await interaction.update({
        embeds: [trackEmbed],
        components: [raceRow]
      });
    } catch (error) {
      console.error('会場選択の処理中にエラーが発生しました:', error);
      await interaction.update({
        content: 'レース情報の取得中にエラーが発生しました。もう一度お試しください。',
        embeds: [],
        components: []
      });
    }
  },
  
  /**
   * レース詳細情報を表示
   */
  async showRaceInfo(interaction, raceId, isUpdate = false) {
  if (!isUpdate) {
    await interaction.deferReply();
  }
  
  try {
    // レース情報を取得
    const race = await getRaceById(raceId);
    
    if (!race) {
      const message = 'レース情報が見つかりません。';
      if (isUpdate) {
        await interaction.update({ content: message, embeds: [], components: [] });
      } else {
        await interaction.editReply(message);
      }
      return;
    }
    
    // horses配列の存在確認と初期化
    const horses = race.horses || [];
    
    // 出馬表を整形
    const horsesFields = horses.length > 0 
      ? horses.map(horse => ({
          name: `${horse.gate || '?'}枠${horse.number || '?'}番 ${horse.name || '不明'}`,
          value: `騎手: ${horse.jockey || '不明'}\nオッズ: ${horse.odds || '未定'}\n人気: ${horse.popularity || '未定'}`
        }))
      : [{ name: '出走馬情報', value: '情報が取得できませんでした。' }];
    
    // 埋め込みを作成
    const embed = new EmbedBuilder()
      .setTitle(`${race.track || '不明'} ${race.number || '?'}R ${race.name || '不明'}`)
      .setColor('#0099ff')
      .setDescription(`${race.time || '不明'}発走 | ${race.distance || '不明'}m(${race.surface || '不明'}) | ${race.isCompleted ? '【レース終了】' : '【出走前】'}`)
      .addFields(horsesFields)
      .setTimestamp();
    
    // ボタンを作成
    const betButton = new ButtonBuilder()
      .setCustomId(`bet:start:${raceId}`)
      .setLabel('馬券を購入する')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(race.isCompleted); // レース終了後は購入不可
    
    const resultButton = new ButtonBuilder()
      .setCustomId(`result:show:${raceId}`)
      .setLabel('結果を確認する')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!race.isCompleted); // レース終了前は結果確認不可
    
    const row = new ActionRowBuilder().addComponents(betButton, resultButton);
    
    // 返信
    if (isUpdate) {
      await interaction.update({
        embeds: [embed],
        components: [row]
      });
    } else {
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
    }
  } catch (error) {
    console.error('レース詳細の表示中にエラーが発生しました:', error);
    const message = 'レース情報の取得中にエラーが発生しました。';
    
    if (isUpdate) {
      await interaction.update({ content: message, embeds: [], components: [] });
    } else {
      await interaction.editReply(message);
    }
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
        const raceId = interaction.values[0];
        await this.showRaceInfo(interaction, raceId, true);
        break;
      case 'show':
        await this.showRaceInfo(interaction, args[0], true);
        break;
      default:
        console.warn(`未知のアクション: ${action}`);
        break;
    }
  }
};