// utils/betHandlers/formationBetHandler.js
// フォーメーション購入の処理を担当するモジュール

import { MessageFlags } from 'discord.js';
import { getRaceById } from '../../services/database/raceService.js';
import { getUser } from '../../services/database/userService.js';
import { placeBet } from '../../services/database/betService.js';
import logger from '../../utils/logger.js';

// UI関連モジュールをインポート
import * as betMenuBuilder from '../betUI/betMenuBuilder.js';
import * as betModalBuilder from '../betUI/betModalBuilder.js';
import * as betUtils from '../betUI/betUtils.js';

/**
 * フォーメーション購入の処理を開始
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ
 */
export async function startFormationBet(interaction, raceId, betType, amount) {
    try {
        await betUtils.safeDeferUpdate(interaction);
        // レース情報を取得
        const race = await getRaceById(raceId);
        if (!race) {
            return await interaction.reply({
                content: `レース情報の取得に失敗しました。`,
                ephemeral: true
            });
        }

        // ユーザー情報を取得
        const user = await getUser(interaction.user.id);
        if (!user) {
            return await interaction.reply({
                content: 'ユーザー情報の取得に失敗しました。',
                ephemeral: true
            });
        }

        // セッション情報を更新
        betUtils.updateSession(interaction.user.id, raceId, {
            method: 'formation',
            amount: amount,
            formationStep: 'first', // フォーメーションのステップを追加
            selections: [] // 選択した馬番を保存する配列
        });

        if (betType === 'umatan' || betType === 'sanrentan') {
            // 順序あり馬券（馬単・三連単）の場合は1着の馬を選択
            await showFirstPositionMenu(interaction, race, raceId, betType, amount);
        } else {
            // 順序なし馬券（馬連・三連複など）の場合は軸馬の選択
            await showKeyHorseMenu(interaction, race, raceId, betType, amount);
        }
    } catch (error) {
        logger.error(`フォーメーション購入開始エラー: ${error}`);
        await betUtils.handleError(interaction, error);
    }
}

// 1着の馬選択メニューを表示
async function showFirstPositionMenu(interaction, race, raceId, betType, amount) {
    // 1着の馬選択用のメニュー構築
    const firstPositionMenu = createPositionSelectionMenu(
        race.horses,
        `bet_formation_first_${raceId}_${betType}_${amount}`,
        "1着の馬を選択してください（複数選択可）",
        5 // 最大選択数
    );

    const backButton = betMenuBuilder.createBackButton(
        `bet_back_to_method_${raceId}`,
        '購入方法選択に戻る'
    );

    await betUtils.safeUpdateInteraction(interaction, {
        content: `**${betUtils.betTypeNames[betType]}**（フォーメーション）- 1着の馬を選択してください`,
        components: [firstPositionMenu, backButton]
    });
}

async function showSecondPositionMenu(interaction, race, raceId, betType, amount, firstSelectedHorses) {
    try {
        // 1着に選択された馬を除外したリストを作成
        const availableHorses = race.horses.filter(horse => 
            !horse.isCanceled && !firstSelectedHorses.includes(horse.horseNumber)
        );
        
        // 2着の馬選択用のメニュー構築
        const secondPositionMenu = createPositionSelectionMenu(
            availableHorses,
            `bet_formation_second_${raceId}_${betType}_${amount}`,
            "2着の馬を選択してください（複数選択可）",
            5 // 最大選択数
        );

        // 戻るボタン（1着選択に戻る）
        const backButton = betMenuBuilder.createBackButton(
            `bet_back_to_first_selection_${raceId}`,
            '1着選択に戻る'
        );

        // 選択された1着馬の表示用テキスト
        const firstSelectedText = firstSelectedHorses.map(horseNumber => {
            const horse = race.horses.find(h => h.horseNumber === horseNumber);
            return horse ? 
                `${horseNumber}番: ${horse.horseName}` : 
                `${horseNumber}番`;
        }).join(', ');

        await betUtils.safeUpdateInteraction(interaction, {
            content: `**${betUtils.betTypeNames[betType]}**（フォーメーション）\n1着の選択: **${firstSelectedText}**\n2着の馬を選択してください（1着に選択した馬は除外されています）`,
            components: [secondPositionMenu, backButton]
        });
    } catch (error) {
        logger.error(`2着馬選択メニュー表示エラー: ${error}`);
        await betUtils.handleError(interaction, error);
    }
}

async function showThirdPositionMenu(interaction, race, raceId, betType, amount, previousSelections) {
    try {
        // 1着と2着に選択された馬を除外
        const firstSelectedHorses = previousSelections[0];
        const secondSelectedHorses = previousSelections[1];
        const alreadySelectedHorses = [...firstSelectedHorses, ...secondSelectedHorses];
        
        const availableHorses = race.horses.filter(horse => 
            !horse.isCanceled && !alreadySelectedHorses.includes(horse.horseNumber)
        );
        
        // 3着の馬選択用のメニュー構築
        const thirdPositionMenu = createPositionSelectionMenu(
            availableHorses,
            `bet_formation_third_${raceId}_${betType}_${amount}`,
            "3着の馬を選択してください（複数選択可）",
            5 // 最大選択数
        );

        // 戻るボタン（2着選択に戻る）
        const backButton = betMenuBuilder.createBackButton(
            `bet_back_to_second_selection_${raceId}`,
            '2着選択に戻る'
        );

        // 選択された1着と2着馬の表示用テキスト
        const firstSelectedText = firstSelectedHorses.map(horseNumber => {
            const horse = race.horses.find(h => h.horseNumber === horseNumber);
            return horse ? 
                `${horseNumber}番: ${horse.horseName}` : 
                `${horseNumber}番`;
        }).join(', ');

        const secondSelectedText = secondSelectedHorses.map(horseNumber => {
            const horse = race.horses.find(h => h.horseNumber === horseNumber);
            return horse ? 
                `${horseNumber}番: ${horse.horseName}` : 
                `${horseNumber}番`;
        }).join(', ');

        await betUtils.safeUpdateInteraction(interaction, {
            content: `**${betUtils.betTypeNames[betType]}**（フォーメーション）\n1着の選択: **${firstSelectedText}**\n2着の選択: **${secondSelectedText}**\n3着の馬を選択してください（1着・2着に選択した馬は除外されています）`,
            components: [thirdPositionMenu, backButton]
        });
    } catch (error) {
        logger.error(`3着馬選択メニュー表示エラー: ${error}`);
        await betUtils.handleError(interaction, error);
    }
}

// 軸馬選択メニューを表示
async function showKeyHorseMenu(interaction, race, raceId, betType, amount) {
    // 軸馬選択用のメニュー構築
    const keyHorseMenu = createPositionSelectionMenu(
        race.horses,
        `bet_formation_key_${raceId}_${betType}_${amount}`,
        "軸馬を選択してください（複数選択可）",
        3 // 最大選択数
    );

    const backButton = betMenuBuilder.createBackButton(
        `bet_back_to_method_${raceId}`,
        '購入方法選択に戻る'
    );

    await betUtils.safeUpdateInteraction(interaction, {
        content: `**${betUtils.betTypeNames[betType]}**（フォーメーション）- 軸馬を選択してください`,
        components: [keyHorseMenu, backButton]
    });
}

// 相手馬選択メニューを表示（馬連・三連複・ワイド用）
async function showPartnerHorseMenu(interaction, race, raceId, betType, amount, keyHorses) {
    try {
        // 軸馬を除外したリストを作成
        const availableHorses = race.horses.filter(horse => 
            !horse.isCanceled && !keyHorses.includes(horse.horseNumber)
        );
        
        // 相手馬選択用のメニュー構築
        const partnerMenu = createPositionSelectionMenu(
            availableHorses,
            `bet_formation_partner_${raceId}_${betType}_${amount}`,
            "相手馬を選択してください（複数選択可）",
            10 // 最大選択数
        );

        // 戻るボタン（軸馬選択に戻る）
        const backButton = betMenuBuilder.createBackButton(
            `bet_back_to_key_selection_${raceId}`,
            '軸馬選択に戻る'
        );

        // 選択された軸馬の表示用テキスト
        const keyHorsesText = keyHorses.map(horseNumber => {
            const horse = race.horses.find(h => h.horseNumber === horseNumber);
            return horse ? 
                `${horseNumber}番: ${horse.horseName}` : 
                `${horseNumber}番`;
        }).join(', ');

        // 馬券タイプに応じたガイダンス
        let guidance = '';
        if (betType === 'umaren' || betType === 'wide') {
            guidance = '相手馬を複数選択することで、軸馬と各相手馬の組み合わせが購入できます。';
        } else if (betType === 'sanrenpuku') {
            guidance = '相手馬を複数選択することで、1着~3着のいずれかに軸馬、残りに相手馬という組み合わせが購入できます。';
        }

        await betUtils.safeUpdateInteraction(interaction, {
            content: `**${betUtils.betTypeNames[betType]}**（フォーメーション）\n軸馬の選択: **${keyHorsesText}**\n相手馬を選択してください（軸馬は除外されています）\n\n${guidance}`,
            components: [partnerMenu, backButton]
        });
    } catch (error) {
        logger.error(`相手馬選択メニュー表示エラー: ${error}`);
        await betUtils.handleError(interaction, error);
    }
}

// 馬番選択メニュー作成関数
function createPositionSelectionMenu(horses, customId, placeholder, maxValues) {
    return new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(customId)
                .setPlaceholder(placeholder)
                .setMinValues(1)
                .setMaxValues(maxValues)
                .addOptions(betMenuBuilder.createHorseOptions(horses))
        );
}

// フォーメーション馬券購入確認ボタンの処理
export async function handleFormationConfirmation(interaction) {
    try {
        await betUtils.safeDeferUpdate(interaction);

        // カスタムIDからパラメータを解析
        const parts = interaction.customId.split('_');
        // [0]=bet, [1]=formation, [2]=confirm, [3]=raceId, [4]=betType, [5]=amount
        const raceId = parts[3];
        const betType = parts[4];
        const amount = parseInt(parts[5], 10);

        // セッションからフォーメーション情報を取得
        const session = betUtils.getSession(interaction.user.id, raceId);
        if (!session || !session.selections) {
            return await betUtils.safeUpdateInteraction(interaction, {
                content: 'セッションが失効しました。最初からやり直してください。',
                components: []
            });
        }

        const selections = session.selections;

        // レース情報を取得
        const race = await getRaceById(raceId);
        if (!race) {
            return await betUtils.safeUpdateInteraction(interaction, {
                content: `レース情報の取得に失敗しました。`,
                components: []
            });
        }

        // 組み合わせ数計算
        let combinationCount = 0;
        if (betType === 'umatan' || betType === 'sanrentan') {
            // 順序あり馬券
            combinationCount = selections.reduce((acc, array) => acc * array.length, 1);
        } else {
            // 順序なし馬券
            const keyHorses = selections[0].length;
            const partnerHorses = selections[1].length;
            const requiredHorses = betUtils.getRequiredSelections(betType);
            
            if (requiredHorses === 2) {
                // 馬連・ワイド
                combinationCount = keyHorses * partnerHorses;
            } else {
                // 三連複 - 組み合わせ計算
                // 3頭のうち1頭が軸馬、残り2頭が相手馬から選ばれる
                combinationCount = keyHorses * betUtils.calculateCombination(partnerHorses, 2);
            }
        }

        // 合計金額を計算
        const totalCost = amount * combinationCount;

        // 馬券購入処理
        try {
            const bet = await placeBet(
                interaction.user.id,
                raceId,
                betType,
                selections,
                'formation',
                totalCost // 注意: 合計金額で購入
            );

            // フォーメーション選択の表示
            let selectionsDisplay = '';
            
            if (betType === 'umatan') {
                selectionsDisplay = `1着: ${selections[0].join(',')} → 2着: ${selections[1].join(',')}`;
            } else if (betType === 'sanrentan') {
                selectionsDisplay = `1着: ${selections[0].join(',')} → 2着: ${selections[1].join(',')} → 3着: ${selections[2].join(',')}`;
            } else {
                // 馬連・三連複・ワイド
                selectionsDisplay = `軸馬: ${selections[0].join(',')} × 相手馬: ${selections[1].join(',')}`;
            }

            // 購入結果を表示
            const user = await getUser(interaction.user.id);
            const resultEmbed = betMenuBuilder.createResultEmbed(
                race,
                betType,
                'formation',
                selections,
                totalCost, // 合計金額
                user.points,
                selectionsDisplay
            );

            // 戻るボタン
            const backButton = betMenuBuilder.createBackButton(
                `bet_back_to_race_${raceId}`,
                'レース詳細に戻る'
            );

            await betUtils.safeUpdateInteraction(interaction, {
                content: `馬券の購入が完了しました！（フォーメーション購入: ${combinationCount}通り）`,
                embeds: [resultEmbed],
                components: [backButton]
            });

        } catch (error) {
            logger.error(`フォーメーション馬券購入処理中にエラー: ${error}`);
            await betUtils.safeUpdateInteraction(interaction, {
                content: `馬券購入中にエラーが発生しました: ${error.message}`,
                components: []
            });
        }
    } catch (error) {
        logger.error(`フォーメーション確認処理中にエラー: ${error}`);
        await betUtils.handleError(interaction, error);
    }
}

// 馬番選択処理関数（新規追加）
export async function handlePositionSelection(interaction) {
    try {
        await betUtils.safeDeferUpdate(interaction);

        // カスタムIDからパラメータを解析
        const parts = interaction.customId.split('_');
        // [0]=bet, [1]=formation, [2]=position, [3]=raceId, [4]=betType, [5]=amount
        const position = parts[2]; // first, second, third, key, partner
        const raceId = parts[3];
        const betType = parts[4];
        const amount = parseInt(parts[5], 10);

        // 選択された馬番
        const selectedHorses = interaction.values.map(v => parseInt(v, 10));

        // レース情報を取得
        const race = await getRaceById(raceId);
        if (!race) {
            return await betUtils.safeUpdateInteraction(interaction, {
                content: `レース情報の取得に失敗しました。`,
                components: []
            });
        }

        // セッションを確認・更新
        const session = betUtils.getSession(interaction.user.id, raceId);
        if (!session) {
            return await betUtils.safeUpdateInteraction(interaction, {
                content: 'セッションが失効しました。最初からやり直してください。',
                components: []
            });
        }

        // セッションに選択を保存
        let selections = session.selections || [];

        if (position === 'first') {
            // 1着馬選択の場合
            selections[0] = selectedHorses;
            betUtils.updateSession(interaction.user.id, raceId, {
                selections,
                formationStep: 'second'
            });

            // 2着馬選択メニューを表示
            await showSecondPositionMenu(interaction, race, raceId, betType, amount, selectedHorses);
        }
        else if (position === 'second') {
            // 2着馬選択の場合
            selections[1] = selectedHorses;

            if (betType === 'sanrentan') {
                // 三連単の場合は3着も選択
                betUtils.updateSession(interaction.user.id, raceId, {
                    selections,
                    formationStep: 'third'
                });

                // 3着馬選択メニューを表示
                await showThirdPositionMenu(interaction, race, raceId, betType, amount, selections);
            } else {
                // 馬単の場合は確認画面へ
                betUtils.updateSession(interaction.user.id, raceId, {
                    selections,
                    formationStep: 'confirm'
                });

                // 確認画面表示
                await showFormationConfirmation(interaction, race, raceId, betType, amount, selections);
            }
        }
        else if (position === 'third') {
            // 3着馬選択の場合（三連単）
            selections[2] = selectedHorses;
            betUtils.updateSession(interaction.user.id, raceId, {
                selections,
                formationStep: 'confirm'
            });

            // 確認画面表示
            await showFormationConfirmation(interaction, race, raceId, betType, amount, selections);
        }
        else if (position === 'key') {
            // 軸馬選択の場合（馬連/三連複/ワイド）
            selections[0] = selectedHorses;
            betUtils.updateSession(interaction.user.id, raceId, {
                selections,
                formationStep: 'partner'
            });

            // 相手馬選択メニューを表示
            await showPartnerHorseMenu(interaction, race, raceId, betType, amount, selectedHorses);
        }
        else if (position === 'partner') {
            // 相手馬選択の場合
            selections[1] = selectedHorses;
            betUtils.updateSession(interaction.user.id, raceId, {
                selections,
                formationStep: 'confirm'
            });

            // 確認画面表示
            await showFormationConfirmation(interaction, race, raceId, betType, amount, selections);
        }
    } catch (error) {
        logger.error(`フォーメーション馬番選択中にエラー: ${error}`);
        await betUtils.handleError(interaction, error);
    }
}

// 馬券購入確認画面表示
async function showFormationConfirmation(interaction, race, raceId, betType, amount, selections) {
    // ユーザー情報を取得
    const user = await getUser(interaction.user.id);

    // 組み合わせ数計算
    let combinationCount = 0;
    if (betType === 'umatan' || betType === 'sanrentan') {
        // 順序あり馬券
        combinationCount = selections.reduce((acc, array) => acc * array.length, 1);
    } else {
        // 順序なし馬券
        const keyHorses = selections[0].length;
        const partnerHorses = selections[1].length;
        const requiredHorses = betUtils.getRequiredSelections(betType);

        if (requiredHorses === 2) {
            // 馬連・ワイド
            combinationCount = keyHorses * partnerHorses;
        } else {
            // 三連複 - 複雑な計算が必要
            combinationCount = calculateFormationCombinations(keyHorses, partnerHorses, requiredHorses);
        }
    }

    // 合計金額を計算
    const totalCost = amount * combinationCount;

    // 確認エンベッド
    const confirmEmbed = betMenuBuilder.createFormationConfirmEmbed(
        race,
        betType,
        selections,
        amount,
        totalCost,
        user.points,
        combinationCount
    );

    // 確認ボタン
    const confirmButton = betMenuBuilder.createFormationConfirmButton(
        raceId,
        betType,
        amount,
        selections
    );

    await betUtils.safeUpdateInteraction(interaction, {
        content: `フォーメーション馬券購入の確認`,
        embeds: [confirmEmbed],
        components: [confirmButton]
    });
}

/**
 * フォーメーション馬券の有効な組み合わせ数を計算
 * @param {Array<Array<number>>|Array<number>} selections - 選択馬（二次元配列または一次元配列）
 * @param {string} betType - 馬券タイプ
 * @returns {number} 有効な組み合わせ数
 */
function calculateFormationCombinations(selections, betType) {
    // 順序あり馬券（馬単・三連単）の場合
    if (betType === 'umatan' || betType === 'sanrentan') {
        const positions = selections; // 各着順の馬番配列

        // 全ての可能な組み合わせを列挙して有効なものだけをカウント
        let validCombinations = 0;

        // 再帰的に組み合わせを生成
        function generateCombinations(currentComb, posIndex) {
            if (posIndex >= positions.length) {
                // 組み合わせが完成したら有効性チェック
                const uniqueHorses = new Set(currentComb);
                if (uniqueHorses.size === currentComb.length) {
                    // 全ての馬が異なれば有効
                    validCombinations++;
                }
                return;
            }

            // 現在の着順における各馬を試す
            for (const horseNumber of positions[posIndex]) {
                // 同じ馬が既に選ばれていないか確認
                const newComb = [...currentComb, horseNumber];
                generateCombinations(newComb, posIndex + 1);
            }
        }

        // 組み合わせ生成を開始
        generateCombinations([], 0);
        return validCombinations;
    }

    // 順序なし馬券（馬連・三連複）の場合
    else {
        // 全ての馬番をフラット化して重複を除去
        const allHorses = Array.isArray(selections[0])
            ? selections.flat()
            : selections;
        const uniqueHorses = [...new Set(allHorses)];

        // 全ての可能な組み合わせをセットで保持
        const combinationSet = new Set();

        // 必要な選択数
        const r = getRequiredSelections(betType);

        // 組み合わせを生成する再帰関数
        function generateUnorderedCombinations(current, start, needed) {
            if (needed === 0) {
                // ソートして一意性を確保
                const key = [...current].sort((a, b) => a - b).join(',');
                combinationSet.add(key);
                return;
            }

            for (let i = start; i < uniqueHorses.length; i++) {
                generateUnorderedCombinations([...current, uniqueHorses[i]], i + 1, needed - 1);
            }
        }

        generateUnorderedCombinations([], 0, r);
        return combinationSet.size;
    }
}

/**
 * フォーメーション購入のモーダル送信を処理
 * @param {ModalSubmitInteraction} interaction - モーダル送信インタラクション
 */
export async function handleFormationSubmit(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // カスタムIDからパラメータを抽出
        const parts = interaction.customId.split('_');
        // [0]=bet, [1]=formation, [2]=raceId, [3]=betType
        const raceId = parts[2];
        const betType = parts[3];

        // 購入金額を取得
        const amountText = interaction.fields.getTextInputValue('amount');
        const amount = betUtils.validateAmount(amountText);

        if (!amount) {
            return await interaction.editReply('購入金額は100pt単位で、100pt以上10,000pt以下で指定してください。');
        }

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
            // 順序なし馬券（馬連・ワイド・三連複・枠連）または追加対応の単勝・複勝
            const horses = interaction.fields.getTextInputValue('horses')
                .split(',')
                .map(num => parseInt(num.trim(), 10))
                .filter(num => !isNaN(num));

            selections = horses;
        }

        // 入力チェック
        if (Array.isArray(selections[0])) {
            // 馬単・三連単のフォーメーション
            let isValid = true;
            let errorMessage = '';

            selections.forEach((posGroup, index) => {
                if (posGroup.length === 0) {
                    isValid = false;
                    errorMessage = `${index + 1}着の馬番が指定されていません。`;
                }
            });

            // 同じ馬番のチェック - 馬単の場合
            if (betType === 'umatan' && isValid) {
                const [firstHorses, secondHorses] = selections;

                const duplicates = firstHorses.filter(horse => secondHorses.includes(horse));
                if (duplicates.length > 0) {
                    isValid = false;
                    errorMessage = `同じ馬番(${duplicates.join(', ')})が1着と2着の両方に指定されています。`;
                }
            }

            // 同じ馬番のチェック - 三連単の場合
            if (betType === 'sanrentan' && isValid) {
                const [firstHorses, secondHorses, thirdHorses] = selections;

                // 1着と2着
                let duplicates = firstHorses.filter(horse => secondHorses.includes(horse));
                if (duplicates.length > 0) {
                    isValid = false;
                    errorMessage = `同じ馬番(${duplicates.join(', ')})が1着と2着の両方に指定されています。`;
                }

                // 1着と3着
                duplicates = firstHorses.filter(horse => thirdHorses.includes(horse));
                if (duplicates.length > 0 && isValid) {
                    isValid = false;
                    errorMessage = `同じ馬番(${duplicates.join(', ')})が1着と3着の両方に指定されています。`;
                }

                // 2着と3着
                duplicates = secondHorses.filter(horse => thirdHorses.includes(horse));
                if (duplicates.length > 0 && isValid) {
                    isValid = false;
                    errorMessage = `同じ馬番(${duplicates.join(', ')})が2着と3着の両方に指定されています。`;
                }
            }

            if (!isValid) {
                return await interaction.editReply(errorMessage);
            }
        } else {
            // 順序なし馬券
            if (selections.length < betUtils.getRequiredSelections(betType)) {
                return await interaction.editReply(`${betUtils.betTypeNames[betType]}には最低${betUtils.getRequiredSelections(betType)}頭の馬番を指定してください。`);
            }

            // 重複チェック
            const uniqueHorses = [...new Set(selections)];
            if (uniqueHorses.length !== selections.length) {
                return await interaction.editReply('同じ馬番が複数回指定されています。');
            }
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

        // 組み合わせ数を計算
        let combinationCount;

        if (Array.isArray(selections[0])) {
            // 馬単・三連単のフォーメーション
            combinationCount = selections.reduce((acc, positions) => acc * positions.length, 1);
        }
        else {
            // 他の馬券タイプ（馬連・三連複など）
            const n = selections.length; // 選択馬数
            const r = betUtils.getRequiredSelections(betType); // 必要な選択数

            // 組み合わせ数の計算 (nCr)
            combinationCount = betUtils.calculateCombination(n, r);
        }

        // 合計金額を計算
        const totalCost = amount * combinationCount;

        // ユーザー情報を取得してポイントチェック
        const user = await getUser(interaction.user.id);
        if (user.points < totalCost) {
            return await interaction.editReply(
                `ポイントが不足しています。現在のポイント: ${user.points}pt、必要なポイント: ${totalCost}pt（${amount}pt × ${combinationCount}通り）`
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
                totalCost // 注意: 合計金額で購入
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

            // 購入結果を表示
            const resultEmbed = betMenuBuilder.createResultEmbed(
                race,
                betType,
                'formation',
                selections,
                totalCost, // 合計金額
                user.points
            );

            // 戻るボタン
            const backButton = betMenuBuilder.createBackButton(
                `bet_back_to_race_${raceId}`,
                'レース詳細に戻る'
            );

            await interaction.editReply({
                content: `馬券の購入が完了しました！（フォーメーション購入: ${combinationCount}通り）`,
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
        await betUtils.handleError(interaction, error);
    }
}