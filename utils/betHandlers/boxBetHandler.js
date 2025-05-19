// utils/betHandlers/boxBetHandler.js
// BOX購入の処理を担当するモジュール

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
 * BOX購入の処理を開始
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ
 * @param {string} amount - 購入金額
 */
export async function startBoxBet(interaction, raceId, betType, amount) {
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
        
        // 馬番選択メニュー
        const horseMenu = betMenuBuilder.createHorseSelectionMenu(
            raceId,
            betType,
            'box',
            validAmount,
            race.horses
        );
        
        // 戻るボタン
        const backButton = betMenuBuilder.createBackButton(
            `bet_back_to_method_${raceId}`,
            '購入方法選択に戻る'
        );
        
        // BOX購入の説明テキスト
        let boxExplanation = '';
        
        if (betType === 'tansho' || betType === 'fukusho') {
            boxExplanation = `**${betUtils.betTypeNames[betType]}**のBOX購入では、選択した馬それぞれに対して1点ずつ購入します。\n`;
            boxExplanation += `例えば、3頭選択した場合、3点として計算され、金額は${validAmount}pt × 3 = ${validAmount * 3}ptになります。`;
        } else {
            boxExplanation = `**${betUtils.betTypeNames[betType]}**のBOX購入では、選択した馬の全ての組み合わせを自動的に購入します。\n`;
            boxExplanation += `金額は「選択した組み合わせ数 × ${validAmount}pt」になります。`;
        }
        
        await interaction.editReply({
            content: `**${betUtils.betTypeNames[betType]}**（BOX）購入 - 基本金額: ${validAmount}pt\n${boxExplanation}\n\nBOX購入する馬番を選択してください。`,
            components: [horseMenu, backButton]
        });
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
        
        // 組み合わせ数を計算
        let combinationCount;
        
        if (betType === 'tansho' || betType === 'fukusho') {
            // 単勝・複勝のBOX対応（各馬ごとに1点）
            combinationCount = selectedHorses.length;
        } else {
            // 必要な馬の数
            const requiredHorses = betUtils.getRequiredSelections(betType);
            // 組み合わせ数の計算 (nCr)
            combinationCount = betUtils.calculateCombination(selectedHorses.length, requiredHorses);
        }
        
        // 合計金額を計算
        const totalCost = amount * combinationCount;
        
        // ポイント残高チェック
        if (user.points < totalCost) {
            return await interaction.editReply({
                content: `ポイントが不足しています。(現在: ${user.points}pt、必要: ${totalCost}pt)`,
                components: []
            });
        }
        
        // 確認エンベッド
        const confirmEmbed = betMenuBuilder.createConfirmEmbed(
            race,
            betType,
            method,
            selectedHorses,
            amount,
            user.points,
            totalCost
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
        
        // 組み合わせ数を計算
        let combinationCount;
        
        if (betType === 'tansho' || betType === 'fukusho') {
            // 単勝・複勝のBOX対応（各馬ごとに1点）
            combinationCount = selectedHorses.length;
        } else {
            // 必要な馬の数
            const requiredHorses = betUtils.getRequiredSelections(betType);
            // 組み合わせ数の計算 (nCr)
            combinationCount = betUtils.calculateCombination(selectedHorses.length, requiredHorses);
        }
        
        // 合計金額を計算
        const totalCost = amount * combinationCount;
        
        try {
            // 馬券購入処理
            const bet = await placeBet(
                interaction.user.id,
                raceId,
                betType,
                selectedHorses,
                method,
                totalCost // 注意: 合計金額で購入
            );
            
            // 購入結果を表示
            const user = await getUser(interaction.user.id);
            const resultEmbed = betMenuBuilder.createResultEmbed(
                race,
                betType,
                method,
                selectedHorses,
                totalCost, // 合計金額
                user.points
            );
            
            // 戻るボタン
            const backButton = betMenuBuilder.createBackButton(
                `bet_back_to_race_${raceId}`,
                'レース詳細に戻る'
            );
            
            await interaction.editReply({
                content: `馬券の購入が完了しました！（BOX購入: ${selectedHorses.length}頭、${combinationCount}通り）`,
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