// src/bot/commands/local-races.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('local-races')
    .setDescription('本日の地方競馬レース一覧を表示します。')
    .addStringOption(option => 
      option.setName('track')
        .setDescription('競馬場を指定')
        .setRequired(false)),
  
  async execute(interaction, bot) {
    const trackFilter = interaction.options.getString('track');
    
    // 地方競馬のレースだけをフィルタリング
    let races = bot.todayRaces.filter(race => race.type === 'local');
    
    if (races.length === 0) {
      return interaction.reply({
        content: '本日の地方競馬レース情報はありません。',
        ephemeral: true
      });
    }
    
    // 競馬場でさらにフィルタリング（指定がある場合）
    if (trackFilter) {
      races = races.filter(race => 
        race.track.toLowerCase().includes(trackFilter.toLowerCase())
      );
      
      if (races.length === 0) {
        return interaction.reply({
          content: `「${trackFilter}」に一致する地方競馬場は見つかりませんでした。`,
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
        .setTitle(`【地方競馬】${track} - 本日のレース`)
        .setColor('#FF9900') // 地方競馬用の色
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