// utils/betHandler.js
// 馬券購入関連の処理を集約したモジュール
import {
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { getRaceById } from '../services/database/raceService.js';
import { getUser } from '../services/database/userService.js';
import { placeBet } from '../services/database/betService.js';
import logger from './logger.js';

// 馬券タイプの名称マッピング
const betTypeNames = {
    tansho: '単勝',
    fukusho: '複勝',
    wakuren: '枠連',
    umaren: '馬連',
    wide: 'ワイド',
    umatan: '馬単',
    sanrenpuku: '三連複',
    sanrentan: '三連単'
};

// 購入方法の名称マッピング
const methodNames = {
    normal: '通常',
    box: 'ボックス',
    formation: 'フォーメーション'
};

/**
 * 馬券購入のメインハンドラ
 */
export default class BetHandler {
    /**
 * 馬券タイプ選択メニューを処理
 * @param {StringSelectMenuInteraction} interaction - インタラクション
 */
    static async handleBetTypeSelection(interaction) {
        try {
            await interaction.deferUpdate().catch(err => {
                logger.warn(`deferUpdate エラー (無視して続行): ${err}`);
            });

            // カスタムIDからレースIDを抽出
            const parts = interaction.customId.split('_');
            const raceId = parts[3];
            const betType = interaction.values[0];

            // レース情報を取得
            const race = await getRaceById(raceId);

            if (!race) {
                return await interaction.editReply({
                    content: `レースID ${raceId} の情報が見つかりませんでした。`,
                    embeds: [],
                    components: []
                });
            }

            // ユーザー情報を取得
            const user = await getUser(interaction.user.id);
            if (!user) {
                return await interaction.editReply({
                    content: 'ユーザー情報の取得に失敗しました。',
                    embeds: [],
                    components: []
                });
            }

            // セッション初期化（グローバル変数使用）
            if (!global.betSessions) global.betSessions = {};
            global.betSessions[`${interaction.user.id}_${raceId}`] = {
                betType: betType,
                timestamp: Date.now()
            };

            // 購入方法選択メニュー
            const options = [];

            // 単勝・複勝は通常購入のみ
            if (betType === 'tansho' || betType === 'fukusho') {
                options.push({
                    label: '通常',
                    value: 'normal',
                    description: `${betTypeNames[betType]}: 選択した馬を購入`,
                    emoji: '🎫'
                });
            } else {
                // 他の馬券タイプは通常・ボックス・フォーメーション
                options.push({
                    label: '通常',
                    value: 'normal',
                    description: `${betTypeNames[betType]}: 選択した馬(枠)を購入`,
                    emoji: '🎫'
                });

                options.push({
                    label: 'ボックス',
                    value: 'box',
                    description: `${betTypeNames[betType]}: 選択した馬(枠)の組み合わせを購入`,
                    emoji: '📦'
                });

                options.push({
                    label: 'フォーメーション',
                    value: 'formation',
                    description: `${betTypeNames[betType]}: 1着~3着を軸馬と相手馬で購入`,
                    emoji: '📊'
                });
            }

            const methodRow = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`bet_select_method_${raceId}`)
                        .setPlaceholder('購入方法を選択してください')
                        .addOptions(options)
                );

            // 戻るボタン
            const backButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`bet_back_to_race_${raceId}`)
                        .setLabel('レース詳細に戻る')
                        .setStyle(ButtonStyle.Secondary)
                );

            // エンベッド
            const embed = new EmbedBuilder()
                .setTitle(`🏇 馬券購入 - ${race.venue} ${race.number}R ${race.name}`)
                .setDescription(`**${betTypeNames[betType]}**の購入方法を選択してください`)
                .setColor(0x00b0f4)
                .setTimestamp()
                .addFields(
                    { name: '現在のポイント', value: `${user.points}pt` }
                );

            await interaction.editReply({
                embeds: [embed],
                components: [methodRow, backButton]
            });
        } catch (error) {
            logger.error(`馬券タイプ選択処理中にエラー: ${error}`);
            await this.handleError(interaction, error);
        }
    }

    /**
 * 馬券購入方法選択を処理
 * @param {StringSelectMenuInteraction} interaction - インタラクション
 */
    static async handleMethodSelection(interaction) {
        try {
            await interaction.deferUpdate().catch(err => {
                logger.warn(`deferUpdate エラー (無視して続行): ${err}`);
            });

            // カスタムIDからパラメータを解析
            const parts = interaction.customId.split('_');
            // [0]=bet, [1]=select, [2]=method, [3]=raceId
            const raceId = parts[3];
            const method = interaction.values[0];

            // セッションを確認・更新
            if (!global.betSessions) global.betSessions = {};
            const sessionKey = `${interaction.user.id}_${raceId}`;
            const session = global.betSessions[sessionKey];

            if (!session || !session.betType) {
                return await interaction.editReply({
                    content: 'セッションが失効しました。最初からやり直してください。',
                    embeds: [],
                    components: []
                });
            }

            // セッションに購入方法を追加
            session.method = method;
            session.timestamp = Date.now();
            global.betSessions[sessionKey] = session;

            // レース情報を取得
            const race = await getRaceById(raceId);
            if (!race) {
                return await interaction.editReply({
                    content: `レースID ${raceId} の情報が見つかりませんでした。`,
                    embeds: [],
                    components: []
                });
            }

            // ユーザー情報を取得
            const user = await getUser(interaction.user.id);
            if (!user) {
                return await interaction.editReply({
                    content: 'ユーザー情報の取得に失敗しました。',
                    embeds: [],
                    components: []
                });
            }

            // フォーメーション購入（モーダル表示）
            if (method === 'formation') {
                // 金額選択メニュー
                const amountRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`bet_select_amount_${raceId}`)
                            .setPlaceholder('金額を選択してください')
                            .addOptions([
                                { label: '100pt', value: '100', emoji: '💰' },
                                { label: '200pt', value: '200', emoji: '💰' },
                                { label: '500pt', value: '500', emoji: '💰' },
                                { label: '1000pt', value: '1000', emoji: '💰' },
                                { label: '2000pt', value: '2000', emoji: '💰' },
                                { label: '5000pt', value: '5000', emoji: '💰' }
                            ])
                    );

                // 戻るボタン
                const backButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`bet_back_to_type_${raceId}`)
                            .setLabel('馬券種類選択に戻る')
                            .setStyle(ButtonStyle.Secondary)
                    );

                // エンベッド
                const embed = new EmbedBuilder()
                    .setTitle(`🏇 馬券購入 - ${race.venue} ${race.number}R ${race.name}`)
                    .setDescription(`**${betTypeNames[session.betType]}**（${methodNames[method]}）購入の金額を選択してください`)
                    .setColor(0x00b0f4)
                    .setTimestamp()
                    .addFields(
                        { name: '現在のポイント', value: `${user.points}pt` }
                    );

                await interaction.editReply({
                    embeds: [embed],
                    components: [amountRow, backButton]
                });
                return;
            }

            // 通常/ボックス購入の場合
            // 金額選択メニュー
            const amountRow = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`bet_select_amount_${raceId}`)
                        .setPlaceholder('金額を選択してください')
                        .addOptions([
                            { label: '100pt', value: '100', emoji: '💰' },
                            { label: '200pt', value: '200', emoji: '💰' },
                            { label: '500pt', value: '500', emoji: '💰' },
                            { label: '1000pt', value: '1000', emoji: '💰' },
                            { label: '2000pt', value: '2000', emoji: '💰' },
                            { label: '5000pt', value: '5000', emoji: '💰' }
                        ])
                );

            // 戻るボタン
            const backButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`bet_back_to_type_${raceId}`)
                        .setLabel('馬券種類選択に戻る')
                        .setStyle(ButtonStyle.Secondary)
                );

            // エンベッド
            const embed = new EmbedBuilder()
                .setTitle(`🏇 馬券購入 - ${race.venue} ${race.number}R ${race.name}`)
                .setDescription(`**${betTypeNames[session.betType]}**（${methodNames[method]}）購入の金額を選択してください`)
                .setColor(0x00b0f4)
                .setTimestamp()
                .addFields(
                    { name: '現在のポイント', value: `${user.points}pt` }
                );

            await interaction.editReply({
                embeds: [embed],
                components: [amountRow, backButton]
            });
        } catch (error) {
            logger.error(`購入方法選択処理中にエラー: ${error}`);
            await this.handleError(interaction, error);
        }
    }
    /**
     * 馬券金額選択を処理
     * @param {StringSelectMenuInteraction} interaction - インタラクション
     */
    static async handleAmountSelection(interaction) {
        try {
            await interaction.deferUpdate().catch(err => {
                logger.warn(`deferUpdate エラー (無視して続行): ${err}`);
            });

            // カスタムIDからパラメータを解析
            const parts = interaction.customId.split('_');
            // [0]=bet, [1]=select, [2]=amount, [3]=raceId
            const raceId = parts[3];
            const amount = parseInt(interaction.values[0], 10);

            // セッションを確認・更新
            if (!global.betSessions) global.betSessions = {};
            const sessionKey = `${interaction.user.id}_${raceId}`;
            const session = global.betSessions[sessionKey];

            if (!session || !session.betType || !session.method) {
                return await interaction.editReply({
                    content: 'セッションが失効しました。最初からやり直してください。',
                    embeds: [],
                    components: []
                });
            }

            // セッションに金額を追加
            session.amount = amount;
            session.timestamp = Date.now();
            global.betSessions[sessionKey] = session;

            const betType = session.betType;
            const method = session.method;

            // レース情報を取得
            const race = await getRaceById(raceId);
            if (!race) {
                return await interaction.editReply({
                    content: `レースID ${raceId} の情報が見つかりませんでした。`,
                    embeds: [],
                    components: []
                });
            }

            // ユーザー情報を取得
            const user = await getUser(interaction.user.id);
            if (!user) {
                return await interaction.editReply({
                    content: 'ユーザー情報の取得に失敗しました。',
                    embeds: [],
                    components: []
                });
            }

            // フォーメーション購入（モーダル表示）
            if (method === 'formation') {
                const modal = new ModalBuilder()
                    .setCustomId(`bet_formation_${raceId}_${betType}_${amount}`)
                    .setTitle(`馬券購入 - ${betTypeNames[betType]}（フォーメーション）`);

                this.addFormationInputs(modal, betType);

                await interaction.showModal(modal);
                return;
            }

            // 通常または馬券購入の場合
            // 馬券タイプと購入方法に応じた最大選択数を取得
            const maxSelections = this.getMaxSelectionsForBet(betType, method);

            // 出走馬オプションの作成
            const horseOptions = this.createHorseOptions(race.horses || []);

            // 選択メニュー
            const selectRow = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`bet_select_horses_${raceId}_${betType}_${method}_${amount}`)
                        .setPlaceholder('馬番を選択してください')
                        .setMinValues(this.getMinSelectionsForBet(betType))
                        .setMaxValues(maxSelections)
                        .addOptions(horseOptions)
                );

            // 戻るボタン
            const backButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`bet_back_to_method_${raceId}`)
                        .setLabel('購入方法選択に戻る')
                        .setStyle(ButtonStyle.Secondary)
                );

            // エンベッド
            const embed = new EmbedBuilder()
                .setTitle(`🏇 馬券購入 - ${race.venue} ${race.number}R ${race.name}`)
                .setDescription(`**${betTypeNames[betType]}**（${methodNames[method]}）購入画面\n\n購入金額: **${amount}pt**\n\n下のメニューから馬番を選択してください。`)
                .setColor(0x00b0f4)
                .setTimestamp()
                .addFields(
                    { name: '現在のポイント', value: `${user.points}pt` }
                );

            await interaction.editReply({
                embeds: [embed],
                components: [selectRow, backButton]
            });
        } catch (error) {
            logger.error(`金額選択処理中にエラー: ${error}`);
            await this.handleError(interaction, error);
        }
    }

    /**
     * 馬番選択を処理
     * @param {StringSelectMenuInteraction} interaction - インタラクション
     */
    static async handleHorseSelection(interaction) {
        try {
            await interaction.deferUpdate().catch(err => {
                logger.warn(`deferUpdate エラー (無視して続行): ${err}`);
            });

            // カスタムIDからパラメータを解析
            const parts = interaction.customId.split('_');
            // [0]=bet, [1]=select, [2]=horses, [3]=raceId, [4]=betType, [5]=method, [6]=amount
            const raceId = parts[3];
            const betType = parts[4];
            const method = parts[5];
            const amount = parseInt(parts[6], 10);

            // 選択された馬番
            const selectedHorses = interaction.values.map(value => parseInt(value, 10));

            // ユーザー情報を取得
            const user = await getUser(interaction.user.id);
            if (!user) {
                return await interaction.followUp({
                    content: 'ユーザー情報の取得に失敗しました。',
                    flags: MessageFlags.Ephemeral
                });
            }

            // レース情報を取得
            const race = await getRaceById(raceId);
            if (!race) {
                return await interaction.followUp({
                    content: `レースID ${raceId} の情報が見つかりませんでした。`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // レース発走時間の2分前チェック
            const now = new Date();
            const raceTime = new Date(
                race.date.slice(0, 4),
                parseInt(race.date.slice(4, 6)) - 1,
                race.date.slice(6, 8),
                race.time.split(':')[0],
                race.time.split(':')[1]
            );

            const twoMinutesBefore = new Date(raceTime.getTime() - 2 * 60 * 1000);

            if (now > twoMinutesBefore) {
                return await interaction.followUp({
                    content: 'このレースは発走2分前を過ぎているため、馬券を購入できません。',
                    flags: MessageFlags.Ephemeral
                });
            }

            // 選択した馬の情報
            const horseInfos = selectedHorses.map(horseNumber => {
                const horse = race.horses?.find(h => h.horseNumber === horseNumber);
                return horse ?
                    `${horseNumber}番: ${horse.horseName} (騎手: ${horse.jockey})` :
                    `${horseNumber}番`;
            });

            // 確認エンベッド
            const confirmEmbed = new EmbedBuilder()
                .setTitle(`🏇 馬券購入確認 - ${race.venue} ${race.number}R ${race.name}`)
                .setDescription(`**${betTypeNames[betType]}**（${methodNames[method]}）の購入を確定しますか？`)
                .setColor(0x00b0f4)
                .setTimestamp()
                .addFields(
                    { name: '選択した馬番', value: horseInfos.join('\n') },
                    { name: '購入金額', value: `${amount}pt` },
                    { name: '残りポイント', value: `${user.points}pt → ${user.points - amount}pt` }
                );

            // 確認ボタン
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`bet_confirm_${raceId}_${betType}_${method}_${amount}_${selectedHorses.join(',')}`)
                        .setLabel('馬券を購入する')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`bet_cancel_${raceId}`)
                        .setLabel('キャンセル')
                        .setStyle(ButtonStyle.Secondary)
                );

            await interaction.editReply({
                embeds: [confirmEmbed],
                components: [confirmRow]
            });
        } catch (error) {
            logger.error(`馬番選択処理中にエラー: ${error}`);
            await this.handleError(interaction, error);
        }
    }

    /**
     * 馬券購入確認を処理
     * @param {ButtonInteraction} interaction - インタラクション
     */
    static async handleBetConfirmation(interaction) {
        try {
            // キャンセルボタンの場合はレース詳細に戻る
            if (interaction.customId.startsWith('bet_cancel_')) {
                const raceId = interaction.customId.split('_')[2];
                return await this.navigateToRaceDetail(interaction, raceId);
            }

            await interaction.deferUpdate().catch(err => {
                logger.warn(`deferUpdate エラー (無視して続行): ${err}`);
            });

            // customId から情報を抽出
            const parts = interaction.customId.split('_');
            // [0]=bet, [1]=confirm, [2]=raceId, [3]=betType, [4]=method, [5]=amount, [6]=horses
            const raceId = parts[2];
            const betType = parts[3];
            const method = parts[4];
            const amount = parseInt(parts[5], 10);
            const horsesString = parts[6];

            const selectedHorses = horsesString.split(',').map(num => parseInt(num.trim(), 10));

            // 各種チェック
            const user = await getUser(interaction.user.id);
            if (!user) {
                return await interaction.editReply({
                    content: 'ユーザー情報の取得に失敗しました。',
                    components: []
                });
            }

            if (user.points < amount) {
                return await interaction.editReply({
                    content: `ポイントが不足しています。(現在: ${user.points}pt、必要: ${amount}pt)`,
                    components: []
                });
            }

            // レース情報を取得
            const race = await getRaceById(raceId);
            if (!race) {
                return await interaction.editReply({
                    content: `レース情報の取得に失敗しました。`,
                    components: []
                });
            }

            // 取消馬チェック
            const canceledHorses = race.horses.filter(h => h.isCanceled && selectedHorses.includes(h.horseNumber));
            if (canceledHorses.length > 0) {
                const canceledNames = canceledHorses.map(h => `${h.horseNumber}番: ${h.horseName}`).join('\n');
                return await interaction.editReply({
                    content: `選択した馬に出走取消馬が含まれています。\n${canceledNames}`,
                    components: []
                });
            }

            // 選択内容を処理
            let selections = selectedHorses;

            // 順序あり馬券（馬単・三連単）の場合は配列構造を変換
            if (method === 'normal') {
                if (betType === 'umatan') {
                    selections = [
                        [selectedHorses[0]],
                        [selectedHorses[1]]
                    ];
                } else if (betType === 'sanrentan') {
                    selections = [
                        [selectedHorses[0]],
                        [selectedHorses[1]],
                        [selectedHorses[2]]
                    ];
                }
            }

            try {
                // 馬券購入処理
                const bet = await placeBet(
                    interaction.user.id,
                    raceId,
                    betType,
                    selections,
                    method,
                    amount
                );

                // 選択馬表示用テキスト生成
                let selectionsDisplay = '';
                if (method === 'normal' && (betType === 'umatan' || betType === 'sanrentan')) {
                    // 順序あり馬券
                    if (betType === 'umatan') {
                        selectionsDisplay = `${selectedHorses[0]}→${selectedHorses[1]}`;
                    } else {
                        selectionsDisplay = `${selectedHorses[0]}→${selectedHorses[1]}→${selectedHorses[2]}`;
                    }
                } else {
                    // その他の馬券
                    selectionsDisplay = selectedHorses.join('-');
                }

                // 馬券購入結果のエンベッド
                const resultEmbed = new EmbedBuilder()
                    .setTitle(`🎫 馬券購入完了`)
                    .setDescription(`${betTypeNames[betType]}（${methodNames[method]}）の馬券を購入しました！`)
                    .setColor(0x00b0f4)
                    .setTimestamp()
                    .addFields(
                        { name: 'レース', value: `${race.venue} ${race.number}R ${race.name}` },
                        { name: '発走時刻', value: race.time },
                        { name: '購入金額', value: `${amount}pt` },
                        { name: '選択馬番', value: selectionsDisplay },
                        { name: '残りポイント', value: `${user.points - amount}pt` }
                    );

                // 戻るボタン
                const backButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`bet_back_to_race_${raceId}`)
                            .setLabel('レース詳細に戻る')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`mypage_open`)
                            .setLabel('マイページを開く')
                            .setStyle(ButtonStyle.Primary)
                    );

                await interaction.editReply({
                    content: `馬券の購入が完了しました！`,
                    embeds: [resultEmbed],
                    components: [backButton]
                });
            } catch (error) {
                logger.error(`馬券購入処理中にエラー: ${error}`);
                await interaction.editReply({
                    content: `馬券購入中にエラーが発生しました: ${error.message}`,
                    components: []
                });
            }
        } catch (error) {
            logger.error(`馬券確定処理中にエラー: ${error}`);
            await this.handleError(interaction, error);
        }
    }

    /**
     * フォーメーション馬券のモーダル送信を処理
     * @param {ModalSubmitInteraction} interaction - インタラクション
     */
    static async handleFormationBet(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(err => {
                logger.warn(`deferReply エラー (無視して続行): ${err}`);
            });

            // customId から情報を抽出
            const parts = interaction.customId.split('_');
            // [0]=bet, [1]=formation, [2]=raceId, [3]=betType, [4]=amount
            const raceId = parts[2];
            const betType = parts[3];
            const amount = parseInt(parts[4], 10);

            // レース情報を取得
            const race = await getRaceById(raceId);
            if (!race) {
                return await interaction.editReply(`レースID ${raceId} の情報が見つかりませんでした。`);
            }

            // フォーメーション情報の解析
            let selections = [];

            if (betType === 'umatan') {
                // 馬単フォーメーション
                const firstHorses = interaction.fields.getTextInputValue('first_horse')
                    .split(',')
                    .map(num => parseInt(num.trim(), 10))
                    .filter(num => !isNaN(num));

                const secondHorses = interaction.fields.getTextInputValue('second_horse')
                    .split(',')
                    .map(num => parseInt(num.trim(), 10))
                    .filter(num => !isNaN(num));

                selections = [firstHorses, secondHorses];
            } else if (betType === 'sanrentan') {
                // 三連単フォーメーション
                const firstHorses = interaction.fields.getTextInputValue('first_horse')
                    .split(',')
                    .map(num => parseInt(num.trim(), 10))
                    .filter(num => !isNaN(num));

                const secondHorses = interaction.fields.getTextInputValue('second_horse')
                    .split(',')
                    .map(num => parseInt(num.trim(), 10))
                    .filter(num => !isNaN(num));

                const thirdHorses = interaction.fields.getTextInputValue('third_horse')
                    .split(',')
                    .map(num => parseInt(num.trim(), 10))
                    .filter(num => !isNaN(num));

                selections = [firstHorses, secondHorses, thirdHorses];
            } else {
                // 順序なし馬券（馬連・ワイド・三連複・枠連）
                const horses = interaction.fields.getTextInputValue('horses')
                    .split(',')
                    .map(num => parseInt(num.trim(), 10))
                    .filter(num => !isNaN(num));

                selections = horses;
            }

            // 取消馬チェック
            const allSelectedHorses = Array.isArray(selections[0]) ?
                selections.flat() : selections;

            const canceledHorses = race.horses.filter(h =>
                h.isCanceled && allSelectedHorses.includes(h.horseNumber)
            );

            if (canceledHorses.length > 0) {
                const canceledNames = canceledHorses.map(h => `${h.horseNumber}番: ${h.horseName}`).join('\n');
                return await interaction.editReply(
                    `選択した馬に出走取消馬が含まれています。\n${canceledNames}`
                );
            }

            try {
                // 馬券購入処理
                const bet = await placeBet(
                    interaction.user.id,
                    raceId,
                    betType,
                    selections,
                    'formation',
                    amount
                );

                // フォーメーション選択の表示
                let selectionsDisplay = '';

                if (Array.isArray(selections[0])) {
                    // 馬単・三連単フォーメーション
                    selectionsDisplay = selections.map(group => `[${group.join(',')}]`).join(' → ');
                } else {
                    // その他のフォーメーション
                    selectionsDisplay = selections.join(',');
                }

                // 馬券購入結果のエンベッド
                const resultEmbed = new EmbedBuilder()
                    .setTitle(`🎫 馬券購入完了`)
                    .setDescription(`${betTypeNames[betType]}（フォーメーション）の馬券を購入しました！`)
                    .setColor(0x00b0f4)
                    .setTimestamp()
                    .addFields(
                        { name: 'レース', value: `${race.venue} ${race.number}R ${race.name}` },
                        { name: '発走時刻', value: race.time },
                        { name: '購入金額', value: `${amount}pt` },
                        { name: '選択馬番', value: selectionsDisplay },
                        { name: '残りポイント', value: `${(await getUser(interaction.user.id)).points}pt` }
                    );

                // 戻るボタン
                const backButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`bet_back_to_race_${raceId}`)
                            .setLabel('レース詳細に戻る')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`mypage_open`)
                            .setLabel('マイページを開く')
                            .setStyle(ButtonStyle.Primary)
                    );

                await interaction.editReply({
                    content: '馬券の購入が完了しました！',
                    embeds: [resultEmbed],
                    components: [backButton]
                });
            } catch (error) {
                logger.error(`フォーメーション馬券処理中にエラー: ${error}`);
                await interaction.editReply({
                    content: `馬券購入中にエラーが発生しました: ${error.message}`
                });
            }
        } catch (error) {
            logger.error(`フォーメーション馬券処理中にエラー: ${error}`);
            await this.handleError(interaction, error);
        }
    }

    /**
 * 「戻る」ボタンの処理
 * @param {ButtonInteraction} interaction - インタラクション
 */
    static async handleBackButton(interaction) {
        try {
            await interaction.deferUpdate().catch(err => {
                logger.warn(`deferUpdate エラー (無視して続行): ${err}`);
            });

            const customId = interaction.customId;

            // レース詳細に戻る
            if (customId.startsWith('bet_back_to_race_')) {
                const raceId = customId.split('_')[4];
                await this.navigateToRaceDetail(interaction, raceId);
            }
            // 馬券タイプ選択に戻る
            else if (customId.startsWith('bet_back_to_type_')) {
                const raceId = customId.split('_')[4];

                // レース情報を取得
                const race = await getRaceById(raceId);
                if (!race) {
                    return await interaction.editReply({
                        content: `レースID ${raceId} の情報が見つかりませんでした。`,
                        embeds: [],
                        components: []
                    });
                }

                // 馬券種類選択メニュー
                const betTypeRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`bet_select_type_${raceId}`)
                            .setPlaceholder('馬券の種類を選択してください')
                            .addOptions([
                                { label: '単勝', value: 'tansho', description: '1着になる馬を当てる', emoji: '🥇' },
                                { label: '複勝', value: 'fukusho', description: '3着以内に入る馬を当てる', emoji: '🏆' },
                                { label: '枠連', value: 'wakuren', description: '1着と2着になる枠を当てる（順不同）', emoji: '🔢' },
                                { label: '馬連', value: 'umaren', description: '1着と2着になる馬を当てる（順不同）', emoji: '🐎' },
                                { label: 'ワイド', value: 'wide', description: '3着以内に入る2頭の馬を当てる（順不同）', emoji: '📊' },
                                { label: '馬単', value: 'umatan', description: '1着と2着になる馬を当てる（順序通り）', emoji: '🎯' },
                                { label: '三連複', value: 'sanrenpuku', description: '1着から3着までの馬を当てる（順不同）', emoji: '🔄' },
                                { label: '三連単', value: 'sanrentan', description: '1着から3着までの馬を当てる（順序通り）', emoji: '💯' }
                            ])
                    );

                // 戻るボタン
                const backButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`bet_back_to_race_${raceId}`)
                            .setLabel('レース詳細に戻る')
                            .setStyle(ButtonStyle.Secondary)
                    );

                // エンベッド
                const embed = new EmbedBuilder()
                    .setTitle(`🏇 馬券購入 - ${race.venue} ${race.number}R ${race.name}`)
                    .setDescription(`馬券の種類を選択してください`)
                    .setColor(0x00b0f4)
                    .setTimestamp();

                await interaction.editReply({
                    content: 'レース詳細と馬券購入画面です。馬券を購入するには、まず馬券の種類を選択してください。',
                    embeds: [embed],
                    components: [betTypeRow, backButton]
                });
            }
            // 購入方法選択に戻る - 追加
            else if (customId.startsWith('bet_back_to_method_')) {
                const raceId = customId.split('_')[4];

                // セッションを確認
                if (!global.betSessions) global.betSessions = {};
                const sessionKey = `${interaction.user.id}_${raceId}`;
                const session = global.betSessions[sessionKey];

                if (!session || !session.betType) {
                    return await interaction.editReply({
                        content: 'セッションが失効しました。最初からやり直してください。',
                        embeds: [],
                        components: []
                    });
                }

                const betType = session.betType;

                // レース情報を取得
                const race = await getRaceById(raceId);
                if (!race) {
                    return await interaction.editReply({
                        content: `レースID ${raceId} の情報が見つかりませんでした。`,
                        embeds: [],
                        components: []
                    });
                }

                // 購入方法選択メニュー
                const options = [];

                // 単勝・複勝は通常購入のみ
                if (betType === 'tansho' || betType === 'fukusho') {
                    options.push({
                        label: '通常',
                        value: 'normal',
                        description: `${betTypeNames[betType]}: 選択した馬を購入`,
                        emoji: '🎫'
                    });
                } else {
                    // 他の馬券タイプは通常・ボックス・フォーメーション
                    options.push({
                        label: '通常',
                        value: 'normal',
                        description: `${betTypeNames[betType]}: 選択した馬(枠)を購入`,
                        emoji: '🎫'
                    });

                    options.push({
                        label: 'ボックス',
                        value: 'box',
                        description: `${betTypeNames[betType]}: 選択した馬(枠)の組み合わせを購入`,
                        emoji: '📦'
                    });

                    options.push({
                        label: 'フォーメーション',
                        value: 'formation',
                        description: `${betTypeNames[betType]}: 1着~3着を軸馬と相手馬で購入`,
                        emoji: '📊'
                    });
                }

                const methodRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`bet_select_method_${raceId}`)
                            .setPlaceholder('購入方法を選択してください')
                            .addOptions(options)
                    );

                // 戻るボタン
                const backButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`bet_back_to_type_${raceId}`)
                            .setLabel('馬券種類選択に戻る')
                            .setStyle(ButtonStyle.Secondary)
                    );

                // エンベッド
                const embed = new EmbedBuilder()
                    .setTitle(`🏇 馬券購入 - ${race.venue} ${race.number}R ${race.name}`)
                    .setDescription(`**${betTypeNames[betType]}**の購入方法を選択してください`)
                    .setColor(0x00b0f4)
                    .setTimestamp();

                await interaction.editReply({
                    embeds: [embed],
                    components: [methodRow, backButton]
                });
            }
            else {
                await interaction.editReply({
                    content: '戻る操作が認識できませんでした。',
                    components: []
                });
            }
        } catch (error) {
            logger.error(`戻るボタン処理中にエラー: ${error}`);
            await this.handleError(interaction, error);
        }
    }

    /**
     * マイページを開く
     * @param {ButtonInteraction} interaction - インタラクション
     * @param {Client} client - Discordクライアント
     */
    static async handleMypageButton(interaction, client) {
        try {
            await interaction.deferUpdate().catch(err => {
                logger.warn(`deferUpdate エラー (無視して続行): ${err}`);
            });

            // ユーザー情報を取得
            const user = await getUser(interaction.user.id);
            if (!user) {
                return await interaction.editReply({
                    content: 'ユーザー情報の取得に失敗しました。',
                    embeds: [],
                    components: []
                });
            }

            // マイページの表示処理を直接呼び出すのではなく、
            // mypageモジュールからdisplayMypage関数をインポートして使用
            try {
                // 動的インポート
                const mypageModule = await import('../commands/mypage.js');
                await mypageModule.displayMypage(interaction, user);
            } catch (importError) {
                logger.error(`mypageモジュールのインポートエラー: ${importError}`);
                await interaction.editReply({
                    content: 'マイページの表示に失敗しました。',
                    components: []
                });
            }
        } catch (error) {
            logger.error(`マイページボタン処理中にエラー: ${error}`);
            await this.handleError(interaction, error);
        }
    }

    /**
     * レース詳細画面に戻る
     * @param {MessageComponentInteraction} interaction - インタラクション
     * @param {string} raceId - レースID
     * @param {boolean} showBetMenu - 馬券購入メニューを表示するか
     */
    static async navigateToRaceDetail(interaction, raceId, showBetMenu = false) {
        try {
            // レース情報を取得
            const race = await getRaceById(raceId);
            if (!race) {
                return await interaction.editReply({
                    content: `レースID ${raceId} の情報が見つかりませんでした。`,
                    embeds: [],
                    components: []
                });
            }

            // レース詳細のエンベッド
            const raceEmbed = new EmbedBuilder()
                .setTitle(`🏇 ${race.venue} ${race.number}R ${race.name}`)
                .setDescription(`発走時刻: ${race.time}\nレースID: ${race.id}`)
                .setColor(race.type === 'jra' ? 0x00b0f4 : 0xf47200)
                .setTimestamp();

            // 出走馬情報
            let horsesInfo = '';
            let horses = race.horses || [];

            // 出走馬情報がない場合
            if (!horses || horses.length === 0) {
                horsesInfo = '出走馬情報を取得できませんでした。';
            } else {
                // 馬番でソート
                const sortedHorses = [...horses].sort((a, b) => a.horseNumber - b.horseNumber);

                // 各出走馬の情報表示
                horsesInfo = `**【出走馬一覧】** (${sortedHorses.length}頭)\n\n`;

                sortedHorses.forEach(horse => {
                    const horseName = horse.isCanceled ?
                        `~~${horse.frameNumber}枠${horse.horseNumber}番: ${horse.horseName} ${'  ( ' + horse.jockey + ' )'}~~` :
                        `**${horse.frameNumber}枠${horse.horseNumber}番**: ${horse.horseName} ${horse.odds ? '\n' + horse.jockey : '  ( ' + horse.jockey + ' )'}`;

                    let horseString = `${horseName}  ${horse.odds || ''} ${horse.popularity ? '( ' + horse.popularity + '人気 )' : ''}`;
                    horsesInfo += horseString + '\n\n';
                });

                // 長すぎる場合は適切に省略
                if (horsesInfo.length > 1024) {
                    horsesInfo = horsesInfo.substring(0, 1000) + '...\n\n(表示しきれない馬がいます)';
                }
            }

            raceEmbed.addFields({ name: '出走馬', value: horsesInfo });

            // コンポーネント
            const components = [];

            // 馬券購入メニューを表示するかどうか
            if (showBetMenu) {
                // 馬券種類選択メニュー
                const betTypeRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`bet_select_type_${raceId}`)
                            .setPlaceholder('馬券の種類を選択してください')
                            .addOptions([
                                { label: '単勝', value: 'tansho', description: '1着になる馬を当てる', emoji: '🥇' },
                                { label: '複勝', value: 'fukusho', description: '3着以内に入る馬を当てる', emoji: '🏆' },
                                { label: '枠連', value: 'wakuren', description: '1着と2着になる枠を当てる（順不同）', emoji: '🔢' },
                                { label: '馬連', value: 'umaren', description: '1着と2着になる馬を当てる（順不同）', emoji: '🐎' },
                                { label: 'ワイド', value: 'wide', description: '3着以内に入る2頭の馬を当てる（順不同）', emoji: '📊' },
                                { label: '馬単', value: 'umatan', description: '1着と2着になる馬を当てる（順序通り）', emoji: '🎯' },
                                { label: '三連複', value: 'sanrenpuku', description: '1着から3着までの馬を当てる（順不同）', emoji: '🔄' },
                                { label: '三連単', value: 'sanrentan', description: '1着から3着までの馬を当てる（順序通り）', emoji: '💯' }
                            ])
                    );

                components.push(betTypeRow);
            }

            // 戻るボタン
            const backRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`races_back_${race.date}`)
                        .setLabel('レース一覧に戻る')
                        .setStyle(ButtonStyle.Secondary)
                );

            components.push(backRow);

            await interaction.editReply({
                content: showBetMenu ?
                    'レース詳細と馬券購入画面です。馬券を購入するには、まず馬券の種類を選択してください。' :
                    'レース詳細画面です。',
                embeds: [raceEmbed],
                components: components
            });
        } catch (error) {
            logger.error(`レース詳細画面遷移中にエラー: ${error}`);
            throw error; // 上位ハンドラに委譲
        }
    }

    /**
     * フォーメーション購入用の入力フィールドを追加
     * @param {ModalBuilder} modal - モーダルビルダー
     * @param {string} betType - 馬券タイプ
     */
    static addFormationInputs(modal, betType) {
        if (betType === 'tansho' || betType === 'fukusho') {
            // 単勝・複勝はフォーメーション非対応
            return;
        }

        if (betType === 'umatan' || betType === 'sanrentan') {
            // 順序あり馬券（馬単・三連単）
            if (betType === 'umatan') {
                // 馬単用フィールド
                const firstHorseInput = new TextInputBuilder()
                    .setCustomId('first_horse')
                    .setLabel('1着の馬番（複数指定はカンマ区切り）')
                    .setPlaceholder('例: 1,2,3')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const secondHorseInput = new TextInputBuilder()
                    .setCustomId('second_horse')
                    .setLabel('2着の馬番（複数指定はカンマ区切り）')
                    .setPlaceholder('例: 4,5,6')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const firstRow = new ActionRowBuilder().addComponents(firstHorseInput);
                const secondRow = new ActionRowBuilder().addComponents(secondHorseInput);

                modal.addComponents(firstRow, secondRow);
            } else {
                // 三連単用フィールド
                const firstHorseInput = new TextInputBuilder()
                    .setCustomId('first_horse')
                    .setLabel('1着の馬番（複数指定はカンマ区切り）')
                    .setPlaceholder('例: 1,2')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const secondHorseInput = new TextInputBuilder()
                    .setCustomId('second_horse')
                    .setLabel('2着の馬番（複数指定はカンマ区切り）')
                    .setPlaceholder('例: 3,4')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const thirdHorseInput = new TextInputBuilder()
                    .setCustomId('third_horse')
                    .setLabel('3着の馬番（複数指定はカンマ区切り）')
                    .setPlaceholder('例: 5,6')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const firstRow = new ActionRowBuilder().addComponents(firstHorseInput);
                const secondRow = new ActionRowBuilder().addComponents(secondHorseInput);
                const thirdRow = new ActionRowBuilder().addComponents(thirdHorseInput);

                modal.addComponents(firstRow, secondRow, thirdRow);
            }
        } else {
            // 順序なし馬券（馬連・ワイド・三連複・枠連）
            const horsesInput = new TextInputBuilder()
                .setCustomId('horses')
                .setLabel('馬番を指定（カンマ区切り）')
                .setPlaceholder('例: 1,2,3,4')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const row = new ActionRowBuilder().addComponents(horsesInput);
            modal.addComponents(row);
        }
    }

    /**
     * 馬券タイプと購入方法に応じた最大選択数を取得
     * @param {string} betType - 馬券タイプ
     * @param {string} method - 購入方法
     * @returns {number} 最大選択数
     */
    static getMaxSelectionsForBet(betType, method) {
        if (method === 'normal') {
            // 通常購入の場合は馬券タイプごとの選択数
            const normalSelections = {
                tansho: 1,
                fukusho: 1,
                wakuren: 2,
                umaren: 2,
                wide: 2,
                umatan: 2,
                sanrenpuku: 3,
                sanrentan: 3
            };
            return normalSelections[betType] || 1;
        } else if (method === 'box') {
            // ボックス購入の場合
            if (betType === 'tansho' || betType === 'fukusho') {
                return 1; // ボックス購入できないが、エラー回避のため
            } else if (betType === 'wakuren' || betType === 'umaren' || betType === 'wide' || betType === 'umatan') {
                return 8; // 二連系は最大8頭まで
            } else {
                return 7; // 三連系は最大7頭まで
            }
        }

        return 1;
    }

    /**
     * 馬券タイプに応じた最小選択数を取得
     * @param {string} betType - 馬券タイプ
     * @returns {number} 最小選択数
     */
    static getMinSelectionsForBet(betType) {
        // 最小選択数
        const minSelections = {
            tansho: 1,
            fukusho: 1,
            wakuren: 2,
            umaren: 2,
            wide: 2,
            umatan: 2,
            sanrenpuku: 3,
            sanrentan: 3
        };

        return minSelections[betType] || 1;
    }

    /**
     * 馬リストから選択肢を作成
     * @param {Array} horses - 馬情報の配列
     * @returns {Array} セレクトメニューのオプション配列
     */
    static createHorseOptions(horses) {
        // options配列を初期化
        const options = [];

        if (!horses || horses.length === 0) {
            // 馬情報がない場合はダミーデータ
            for (let i = 1; i <= 16; i++) {
                options.push({
                    label: `${i}番`,
                    description: `${i}番の馬`,
                    value: `${i}`
                });
            }
            return options;
        }

        // 馬番順にソート
        const sortedHorses = [...horses].sort((a, b) => a.horseNumber - b.horseNumber);

        // 馬情報に基づいてオプションを作成
        sortedHorses.forEach(horse => {
            if (!horse.isCanceled) {
                options.push({
                    label: `${horse.frameNumber || '?'}枠${horse.horseNumber}番: ${horse.horseName}`,
                    description: `騎手: ${horse.jockey || '情報なし'}${horse.odds ? ' オッズ: ' + horse.odds : ''}`,
                    value: `${horse.horseNumber}`
                });
            } else {
                // 取消馬も表示するが選択不可にする
                options.push({
                    label: `${horse.frameNumber || '?'}枠${horse.horseNumber}番: ${horse.horseName} 【取消】`,
                    description: `騎手: ${horse.jockey || '情報なし'} - 出走取消`,
                    value: `${horse.horseNumber}`,
                    disabled: true
                });
            }
        });

        return options;
    }

    /**
     * エラーハンドリング共通処理
     * @param {MessageComponentInteraction} interaction - インタラクション
     * @param {Error} error - エラーオブジェクト
     */
    static async handleError(interaction, error) {
        try {
            const errorMessage = `操作中にエラーが発生しました: ${error.message}`;

            if (interaction.deferred) {
                await interaction.editReply({
                    content: errorMessage,
                    components: []
                });
            } else if (interaction.replied) {
                await interaction.followUp({
                    content: errorMessage,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await interaction.reply({
                    content: errorMessage,
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (followupError) {
            logger.error(`エラー処理中に更にエラー発生: ${followupError}`);
        }
    }
}