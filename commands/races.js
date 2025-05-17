import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getRacesByDate } from '../services/database/raceService.js';
import { saveUser } from '../services/database/userService.js';
import dayjs from 'dayjs';
import logger from '../utils/logger.js';

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
      
      // 競馬場ごとにレースをグループ化
      const venueGroups = {};
      
      races.forEach(race => {
        if (!venueGroups[race.venue]) {
          venueGroups[race.venue] = [];
        }
        venueGroups[race.venue].push(race);
      });
      
      // 競馬場ごとにエンベッドを作成
      const embeds = [];
      
      for (const [venue, venueRaces] of Object.entries(venueGroups)) {
        const raceType = venueRaces[0].type.toUpperCase();
        const embed = new EmbedBuilder()
          .setTitle(`${displayDate} ${venue}（${raceType}）レース一覧`)
          .setColor(raceType === 'JRA' ? 0x00b0f4 : 0xf47200)
          .setTimestamp();
        
        let description = '';
        
        venueRaces.forEach(race => {
          const statusEmoji = getStatusEmoji(race.status);
          logger.debug(`レース ${race.id} のステータス: ${race.status}, 絵文字: ${statusEmoji}`);
          const raceLink = race.link || '詳細情報なし';
          description += `${statusEmoji} **${race.number}R** ${race.time} 【${race.name}】\n`;
          description += `→ レースID: \`${race.id}\`\n\n`;
        });
        
        embed.setDescription(description);
        embeds.push(embed);
      }
      
      // 前日・翌日ボタン
      const prevDate = dayjs(targetDate).subtract(1, 'day').format('YYYYMMDD');
      const nextDate = dayjs(targetDate).add(1, 'day').format('YYYYMMDD');
      
      const row = new ActionRowBuilder()
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
      
      // 各競馬場のエンベッドを送信（最大10個まで）
      await interaction.editReply({ 
        content: `${displayDate}のレース一覧（${races.length}件）\n各レースの馬券購入は \`/bet\` コマンドで行えます。`,
        embeds: embeds.slice(0, 10),
        components: [row]
      });
      
      // ボタンのインタラクションコレクター
      const filter = i => 
        i.customId.startsWith('races_prev_') || 
        i.customId.startsWith('races_next_');
      
      const collector = interaction.channel.createMessageComponentCollector({ 
        filter, 
        time: 600000 // 10分間有効
      });
      
      collector.on('collect', async i => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({ content: 'このボタンは他のユーザーのコマンド結果用です。自分で `/races` コマンドを実行してください。', ephemeral: true });
          return;
        }
        
        const newDate = i.customId.split('_')[2];
        
        // 新しいコマンドを実行したように処理
        await i.update({ content: '読み込み中...', embeds: [], components: [] });
        
        // 新しい日付でコマンドを再実行
        const command = interaction.client.commands.get('races');
        const newInteraction = {
          ...interaction,
          options: {
            getString: () => newDate
          },
          editReply: (options) => i.editReply(options)
        };
        
        await command.execute(newInteraction);
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