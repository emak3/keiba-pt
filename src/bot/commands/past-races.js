// src/bot/commands/past-races.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('past-races')
    .setDescription('過去のレース結果を検索します。')
    .addStringOption(option => 
      option.setName('date')
        .setDescription('検索する日付（YYYYMMDD形式）')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('type')
        .setDescription('レースタイプを指定')
        .setRequired(false)
        .addChoices(
          { name: 'すべて', value: 'all' },
          { name: 'JRA', value: 'jra' },
          { name: '地方競馬', value: 'local' }
        )),
  
  async execute(interaction, bot) {
    await interaction.deferReply();
    
    const dateStr = interaction.options.getString('date');
    const typeFilter = interaction.options.getString('type') || 'all';
    
    // 日付形式の検証
    if (!/^\d{8}$/.test(dateStr)) {
      return interaction.editReply({
        content: '日付はYYYYMMDD形式で入力してください（例：20240512）',
        ephemeral: true
      });
    }
    
    // 日付の解析
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1; // 0-indexed
    const day = parseInt(dateStr.substring(6, 8));
    
    const searchDate = new Date(year, month, day);
    const today = new Date();
    
    // 未来の日付はエラー
    if (searchDate > today) {
      return interaction.editReply({
        content: '未来の日付は検索できません。',
        ephemeral: true
      });
    }
    
    try {
      // 指定日のレース一覧を取得
      const races = await bot.netkeibaClient.getRacesByDate(searchDate);
      
      // レースタイプでフィルタリング
      let filteredRaces = races;
      if (typeFilter !== 'all') {
        filteredRaces = races.filter(race => race.type === typeFilter);
        
        if (filteredRaces.length === 0) {
          return interaction.editReply({
            content: `${dateStr.substring(0, 4)}年${dateStr.substring(4, 6)}月${dateStr.substring(6, 8)}日の${typeFilter === 'jra' ? 'JRA' : '地方競馬'}レース情報はありません。`,
            ephemeral: true
          });
        }
      }
      
      if (filteredRaces.length === 0) {
        return interaction.editReply({
          content: `${dateStr.substring(0, 4)}年${dateStr.substring(4, 6)}月${dateStr.substring(6, 8)}日のレース情報はありません。`,
          ephemeral: true
        });
      }
      
      // 競馬場ごとにレースをグループ化
      const trackGroups = filteredRaces.reduce((groups, race) => {
        // グループキーには競馬場名とレースタイプを含める
        const key = `${race.track}_${race.type}`;
        if (!groups[key]) {
          groups[key] = {
            track: race.track,
            type: race.type,
            races: []
          };
        }
        groups[key].races.push(race);
        return groups;
      }, {});
      
      const embeds = [];
      
      // 各競馬場ごとにEmbedを作成
      for (const groupInfo of Object.values(trackGroups)) {
        const { track, type, races: trackRaces } = groupInfo;
        const raceTypeLabel = type === 'jra' ? 'JRA' : '地方競馬';
        const color = type === 'jra' ? '#0099FF' : '#FF9900';
        
        const embed = new EmbedBuilder()
          .setTitle(`【${raceTypeLabel}】${track} - ${dateStr.substring(0, 4)}年${dateStr.substring(4, 6)}月${dateStr.substring(6, 8)}日のレース`)
          .setColor(color)
          .setTimestamp();
        
        // レース情報を追加
        const racesList = trackRaces
          .sort((a, b) => parseInt(a.number) - parseInt(b.number))
          .map(race => {
            return `**${race.number}R ${race.name}**`;
          })
          .join('\n');
        
        embed.setDescription(racesList);
        embeds.push(embed);
      }
      
      // 操作ボタンを追加
      const buttons = filteredRaces.slice(0, 5).map(race => {
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`race_detail_${race.id}`)
              .setLabel(`${race.type === 'jra' ? 'JRA' : '地方'} ${race.track} ${race.number}R 詳細`)
              .setStyle(ButtonStyle.Primary)
          );
        
        return row;
      });
      
      await interaction.editReply({
        embeds: embeds,
        components: buttons.length > 0 ? buttons : []
      });
      
    } catch (error) {
      console.error(`過去レース検索エラー: ${error}`);
      await interaction.editReply({
        content: 'レース情報の取得に失敗しました。日付を確認して再度お試しください。',
        ephemeral: true
      });
    }
  }
};