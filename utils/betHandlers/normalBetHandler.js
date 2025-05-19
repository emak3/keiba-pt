// utils/betHandlers/normalBetHandler.js
// 通常購入の処理を担当するモジュール

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
 * 通常購入の処理を開始
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ
 * @param {string} amount - 購入金額
 */
export async function startNormalBet(interaction, raceId, betType, amount) {
    try {
        // 検証済みの金額を取得
        const validAmount = betUtils.validateAmount(amount);
        if (!validAmount) {
            return await interaction.editReply({
                content: '購入金額は100pt単位で、100pt以上10,000pt以下で指定してください。',
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
        
        // ユーザー情報を取得
        const user = await getUser(interaction.user.id);
        if (!user) {
            return await interaction.editReply({
                content: 'ユーザー情報の取得に失敗しました。',
                components: []
            });
        }
        
        // ポイント残高チェック
        if (user.points < validAmount) {
            return await interaction.editReply({
                content: `ポイントが不足しています。(現在: ${user.points}pt、必要: ${validAmount}pt)`,
                components: []
            });
        }
        
        // 馬単・三連単の場合は順序入力モーダルを表示
        if (betType === 'umatan' || betType === 'sanrentan') {
            const modal = betModalBuilder.createOrderedBetModal(
                `bet_ordered_normal_${raceId}_${betType}_${validAmount}`,
                betType,
                race
            );
            
            await betUtils.safeShowModal(interaction, modal);
            return;
        }
        
        // その他の馬券タイプは馬番選択メニュー
        const horseMenu = betMenuBuilder.createHorseSelectionMenu(
            raceId,
            betType,
            'normal',
            validAmount,
            race.horses
        );
        
        // 戻るボタン
        const backButton = betMenuBuilder.createBackButton(
            `bet_back_to_method_${raceId}`,
            '購入方法選択に戻る'
        );
        
        await interaction.editReply({
            content: `**${betUtils.betTypeNames[betType]}**（通常）購入 - 金額: ${validAmount}pt\n馬番を選択してください。`,
            components: [horseMenu, backButton]
        });
    } catch (error) {
        await betUtils.handleError(interaction, error);
    }
}

/**
 * 馬単・三連単用の順序指定モーダル送信を処理
 * @param {ModalSubmitInteraction} interaction - モーダル送信インタラクション
 */
export async function handleOrderedBetSubmit(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    try {
        // カスタムIDからパラメータを抽出
        const parts = interaction.customId.split('_');
        // [0]=bet, [1]=ordered, [2]=normal, [3]=raceId, [4]=betType, [5]=amount
        const raceId = parts[3];
        const betType = parts[4];
        const amount = parseInt(parts[5], 10);
        
        // 入力値を取得
        const firstHorse = parseInt(interaction.fields.getTextInputValue('first_horse'), 10);
        const secondHorse = parseInt(interaction.fields.getTextInputValue('second_horse'), 10);
        
        // レース情報を取得
        const race = await getRaceById(raceId);
        if (!race) {
            return await interaction.editReply(`レースID ${raceId} の情報が見つかりませんでした。`);
        }
        
        // 馬番チェック
        if (isNaN(firstHorse) || isNaN(secondHorse) || firstHorse <= 0 || secondHorse <= 0) {
            return await interaction.editReply('無効な馬番が入力されました。数字で入力してください。');
        }
        
        // 同じ馬番のチェック
        if (firstHorse === secondHorse) {
            return await interaction.editReply('同じ馬番を複数の着順に指定することはできません。');
        }
        
        // 三連単の場合は3着も取得
        let thirdHorse = null;
        if (betType === 'sanrentan') {
            thirdHorse = parseInt(interaction.fields.getTextInputValue('third_horse'), 10);
            
            // 馬番チェック
            if (isNaN(thirdHorse) || thirdHorse <= 0) {
                return await interaction.editReply('無効な馬番が入力されました。数字で入力してください。');
            }
            
            // 同じ馬番のチェック
            if (thirdHorse === firstHorse || thirdHorse === secondHorse) {
                return await interaction.editReply('同じ馬番を複数の着順に指定することはできません。');
            }
        }
        
        // 選択馬番配列の構築
        let selectedHorses;
        let selections;
        
        if (betType === 'umatan') {
            selectedHorses = [firstHorse, secondHorse];
            selections = [[firstHorse], [secondHorse]];
        } else { // sanrentan
            selectedHorses = [firstHorse, secondHorse, thirdHorse];
            selections = [[firstHorse], [secondHorse], [thirdHorse]];
        }
        
        // 取消馬チェック
        const canceledHorses = race.horses.filter(h => h.isCanceled && selectedHorses.includes(h.horseNumber));
        if (canceledHorses.length > 0) {
            const canceledNames = canceledHorses.map(h => `${h.horseNumber}番: ${h.horseName}`).join('\n');
            return await interaction.editReply(`選択した馬に出走取消馬が含まれています。\n${canceledNames}`);
        }
        
        try {
            // 馬券購入処理
            const bet = await placeBet(
                interaction.user.id,
                raceId,
                betType,
                selections,
                'normal',
                amount
            );
            
            // 選択馬表示用テキスト生成
            let selectionsDisplay = '';
            if (betType === 'umatan') {
                selectionsDisplay = `${firstHorse}→${secondHorse}`;
            } else { // sanrentan
                selectionsDisplay = `${firstHorse}→${secondHorse}→${thirdHorse}`;
            }
            
            // 購入結果を表示
            const user = await getUser(interaction.user.id);
            const resultEmbed = betMenuBuilder.createResultEmbed(
                race,
                betType,
                'normal',
                selections,
                amount,
                user.points
            );
            
            // 戻るボタン
            const backButton = betMenuBuilder.createBackButton(
                `bet_back_to_race_${raceId}`,
                'レース詳細に戻る'
            );
            
            await interaction.editReply({
                content: `馬券の購入が完了しました！`,
                embeds: [resultEmbed],
                components: [backButton]
            });
            
        } catch (error) {
            logger.error(`馬券購入処理中にエラー: ${error}`);
            await interaction.editReply({
                content: `馬券購入中にエラーが発生しました: ${error.message}`
            });
        }
        
    } catch (error) {
        await betUtils.handleError(interaction, error);
    }
}

/**
 * 馬番選択後の処理
 * @param {StringSelectMenuInteraction} interaction - インタラクション
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 * @param {number} amount - 購入金額
 * @param {Array<number>} selectedHorses - 選択された馬番
 */
export async function handleHorseSelection(interaction, raceId, betType, method, amount, selectedHorses) {
    try {
        // レース情報を取得
        const race = await getRaceById(raceId);
        if (!race) {
            return await interaction.editReply({
                content: `レース情報の取得に失敗しました。`,
                components: []
            });
        }
        
        // ユーザー情報を取得
        const user = await getUser(interaction.user.id);
        if (!user) {
            return await interaction.editReply({
                content: 'ユーザー情報の取得に失敗しました。',
                components: []
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
        const confirmEmbed = betMenuBuilder.createConfirmEmbed(
            race,
            betType,
            method,
            selectedHorses,
            amount,
            user.points,
            amount // 通常購入は組み合わせ数が1なのでそのまま
        );
        
        // 確認ボタン
        const confirmButton = betMenuBuilder.createConfirmButton(
            raceId,
            betType,
            method,
            amount,
            selectedHorses
        );
        
        await interaction.editReply({
            embeds: [confirmEmbed],
            components: [confirmButton]
        });
    } catch (error) {
        await betUtils.handleError(interaction, error);
    }
}

/**
 * 馬券購入確認の処理
 * @param {ButtonInteraction} interaction - インタラクション
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 * @param {number} amount - 購入金額
 * @param {Array<number>} selectedHorses - 選択された馬番
 */
export async function handleConfirmation(interaction, raceId, betType, method, amount, selectedHorses) {
    try {
        // レース情報を取得
        const race = await getRaceById(raceId);
        if (!race) {
            return await interaction.editReply({
                content: `レース情報の取得に失敗しました。`,
                components: []
            });
        }
        
        // 選択内容を処理
        let selections = selectedHorses;

        // 順序あり馬券（馬単・三連単）の場合は配列構造を変換
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
            
            // 購入結果を表示
            const user = await getUser(interaction.user.id);
            const resultEmbed = betMenuBuilder.createResultEmbed(
                race,
                betType,
                method,
                selections,
                amount,
                user.points
            );
            
            // 戻るボタン
            const backButton = betMenuBuilder.createBackButton(
                `bet_back_to_race_${raceId}`,
                'レース詳細に戻る'
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
        await betUtils.handleError(interaction, error);
    }
}