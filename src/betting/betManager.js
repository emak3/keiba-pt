// src/betting/betManager.js
const BetCalculator = require('./betCalculator');

class BetManager {
  constructor() {
    this.bets = new Map(); // ユーザーごとの馬券を管理
    this.calculator = new BetCalculator();
  }

  // 馬券を購入
  placeBet(userId, raceId, betType, method, selections, amount) {
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
    
    // ユーザーの馬券リストに追加
    if (!this.bets.has(userId)) {
      this.bets.set(userId, []);
    }
    
    this.bets.get(userId).push(bet);
    
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
  getUserBets(userId) {
    return this.bets.get(userId) || [];
  }

  // 特定のレースに対するユーザーの馬券を取得
  getUserRaceBets(userId, raceId) {
    const userBets = this.bets.get(userId) || [];
    return userBets.filter(bet => bet.raceId === raceId);
  }

  // 馬券の結果を処理
  processBetResult(raceId, raceResult) {
    let processedBets = [];
    
    // 全ユーザーの馬券をチェック
    for (const [userId, userBets] of this.bets.entries()) {
      for (const bet of userBets) {
        if (bet.raceId === raceId && bet.status === 'active') {
          // 払戻金を計算
          const payout = this.calculator.calculatePayout(bet, raceResult);
          
          // 馬券の状態を更新
          bet.status = payout > 0 ? 'won' : 'lost';
          bet.payout = payout;
          
          processedBets.push({
            userId,
            betId: bet.id,
            won: bet.status === 'won',
            payout
          });
        }
      }
    }
    
    return processedBets;
  }
}

module.exports = BetManager;