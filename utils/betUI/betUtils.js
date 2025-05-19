// utils/betUI/betUtils.js の修正版
// 馬券購入関連の共通ユーティリティ（エラー処理強化版）

import { MessageFlags } from 'discord.js';
import logger from '../../utils/logger.js';
import SafeInteraction from '../safeInteraction.js';

/**
 * 馬券タイプの名称マッピング
 */
export const betTypeNames = {
    tansho: '単勝',
    fukusho: '複勝',
    wakuren: '枠連',
    umaren: '馬連',
    wide: 'ワイド',
    umatan: '馬単',
    sanrenpuku: '三連複',
    sanrentan: '三連単'
};

/**
 * 購入方法の名称マッピング
 */
export const methodNames = {
    normal: '通常',
    box: 'ボックス',
    formation: 'フォーメーション'
};

/**
 * セッション管理のグローバル変数を初期化
 */
export function initBetSessions() {
    if (!global.betSessions) {
        global.betSessions = {};
    }
}

/**
 * セッションを取得する
 * @param {string} userId - ユーザーID
 * @param {string} raceId - レースID
 * @returns {Object|null} セッション情報またはnull
 */
export function getSession(userId, raceId) {
    initBetSessions();

    const sessionKey = `${userId}_${raceId}`;
    const session = global.betSessions[sessionKey];

    // セッションの有効期限チェック (1時間)
    if (session && session.timestamp) {
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;

        if (now - session.timestamp > oneHour) {
            // 期限切れのセッションを削除
            delete global.betSessions[sessionKey];
            return null;
        }
    }

    return session;
}

/**
 * セッションを作成/更新する
 * @param {string} userId - ユーザーID
 * @param {string} raceId - レースID
 * @param {Object} data - セッションデータ
 * @returns {Object} 更新されたセッション
 */
export function updateSession(userId, raceId, data) {
    initBetSessions();

    const sessionKey = `${userId}_${raceId}`;
    const existingSession = global.betSessions[sessionKey] || {};

    const updatedSession = {
        ...existingSession,
        ...data,
        timestamp: Date.now() // タイムスタンプを更新
    };

    global.betSessions[sessionKey] = updatedSession;
    return updatedSession;
}

/**
 * セッションを削除する
 * @param {string} userId - ユーザーID
 * @param {string} raceId - レースID
 */
export function clearSession(userId, raceId) {
    initBetSessions();

    const sessionKey = `${userId}_${raceId}`;
    delete global.betSessions[sessionKey];
}

/**
 * 購入金額のバリデーション
 * @param {string|number} amount - 入力された金額
 * @returns {number|null} 有効な金額または無効な場合はnull
 */
export function validateAmount(amount) {
    // 文字列から数値に変換
    if (typeof amount === 'string') {
        amount = parseInt(amount.replace(/[^\d]/g, ''), 10);
    }

    // 数値でない場合はnullを返す
    if (isNaN(amount)) {
        return null;
    }

    // 100pt未満または10,000ptより大きい場合は無効
    if (amount < 100 || amount > 10000) {
        return null;
    }

    // 100pt単位でない場合は無効
    if (amount % 100 !== 0) {
        return null;
    }

    return amount;
}

/**
 * 馬券タイプと購入方法に応じた購入金額を計算
 * @param {string} betType - 馬券タイプ
 * @param {string} method - 購入方法
 * @param {Array} selections - 選択された馬番または馬番グループ
 * @param {number} baseAmount - 基本購入金額
 * @returns {number} 計算された購入金額
 */
export function calculateTotalCost(betType, method, selections, baseAmount) {
    if (method === 'normal') {
        // 通常購入は基本金額のまま
        return baseAmount;
    }

    let combinationCount = 1;

    if (method === 'box') {
        // BOX購入の組み合わせ数を計算

        // 単勝・複勝のBOX対応（各馬ごとに1点）
        if (betType === 'tansho' || betType === 'fukusho') {
            combinationCount = selections.length;
        }
        // 通常のBOX購入
        else {
            const n = selections.length; // 選択馬数
            const r = getRequiredSelections(betType); // 必要な選択数

            // 組み合わせ数の計算 (nCr)
            combinationCount = calculateCombination(n, r);
        }
    }
    else if (method === 'formation') {
        // フォーメーション購入の組み合わせ数を計算
        if (Array.isArray(selections[0])) {
            // 馬単・三連単のフォーメーション
            combinationCount = selections.reduce((acc, positions) => acc * positions.length, 1);
        }
        else {
            // 他の馬券タイプ（馬連・三連複など）
            const n = selections.length; // 選択馬数
            const r = getRequiredSelections(betType); // 必要な選択数

            // 組み合わせ数の計算 (nCr)
            combinationCount = calculateCombination(n, r);
        }
    }

    return baseAmount * combinationCount;
}

/**
 * 組み合わせ数を計算 (nCr)
 * @param {number} n - 全体の数
 * @param {number} r - 選ぶ数
 * @returns {number} 組み合わせ数
 */
export function calculateCombination(n, r) {
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
 * 馬券タイプに応じた必要選択数を取得
 * @param {string} betType - 馬券タイプ
 * @returns {number} 必要な選択数
 */
export function getRequiredSelections(betType) {
    const requirements = {
        tansho: 1,     // 単勝: 1頭
        fukusho: 1,    // 複勝: 1頭
        wakuren: 2,    // 枠連: 2枠
        umaren: 2,     // 馬連: 2頭
        wide: 2,       // ワイド: 2頭
        umatan: 2,     // 馬単: 2頭
        sanrenpuku: 3, // 三連複: 3頭
        sanrentan: 3   // 三連単: 3頭
    };

    return requirements[betType] || 0;
}

/**
 * [改善版] エラーハンドリング共通処理
 * インタラクションの状態を考慮して適切なエラー応答を行う
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {Error} error - エラーオブジェクト
 */
export async function handleError(interaction, error) {
    // SafeInteractionクラスのエラーハンドリング機能を使用
    await SafeInteraction.handleError(interaction, error);
}

/**
 * [新機能] インタラクションを安全に更新する
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {Object} options - 更新オプション
 */
export async function safeUpdateInteraction(interaction, options) {
    await SafeInteraction.safeUpdate(interaction, options);
}

/**
 * [新機能] インタラクションを安全に遅延応答する
 * @param {MessageComponentInteraction} interaction - インタラクション
 */
export async function safeDeferUpdate(interaction) {
    if (interaction.replied || interaction.deferred) {
        // 既に応答済みの場合は何もしない
        logger.debug('インタラクションは既に応答済みです。deferUpdateはスキップします。');
        return;
    }

    try {
        await interaction.deferUpdate().catch(err => {
            logger.warn(`deferUpdate エラー (リカバリを試みます): ${err}`);
            // deferUpdateが失敗した場合はdeferReplyを試す
            return interaction.deferReply({ ephemeral: true }).catch(deferReplyErr => {
                logger.error(`deferReply もエラー: ${deferReplyErr}`);
                // 両方失敗した場合は例外をスロー
                throw new Error('インタラクション応答に失敗しました');
            });
        });
    } catch (error) {
        // エラーハンドリング
        logger.error(`safeDeferUpdate エラー: ${error}`);
        throw error;
    }
}

/**
 * [新機能] モーダルを安全に表示する
 * @param {MessageComponentInteraction} interaction - インタラクション
 * @param {ModalBuilder} modal - 表示するモーダル
 */
export async function safeShowModal(interaction, modal) {
    await SafeInteraction.safeShowModal(interaction, modal);
}