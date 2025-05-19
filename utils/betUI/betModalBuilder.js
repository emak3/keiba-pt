// utils/betUI/betModalBuilder.js
// 馬券購入関連のモーダル構築を担当するモジュール

import {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder
} from 'discord.js';

/**
 * 馬券購入金額入力モーダルを作成
 * @param {string} customId - モーダルのカスタムID
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 * @param {Object} race - レース情報
 * @returns {ModalBuilder} 構築されたモーダル
 */
export function createAmountInputModal(customId, betType, method, race) {
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
    
    const methodNames = {
        normal: '通常',
        box: 'ボックス',
        formation: 'フォーメーション'
    };

    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(`馬券購入 - ${betTypeNames[betType]}（${methodNames[method]}）`);
    
    // 金額入力フィールド
    const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('購入金額（100pt単位、最大10,000pt）')
        .setPlaceholder('例: 100, 500, 1000')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(5);
    
    const amountRow = new ActionRowBuilder().addComponents(amountInput);
    
    modal.addComponents(amountRow);
    
    return modal;
}

/**
 * フォーメーション購入用のモーダルを作成
 * @param {string} customId - モーダルのカスタムID
 * @param {string} betType - 馬券タイプ
 * @param {Object} race - レース情報
 * @returns {ModalBuilder} 構築されたモーダル
 */
export function createFormationModal(customId, betType, race) {
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

    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(`馬券購入 - ${betTypeNames[betType]}（フォーメーション）`);
    
    // 金額入力フィールド
    const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('購入金額（100pt単位、最大10,000pt）')
        .setPlaceholder('例: 100, 500, 1000')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(5);
    
    const amountRow = new ActionRowBuilder().addComponents(amountInput);
    modal.addComponents(amountRow);
    
    // 馬券タイプに応じたフィールドを追加
    addFormationInputs(modal, betType);
    
    return modal;
}

/**
 * 馬単・三連単用の1着指定モーダルを作成
 * @param {string} customId - モーダルのカスタムID
 * @param {string} betType - 馬券タイプ
 * @param {Object} race - レース情報
 * @returns {ModalBuilder} 構築されたモーダル
 */
export function createOrderedBetModal(customId, betType, race) {
    const betTypeNames = {
        umatan: '馬単',
        sanrentan: '三連単'
    };

    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(`馬券購入 - ${betTypeNames[betType]}`);
    
    // 金額入力フィールド
    const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('購入金額（100pt単位、最大10,000pt）')
        .setPlaceholder('例: 100, 500, 1000')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(5);
    
    const amountRow = new ActionRowBuilder().addComponents(amountInput);
    modal.addComponents(amountRow);
    
    // 1着の馬番入力フィールド
    const firstHorseInput = new TextInputBuilder()
        .setCustomId('first_horse')
        .setLabel('1着の馬番')
        .setPlaceholder('例: 1')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2);
    
    // 2着の馬番入力フィールド
    const secondHorseInput = new TextInputBuilder()
        .setCustomId('second_horse')
        .setLabel('2着の馬番')
        .setPlaceholder('例: 2')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2);
    
    const firstRow = new ActionRowBuilder().addComponents(firstHorseInput);
    const secondRow = new ActionRowBuilder().addComponents(secondHorseInput);
    
    modal.addComponents(firstRow, secondRow);
    
    // 三連単の場合は3着入力フィールドも追加
    if (betType === 'sanrentan') {
        const thirdHorseInput = new TextInputBuilder()
            .setCustomId('third_horse')
            .setLabel('3着の馬番')
            .setPlaceholder('例: 3')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2);
        
        const thirdRow = new ActionRowBuilder().addComponents(thirdHorseInput);
        modal.addComponents(thirdRow);
    }
    
    return modal;
}

/**
 * フォーメーション購入用の入力フィールドを追加
 * @param {ModalBuilder} modal - モーダルビルダー
 * @param {string} betType - 馬券タイプ
 */
function addFormationInputs(modal, betType) {
    if (betType === 'tansho' || betType === 'fukusho') {
        // 単勝・複勝用フィールド - BOX対応用に修正
        const horsesInput = new TextInputBuilder()
            .setCustomId('horses')
            .setLabel('馬番を指定（カンマ区切り）')
            .setPlaceholder('例: 1,2,3')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        
        const row = new ActionRowBuilder().addComponents(horsesInput);
        modal.addComponents(row);
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