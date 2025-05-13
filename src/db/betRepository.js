// src/db/betRepository.js
const { getFirestore, createTimestamp, runTransaction, getBatch } = require('./firebase');
const { getUserById, updateUserPoints } = require('./userRepository');
const { getRaceById } = require('./raceRepository');
const logger = require('../utils/logger');

// Firestoreのコレクション名
const BETS_COLLECTION = 'bets';

/**
 * 馬券データを保存する
 * @param {Object} betData - 馬券データ
 * @returns {Promise<string>} - 馬券ID
 */
async function saveBet(betData) {
  try {
    const db = getFirestore();
    const now = createTimestamp();
    
    // ユーザーIDとレースIDが必要
    if (!betData.userId || !betData.raceId) {
      throw new Error('ユーザーIDとレースIDが必要です');
    }
    
    // レース情報の確認
    const race = await getRaceById(betData.raceId);
    if (!race) {
      throw new Error(`レースが存在しません: ${betData.raceId}`);
    }
    
    // レースが締め切り前かチェック
    if (race.status === 'closed' || race.status === 'finished') {
      throw new Error(`レースは既に締め切られています: ${betData.raceId}`);
    }
    
    // ユーザー情報の確認
    const user = await getUserById(betData.userId);
    if (!user) {
      throw new Error(`ユーザーが存在しません: ${betData.userId}`);
    }
    
    // ポイントが十分かチェック
    if (user.points < betData.amount) {
      throw new Error('ポイントが足りません');
    }
    
    // トランザクションで馬券保存とポイント減算を行う
    return await runTransaction(async (transaction) => {
      // 新しい馬券IDを生成
      const betRef = db.collection(BETS_COLLECTION).doc();
      const betId = betRef.id;
      
      // 馬券データ
      const data = {
        ...betData,
        id: betId,
        status: 'active',
        payout: 0,
        createdAt: now
      };
      
      // 馬券を保存
      transaction.set(betRef, data);
      
      // ユーザーからポイントを減算
      const userRef = db.collection('users').doc(betData.userId);
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new Error(`ユーザーが存在しません: ${betData.userId}`);
      }
      
      const userData = userDoc.data();
      const currentPoints = userData.points || 0;
      const newPoints = currentPoints - betData.amount;
      
      if (newPoints < 0) {
        throw new Error('ポイントが足りません');
      }
      
      // ポイント履歴を追加
      const pointHistory = userData.pointHistory || [];
      pointHistory.push({
        amount: -betData.amount,
        reason: `馬券購入: ${race.name} (${betData.type})`,
        timestamp: now
      });
      
      // 履歴は最新100件に制限
      while (pointHistory.length > 100) {
        pointHistory.shift();
      }
      
      // ユーザー情報を更新
      transaction.update(userRef, {
        points: newPoints,
        pointHistory,
        updatedAt: now
      });
      
      logger.info(`馬券を登録しました: ${betId}, ユーザー: ${betData.userId}, レース: ${betData.raceId}`);
      return betId;
    });
  } catch (error) {
    logger.error('馬券登録に失敗しました', error);
    throw error;
  }
}

/**
 * 馬券情報を取得する
 * @param {string} betId - 馬券ID
 * @returns {Promise<Object|null>} - 馬券情報
 */
async function getBetById(betId) {
  try {
    const db = getFirestore();
    const docRef = await db.collection(BETS_COLLECTION).doc(betId).get();
    
    if (!docRef.exists) {
      return null;
    }
    
    return { id: docRef.id, ...docRef.data() };
  } catch (error) {
    logger.error(`馬券情報の取得に失敗しました: ${betId}`, error);
    throw error;
  }
}

/**
 * ユーザーの馬券一覧を取得する
 * @param {string} userId - ユーザーID
 * @param {Object} [options] - 取得オプション
 * @param {string} [options.status] - ステータスでフィルタ
 * @param {number} [options.limit=50] - 取得件数
 * @returns {Promise<Array>} - 馬券情報の配列
 */
async function getUserBets(userId, options = {}) {
  try {
    const db = getFirestore();
    let query = db.collection(BETS_COLLECTION)
      .where('userId', '==', userId);
    
    // ステータスフィルタ
    if (options.status) {
      query = query.where('status', '==', options.status);
    }
    
    // 作成日時でソート
    query = query.orderBy('createdAt', 'desc');
    
    // 取得件数
    const limit = options.limit || 50;
    query = query.limit(limit);
    
    const snapshot = await query.get();
    
    if (snapshot.empty) {
      return [];
    }
    
    const bets = [];
    snapshot.forEach(doc => {
      bets.push({ id: doc.id, ...doc.data() });
    });
    
    return bets;
  } catch (error) {
    logger.error(`ユーザーの馬券一覧取得に失敗しました: ${userId}`, error);
    throw error;
  }
}

/**
 * レースの馬券一覧を取得する
 * @param {string} raceId - レースID
 * @param {Object} [options] - 取得オプション
 * @param {string} [options.status] - ステータスでフィルタ
 * @param {number} [options.limit=100] - 取得件数
 * @returns {Promise<Array>} - 馬券情報の配列
 */
async function getRaceBets(raceId, options = {}) {
  try {
    const db = getFirestore();
    let query = db.collection(BETS_COLLECTION)
      .where('raceId', '==', raceId);
    
    // ステータスフィルタ
    if (options.status) {
      query = query.where('status', '==', options.status);
    }
    
    // 取得件数
    const limit = options.limit || 100;
    query = query.limit(limit);
    
    const snapshot = await query.get();
    
    if (snapshot.empty) {
      return [];
    }
    
    const bets = [];
    snapshot.forEach(doc => {
      bets.push({ id: doc.id, ...doc.data() });
    });
    
    return bets;
  } catch (error) {
    logger.error(`レースの馬券一覧取得に失敗しました: ${raceId}`, error);
    throw error;
  }
}

/**
 * レースの馬券を締め切る
 * @param {string} raceId - レースID
 * @returns {Promise<number>} - 更新した馬券数
 */
async function closeBetsByRaceId(raceId) {
  try {
    const db = getFirestore();
    const now = createTimestamp();
    
    // アクティブな馬券を検索
    const snapshot = await db.collection(BETS_COLLECTION)
      .where('raceId', '==', raceId)
      .where('status', '==', 'active')
      .get();
    
    if (snapshot.empty) {
      logger.info(`締め切るアクティブな馬券はありません: ${raceId}`);
      return 0;
    }
    
    // バッチ処理で一括更新
    const batch = getBatch();
    let count = 0;
    
    snapshot.forEach(doc => {
      batch.update(doc.ref, {
        status: 'closed',
        updatedAt: now
      });
      count++;
    });
    
    await batch.commit();
    logger.info(`${count}件の馬券を締め切りました: ${raceId}`);
    
    return count;
  } catch (error) {
    logger.error(`馬券の締め切りに失敗しました: ${raceId}`, error);
    throw error;
  }
}

/**
 * 馬券の払戻処理
 * @param {string} raceId - レースID
 * @param {Object} raceResult - レース結果
 * @returns {Promise<Object>} - 処理結果
 */
async function processBetPayouts(raceId, raceResult) {
  try {
    // レース結果のチェック
    if (!raceResult || !raceResult.results || !raceResult.payouts) {
      throw new Error('有効なレース結果が必要です');
    }
    
    // 閉じられた馬券を取得
    const bets = await getRaceBets(raceId, { status: 'closed' });
    if (bets.length === 0) {
      logger.info(`払戻対象の馬券はありません: ${raceId}`);
      return { processed: 0, hit: 0, payoutTotal: 0 };
    }
    
    // 結果と払戻情報
    const { results, payouts } = raceResult;
    
    // 処理結果の集計用
    let processed = 0;
    let hit = 0;
    let payoutTotal = 0;
    
    // 各馬券を処理
    for (const bet of bets) {
      try {
        // 馬券タイプに応じた的中判定と払戻金計算
        const { isHit, payout } = calculatePayout(bet, results, payouts);
        
        // 的中した馬券の処理
        if (isHit && payout > 0) {
          // ユーザーにポイントを加算
          await updateUserPoints(
            bet.userId,
            payout,
            `馬券的中: ${raceId} (${bet.type})`
          );
          
          // 馬券のステータスを更新
          await updateBetStatus(bet.id, 'won', payout);
          
          hit++;
          payoutTotal += payout;
        } else {
          // 外れた馬券の処理
          await updateBetStatus(bet.id, 'lost', 0);
        }
        
        processed++;
      } catch (error) {
        logger.error(`馬券の払戻処理に失敗しました: ${bet.id}`, error);
        // 続行する
      }
    }
    
    logger.info(`馬券払戻処理完了: ${raceId}, 処理数: ${processed}, 的中: ${hit}, 払戻総額: ${payoutTotal}`);
    
    return { processed, hit, payoutTotal };
  } catch (error) {
    logger.error(`馬券払戻処理に失敗しました: ${raceId}`, error);
    throw error;
  }
}

/**
 * 馬券のステータスを更新
 * @param {string} betId - 馬券ID
 * @param {string} status - 新しいステータス
 * @param {number} payout - 払戻金額
 * @returns {Promise<void>}
 */
async function updateBetStatus(betId, status, payout) {
  try {
    const db = getFirestore();
    const now = createTimestamp();
    
    await db.collection(BETS_COLLECTION).doc(betId).update({
      status,
      payout,
      updatedAt: now
    });
  } catch (error) {
    logger.error(`馬券ステータスの更新に失敗しました: ${betId}`, error);
    throw error;
  }
}

/**
 * 馬券の的中判定と払戻金計算
 * @param {Object} bet - 馬券情報
 * @param {Array} results - レース結果
 * @param {Object} payouts - 払戻情報
 * @returns {Object} - 的中判定と払戻金
 */
function calculatePayout(bet, results, payouts) {
  // 馬券タイプに応じた判定と計算
  const { type, method, selections, amount } = bet;
  
  // デフォルト値
  let isHit = false;
  let payout = 0;
  
  // 馬券タイプ別の処理
  switch (type) {
    case 'tansho': // 単勝
      isHit = selections.includes(results[0].horseNumber);
      if (isHit && payouts.tanshoAmount) {
        payout = Math.floor(amount * (payouts.tanshoAmount / 100));
      }
      break;
      
    case 'fukusho': // 複勝
      // 複勝の的中馬番
      const fukushoWinners = payouts.fukusho || [];
      // 選択した馬番が的中馬番に含まれるかチェック
      isHit = selections.some(number => fukushoWinners.includes(number));
      
      if (isHit && payouts.fukushoAmounts) {
        // 的中した選択肢のインデックスを取得
        const hitIndex = fukushoWinners.findIndex(number => selections.includes(number));
        if (hitIndex >= 0 && payouts.fukushoAmounts[hitIndex]) {
          payout = Math.floor(amount * (payouts.fukushoAmounts[hitIndex] / 100));
        }
      }
      break;
      
    case 'wakuren': // 枠連
      // 枠連の的中枠番
      const wakurenWinners = payouts.wakuren || [];
      // 選択と的中枠の一致をチェック
      isHit = method === 'box' ?
        // ボックス投票の場合
        selections.every(frame => wakurenWinners.includes(frame)) && 
        wakurenWinners.every(frame => selections.includes(frame)) :
        // 通常投票の場合
        selections[0] === wakurenWinners[0] && selections[1] === wakurenWinners[1];
      
      if (isHit && payouts.wakurenAmount) {
        payout = Math.floor(amount * (payouts.wakurenAmount / 100));
      }
      break;
      
    case 'umaren': // 馬連
      // 馬連の的中馬番
      const umarenWinners = payouts.umaren || [];
      // 選択と的中馬番の一致をチェック
      isHit = method === 'box' ?
        // ボックス投票の場合（順不同）
        selections.every(number => umarenWinners.includes(number)) && 
        umarenWinners.every(number => selections.includes(number)) :
        // 通常投票の場合
        (selections[0] === umarenWinners[0] && selections[1] === umarenWinners[1]) ||
        (selections[0] === umarenWinners[1] && selections[1] === umarenWinners[0]);
      
      if (isHit && payouts.umarenAmount) {
        payout = Math.floor(amount * (payouts.umarenAmount / 100));
      }
      break;
      
    // 他の馬券タイプも同様に実装
    // 馬単、ワイド、三連複、三連単など
    
    default:
      logger.warn(`未対応の馬券タイプ: ${type}`);
      break;
  }
  
  return { isHit, payout };
}

module.exports = {
  saveBet,
  getBetById,
  getUserBets,
  getRaceBets,
  closeBetsByRaceId,
  processBetPayouts,
  updateBetStatus
};