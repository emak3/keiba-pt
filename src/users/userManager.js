// src/users/userManager.js
class UserManager {
  constructor() {
    this.users = new Map(); // ユーザー情報を管理
    this.defaultPoints = 1000; // 初期ポイント
  }

  // ユーザー登録
  registerUser(userId, username) {
    if (this.users.has(userId)) {
      return { 
        success: false, 
        message: 'すでに登録されているユーザーです。' 
      };
    }
    
    const user = {
      id: userId,
      username,
      points: this.defaultPoints,
      betHistory: [],
      totalWinnings: 0,
      registeredAt: new Date()
    };
    
    this.users.set(userId, user);
    
    return { 
      success: true, 
      message: 'ユーザー登録が完了しました。', 
      user 
    };
  }

  // ユーザー情報を取得
  getUser(userId) {
    return this.users.get(userId);
  }

  // ポイントを更新
  updatePoints(userId, amount) {
    const user = this.users.get(userId);
    if (!user) {
      return { 
        success: false, 
        message: 'ユーザーが見つかりません。' 
      };
    }
    
    // 馬券購入の場合はポイントを減算
    if (amount < 0) {
      if (user.points + amount < 0) {
        return { 
          success: false, 
          message: 'ポイントが不足しています。' 
        };
      }
    }
    
    user.points += amount;
    
    // 払戻の場合は総獲得金額を更新
    if (amount > 0) {
      user.totalWinnings += amount;
    }
    
    return { 
      success: true, 
      message: 'ポイントを更新しました。', 
      newPoints: user.points 
    };
  }

  // 馬券履歴を追加
  addBetHistory(userId, bet) {
    const user = this.users.get(userId);
    if (!user) {
      return { 
        success: false, 
        message: 'ユーザーが見つかりません。' 
      };
    }
    
    user.betHistory.push({
      id: bet.id,
      raceId: bet.raceId,
      betType: bet.betType,
      method: bet.method,
      selections: bet.selections,
      amount: bet.amount,
      timestamp: bet.timestamp,
      status: bet.status,
      payout: bet.payout
    });
    
    return { 
      success: true, 
      message: '馬券履歴を更新しました。' 
    };
  }

  // 馬券履歴を取得
  getBetHistory(userId) {
    const user = this.users.get(userId);
    if (!user) {
      return [];
    }
    
    return user.betHistory;
  }

  // ポイントランキングを取得
  getPointsRanking(limit = 10) {
    const userArray = Array.from(this.users.values());
    
    // ポイントの降順でソート
    return userArray
      .sort((a, b) => b.points - a.points)
      .slice(0, limit)
      .map((user, index) => ({
        rank: index + 1,
        id: user.id,
        username: user.username,
        points: user.points,
        totalWinnings: user.totalWinnings
      }));
  }

  // ユーザー一覧を取得
  getAllUsers() {
    return Array.from(this.users.values());
  }
}

module.exports = UserManager;