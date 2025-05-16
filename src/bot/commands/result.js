// result.js - レース結果確認コマンド
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getDb } = require('../../db/firebase');
const { getTodayRaces, getRaceById } = require('../../db/races');
const { getUserByDiscordId } = require('../../db/users');
const { getUserRaceBets } = require('../../db/bets');
const { formatter } = require('../../utils/formatter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('result')
    .setDescription('レース結果を確認します')
    .addSubcommand(subcommand =>
      subcommand
        .setName('race')
        .setDescription('特定のレースの結果を確認します')
        .addStringOption(option =>
          option
            .setName('race_id')
            .setDescription('レースID')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('mybets')
        .setDescription('自分が購入した馬券の結果を確認します')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'race') {
      const raceId = interaction.options.getString('race_id');

      if (raceId) {
        await this.showRaceResult(interaction, raceId);
      } else {
        await this.showRaceSelection(interaction);
      }
    } else if (subcommand === 'mybets') {
      await this.showUserBetResults(interaction);
    }
  },

  /**
   * レース選択画面を表示
   */
  async showRaceSelection(interaction) {
    await interaction.deferReply();

    try {
      // 当日のレース一覧を取得
      const races = await getTodayRaces();

      // 完了したレースのみをフィルタリング
      const completedRaces = races.filter(race => race.isCompleted);

      if (completedRaces.length === 0) {
        await interaction.editReply('現在確認できるレース結果はありません。');
        return;
      }

      // 会場ごとにグループ化
      const racesByTrack = completedRaces.reduce((acc, race) => {
        if (!acc[race.track]) {
          acc[race.track] = [];
        }
        acc[race.track].push(race);
        return acc;
      }, {});

      // 埋め込みを作成
      const embed = new EmbedBuilder()
        .setTitle('レース結果確認')
        .setColor('#0099ff')
        .setDescription('下のメニューから会場を選択してください。')
        .setTimestamp();

      // 会場選択メニューを作成
      const trackOptions = Object.keys(racesByTrack).map(track => ({
        label: track,
        value: track
      }));

      const trackSelect = new StringSelectMenuBuilder()
        .setCustomId('result:select_track')
        .setPlaceholder('会場を選択')
        .addOptions(trackOptions);

      const row = new ActionRowBuilder().addComponents(trackSelect);

      // 返信
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      console.error('レース選択画面の表示中にエラーが発生しました:', error);
      await interaction.editReply('レース情報の取得中にエラーが発生しました。');
    }
  },

  /**
   * レース結果を表示
   */
  async showRaceResult(interaction, raceId, isUpdate = false) {
    if (!isUpdate) {
      await interaction.deferReply();
    }

    try {
      // レース情報と結果を取得
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

      if (!race.isCompleted) {
        const message = 'このレースはまだ終了していません。';
        if (isUpdate) {
          await interaction.update({ content: message, embeds: [], components: [] });
        } else {
          await interaction.editReply(message);
        }
        return;
      }

      // レース結果を取得
      const db = getDb();
      const resultDoc = await db.collection('raceResults').doc(raceId).get();

      if (!resultDoc.exists) {
        const message = 'レース結果が見つかりません。';
        if (isUpdate) {
          await interaction.update({ content: message, embeds: [], components: [] });
        } else {
          await interaction.editReply(message);
        }
        return;
      }

      const resultData = resultDoc.data();

      // 着順情報を整形
      const resultsInfo = resultData.results.map(result => {
        const horse = race.horses.find(h => h.id === result.id);
        return {
          order: result.order,
          number: result.number,
          name: result.name,
          jockey: horse ? horse.jockey : '不明'
        };
      }).sort((a, b) => a.order - b.order);

      // 払戻金情報
      const payouts = resultData.payouts;

      // 埋め込みを作成
      const embed = new EmbedBuilder()
        .setTitle(`${race.track} ${race.number}R ${race.name} 結果`)
        .setColor('#0099ff')
        .setDescription(`${race.time}発走 | ${race.distance}m(${race.surface})`)
        .setTimestamp();

      // 着順情報を追加
      let resultsText = '';
      for (let i = 0; i < Math.min(5, resultsInfo.length); i++) {
        const result = resultsInfo[i];
        resultsText += `${result.order}着: ${result.number}番 ${result.name} (${result.jockey})\n`;
      }

      embed.addFields({ name: '着順', value: resultsText });

      // 払戻金情報を追加
      if (payouts) {
        if (payouts.tansho && payouts.tansho.length > 0) {
          embed.addFields({ name: '単勝', value: formatter.formatPayout(payouts.tansho) });
        }

        if (payouts.fukusho && payouts.fukusho.length > 0) {
          embed.addFields({ name: '複勝', value: formatter.formatPayout(payouts.fukusho) });
        }

        if (payouts.wakuren && payouts.wakuren.length > 0) {
          embed.addFields({ name: '枠連', value: formatter.formatPayout(payouts.wakuren) });
        }

        if (payouts.umaren && payouts.umaren.length > 0) {
          embed.addFields({ name: '馬連', value: formatter.formatPayout(payouts.umaren) });
        }

        if (payouts.wide && payouts.wide.length > 0) {
          embed.addFields({ name: 'ワイド', value: formatter.formatPayout(payouts.wide) });
        }

        if (payouts.umatan && payouts.umatan.length > 0) {
          embed.addFields({ name: '馬単', value: formatter.formatPayout(payouts.umatan) });
        }

        if (payouts.sanrenpuku && payouts.sanrenpuku.length > 0) {
          embed.addFields({ name: '3連複', value: formatter.formatPayout(payouts.sanrenpuku) });
        }

        if (payouts.sanrentan && payouts.sanrentan.length > 0) {
          embed.addFields({ name: '3連単', value: formatter.formatPayout(payouts.sanrentan) });
        }
      }

      // マイ馬券情報（存在する場合）
      const user = await getUserByDiscordId(interaction.user.id);

      if (user) {
        const userBets = await getUserRaceBets(user.id, raceId);

        if (userBets && userBets.length > 0) {
          const betContents = userBets.map(bet => formatter.betContent(bet)).join('\n');

          embed.addFields({
            name: 'マイ馬券',
            value: betContents
          });

          // 払戻金合計
          const totalPayout = userBets.reduce((sum, bet) => sum + bet.payout, 0);
          const totalAmount = userBets.reduce((sum, bet) => sum + bet.amount, 0);
          const profit = totalPayout - totalAmount;

          embed.addFields({
            name: '収支',
            value: `投資: ${totalAmount}pt\n払戻: ${totalPayout}pt\n収支: ${profit >= 0 ? '+' : ''}${profit}pt`
          });
        }
      }

      // 返信
      if (isUpdate) {
        await interaction.update({
          embeds: [embed],
          components: []
        });
      } else {
        await interaction.editReply({
          embeds: [embed]
        });
      }
    } catch (error) {
      console.error('レース結果の表示中にエラーが発生しました:', error);
      const message = 'レース結果の取得中にエラーが発生しました。';

      if (isUpdate) {
        await interaction.update({ content: message, embeds: [], components: [] });
      } else {
        await interaction.editReply(message);
      }
    }
  },

  /**
   * 自分の馬券結果を表示
   */
  async showUserBetResults(interaction) {
    await interaction.deferReply();

    try {
      // ユーザー情報を取得
      const user = await getUserByDiscordId(interaction.user.id);
      const db = getDb();
      
      if (!user) {
        await interaction.editReply('ユーザー情報が見つかりません。');
        return;
      }

      console.log(`ユーザーID: ${user.id}, DiscordID: ${interaction.user.id}`);

      // 全ての馬券を取得して確認（デバッグ用）
      const allBetsSnapshot = await db.collection('bets')
        .where('userId', '==', user.id)
        .get();

      console.log(`全馬券数: ${allBetsSnapshot.size}`);
      allBetsSnapshot.forEach(doc => {
        const bet = doc.data();
        console.log(`馬券ID: ${bet.id}, settled: ${bet.settled} (${typeof bet.settled})`);
      });

      // 完了したレースの馬券を取得
      const betsSnapshot = await db.collection('bets')
        .where('userId', '==', user.id)
        .where('settled', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      console.log(`settled=true の馬券数: ${betsSnapshot.size}`);

      if (betsSnapshot.empty) {
        await interaction.editReply('購入済みの馬券結果はありません。デバッグ情報をログで確認してください。');
        return;
      }

      const bets = [];
      betsSnapshot.forEach(doc => {
        bets.push(doc.data());
      });

      // レースごとにグループ化
      const betsByRace = bets.reduce((acc, bet) => {
        if (!acc[bet.raceId]) {
          acc[bet.raceId] = [];
        }
        acc[bet.raceId].push(bet);
        return acc;
      }, {});

      // 埋め込みを作成
      const embed = new EmbedBuilder()
        .setTitle('マイ馬券結果')
        .setColor('#0099ff')
        .setDescription(`${interaction.user.username}さんの馬券結果です。最近の結果から最大10レース分を表示します。`)
        .setTimestamp();

      // 各レースの結果を追加
      let raceCount = 0;
      let totalProfit = 0;

      for (const [raceId, raceBets] of Object.entries(betsByRace)) {
        if (raceCount >= 10) break;

        const race = await getRaceById(raceId);
        if (!race) continue;

        const betContents = raceBets.map(bet => formatter.betContent(bet)).join('\n');

        // 払戻金合計
        const totalPayout = raceBets.reduce((sum, bet) => sum + bet.payout, 0);
        const totalAmount = raceBets.reduce((sum, bet) => sum + bet.amount, 0);
        const profit = totalPayout - totalAmount;
        totalProfit += profit;

        embed.addFields(
          {
            name: `${race.track} ${race.number}R ${race.name}`,
            value: betContents
          },
          {
            name: '収支',
            value: `投資: ${totalAmount}pt\n払戻: ${totalPayout}pt\n収支: ${profit >= 0 ? '+' : ''}${profit}pt`,
            inline: true
          }
        );

        raceCount++;
      }

      // 総合収支
      embed.addFields({
        name: '総合収支',
        value: `${totalProfit >= 0 ? '+' : ''}${totalProfit}pt`
      });

      // 返信
      await interaction.editReply({
        embeds: [embed]
      });
    } catch (error) {
      console.error('馬券結果の表示中にエラーが発生しました:', error);
      await interaction.editReply('馬券結果の取得中にエラーが発生しました。');
    }
  },

  /**
   * インタラクションを処理
   */
  async handleInteraction(interaction, action, args) {
    if (action === 'select_track') {
      await this.handleTrackSelection(interaction);
    } else if (action === 'select_race') {
      await this.handleRaceSelection(interaction);
    } else if (action === 'show') {
      await this.showRaceResult(interaction, args[0], true);
    }
  },

  /**
   * 会場選択の処理
   */
  async handleTrackSelection(interaction) {
    try {
      const selectedTrack = interaction.values[0];

      // 当日の選択した会場のレースを取得
      const races = await getTodayRaces();
      const trackRaces = races
        .filter(race => race.track === selectedTrack && race.isCompleted)
        .sort((a, b) => parseInt(a.number) - parseInt(b.number));

      // レース選択メニューを作成
      const raceOptions = trackRaces.map(race => ({
        label: `${race.number}R ${race.name}`,
        description: `${race.time}発走`,
        value: race.id
      }));

      const raceSelect = new StringSelectMenuBuilder()
        .setCustomId('result:select_race')
        .setPlaceholder('レースを選択')
        .addOptions(raceOptions);

      const raceRow = new ActionRowBuilder().addComponents(raceSelect);

      // 埋め込みを更新
      const embed = new EmbedBuilder()
        .setTitle(`レース結果 - ${selectedTrack}`)
        .setColor('#0099ff')
        .setDescription('結果を確認するレースを選択してください。')
        .addFields(
          trackRaces.map(race => ({
            name: `${race.number}R ${race.name}`,
            value: `${race.time}発走`
          }))
        )
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: [raceRow]
      });
    } catch (error) {
      console.error('会場選択の処理中にエラーが発生しました:', error);
      await interaction.update({
        content: 'エラーが発生しました。',
        embeds: [],
        components: []
      });
    }
  },

  /**
   * レース選択の処理
   */
  async handleRaceSelection(interaction) {
    try {
      const raceId = interaction.values[0];
      await this.showRaceResult(interaction, raceId, true);
    } catch (error) {
      console.error('レース選択の処理中にエラーが発生しました:', error);
      await interaction.update({
        content: 'エラーが発生しました。',
        embeds: [],
        components: []
      });
    }
  }
};