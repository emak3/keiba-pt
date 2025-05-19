// utils/betHandler.js
// 馬券購入処理のメインハンドラークラス（リファクタリング版）

import { getRaceById } from '../services/database/raceService.js';
import { getUser } from '../services/database/userService.js';
import logger from './logger.js';

// UI関連モジュールをインポート
import * as betMenuBuilder from './betUI/betMenuBuilder.js';
import * as betModalBuilder from './betUI/betModalBuilder.js';
import * as betUtils from './betUI/betUtils.js';

// 購入方法別ハンドラーをインポート
import * as normalBetHandler from './betHandlers/normalBetHandler.js';
import * as boxBetHandler from './betHandlers/boxBetHandler.js';
import * as formationBetHandler from './betHandlers/formationBetHandler.js';

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

            // セッション初期化
            betUtils.updateSession(interaction.user.id, raceId, {
                betType: betType
            });

            // 購入方法選択メニュー
            const methodRow = betMenuBuilder.createMethodMenu(raceId, betType);

            // 戻るボタン
            const backButton = betMenuBuilder.createBackButton(
                `bet_back_to_race_${raceId}`,
                'レース詳細に戻る'
            );

            await interaction.editReply({
                content: `**${betUtils.betTypeNames[betType]}**の購入方法を選択してください`,
                embeds: [],
                components: [methodRow, backButton]
            });
        } catch (error) {
            logger.error(`馬券タイプ選択処理中にエラー: ${error}`);
            await betUtils.handleError(interaction, error);
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
            const sessionKey = `${interaction.user.id}_${raceId}`;
            const session = betUtils.getSession(interaction.user.id, raceId);

            if (!session || !session.betType) {
                return await interaction.editReply({
                    content: 'セッションが失効しました。最初からやり直してください。',
                    embeds: [],
                    components: []
                });
            }

            // セッションに購入方法を追加
            betUtils.updateSession(interaction.user.id, raceId, {
                method: method
            });

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

            // 購入金額入力モーダル表示
            const modal = betModalBuilder.createAmountInputModal(
                `bet_amount_${raceId}_${betType}_${method}`,
                betType,
                method,
                race
            );
            
            await interaction.showModal(modal);
        } catch (error) {
            logger.error(`購入方法選択処理中にエラー: ${error}`);
            await betUtils.handleError(interaction, error);
        }
    }

    /**
     * 馬券金額入力モーダル送信を処理
     * @param {ModalSubmitInteraction} interaction - モーダル送信インタラクション
     */
    static async handleAmountSubmit(interaction) {
        try {
            await interaction.deferUpdate().catch(err => {
                logger.warn(`deferUpdate エラー (無視して続行): ${err}`);
            });

            // カスタムIDからパラメータを解析
            const parts = interaction.customId.split('_');
            // [0]=bet, [1]=amount, [2]=raceId, [3]=betType, [4]=method
            const raceId = parts[2];
            const betType = parts[3];
            const method = parts[4];
            
            // 入力された金額を取得
            const amountInput = interaction.fields.getTextInputValue('amount');
            const amount = betUtils.validateAmount(amountInput);
            
            if (!amount) {
                return await interaction.editReply({
                    content: '購入金額は100pt単位で、100pt以上10,000pt以下で指定してください。',
                    components: []
                });
            }
            
            // 購入方法に応じた処理
            if (method === 'normal') {
                // 通常購入
                await normalBetHandler.startNormalBet(interaction, raceId, betType, amount);
            }
            else if (method === 'box') {
                // BOX購入
                await boxBetHandler.startBoxBet(interaction, raceId, betType, amount);
            }
            else if (method === 'formation') {
                // フォーメーション購入 - 金額はセッションに保存
                betUtils.updateSession(interaction.user.id, raceId, {
                    amount: amount
                });
                
                await formationBetHandler.startFormationBet(interaction, raceId, betType);
            }
        } catch (error) {
            logger.error(`金額入力処理中にエラー: ${error}`);
            await betUtils.handleError(interaction, error);
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

            // 購入方法に応じたハンドラーに振り分け
            if (method === 'normal') {
                await normalBetHandler.handleHorseSelection(interaction, raceId, betType, method, amount, selectedHorses);
            }
            else if (method === 'box') {
                await boxBetHandler.handleHorseSelection(interaction, raceId, betType, method, amount, selectedHorses);
            }
        } catch (error) {
            logger.error(`馬番選択処理中にエラー: ${error}`);
            await betUtils.handleError(interaction, error);
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

            // 購入方法に応じたハンドラーに振り分け
            if (method === 'normal') {
                await normalBetHandler.handleConfirmation(interaction, raceId, betType, method, amount, selectedHorses);
            }
            else if (method === 'box') {
                await boxBetHandler.handleConfirmation(interaction, raceId, betType, method, amount, selectedHorses);
            }
        } catch (error) {
            logger.error(`馬券確定処理中にエラー: ${error}`);
            await betUtils.handleError(interaction, error);
        }
    }
    
    /**
     * 馬単・三連単用の順序指定モーダル送信を処理
     * @param {ModalSubmitInteraction} interaction - モーダル送信インタラクション
     */
    static async handleOrderedBetSubmit(interaction) {
        try {
            await normalBetHandler.handleOrderedBetSubmit(interaction);
        } catch (error) {
            logger.error(`順序指定馬券処理中にエラー: ${error}`);
            await betUtils.handleError(interaction, error);
        }
    }

    /**
     * フォーメーション馬券のモーダル送信を処理
     * @param {ModalSubmitInteraction} interaction - モーダル送信インタラクション
     */
    static async handleFormationBetSubmit(interaction) {
        try {
            await formationBetHandler.handleFormationSubmit(interaction);
        } catch (error) {
            logger.error(`フォーメーション馬券処理中にエラー: ${error}`);
            await betUtils.handleError(interaction, error);
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
                const betTypeRow = betMenuBuilder.createBetTypeMenu(raceId);

                // 戻るボタン
                const backButton = betMenuBuilder.createBackButton(
                    `bet_back_to_race_${raceId}`,
                    'レース詳細に戻る'
                );

                await interaction.editReply({
                    content: 'レース詳細と馬券購入画面です。馬券を購入するには、まず馬券の種類を選択してください。',
                    embeds: [],
                    components: [betTypeRow, backButton]
                });
            }
            // 購入方法選択に戻る
            else if (customId.startsWith('bet_back_to_method_')) {
                const raceId = customId.split('_')[4];

                // セッションを確認
                const session = betUtils.getSession(interaction.user.id, raceId);

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
                const methodRow = betMenuBuilder.createMethodMenu(raceId, betType);

                // 戻るボタン
                const backButton = betMenuBuilder.createBackButton(
                    `bet_back_to_type_${raceId}`,
                    '馬券種類選択に戻る'
                );

                await interaction.editReply({
                    content: `**${betUtils.betTypeNames[betType]}**の購入方法を選択してください`,
                    embeds: [],
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
            await betUtils.handleError(interaction, error);
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
            await betUtils.handleError(interaction, error);
        }
    }

    /**
     * レース詳細画面に戻る
     * @param {MessageComponentInteraction} interaction - インタラクション
     * @param {string} raceId - レースID
     * @param {boolean} showBetMenu - 馬券購入メニューを表示するか
     */
    static async navigateToRaceDetail(interaction, raceId, showBetMenu = true) {
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

            // レース詳細画面表示を races.js から呼び出す
            try {
                // 動的インポート
                const racesModule = await import('../commands/races.js');
                
                // displayRaceDetail関数があれば呼び出す
                if (racesModule.default && typeof racesModule.default.displayRaceDetail === 'function') {
                    await racesModule.default.displayRaceDetail(interaction, raceId, showBetMenu);
                } else {
                    // 関数がない場合は簡易表示
                    const betTypeRow = betMenuBuilder.createBetTypeMenu(raceId);
                    
                    await interaction.editReply({
                        content: `${race.venue} ${race.number}R ${race.name} の詳細画面です。馬券を購入するには、馬券の種類を選択してください。`,
                        components: [betTypeRow]
                    });
                }
            } catch (importError) {
                logger.error(`races.jsモジュールのインポートエラー: ${importError}`);
                
                // インポートエラーの場合は簡易表示
                const betTypeRow = betMenuBuilder.createBetTypeMenu(raceId);
                
                await interaction.editReply({
                    content: `${race.venue} ${race.number}R ${race.name} の詳細画面です。馬券を購入するには、馬券の種類を選択してください。`,
                    components: [betTypeRow]
                });
            }
        } catch (error) {
            logger.error(`レース詳細画面遷移中にエラー: ${error}`);
            await betUtils.handleError(interaction, error);
        }
    }
}