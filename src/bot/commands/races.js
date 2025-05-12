// src/bot/commands/races.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('races')
    .setDescription('本日のレース一覧を表示します。')
    .addStringOption(option => 
      option.setName('track')
        .setDescription('競馬場を指定')
        .setRequired(false)),
  
  async execute(interaction, bot) {
    const trackFilter = interaction.options.getString('track');
    
    if (bot.todayRaces.length === 0) {
      return interaction.reply({
        content: '本日のレース情報はありません。',
        ephemeral: true
      });
    }
    
    // 競馬場でフィルタリング（指定がある場合）
    let races = bot.todayRaces;
    if (trackFilter) {
      races = races.filter(race => 
        race.track.toLowerCase().includes(trackFilter.toLowerCase())
      );
      
      if (races.length === 0) {
        return interaction.reply({
          content: `「${trackFilter}」に一致する競馬場は見つかりませんでした。`,
          ephemeral: true
        });
      }
    }
    
    // 競馬場ごとにレースをグループ化
    const trackGroups = races.reduce((groups, race) => {
      if (!groups[race.track]) {
        groups[race.track] = [];
      }
      groups[race.track].push(race);
      return groups;
    }, {});
    
    const embeds = [];
    
    // 各競馬場ごとにEmbedを作成
    for (const [track, trackRaces] of Object.entries(trackGroups)) {
      const embed = new EmbedBuilder()
        .setTitle(`${track} - 本日のレース`)
        .setColor('#0099FF')
        .setTimestamp();
      
      // レース情報を追加
      const racesList = trackRaces
        .sort((a, b) => parseInt(a.number) - parseInt(b.number))
        .map(race => {
          const status = race.status === '確定' ? '🏁 確定' : `🕒 ${race.time}`;
          return `**${race.number}R ${race.name}** (${status})`;
        })
        .join('\n');
      
      embed.setDescription(racesList);
      embeds.push(embed);
    }
    
    // 操作ボタンを追加
    const buttons = races.map(race => {
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`race_detail_${race.id}`)
            .setLabel(`${race.track} ${race.number}R 詳細`)
            .setStyle(ButtonStyle.Primary)
        );
      
      if (race.status !== '確定') {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`race_bet_${race.id}`)
            .setLabel('馬券購入')
            .setStyle(ButtonStyle.Success)
        );
      }
      
      return row;
    });
    
    // 最大5つのボタン行に制限（Discordの制限）
    const limitedButtons = buttons.slice(0, 5);
    
    await interaction.reply({
      embeds: embeds,
      components: limitedButtons
    });
  }
};