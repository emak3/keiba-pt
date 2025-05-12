// src/users/userManager.js
class UserManager {
  constructor(firebaseClient) {
    this.users = new Map(); // メモリ内ユーザー情報キャッシュ
    this.defaultPoints = 1000; // 初期ポイント
    this.firebaseClient = firebaseClient; // Firebase接続クライアント
    
    // 起動時にユーザーデータをキャッシュに読み込み
    this.loadUsers();
  }

  // Firebaseからすべてのユーザーをロード
  async loadUsers() {
    try {
      if (!this.firebaseClient) return;
      
      const result = await this.firebaseClient.getAllUsers();
      if (result.success) {
        result.data.forEach(user => {
          this.users.set(user.id, user);
        });
        console.log(`${result.data.length}人のユーザーデータをロードしました`);
      }
    } catch (error) {
      console.error('ユーザーデータのロードに失敗しました:', error);
    }
  }

  // ユーザー登録
  async registerUser(userId, username) {
    // すでに登録済みのユーザーチェック
    if (this.users.has(userId)) {
      return { 
        success: false, 
        message: 'すでに登録されているユーザーです。',
        user: this.users.get(userId)
      };
    }
    
    // 新規ユーザー作成
    const user = {
      id: userId,
      username,
      points: this.defaultPoints,
      betHistory: [],
      totalWinnings: 0,
      registeredAt: new Date(),
      updatedAt: new Date()
    };
    
    // メモリ内キャッシュに保存
    this.users.set(userId, user);
    
    // Firebaseに保存
    if (this.firebaseClient) {
      try {
        await this.firebaseClient.saveUser(userId, user);
      } catch (error) {
        console.error('ユーザー登録のFirebase保存に失敗:', error);
        // エラーがあっても処理は続行（次回再試行）
      }
    }
    
    return { 
      success: true, 
      message: 'ユーザー登録が完了しました。', 
      user 
    };
  }

  // ユーザー情報を取得
  async getUser(userId) {
    // メモリキャッシュにある場合はそれを返す
    if (this.users.has(userId)) {
      return this.users.get(userId);
    }
    
    // キャッシュになければFirebaseから取得
    if (this.firebaseClient) {
      try {
        const result = await this.firebaseClient.getUser(userId);
        if (result.success) {
          this.users.set(userId, result.data);
          return result.data;
        }
      } catch (error) {
        console.error(`ユーザー取得エラー (ID: ${userId}):`, error);
      }
    }
    
    return null;
  }

  // ポイントを更新
  async updatePoints(userId, amount) {
    const user = await this.getUser(userId);
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
    
    // メモリ内のユーザーデータを更新
    user.points += amount;
    user.updatedAt = new Date();
    
    // 払戻の場合は総獲得金額を更新
    let totalWinningsAdd = 0;
    if (amount > 0) {
      user.totalWinnings += amount;
      totalWinningsAdd = amount;
    }
    
    // Firebaseに更新を反映
    if (this.firebaseClient) {
      try {
        await this.firebaseClient.updateUserPoints(userId, user.points, totalWinningsAdd);
      } catch (error) {
        console.error(`ポイント更新のFirebase保存に失敗 (ID: ${userId}):`, error);
      }
    }
    
    return { 
      success: true, 
      message: 'ポイントを更新しました。', 
      newPoints: user.points 
    };
  }

  // 馬券履歴を追加
  async addBetHistory(userId, bet) {
    const user = await this.getUser(userId);
    if (!user) {
      return { 
        success: false, 
        message: 'ユーザーが見つかりません。' 
      };
    }
    
    // メモリ内の馬券履歴を更新
    if (!user.betHistory) {
      user.betHistory = [];
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
    
    // Firebaseに馬券データを保存
    if (this.firebaseClient) {
      try {
        await this.firebaseClient.saveBet(bet.id, bet);
      } catch (error) {
        console.error(`馬券履歴のFirebase保存に失敗 (ID: ${bet.id}):`, error);
      }
    }
    
    return { 
      success: true, 
      message: '馬券履歴を更新しました。' 
    };
  }

  // 馬券履歴を取得
  async getBetHistory(userId, limit = 50) {
    // メモリキャッシュから取得
    const user = await this.getUser(userId);
    if (!user || !user.betHistory) {
      return [];
    }
    
    // キャッシュに履歴があれば返す
    if (user.betHistory.length > 0) {
      return user.betHistory
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
    }
    
    // キャッシュになければFirebaseから取得
    if (this.firebaseClient) {
      try {
        const result = await this.firebaseClient.getUserBets(userId);
        if (result.success) {
          // メモリキャッシュを更新
          user.betHistory = result.data;
          return result.data.slice(0, limit);
        }
      } catch (error) {
        console.error(`馬券履歴取得エラー (ID: ${userId}):`, error);
      }
    }
    
    return [];
  }

  // ポイントランキングを取得
  async getPointsRanking(limit = 10) {
    // 全ユーザーデータの更新
    await this.loadUsers();
    
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
  async getAllUsers() {
    // データの更新
    await this.loadUsers();
    return Array.from(this.users.values());
  }

  // ユーザーデータをFirebaseと同期
  async syncUserData(userId) {
    if (!this.firebaseClient) return;
    
    const user = this.users.get(userId);
    if (user) {
      try {
        await this.firebaseClient.saveUser(userId, user);
      } catch (error) {
        console.error(`ユーザーデータ同期エラー (ID: ${userId}):`, error);
      }
    }
  }
}

module.exports = UserManager;