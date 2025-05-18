import { doc, collection, setDoc, getDoc, getDocs, query, where, updateDoc, increment, orderBy, limit } from 'firebase/firestore';
import { getDb } from '../../config/firebase-config.js';
import logger from '../../utils/logger.js';

/**
 * Discordユーザーをデータベースに保存/更新
 * @param {string} userId - DiscordユーザーID
 * @param {string} username - Discordユーザー名
 * @param {string} [avatarUrl] - ユーザーアバターURL
 * @returns {Promise<Object>} ユーザーデータ
 */
export async function saveUser(userId, username, avatarUrl = null) {
  try {
    const db = getDb();
    const userRef = doc(db, 'users', userId);
    
    // 既存データがあるか確認
    const docSnap = await getDoc(userRef);
    
    if (docSnap.exists()) {
      const existingData = docSnap.data();
      
      // 更新するデータ
      const updateData = {
        username,
        updatedAt: new Date().toISOString()
      };
      
      // アバターURLが提供された場合のみ更新
      if (avatarUrl) {
        updateData.avatarUrl = avatarUrl;
      }
      
      await updateDoc(userRef, updateData);
      
      return {
        id: userId,
        ...existingData,
        ...updateData
      };
    } else {
      // 新規ユーザーデータ
      const userData = {
        id: userId,
        username,
        points: 1000, // 初期ポイント
        avatarUrl: avatarUrl || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await setDoc(userRef, userData);
      
      logger.info(`新規ユーザー ${userId} (${username}) を作成しました。初期ポイント: 1000`);
      
      return userData;
    }
  } catch (error) {
    logger.error(`ユーザー保存中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * ユーザー情報を取得
 * @param {string} userId - DiscordユーザーID
 * @returns {Promise<Object|null>} ユーザーデータまたはnull
 */
export async function getUser(userId) {
  try {
    const db = getDb();
    const userRef = doc(db, 'users', userId);
    const docSnap = await getDoc(userRef);
    
    if (docSnap.exists()) {
      return {
        id: docSnap.id,
        ...docSnap.data()
      };
    } else {
      logger.warn(`ユーザー ${userId} が見つかりません。`);
      return null;
    }
  } catch (error) {
    logger.error(`ユーザー取得中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * ユーザーのポイントを追加
 * @param {string} userId - DiscordユーザーID
 * @param {number} points - 追加するポイント数
 * @returns {Promise<number>} 更新後のポイント
 */
export async function addPoints(userId, points) {
  try {
    if (!userId) {
      throw new Error('ユーザーIDが指定されていません。');
    }
    
    if (!points || isNaN(points) || points <= 0) {
      throw new Error('有効なポイント数を指定してください。');
    }
    
    const db = getDb();
    const userRef = doc(db, 'users', userId);
    
    // 既存ユーザーの確認
    const docSnap = await getDoc(userRef);
    
    if (!docSnap.exists()) {
      throw new Error(`ユーザー ${userId} が見つかりません。`);
    }
    
    // ポイントを追加
    await updateDoc(userRef, {
      points: increment(points),
      updatedAt: new Date().toISOString()
    });
    
    // 更新後のデータを取得
    const updatedSnap = await getDoc(userRef);
    const updatedData = updatedSnap.data();
    
    logger.info(`ユーザー ${userId} のポイントを ${points} 追加しました。現在のポイント: ${updatedData.points}`);
    
    return updatedData.points;
  } catch (error) {
    logger.error(`ポイント追加中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * ユーザーのポイントを減算
 * @param {string} userId - DiscordユーザーID
 * @param {number} points - 減算するポイント数
 * @returns {Promise<number>} 更新後のポイント
 */
export async function subtractPoints(userId, points) {
  try {
    if (!userId) {
      throw new Error('ユーザーIDが指定されていません。');
    }
    
    if (!points || isNaN(points) || points <= 0) {
      throw new Error('有効なポイント数を指定してください。');
    }
    
    const db = getDb();
    const userRef = doc(db, 'users', userId);
    
    // 既存ユーザーの確認
    const docSnap = await getDoc(userRef);
    
    if (!docSnap.exists()) {
      throw new Error(`ユーザー ${userId} が見つかりません。`);
    }
    
    const userData = docSnap.data();
    
    // ポイントが足りるか確認
    if (userData.points < points) {
      throw new Error(`ポイントが不足しています。現在のポイント: ${userData.points}, 必要なポイント: ${points}`);
    }
    
    // ポイントを減算
    await updateDoc(userRef, {
      points: increment(-points),
      updatedAt: new Date().toISOString()
    });
    
    // 更新後のデータを取得
    const updatedSnap = await getDoc(userRef);
    const updatedData = updatedSnap.data();
    
    logger.info(`ユーザー ${userId} のポイントを ${points} 減算しました。現在のポイント: ${updatedData.points}`);
    
    return updatedData.points;
  } catch (error) {
    logger.error(`ポイント減算中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * ポイントランキングを取得
 * @param {number} [limit=10] - 取得する上位ユーザー数
 * @returns {Promise<Array>} ランキング情報の配列
 */
export async function getPointsRanking(limitCount = 10) {
  try {
    const db = getDb();
    const usersQuery = query(
      collection(db, 'users'),
      orderBy('points', 'desc'),
      limit(limitCount)
    );
    
    const usersSnapshot = await getDocs(usersQuery);
    
    const ranking = [];
    let rank = 1;
    
    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      ranking.push({
        rank,
        id: doc.id,
        username: userData.username,
        points: userData.points,
        avatarUrl: userData.avatarUrl
      });
      rank++;
    });
    
    return ranking;
  } catch (error) {
    logger.error(`ポイントランキング取得中にエラーが発生しました: ${error}`);
    throw error;
  }
}