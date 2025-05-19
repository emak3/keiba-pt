// utils/betUI/betMenuBuilder.js
// 馬券購入関連のメニュー構築を担当するモジュール

import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} from 'discord.js';

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
 * 馬券種類選択メニューを構築
 * @param {string} raceId - レースID
 * @returns {ActionRowBuilder} 構築されたメニュー
 */
export function createBetTypeMenu(raceId) {
    return new ActionRowBuilder()
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
}

/**
 * 購入方法選択メニューを構築
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ
 * @returns {ActionRowBuilder} 構築されたメニュー
 */
export function createMethodMenu(raceId, betType) {
    const options = [];

    // 全馬券タイプで通常購入
    options.push({
        label: '通常',
        value: 'normal',
        description: `${betTypeNames[betType]}: 選択した馬(枠)を購入`,
        emoji: '🎫'
    });

    // 全馬券タイプでBOX購入対応
    options.push({
        label: 'ボックス',
        value: 'box',
        description: betType === 'tansho' || betType === 'fukusho' ?
            `${betTypeNames[betType]}: 複数の馬に均等に購入` :
            `${betTypeNames[betType]}: 選択した馬の全組み合わせを購入`,
        emoji: '📦'
    });

    // フォーメーションも全馬券タイプで対応
    options.push({
        label: 'フォーメーション',
        value: 'formation',
        description: `${betTypeNames[betType]}: 1着~3着を軸馬と相手馬で購入`,
        emoji: '📊'
    });

    return new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`bet_select_method_${raceId}`)
                .setPlaceholder('購入方法を選択してください')
                .addOptions(options)
        );
}

/**
 * 馬番選択メニューを構築
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 * @param {number} amount - 購入金額
 * @param {Array} horses - 馬情報
 * @returns {ActionRowBuilder} 構築されたメニュー
 */
export function createHorseSelectionMenu(raceId, betType, method, amount, horses) {
    if (betType === 'wakuren') {
        return createFrameSelectionMenu(raceId, betType, method, amount, horses);
    }
    // 馬券タイプと購入方法に応じた最大選択数を取得
    const maxSelections = getMaxSelectionsForBet(betType, method);
    const minSelections = getMinSelectionsForBet(betType);

    return new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`bet_select_horses_${raceId}_${betType}_${method}_${amount}`)
                .setPlaceholder('馬番を選択してください')
                .setMinValues(minSelections)
                .setMaxValues(maxSelections)
                .addOptions(createHorseOptions(horses || []))
        );
}
/**
 * 枠番選択メニューを構築（枠連用）
 */
function createFrameSelectionMenu(raceId, betType, method, amount, horses) {
    const maxSelections = getMaxSelectionsForBet(betType, method);
    const minSelections = getMinSelectionsForBet(betType);

    return new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`bet_select_frames_${raceId}_${betType}_${method}_${amount}`)
                .setPlaceholder('枠番を選択してください')
                .setMinValues(minSelections)
                .setMaxValues(maxSelections)
                .addOptions(createFrameOptions(horses || []))
        );
}

/**
 * 枠リストから選択肢を作成
 */
function createFrameOptions(horses) {
    // 使用されている枠番を集める
    const frameSet = new Set();

    if (horses && horses.length > 0) {
        horses.forEach(horse => {
            if (horse.frameNumber && !horse.isCanceled) {
                frameSet.add(horse.frameNumber);
            }
        });
    }

    // 枠番がない場合は1〜8枠を表示
    if (frameSet.size === 0) {
        for (let i = 1; i <= 8; i++) {
            frameSet.add(i);
        }
    }

    // 枠番順にソートしてオプションを作成
    const options = [];
    [...frameSet].sort((a, b) => a - b).forEach(frameNumber => {
        // その枠に含まれる馬の情報を取得
        const horsesInFrame = horses.filter(h =>
            h.frameNumber === frameNumber && !h.isCanceled
        );

        let description = `${frameNumber}枠`;
        if (horsesInFrame.length > 0) {
            const horseInfo = horsesInFrame.map(h =>
                `${h.horseNumber}番:${h.horseName.substring(0, 5)}`
            ).join(', ');

            description = horseInfo.length > 100
                ? horseInfo.substring(0, 97) + '...'
                : horseInfo;
        }

        options.push({
            label: `${frameNumber}枠`,
            description: description,
            value: `${frameNumber}`
        });
    });

    return options;
}
/**
 * 戻るボタンを構築
 * @param {string} customId - ボタンのカスタムID
 * @param {string} label - ボタンのラベル
 * @returns {ActionRowBuilder} 構築されたボタン
 */
export function createBackButton(customId, label) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel(label)
                .setStyle(ButtonStyle.Secondary)
        );
}

/**
 * 馬券購入確認ボタンを構築
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 * @param {number} amount - 購入金額
 * @param {Array} selectedHorses - 選択された馬番
 * @returns {ActionRowBuilder} 構築されたボタン
 */
export function createConfirmButton(raceId, betType, method, amount, selectedHorses) {
    return new ActionRowBuilder()
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
}

/**
 * 馬券購入確認用エンベッドを構築
 * @param {Object} race - レース情報
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 * @param {Array} selectedHorses - 選択された馬番
 * @param {number} amount - 購入金額
 * @param {number} userPoints - ユーザーの所持ポイント
 * @param {number} totalCost - 合計コスト (組み合わせ数×購入金額)
 * @returns {EmbedBuilder} 構築されたエンベッド
 */
export function createConfirmEmbed(race, betType, method, selectedHorses, amount, userPoints, totalCost) {
    // 選択した馬の情報
    const horseInfos = selectedHorses.map(horseNumber => {
        const horse = race.horses?.find(h => h.horseNumber === horseNumber);
        return horse ?
            `${horseNumber}番: ${horse.horseName} (騎手: ${horse.jockey})` :
            `${horseNumber}番`;
    });

    // 組み合わせ数の表示
    let combinationInfo = '';
    if (method === 'box' || method === 'formation') {
        const combinationCount = calculateCombinations(selectedHorses.length, betType, method);
        combinationInfo = `\n組み合わせ数: ${combinationCount}通り`;
    }

    return new EmbedBuilder()
        .setTitle(`🏇 馬券購入確認 - ${race.venue} ${race.number}R ${race.name}`)
        .setDescription(`**${betTypeNames[betType]}**（${methodNames[method]}）の購入を確定しますか？`)
        .setColor(0x00b0f4)
        .setTimestamp()
        .addFields(
            { name: '選択した馬番', value: horseInfos.join('\n') },
            { name: '購入金額', value: `${amount}pt × ${method === 'box' || method === 'formation' ? '組み合わせ数' : '1組'} = ${totalCost}pt${combinationInfo}` },
            { name: '残りポイント', value: `${userPoints}pt → ${userPoints - totalCost}pt` }
        );
}

/**
 * 馬券購入結果用エンベッドを構築
 * @param {Object} race - レース情報
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 * @param {Array|Array<Array>} selections - 選択した馬番
 * @param {number} amount - 購入金額
 * @param {number} remainingPoints - 残りポイント
 * @returns {EmbedBuilder} 構築されたエンベッド
 */
export function createResultEmbed(race, betType, method, selections, amount, remainingPoints) {
    // 選択馬表示用テキスト生成
    let selectionsDisplay = '';
    if (method === 'normal' && (betType === 'umatan' || betType === 'sanrentan')) {
        // 順序あり馬券
        if (betType === 'umatan') {
            selectionsDisplay = `${selections[0][0]}→${selections[1][0]}`;
        } else {
            selectionsDisplay = `${selections[0][0]}→${selections[1][0]}→${selections[2][0]}`;
        }
    } else if (Array.isArray(selections[0])) {
        // フォーメーション選択
        selectionsDisplay = selections.map(group => `[${group.join(',')}]`).join(' → ');
    } else {
        // その他の馬券
        selectionsDisplay = selections.join('-');
    }

    return new EmbedBuilder()
        .setTitle(`🎫 馬券購入完了`)
        .setDescription(`${betTypeNames[betType]}（${methodNames[method]}）の馬券を購入しました！`)
        .setColor(0x00b0f4)
        .setTimestamp()
        .addFields(
            { name: 'レース', value: `${race.venue} ${race.number}R ${race.name}` },
            { name: '発走時刻', value: race.time },
            { name: '購入金額', value: `${amount}pt` },
            { name: '選択馬番', value: selectionsDisplay },
            { name: '残りポイント', value: `${remainingPoints}pt` }
        );
}

/**
 * 馬券タイプと購入方法に応じた最大選択数を取得
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 * @returns {number} 最大選択数
 */
export function getMaxSelectionsForBet(betType, method) {
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
        // ボックス購入の場合 - 単勝・複勝も複数選択可能に
        if (betType === 'tansho' || betType === 'fukusho') {
            return 5; // 単勝・複勝のボックスは最大5頭まで
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
export function getMinSelectionsForBet(betType) {
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
 * 組み合わせ数を計算する
 * @param {number} selectedCount - 選択した馬の数
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 * @returns {number} 組み合わせ数
 */
export function calculateCombinations(selectedCount, betType, method) {
    // 必要な馬の数
    const requiredHorses = getMinSelectionsForBet(betType);

    if (method === 'box') {
        // 単勝・複勝のBOX対応（各馬ごとに1点）
        if (betType === 'tansho' || betType === 'fukusho') {
            return selectedCount;
        }

        // 組み合わせ数の計算 (nCr)
        return calculateCombination(selectedCount, requiredHorses);
    }

    return 1; // 通常購入は1通り
}

/**
 * 組み合わせ数を計算 (nCr)
 * @param {number} n - 全体の数
 * @param {number} r - 選ぶ数
 * @returns {number} 組み合わせ数
 */
function calculateCombination(n, r) {
    if (r > n) return 0;
    if (r === 0 || r === n) return 1;

    // 分子: n * (n-1) * ... * (n-r+1)
    let numerator = 1;
    for (let i = 0; i < r; i++) {
        numerator *= (n - i);
    }

    // 分母: r!
    let denominator = 1;
    for (let i = 1; i <= r; i++) {
        denominator *= i;
    }

    return Math.round(numerator / denominator);
}

/**
 * 馬リストから選択肢を作成
 * @param {Array} horses - 馬情報の配列
 * @returns {Array} セレクトメニューのオプション配列
 */
export function createHorseOptions(horses) {
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