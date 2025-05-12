// src/database/firebaseClient.js
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

class FirebaseClient {
  constructor() {
    try {
      // serviceAccountKeyが存在する場合はそれを使用
      const serviceAccountPath = path.join(process.cwd(), 'serviceAccountKey.json');

      if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      } else {
        // 環境変数からの初期化をサポート
        admin.initializeApp({
          credential: admin.credential.applicationDefault()
        });
      }

      this.db = admin.firestore();
      console.log('Firebaseに接続しました');
    } catch (error) {
      console.error('Firebase初期化エラー:', error);
      throw error;
    }
  }

  // ユーザーデータを保存
  async saveUser(userId, userData) {
    try {
      await this.db.collection('users').doc(userId).set(userData);
      return { success: true };
    } catch (error) {
      console.error(`ユーザー保存エラー (ID: ${userId}):`, error);
      return { success: false, error };
    }
  }

  // ユーザーデータを取得
  async getUser(userId) {
    try {
      const doc = await this.db.collection('users').doc(userId).get();
      if (doc.exists) {
        return { success: true, data: doc.data() };
      } else {
        return { success: false, error: 'ユーザーが見つかりません' };
      }
    } catch (error) {
      console.error(`ユーザー取得エラー (ID: ${userId}):`, error);
      return { success: false, error };
    }
  }

  // 全ユーザーデータを取得
  async getAllUsers() {
    try {
      const snapshot = await this.db.collection('users').get();
      const users = [];
      snapshot.forEach(doc => {
        users.push(doc.data());
      });
      return { success: true, data: users };
    } catch (error) {
      console.error('全ユーザー取得エラー:', error);
      return { success: false, error };
    }
  }

  // レース情報を保存
  async saveRace(raceId, raceData) {
    try {
      await this.db.collection('races').doc(raceId).set(raceData);
      return { success: true };
    } catch (error) {
      console.error(`レース保存エラー (ID: ${raceId}):`, error);
      return { success: false, error };
    }
  }

  // レース情報を取得
  async getRace(raceId) {
    try {
      const doc = await this.db.collection('races').doc(raceId).get();
      if (doc.exists) {
        return { success: true, data: doc.data() };
      } else {
        return { success: false, error: 'レースが見つかりません' };
      }
    } catch (error) {
      console.error(`レース取得エラー (ID: ${raceId}):`, error);
      return { success: false, error };
    }
  }

  // 当日のレース一覧を保存
  async saveTodayRaces(date, races) {
    try {
      await this.db.collection('daily_races').doc(date).set({ races });
      return { success: true };
    } catch (error) {
      console.error(`当日レース保存エラー (日付: ${date}):`, error);
      return { success: false, error };
    }
  }

  // 当日のレース一覧を取得
  async getTodayRaces(date) {
    try {
      const doc = await this.db.collection('daily_races').doc(date).get();
      if (doc.exists) {
        return { success: true, data: doc.data().races };
      } else {
        return { success: false, error: '当日のレース情報が見つかりません' };
      }
    } catch (error) {
      console.error(`当日レース取得エラー (日付: ${date}):`, error);
      return { success: false, error };
    }
  }

  // 馬券データを保存
  async saveBet(betId, betData) {
    try {
      await this.db.collection('bets').doc(betId).set(betData);
      return { success: true };
    } catch (error) {
      console.error(`馬券保存エラー (ID: ${betId}):`, error);
      return { success: false, error };
    }
  }

  // ユーザーの馬券一覧を取得
  async getUserBets(userId) {
    try {
      // Firestoreのインデックスエラーを回避するためにクエリを変更
      const snapshot = await this.db.collection('bets')
        .where('userId', '==', userId)
        // orderByを除去し、アプリケーション側でソートを行う
        // .orderBy('timestamp', 'desc')
        .get();

      const bets = [];
      snapshot.forEach(doc => {
        bets.push(doc.data());
      });

      return { success: true, data: bets };
    } catch (error) {
      // インデックスに関するエラーの場合、特別なメッセージを表示
      if (error.code === 9 && error.details && error.details.includes('index')) {
        console.error(`Firestoreインデックスが必要です: ${error.details}`);
        console.error('このエラーを解決するには、提供されたURLにアクセスしてインデックスを作成してください。');
        console.error('その間は、アプリケーション側でソートを行います。');

        try {
          // インデックスなしでクエリを実行
          const simpleSnapshot = await this.db.collection('bets')
            .where('userId', '==', userId)
            .get();

          const bets = [];
          simpleSnapshot.forEach(doc => {
            bets.push(doc.data());
          });

          return { success: true, data: bets };
        } catch (innerError) {
          console.error(`シンプルクエリでもエラー (ID: ${userId}):`, innerError);
          return { success: false, error: innerError, data: [] };
        }
      }

      console.error(`ユーザー馬券取得エラー (ID: ${userId}):`, error);
      return { success: false, error, data: [] };
    }
  }

  // レースの馬券一覧を取得
  async getRaceBets(raceId) {
    try {
      const snapshot = await this.db.collection('bets')
        .where('raceId', '==', raceId)
        .where('status', '==', 'active')
        .get();

      const bets = [];
      snapshot.forEach(doc => {
        bets.push(doc.data());
      });

      return { success: true, data: bets };
    } catch (error) {
      console.error(`レース馬券取得エラー (ID: ${raceId}):`, error);
      return { success: false, error };
    }
  }

  // 馬券ステータスを更新
  async updateBetStatus(betId, status, payout = 0) {
    try {
      await this.db.collection('bets').doc(betId).update({
        status,
        payout,
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { success: true };
    } catch (error) {
      console.error(`馬券ステータス更新エラー (ID: ${betId}):`, error);
      return { success: false, error };
    }
  }

  // ユーザーポイントを更新
  async updateUserPoints(userId, points, totalWinnings = 0) {
    try {
      const userRef = this.db.collection('users').doc(userId);

      await this.db.runTransaction(async (transaction) => {
        const doc = await transaction.get(userRef);
        if (!doc.exists) {
          throw new Error('ユーザーが存在しません');
        }

        const userData = doc.data();
        transaction.update(userRef, {
          points: points,
          totalWinnings: userData.totalWinnings + totalWinnings,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      return { success: true };
    } catch (error) {
      console.error(`ポイント更新エラー (ID: ${userId}):`, error);
      return { success: false, error };
    }
  }
}

module.exports = FirebaseClient;