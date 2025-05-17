import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPointsRanking } from '../services/database/userService.js';
import logger from '../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('ポイントランキングを表示します')
    .addIntegerOption(option => 
      option.setName('limit')
        .setDescription('表示するランキング数')
        .setRequired(false)
        .setMinValue(5)
        .setMaxValue(30)),
  
  async execute(interaction) {
    await interaction.deferReply();
    
    try {
      // オプションの取得
      const limit = interaction.options.getInteger('limit') || 10;
      
      // ランキングの取得
      const ranking = await getPointsRanking(limit);
      
      if (ranking.length === 0) {
        return await interaction.editReply('ランキング情報がありません。');
      }
      
      // ランキングのエンベッド
      const rankingEmbed = new EmbedBuilder()
        .setTitle('🏆 ポイントランキング')
        .setColor(0xFFD700) // 金色
        .setTimestamp();
      
      // ランキングの整形
      let rankingText = '';
      
      ranking.forEach((user, index) => {
        // ランキング表示用の絵文字
        let rankEmoji;
        switch (index) {
          case 0:
            rankEmoji = '🥇';
            break;
          case 1:
            rankEmoji = '🥈';
            break;
          case 2:
            rankEmoji = '🥉';
            break;
          default:
            rankEmoji = `${index + 1}.`;
        }
        
        // 現在のユーザーかどうか
        const isCurrentUser = user.id === interaction.user.id;
        const userDisplay = isCurrentUser ? `**${user.username}**` : user.username;
        
        rankingText += `${rankEmoji} ${userDisplay} - ${user.points.toLocaleString()}pt\n`;
      });
      
      rankingEmbed.setDescription(rankingText);
      
      // 自分のランキングが表示されていない場合、追加情報を表示
      const currentUserInRanking = ranking.some(user => user.id === interaction.user.id);
      
      if (!currentUserInRanking) {
        // 自分のランキング情報を追加（オプション）
        rankingEmbed.setFooter({ 
          text: `あなたのランキングを確認するには /mypage コマンドを使用してください。` 
        });
      }
      
      // レスポンスを送信
      await interaction.editReply({
        embeds: [rankingEmbed]
      });
      
    } catch (error) {
      logger.error(`ランキング表示中にエラーが発生しました: ${error}`);
      await interaction.editReply({ content: 'ランキングの表示中にエラーが発生しました。しばらく経ってからもう一度お試しください。' });
    }
  }
};