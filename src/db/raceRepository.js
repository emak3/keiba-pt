// src/db/raceRepository.js
const { getFirestore, createTimestamp, dateToTimestamp } = require('./firebase');
const logger = require('../utils/logger');

// Firestoreのコレクション名
const RACES_COLLECTION = 'races';

/**
 * レース情報を保存する
 * @param {Object} raceData - レース情報
 * @returns {Promise<string>} - 保存したレースのID
 */
async function saveRaceData(raceData) {
  try {
    const db = getFirestore();
    const now = createTimestamp();
    
    // タイムスタンプ形式の日付を追加
    const data = {
      ...raceData,
      createdAt: now,
      updatedAt: now
    };
    
    // 日付がDate型の場合はタイムスタンプに変換
    if (data.date instanceof Date) {
      data.date = dateToTimestamp(data.date);
    }
    
    // IDが存在する場合は更新、なければ新規作成
    if (data.id) {
      await db.collection(RACES_COLLECTION).doc(data.id).set(data, { merge: true });
      logger.info(`レース情報を更新しました: ${data.id}`);
      return data.id;
    } else {
      const docRef = await db.collection(RACES_COLLECTION).add(data);
      logger.info(`新しいレース情報を保存しました: ${docRef.id}`);
      return docRef.id;
    }
  } catch (error) {
    logger.error('レース情報の保存に失敗しました', error);
    throw error;
  }
}

/**
 * レース結果を更新する
 * @param {string} raceId - レースID
 * @param {Object} resultData - 結果データ
 * @returns {Promise<void>}
 */
async function updateRaceResult(raceId, resultData) {
  try {
    const db = getFirestore();
    const now = createTimestamp();
    
    // 更新データを準備
    const data = {
      ...resultData,
      updatedAt: now
    };
    
    await db.collection(RACES_COLLECTION).doc(raceId).update(data);
    logger.info(`レース結果を更新しました: ${raceId}`);
  } catch (error) {
    logger.error(`レース結果の更新に失敗しました: ${raceId}`, error);
    throw error;
  }
}

/**
 * レース情報を取得する
 * @param {string} raceId - レースID
 * @returns {Promise<Object|null>} - レース情報
 */
async function getRaceById(raceId) {
  try {
    const db = getFirestore();
    const docRef = await db.collection(RACES_COLLECTION).doc(raceId).get();
    
    if (!docRef.exists) {
      logger.warn(`レース情報が見つかりません: ${raceId}`);
      return null;
    }
    
    return { id: docRef.id, ...docRef.data() };
  } catch (error) {
    logger.error(`レース情報の取得に失敗しました: ${raceId}`, error);
    throw error;
  }
}

/**
 * 指定した日付のレース一覧を取得する
 * @param {Date} date - 日付
 * @param {string} [type] - レースタイプ（JRA/NAR）
 * @returns {Promise<Array>} - レース情報の配列
 */
async function getRacesByDate(date, type = null) {
  try {
    const db = getFirestore();
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);
    
    // 日付範囲でクエリ
    let query = db.collection(RACES_COLLECTION)
      .where('date', '>=', dateToTimestamp(startDate))
      .where('date', '<=', dateToTimestamp(endDate));
    
    // タイプが指定されていればフィルタを追加
    if (type) {
      query = query.where('type', '==', type);
    }
    
    const snapshot = await query.get();
    
    if (snapshot.empty) {
      logger.info(`${date.toISOString().split('T')[0]}のレース情報はありません`);
      return [];
    }
    
    const races = [];
    snapshot.forEach(doc => {
      races.push({ id: doc.id, ...doc.data() });
    });
    
    return races;
  } catch (error) {
    logger.error(`日付によるレース情報の取得に失敗しました: ${date}`, error);
    throw error;
  }
}

/**
 * ステータスによるレース一覧の取得
 * @param {string} status - レースステータス
 * @returns {Promise<Array>} - レース情報の配列
 */
async function getRacesByStatus(status) {
  try {
    const db = getFirestore();
    const snapshot = await db.collection(RACES_COLLECTION)
      .where('status', '==', status)
      .get();
    
    if (snapshot.empty) {
      return [];
    }
    
    const races = [];
    snapshot.forEach(doc => {
      races.push({ id: doc.id, ...doc.data() });
    });
    
    return races;
  } catch (error) {
    logger.error(`ステータスによるレース情報の取得に失敗しました: ${status}`, error);
    throw error;
  }
}

/**
 * 会場ごとのレース一覧を取得
 * @param {string} venue - 開催場所
 * @param {Date} [date] - 日付（省略時は全期間）
 * @returns {Promise<Array>} - レース情報の配列
 */
async function getRacesByVenue(venue, date = null) {
  try {
    const db = getFirestore();
    let query = db.collection(RACES_COLLECTION)
      .where('venue', '==', venue);
    
    // 日付が指定されていれば範囲を追加
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      
      query = query
        .where('date', '>=', dateToTimestamp(startDate))
        .where('date', '<=', dateToTimestamp(endDate));
    }
    
    const snapshot = await query.get();
    
    if (snapshot.empty) {
      return [];
    }
    
    const races = [];
    snapshot.forEach(doc => {
      races.push({ id: doc.id, ...doc.data() });
    });
    
    return races;
  } catch (error) {
    logger.error(`会場によるレース情報の取得に失敗しました: ${venue}`, error);
    throw error;
  }
}

/**
 * レース情報を削除する
 * @param {string} raceId - レースID
 * @returns {Promise<void>}
 */
async function deleteRace(raceId) {
  try {
    const db = getFirestore();
    await db.collection(RACES_COLLECTION).doc(raceId).delete();
    logger.info(`レース情報を削除しました: ${raceId}`);
  } catch (error) {
    logger.error(`レース情報の削除に失敗しました: ${raceId}`, error);
    throw error;
  }
}

module.exports = {
  saveRaceData,
  updateRaceResult,
  getRaceById,
  getRacesByDate,
  getRacesByStatus,
  getRacesByVenue,
  deleteRace
};