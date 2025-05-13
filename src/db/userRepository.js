// src/db/userRepository.js
const { getFirestore, createTimestamp, runTransaction } = require('./firebase');
const logger = require('../utils/logger');

// Firestoreのコレクション名
const USERS_COLLECTION = 'users';

/**
 * ユーザー情報を取得する
 * @param {string} userId - Discord ユーザーID
 * @returns {Promise<Object|null>} - ユーザー情報
 */
async function getUserById(userId) {
  try {
    const db = getFirestore();
    const docRef = await db.collection(USERS_COLLECTION).doc(userId).get();
    
    if (!docRef.exists) {
      return null;
    }
    
    return { id: docRef.id, ...docRef.data() };
  } catch (error) {
    logger.error(`ユーザー情報の取得に失敗しました: ${userId}`, error);
    throw error;
  }
}

/**
 * ユーザーを作成または更新する
 * @param {Object} userData - ユーザー情報
 * @returns {Promise<string>} - ユーザーID
 */
async function saveUser(userData) {
  try {
    const db = getFirestore();
    const now = createTimestamp();
    
    // ユーザーIDが必要
    if (!userData.id) {
      throw new Error('ユーザーIDが必要です');
    }
    
    const userId = userData.id;
    
    // 既存ユーザーの確認
    const existingUser = await getUserById(userId);
    
    const data = {
      ...userData,
      updatedAt: now
    };
    
    // 新規ユーザーの場合
    if (!existingUser) {
      data.points = data.points || 100; // デフォルトポイント
      data.createdAt = now;
    }
    
    await db.collection(USERS_COLLECTION).doc(userId).set(data, { merge: true });
    logger.info(`ユーザー情報を保存しました: ${userId}`);
    
    return userId;
  } catch (error) {
    logger.error('ユーザー情報の保存に失敗しました', error);
    throw error;
  }
}

/**
 * ユーザーポイントを更新する（トランザクション処理）
 * @param {string} userId - ユーザーID
 * @param {number} pointDiff - 増減ポイント
 * @param {string} reason - 更新理由
 * @returns {Promise<Object>} - 更新後のポイント情報
 */
async function updateUserPoints(userId, pointDiff, reason) {
  try {
    return await runTransaction(async (transaction) => {
      const db = getFirestore();
      const userRef = db.collection(USERS_COLLECTION).doc(userId);
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new Error(`ユーザーが存在しません: ${userId}`);
      }
      
      const userData = userDoc.data();
      const currentPoints = userData.points || 0;
      const newPoints = currentPoints + pointDiff;
      
      // マイナスにならないように
      if (newPoints < 0) {
        throw new Error('ポイントが足りません');
      }
      
      // ポイント履歴を追加
      const now = createTimestamp();
      const pointHistory = userData.pointHistory || [];
      
      pointHistory.push({
        amount: pointDiff,
        reason,
        timestamp: now
      });
      
      // 履歴は最新100件に制限
      while (pointHistory.length > 100) {
        pointHistory.shift();
      }
      
      // 更新
      transaction.update(userRef, {
        points: newPoints,
        pointHistory,
        updatedAt: now
      });
      
      return {
        userId,
        oldPoints: currentPoints,
        newPoints,
        diff: pointDiff,
        reason,
        timestamp: now
      };
    });
  } catch (error) {
    logger.error(`ポイント更新に失敗しました: ${userId}, ${pointDiff}`, error);
    throw error;
  }
}

/**
 * ポイントランキングを取得
 * @param {number} limit - 取得件数
 * @returns {Promise<Array>} - ランキング情報
 */
async function getPointsRanking(limit = 10) {
  try {
    const db = getFirestore();
    const snapshot = await db.collection(USERS_COLLECTION)
      .orderBy('points', 'desc')
      .limit(limit)
      .get();
    
    if (snapshot.empty) {
      return [];
    }
    
    const rankings = [];
    snapshot.forEach((doc, index) => {
      const userData = doc.data();
      rankings.push({
        rank: index + 1,
        id: doc.id,
        username: userData.username,
        points: userData.points || 0
      });
    });
    
    return rankings;
  } catch (error) {
    logger.error('ポイントランキングの取得に失敗しました', error);
    throw error;
  }
}

/**
 * 指定した条件でユーザーを検索
 * @param {Object} filters - 検索条件
 * @param {number} limit - 取得件数
 * @returns {Promise<Array>} - ユーザー情報の配列
 */
async function searchUsers(filters = {}, limit = 50) {
  try {
    const db = getFirestore();
    let query = db.collection(USERS_COLLECTION);
    
    // フィルタの適用
    Object.keys(filters).forEach(key => {
      const value = filters[key];
      if (value !== undefined && value !== null) {
        query = query.where(key, '==', value);
      }
    });
    
    // 制限
    query = query.limit(limit);
    
    const snapshot = await query.get();
    
    if (snapshot.empty) {
      return [];
    }
    
    const users = [];
    snapshot.forEach(doc => {
      users.push({ id: doc.id, ...doc.data() });
    });
    
    return users;
  } catch (error) {
    logger.error('ユーザー検索に失敗しました', error);
    throw error;
  }
}

/**
 * ユーザーを削除
 * @param {string} userId - ユーザーID
 * @returns {Promise<void>}
 */
async function deleteUser(userId) {
  try {
    const db = getFirestore();
    await db.collection(USERS_COLLECTION).doc(userId).delete();
    logger.info(`ユーザーを削除しました: ${userId}`);
  } catch (error) {
    logger.error(`ユーザーの削除に失敗しました: ${userId}`, error);
    throw error;
  }
}

module.exports = {
  getUserById,
  saveUser,
  updateUserPoints,
  getPointsRanking,
  searchUsers,
  deleteUser
};