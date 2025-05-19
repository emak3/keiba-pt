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
export async function startFormationBet(interaction, raceId, betType) {
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
        
        // フォーメーション購入用のモーダルを作成
        const modal = betModalBuilder.createFormationModal(
            `bet_formation_${raceId}_${betType}`,
            betType,
            race
        );
        
        await betUtils.safeShowModal(interaction, modal);
    } catch (error) {
        await betUtils.handleError(interaction, error);
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