// src/bot/index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');

// モジュールをインポート
const NetkeibaClient = require('../scrapers/netkeibaClient');
const BetManager = require('../betting/betManager');
const UserManager = require('../users/userManager');

class RaceBot {
    constructor() {
        // Discord クライアントの設定
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers
            ]
        });

        this.token = process.env.DISCORD_TOKEN;
        this.commands = new Collection();
        this.cooldowns = new Collection();

        // 各モジュールのインスタンス化
        this.netkeibaClient = new NetkeibaClient();
        this.betManager = new BetManager();
        this.userManager = new UserManager();

        // レース情報を保持
        this.todayRaces = [];
        this.raceDetails = new Map();

        // イベントとコマンドを設定
        this.setupEventHandlers();
        this.loadCommands();
    }

    // イベントハンドラの設定
    setupEventHandlers() {
        this.client.once('ready', this.onReady.bind(this));
        this.client.on('interactionCreate', this.onInteraction.bind(this));
    }

    // コマンドの読み込み
    loadCommands() {
        const commandsPath = path.join(__dirname, 'commands');
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            const command = require(filePath);

            if ('data' in command && 'execute' in command) {
                this.commands.set(command.data.name, command);
            } else {
                console.log(`[警告] ${filePath} のコマンドには必要なプロパティがありません。`);
            }
        }
    }

    // Readyイベントハンドラ
    async onReady() {
        console.log(`${this.client.user.tag} が起動しました！`);

        // 当日のレース情報を取得
        await this.updateRaceData();

        // 定期的にレース情報を更新（1時間ごと）
        setInterval(this.updateRaceData.bind(this), 60 * 60 * 1000);

        // レース結果の監視を開始
        this.netkeibaClient.startResultsMonitoring(
            this.todayRaces,
            this.processRaceResult.bind(this)
        );
    }

    // レース情報の更新
    async updateRaceData() {
        try {
            this.todayRaces = await this.netkeibaClient.getTodayRaces();
            console.log(`${this.todayRaces.length} レースの情報を取得しました。`);
        } catch (error) {
            console.error('レース情報の更新に失敗しました:', error);
        }
    }

    // レース結果の処理
    async processRaceResult(raceId, result) {
        console.log(`レース ID: ${raceId} の結果を処理しています...`);

        // 馬券の結果を処理
        const processedBets = this.betManager.processBetResult(raceId, result);

        // ユーザーに払戻を行う
        for (const bet of processedBets) {
            if (bet.won) {
                // ポイントを更新
                this.userManager.updatePoints(bet.userId, bet.payout);

                // 結果を通知
                this.notifyBetResult(bet);
            }
        }

        // レース結果を全体に通知
        this.broadcastRaceResult(raceId, result);
    }

    // 馬券結果の通知
    async notifyBetResult(bet) {
        const user = this.userManager.getUser(bet.userId);
        if (!user) return;

        try {
            const member = await this.client.users.fetch(bet.userId);
            if (member) {
                const embed = new EmbedBuilder()
                    .setTitle('🎉 馬券的中！')
                    .setDescription(`おめでとうございます！馬券が的中しました。`)
                    .addFields(
                        { name: '払戻金', value: `${bet.payout}ポイント` },
                        { name: '現在のポイント', value: `${user.points}ポイント` }
                    )
                    .setColor('#00FF00')
                    .setTimestamp();

                member.send({ embeds: [embed] }).catch(err =>
                    console.log(`ユーザー ${bet.userId} への通知に失敗しました: ${err}`)
                );
            }
        } catch (error) {
            console.error(`馬券結果の通知に失敗しました: ${error}`);
        }
    }

    // レース結果の全体通知
    async broadcastRaceResult(raceId, result) {
        const race = this.todayRaces.find(r => r.id === raceId);
        if (!race) return;

        const raceInfo = `${race.track} ${race.number}R ${race.name}`;

        // 通知チャンネルIDは環境変数から取得
        const channelId = process.env.RESULT_CHANNEL_ID;
        if (!channelId) return;

        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel) return;

            const embed = new EmbedBuilder()
                .setTitle(`🏁 レース結果: ${raceInfo}`)
                .setDescription('馬券の払戻金が確定しました。')
                .setColor('#0099FF')
                .setTimestamp();

            // 着順を追加
            const orderField = result.results
                .slice(0, 3)
                .map(r => `${r.order}着: ${r.umaban}番 ${r.name}`)
                .join('\n');

            embed.addFields({ name: '結果', value: orderField });

            // 払戻金情報を追加
            const payoutFields = this.formatPayouts(result.payouts);
            for (const field of payoutFields) {
                embed.addFields(field);
            }

            channel.send({ embeds: [embed] });
        } catch (error) {
            console.error(`レース結果の通知に失敗しました: ${error}`);
        }
    }

    // 払戻金情報のフォーマット
    formatPayouts(payouts) {
        const fields = [];

        const betNames = {
            tansho: '単勝',
            fukusho: '複勝',
            wakuren: '枠連',
            umaren: '馬連',
            wide: 'ワイド',
            umatan: '馬単',
            sanrentan: '三連単',
            sanrenpuku: '三連複'
        };

        for (const [type, entries] of Object.entries(payouts)) {
            if (entries.length > 0) {
                const value = entries
                    .map(e => `${e.numbers}: ${e.amount}円`)
                    .join('\n');

                fields.push({
                    name: betNames[type] || type,
                    value: value || '情報なし',
                    inline: true
                });
            }
        }

        return fields;
    }

    // インタラクションハンドラ
    async onInteraction(interaction) {
        if (interaction.isChatInputCommand()) {
            await this.handleCommand(interaction);
        } else if (interaction.isButton()) {
            await this.handleButton(interaction);
        } else if (interaction.isStringSelectMenu()) {
            await this.handleSelectMenu(interaction);
        } else if (interaction.isModalSubmit()) {
            await this.handleModalSubmit(interaction);
        }
    }

    // コマンド処理
    async handleCommand(interaction) {
        const command = this.commands.get(interaction.commandName);

        if (!command) {
            console.error(`${interaction.commandName} というコマンドは見つかりません。`);
            return;
        }

        try {
            await command.execute(interaction, this);
        } catch (error) {
            console.error(`コマンド実行中にエラーが発生しました: ${error}`);

            const reply = {
                content: 'コマンドの実行中にエラーが発生しました。',
                ephemeral: true
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
            }
        }
    }

    // ボタン処理
    async handleButton(interaction) {
        const [type, ...args] = interaction.customId.split('_');

        try {
            switch (type) {
                case 'race':
                    await this.handleRaceButton(interaction, args);
                    break;
                case 'bet':
                    await this.handleBetButton(interaction, args);
                    break;
                default:
                    await interaction.reply({
                        content: '無効なボタンです。',
                        ephemeral: true
                    });
            }
        } catch (error) {
            console.error(`ボタン処理中にエラーが発生しました: ${error}`);
            await interaction.reply({
                content: 'エラーが発生しました。',
                ephemeral: true
            });
        }
    }

    // レース関連ボタンの処理
    async handleRaceButton(interaction, args) {
        const [action, raceId] = args;

        switch (action) {
            case 'detail':
                // レース詳細を表示
                if (!this.raceDetails.has(raceId)) {
                    const details = await this.netkeibaClient.getRaceDetails(raceId);
                    if (details) {
                        this.raceDetails.set(raceId, details);
                    }
                }

                const raceDetail = this.raceDetails.get(raceId);
                if (raceDetail) {
                    await this.showRaceDetail(interaction, raceDetail);
                } else {
                    await interaction.reply({
                        content: 'レース情報を取得できませんでした。',
                        ephemeral: true
                    });
                }
                break;

            case 'bet':
                // 馬券購入画面を表示
                await this.showBetMenu(interaction, raceId);
                break;

            default:
                await interaction.reply({
                    content: '無効な操作です。',
                    ephemeral: true
                });
        }
    }

    // 馬券関連ボタンの処理
    async handleBetButton(interaction, args) {
        const [action, raceId, betType] = args;

        switch (action) {
            case 'type':
                // 馬券タイプの選択
                await this.showBetTypeOptions(interaction, raceId);
                break;

            case 'method':
                // 購入方法の選択
                await this.showBetMethodOptions(interaction, raceId, betType);
                break;

            case 'select':
                // 馬番選択
                await this.showHorseSelectionMenu(interaction, raceId, betType, args[3]);
                break;

            case 'amount':
                // 金額入力
                await this.showAmountInput(interaction, raceId, betType, args[3], args[4]);
                break;

            case 'confirm':
                // 購入確認
                await this.confirmBet(interaction, args.slice(1).join('_'));
                break;

            default:
                await interaction.reply({
                    content: '無効な操作です。',
                    ephemeral: true
                });
        }
    }

    // セレクトメニュー処理
    async handleSelectMenu(interaction) {
        const [type, ...args] = interaction.customId.split('_');

        try {
            switch (type) {
                case 'bettype':
                    // 馬券タイプの選択処理
                    await this.handleBetTypeSelection(interaction, args);
                    break;

                case 'betmethod':
                    // 購入方法の選択処理
                    await this.handleBetMethodSelection(interaction, args);
                    break;

                case 'horse':
                    // 馬番選択の処理
                    await this.handleHorseSelection(interaction, args);
                    break;

                default:
                    await interaction.reply({
                        content: '無効な選択です。',
                        ephemeral: true
                    });
            }
        } catch (error) {
            console.error(`セレクトメニュー処理中にエラーが発生しました: ${error}`);
            await interaction.reply({
                content: 'エラーが発生しました。',
                ephemeral: true
            });
        }
    }

    // モーダル送信処理
    async handleModalSubmit(interaction) {
        const [type, ...args] = interaction.customId.split('_');

        try {
            switch (type) {
                case 'betamount':
                    // 金額入力の処理
                    await this.handleBetAmountSubmit(interaction, args);
                    break;

                default:
                    await interaction.reply({
                        content: '無効なフォームです。',
                        ephemeral: true
                    });
            }
        } catch (error) {
            console.error(`モーダル処理中にエラーが発生しました: ${error}`);
            await interaction.reply({
                content: 'エラーが発生しました。',
                ephemeral: true
            });
        }
    }

    // ボットの起動
    start() {
        this.client.login(this.token);
    }
}

module.exports = RaceBot;

// ボットの起動
if (require.main === module) {
    const bot = new RaceBot();
    bot.start();
}