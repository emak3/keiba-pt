// users.js - ユーザーデータの操作
const { getDb } = require('./firebase');

/**
 * ユーザー情報を取得する
 */
async function getUserById(userId) {
  try {
    const db = getDb();
    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();
    
    if (!doc.exists) {
      return null;
    }
    
    return doc.data();
  } catch (error) {
    console.error(`ユーザー情報(${userId})の取得中にエラーが発生しました:`, error);
    return null;
  }
}

/**
 * ユーザー情報をDiscord IDで取得する
 */
async function getUserByDiscordId(discordId) {
  try {
    const db = getDb();
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('discordId', '==', discordId).limit(1).get();
    
    if (snapshot.empty) {
      return null;
    }
    
    return snapshot.docs[0].data();
  } catch (error) {
    console.error(`Discord ID(${discordId})によるユーザー情報の取得中にエラーが発生しました:`, error);
    return null;
  }
}

/**
 * 新しいユーザーを作成する
 */
async function createUser(userData) {
  try {
    const db = getDb();
    
    // ユーザーが既に存在するか確認
    const existingUser = await getUserByDiscordId(userData.discordId);
    
    if (existingUser) {
      return existingUser;
    }
    
    // 新しいユーザーを作成
    const newUser = {
      id: userData.id || db.collection('users').doc().id,
      discordId: userData.discordId,
      username: userData.username,
      points: 1000, // 初期ポイント
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await db.collection('users').doc(newUser.id).set(newUser);
    
    return newUser;
  } catch (error) {
    console.error('ユーザー作成中にエラーが発生しました:', error);
    return null;
  }
}

/**
 * ユーザーのポイントを更新する
 */
async function updateUserPoints(userId, pointsDelta) {
  try {
    const db = getDb();
    const userRef = db.collection('users').doc(userId);
    
    const user = await getUserById(userId);
    
    if (!user) {
      throw new Error(`ユーザー(${userId})が見つかりません`);
    }
    
    // ポイントが足りるか確認（ポイント減少の場合）
    if (pointsDelta < 0 && user.points + pointsDelta < 0) {
      return {
        success: false,
        message: '残高不足',
        currentPoints: user.points
      };
    }
    
    // ポイントを更新
    await userRef.update({
      points: user.points + pointsDelta,
      updatedAt: new Date().toISOString()
    });
    
    return {
      success: true,
      currentPoints: user.points + pointsDelta
    };
  } catch (error) {
    console.error(`ユーザーポイント更新(${userId})中にエラーが発生しました:`, error);
    return {
      success: false,
      message: error.message,
      currentPoints: 0
    };
  }
}

/**
 * ポイントランキングを取得する
 */
async function getPointsRanking(limit = 10) {
  try {
    const db = getDb();
    const usersRef = db.collection('users');
    const snapshot = await usersRef.orderBy('points', 'desc').limit(limit).get();
    
    const ranking = [];
    let rank = 1;
    
    snapshot.forEach(doc => {
      const user = doc.data();
      ranking.push({
        rank,
        id: user.id,
        discordId: user.discordId,
        username: user.username,
        points: user.points
      });
      rank++;
    });
    
    return ranking;
  } catch (error) {
    console.error('ポイントランキング取得中にエラーが発生しました:', error);
    return [];
  }
}

module.exports = {
  getUserById,
  getUserByDiscordId,
  createUser,
  updateUserPoints,
  getPointsRanking
};