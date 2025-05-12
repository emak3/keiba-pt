// src/betting/betManager.js
const BetCalculator = require('./betCalculator');

class BetManager {
  constructor(firebaseClient) {
    this.bets = new Map(); // ユーザーごとの馬券を管理（メモリキャッシュ）
    this.calculator = new BetCalculator();
    this.firebaseClient = firebaseClient; // Firebase接続
  }

  // 馬券を購入
  async placeBet(userId, raceId, betType, method, selections, amount) {
    // 馬券購入のバリデーション
    if (!this.validateBet(betType, method, selections, amount)) {
      return { success: false, message: '無効な馬券情報です。' };
    }
    
    const betId = `${userId}-${raceId}-${Date.now()}`;
    const bet = {
      id: betId,
      userId,
      raceId,
      betType,
      method,
      selections,
      amount,
      timestamp: new Date(),
      status: 'active', // active, won, lost
      payout: 0
    };
    
    // ユーザーの馬券リストに追加（メモリキャッシュ）
    if (!this.bets.has(userId)) {
      this.bets.set(userId, []);
    }
    
    this.bets.get(userId).push(bet);
    
    // Firebaseに保存
    if (this.firebaseClient) {
      try {
        await this.firebaseClient.saveBet(betId, bet);
      } catch (error) {
        console.error(`馬券データの保存に失敗 (ID: ${betId}):`, error);
        // エラーがあっても処理は続行
      }
    }
    
    return { 
      success: true, 
      message: '馬券を購入しました。', 
      bet 
    };
  }

  // 馬券のバリデーション
  validateBet(betType, method, selections, amount) {
    // 馬券タイプのチェック
    if (!Object.values(this.calculator.betTypes).includes(betType)) {
      return false;
    }
    
    // 購入方法のチェック
    if (!Object.values(this.calculator.betMethods).includes(method)) {
      return false;
    }
    
    // 金額のチェック（100円以上、100円単位）
    if (amount < 100 || amount % 100 !== 0) {
      return false;
    }
    
    // 選択馬のチェック
    if (method === this.calculator.betMethods.NORMAL) {
      // 通常の馬券
      if (!Array.isArray(selections)) {
        return false;
      }
      
      // 馬券タイプに応じた選択数のチェック
      const requiredSelections = this.calculator.getRequiredSelections(betType);
      if (selections.length !== requiredSelections) {
        return false;
      }
    } else if (method === this.calculator.betMethods.BOX) {
      // ボックス馬券
      if (!Array.isArray(selections) || selections.length < 2) {
        return false;
      }
      
      // 馬券タイプに対応しているかのチェック
      if (![
        this.calculator.betTypes.UMAREN,
        this.calculator.betTypes.UMATAN,
        this.calculator.betTypes.SANRENPUKU,
        this.calculator.betTypes.SANRENTAN
      ].includes(betType)) {
        return false;
      }
    } else if (method === this.calculator.betMethods.FORMATION) {
      // フォーメーション馬券
      if (!selections.first || !selections.second) {
        return false;
      }
      
      // 三連系の場合は third も必要
      if ([
        this.calculator.betTypes.SANRENPUKU,
        this.calculator.betTypes.SANRENTAN
      ].includes(betType) && !selections.third) {
        return false;
      }
      
      // 馬券タイプに対応しているかのチェック
      if (![
        this.calculator.betTypes.UMAREN,
        this.calculator.betTypes.UMATAN,
        this.calculator.betTypes.SANRENPUKU,
        this.calculator.betTypes.SANRENTAN
      ].includes(betType)) {
        return false;
      }
    }
    
    return true;
  }

  // ユーザーの馬券一覧を取得
  async getUserBets(userId) {
    // メモリキャッシュから取得
    if (this.bets.has(userId)) {
      return this.bets.get(userId);
    }
    
    // キャッシュになければFirebaseから取得
    if (this.firebaseClient) {
      try {
        const result = await this.firebaseClient.getUserBets(userId);
        if (result.success) {
          // メモリキャッシュにセット
          this.bets.set(userId, result.data);
          return result.data;
        }
      } catch (error) {
        console.error(`ユーザー馬券取得エラー (ID: ${userId}):`, error);
      }
    }
    
    return [];
  }

  // 特定のレースに対するユーザーの馬券を取得
  async getUserRaceBets(userId, raceId) {
    const userBets = await this.getUserBets(userId);
    return userBets.filter(bet => bet.raceId === raceId);
  }

  // 特定レースの全ユーザー馬券を取得
  async getRaceBets(raceId) {
    if (this.firebaseClient) {
      try {
        const result = await this.firebaseClient.getRaceBets(raceId);
        if (result.success) {
          return result.data;
        }
      } catch (error) {
        console.error(`レース馬券取得エラー (ID: ${raceId}):`, error);
      }
    }
    
    // Firebaseからの取得に失敗した場合はメモリキャッシュから検索
    let raceBets = [];
    for (const [_, userBets] of this.bets.entries()) {
      raceBets = [
        ...raceBets,
        ...userBets.filter(bet => bet.raceId === raceId && bet.status === 'active')
      ];
    }
    
    return raceBets;
  }

  // 馬券の結果を処理
  async processBetResult(raceId, raceResult) {
    console.log(`レース ID: ${raceId} の馬券結果を処理しています...`);
    let processedBets = [];
    
    // レースの馬券を取得（Firebaseから、または必要ならキャッシュから）
    const raceBets = await this.getRaceBets(raceId);
    
    // 各馬券の結果を処理
    for (const bet of raceBets) {
      // 払戻金を計算
      const payout = this.calculator.calculatePayout(bet, raceResult);
      
      // 馬券の状態を更新
      const status = payout > 0 ? 'won' : 'lost';
      
      // メモリキャッシュの更新
      if (this.bets.has(bet.userId)) {
        const userBets = this.bets.get(bet.userId);
        const betIndex = userBets.findIndex(b => b.id === bet.id);
        
        if (betIndex !== -1) {
          userBets[betIndex].status = status;
          userBets[betIndex].payout = payout;
        }
      }
      
      // Firebaseの更新
      if (this.firebaseClient) {
        try {
          await this.firebaseClient.updateBetStatus(bet.id, status, payout);
        } catch (error) {
          console.error(`馬券結果更新エラー (ID: ${bet.id}):`, error);
        }
      }
      
      processedBets.push({
        userId: bet.userId,
        betId: bet.id,
        won: status === 'won',
        payout
      });
    }
    
    return processedBets;
  }

  // 馬券種類の表示名を取得
  getBetTypeDisplay(betType) {
    const types = {
      tansho: '単勝',
      fukusho: '複勝',
      wakuren: '枠連',
      umaren: '馬連',
      umatan: '馬単',
      wide: 'ワイド',
      sanrenpuku: '三連複',
      sanrentan: '三連単'
    };
    
    return types[betType] || betType;
  }

  // 購入方法の表示名を取得
  getBetMethodDisplay(method) {
    const methods = {
      normal: '通常',
      box: 'ボックス',
      formation: 'フォーメーション'
    };
    
    return methods[method] || method;
  }

  // 馬券の購入金額合計を取得
  calculateBetAmount(userId) {
    let total = 0;
    const userBets = this.bets.get(userId) || [];
    
    for (const bet of userBets) {
      total += bet.amount;
    }
    
    return total;
  }

  // 馬券の払戻金合計を取得
  calculateTotalPayout(userId) {
    let total = 0;
    const userBets = this.bets.get(userId) || [];
    
    for (const bet of userBets) {
      if (bet.status === 'won') {
        total += bet.payout;
      }
    }
    
    return total;
  }

  // 的中率を計算
  calculateWinRate(userId) {
    const userBets = this.bets.get(userId) || [];
    const completedBets = userBets.filter(bet => bet.status === 'won' || bet.status === 'lost');
    
    if (completedBets.length === 0) {
      return 0;
    }
    
    const wonBets = completedBets.filter(bet => bet.status === 'won');
    return (wonBets.length / completedBets.length) * 100;
  }
}

module.exports = BetManager;