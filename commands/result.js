import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getRaceById } from '../../services/database/raceService.js';
import { saveUser } from '../../services/database/userService.js';
import logger from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('result')
    .setDescription('レースの結果と払戻情報を表示します')
    .addStringOption(option => 
      option.setName('race_id')
        .setDescription('レースID')
        .setRequired(true)),
  
  async execute(interaction) {
    await interaction.deferReply();
    
    try {
      // ユーザー情報を保存
      await saveUser(
        interaction.user.id,
        interaction.user.username,
        interaction.user.displayAvatarURL()
      );
      
      // レースIDの取得
      const raceId = interaction.options.getString('race_id');
      
      // レース情報の取得
      const race = await getRaceById(raceId);
      
      if (!race) {
        return await interaction.editReply(`レースID ${raceId} の情報が見つかりませんでした。`);
      }
      
      // レースが終了していない場合
      if (race.status !== 'completed') {
        return await interaction.editReply(`このレースはまだ終了していません。\n\n${race.venue} ${race.number}R ${race.name}\n発走時刻: ${race.date.slice(0, 4)}/${race.date.slice(4, 6)}/${race.date.slice(6, 8)} ${race.time}`);
      }
      
      // 結果情報がない場合
      if (!race.results || race.results.length === 0 || !race.payouts) {
        return await interaction.editReply(`レース ${race.id} の結果情報がまだ利用できません。しばらく経ってからもう一度お試しください。`);
      }
      
      // メインの結果エンベッド
      const resultEmbed = new EmbedBuilder()
        .setTitle(`🏁 ${race.venue} ${race.number}R ${race.name} - 結果`)
        .setDescription(`レース結果と払戻金の情報です。`)
        .setColor(race.type === 'jra' ? 0x00b0f4 : 0xf47200)
        .setTimestamp();
      
      // 着順情報
      let resultText = '**【着順】**\n';
      
      const sortedResults = [...race.results].sort((a, b) => a.order - b.order);
      
      sortedResults.slice(0, 5).forEach(result => {
        resultText += `${result.order}着: ${result.frameNumber}枠 ${result.horseNumber}番 ${result.horseName} (${result.jockey})\n`;
      });
      
      resultEmbed.addFields({ name: '結果', value: resultText });
      
      // 払戻情報のエンベッド
      const payoutEmbed = new EmbedBuilder()
        .setTitle(`💰 ${race.venue} ${race.number}R ${race.name} - 払戻金`)
        .setColor(race.type === 'jra' ? 0x00b0f4 : 0xf47200)
        .setTimestamp();
      
      // 払戻情報の整形
      let payoutText = '';
      
      // 単勝
      if (race.payouts.tansho && race.payouts.tansho.length > 0) {
        const tansho = race.payouts.tansho[0];
        payoutText += `**単勝**: ${tansho.numbers.join('-')} (${tansho.popularity}人気) → ${tansho.payout}円\n\n`;
      }
      
      // 複勝
      if (race.payouts.fukusho && race.payouts.fukusho.length > 0) {
        payoutText += '**複勝**: ';
        race.payouts.fukusho.forEach((fukusho, index) => {
          payoutText += `${fukusho.numbers.join('-')} (${fukusho.popularity}人気) → ${fukusho.payout}円`;
          if (index < race.payouts.fukusho.length - 1) {
            payoutText += ' / ';
          }
        });
        payoutText += '\n\n';
      }
      
      // 枠連
      if (race.payouts.wakuren && race.payouts.wakuren.length > 0) {
        const wakuren = race.payouts.wakuren[0];
        payoutText += `**枠連**: ${wakuren.numbers.join('-')} (${wakuren.popularity}人気) → ${wakuren.payout}円\n\n`;
      }
      
      // 馬連
      if (race.payouts.umaren && race.payouts.umaren.length > 0) {
        const umaren = race.payouts.umaren[0];
        payoutText += `**馬連**: ${umaren.numbers.join('-')} (${umaren.popularity}人気) → ${umaren.payout}円\n\n`;
      }
      
      // ワイド
      if (race.payouts.wide && race.payouts.wide.length > 0) {
        payoutText += '**ワイド**: ';
        race.payouts.wide.forEach((wide, index) => {
          payoutText += `${wide.numbers.join('-')} (${wide.popularity}人気) → ${wide.payout}円`;
          if (index < race.payouts.wide.length - 1) {
            payoutText += ' / ';
          }
        });
        payoutText += '\n\n';
      }
      
      // 馬単
      if (race.payouts.umatan && race.payouts.umatan.length > 0) {
        const umatan = race.payouts.umatan[0];
        payoutText += `**馬単**: ${umatan.numbers.join('→')} (${umatan.popularity}人気) → ${umatan.payout}円\n\n`;
      }
      
      // 三連複
      if (race.payouts.sanrenpuku && race.payouts.sanrenpuku.length > 0) {
        const sanrenpuku = race.payouts.sanrenpuku[0];
        payoutText += `**三連複**: ${sanrenpuku.numbers.join('-')} (${sanrenpuku.popularity}人気) → ${sanrenpuku.payout}円\n\n`;
      }
      
      // 三連単
      if (race.payouts.sanrentan && race.payouts.sanrentan.length > 0) {
        const sanrentan = race.payouts.sanrentan[0];
        payoutText += `**三連単**: ${sanrentan.numbers.join('→')} (${sanrentan.popularity}人気) → ${sanrentan.payout}円`;
      }
      
      payoutEmbed.setDescription(payoutText);
      
      // レスポンスを送信
      await interaction.editReply({
        content: `${race.venue} ${race.number}R ${race.name} の結果と払戻金です。`,
        embeds: [resultEmbed, payoutEmbed]
      });
      
    } catch (error) {
      logger.error(`レース結果表示中にエラーが発生しました: ${error}`);
      await interaction.editReply({ content: 'レース結果の取得中にエラーが発生しました。しばらく経ってからもう一度お試しください。' });
    }
  }
};