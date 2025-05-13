// src/services/userService.js
const { 
  getUserById, 
  saveUser, 
  updateUserPoints, 
  getPointsRanking 
} = require('../db/userRepository');
const { getUserBets } = require('../db/betRepository');
const logger = require('../utils/logger');

/**
 * ユーザー管理サービス
 */
class UserService {
  /**
   * ユーザー情報を取得する
   * @param {string} userId - ユーザーID
   * @returns {Promise<Object|null>} - ユーザー情報
   */
  async getUserById(userId) {
    return getUserById(userId);
  }

  /**
   * ユーザーを登録または更新する
   * @param {string} userId - ユーザーID
   * @param {string} username - ユーザー名
   * @param {Object} [additionalData={}] - 追加のユーザーデータ
   * @returns {Promise<Object>} - 登録結果
   */
  async registerUser(userId, username, additionalData = {}) {
    try {
      // 既存ユーザーの確認
      const existingUser = await getUserById(userId);
      
      // ユーザーデータ
      const userData = {
        id: userId,
        username,
        ...additionalData
      };
      
      // 新規ユーザーの場合は初期ポイントを設定
      if (!existingUser) {
        userData.points = 100; // デフォルトのポイント
      }
      
      // ユーザー情報を保存
      await saveUser(userData);
      
      // 最新のユーザー情報を取得
      const updatedUser = await getUserById(userId);
      
      logger.info(`ユーザーを登録/更新しました: ${userId}`);
      return updatedUser;
    } catch (error) {
      logger.error(`ユーザー登録に失敗しました: ${userId}`, error);
      throw error;
    }
  }

  /**
   * ユーザーポイントを更新する
   * @param {string} userId - ユーザーID
   * @param {number} pointDiff - 増減ポイント
   * @param {string} reason - 更新理由
   * @returns {Promise<Object>} - 更新結果
   */
  async updateUserPoints(userId, pointDiff, reason) {
    try {
      const result = await updateUserPoints(userId, pointDiff, reason);
      logger.info(`ユーザーポイントを更新しました: ${userId}, ${pointDiff}pt, 理由: ${reason}`);
      return result;
    } catch (error) {
      logger.error(`ユーザーポイント更新に失敗しました: ${userId}`, error);
      throw error;
    }
  }

  /**
   * ポイントランキングを取得する
   * @param {number} limit - 取得件数
   * @returns {Promise<Array>} - ランキング情報
   */
  async getPointsRanking(limit = 10) {
    return getPointsRanking(limit);
  }

  /**
   * ユーザーの馬券履歴を取得する
   * @param {string} userId - ユーザーID
   * @param {Object} [options] - 取得オプション
   * @returns {Promise<Array>} - 馬券情報の配列
   */
  async getUserBetHistory(userId, options = {}) {
    return getUserBets(userId, options);
  }

  /**
   * ユーザーの的中馬券を取得する
   * @param {string} userId - ユーザーID
   * @param {number} [limit=10] - 取得件数
   * @returns {Promise<Array>} - 馬券情報の配列
   */
  async getUserWinningBets(userId, limit = 10) {
    const options = {
      status: 'won',
      limit
    };
    return getUserBets(userId, options);
  }

  /**
   * ユーザー情報をフォーマットしてDiscordに表示しやすい形式に変換
   * @param {Object} user - ユーザー情報
   * @param {boolean} [includeHistory=false] - 履歴を含めるかどうか
   * @returns {Promise<Object>} - フォーマットされたユーザー情報
   */
  async formatUserForDisplay(user, includeHistory = false) {
    try {
      if (!user) return null;
      
      // 基本情報
      const formattedUser = {
        id: user.id,
        username: user.username,
        points: user.points || 0,
        createdAt: user.createdAt
      };
      
      // ポイント履歴
      if (user.pointHistory && Array.isArray(user.pointHistory) && user.pointHistory.length > 0) {
        formattedUser.recentPointHistory = user.pointHistory
          .slice(-5) // 最新5件
          .map(entry => ({
            amount: entry.amount,
            reason: entry.reason,
            timestamp: entry.timestamp
          }));
      }
      
      // 馬券履歴を含める場合
      if (includeHistory) {
        // 最近の馬券（最新10件）
        const recentBets = await getUserBets(user.id, { limit: 10 });
        
        if (recentBets.length > 0) {
          formattedUser.recentBets = recentBets.map(bet => ({
            id: bet.id,
            raceId: bet.raceId,
            type: bet.type,
            amount: bet.amount,
            status: bet.status,
            payout: bet.payout || 0,
            createdAt: bet.createdAt
          }));
        }
        
        // 的中馬券（最新5件）
        const winningBets = await getUserBets(user.id, { status: 'won', limit: 5 });
        
        if (winningBets.length > 0) {
          formattedUser.winningBets = winningBets.map(bet => ({
            id: bet.id,
            raceId: bet.raceId,
            type: bet.type,
            amount: bet.amount,
            payout: bet.payout || 0,
            createdAt: bet.createdAt
          }));
        }
      }
      
      return formattedUser;
    } catch (error) {
      logger.error('ユーザー情報のフォーマットに失敗しました', error);
      return user; // エラー時は元の情報をそのまま返す
    }
  }
  
  /**
   * ユーザーの統計情報を取得する
   * @param {string} userId - ユーザーID
   * @returns {Promise<Object>} - 統計情報
   */
  async getUserStats(userId) {
    try {
      // ユーザー情報の取得
      const user = await getUserById(userId);
      if (!user) {
        throw new Error(`ユーザーが存在しません: ${userId}`);
      }
      
      // すべての馬券履歴を取得
      const allBets = await getUserBets(userId, { limit: 1000 });
      
      // 統計情報の集計
      const stats = {
        totalBets: allBets.length,
        totalAmount: 0,
        totalPayout: 0,
        winCount: 0,
        loseCount: 0,
        pendingCount: 0,
        betsByType: {},
        recentBets: []
      };
      
      // 各馬券の集計
      allBets.forEach(bet => {
        // 合計金額
        stats.totalAmount += bet.amount;
        
        // 的中・不的中の集計
        if (bet.status === 'won') {
          stats.winCount++;
          stats.totalPayout += bet.payout || 0;
        } else if (bet.status === 'lost') {
          stats.loseCount++;
        } else {
          stats.pendingCount++;
        }
        
        // タイプ別の集計
        if (!stats.betsByType[bet.type]) {
          stats.betsByType[bet.type] = {
            count: 0,
            amount: 0,
            payout: 0,
            winCount: 0
          };
        }
        
        const typeStats = stats.betsByType[bet.type];
        typeStats.count++;
        typeStats.amount += bet.amount;
        
        if (bet.status === 'won') {
          typeStats.payout += bet.payout || 0;
          typeStats.winCount++;
        }
      });
      
      // 勝率の計算
      const decidedBets = stats.winCount + stats.loseCount;
      stats.winRate = decidedBets > 0 ? (stats.winCount / decidedBets * 100).toFixed(1) : 0;
      
      // 回収率の計算
      stats.returnRate = stats.totalAmount > 0 ? (stats.totalPayout / stats.totalAmount * 100).toFixed(1) : 0;
      
      // 最近の馬券（最新10件）
      stats.recentBets = allBets.slice(0, 10).map(bet => ({
        id: bet.id,
        raceId: bet.raceId,
        type: bet.type,
        amount: bet.amount,
        status: bet.status,
        payout: bet.payout || 0,
        createdAt: bet.createdAt
      }));
      
      return stats;
    } catch (error) {
      logger.error(`ユーザー統計情報の取得に失敗しました: ${userId}`, error);
      throw error;
    }
  }
}

module.exports = new UserService();