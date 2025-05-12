// src/betting/betCalculator.js
class BetCalculator {
  constructor() {
    // 馬券タイプの定義
    this.betTypes = {
      TANSHO: 'tansho',       // 単勝
      FUKUSHO: 'fukusho',     // 複勝
      WAKUREN: 'wakuren',     // 枠連
      UMAREN: 'umaren',       // 馬連
      UMATAN: 'umatan',       // 馬単
      WIDE: 'wide',           // ワイド
      SANRENPUKU: 'sanrenpuku', // 三連複
      SANRENTAN: 'sanrentan'    // 三連単
    };
    
    // 購入方法
    this.betMethods = {
      NORMAL: 'normal',         // 通常
      BOX: 'box',               // ボックス
      FORMATION: 'formation'    // フォーメーション
    };
  }

  // 払戻金を計算
  calculatePayout(bet, raceResult) {
    if (!raceResult || !raceResult.payouts) {
      return 0;
    }

    const { betType, method, selections, amount } = bet;
    let payout = 0;

    // 通常の馬券の場合
    if (method === this.betMethods.NORMAL) {
      payout = this.calculateNormalPayout(betType, selections, amount, raceResult.payouts);
    } 
    // ボックス馬券の場合
    else if (method === this.betMethods.BOX) {
      payout = this.calculateBoxPayout(betType, selections, amount, raceResult.payouts);
    }
    // フォーメーション馬券の場合
    else if (method === this.betMethods.FORMATION) {
      payout = this.calculateFormationPayout(betType, selections, amount, raceResult.payouts);
    }

    return payout;
  }

  // 通常の馬券の払戻金を計算
  calculateNormalPayout(betType, selections, amount, payouts) {
    let payout = 0;
    const payoutKey = this.getPayoutKey(betType);
    
    if (!payouts[payoutKey]) {
      return 0;
    }

    const selectedKey = this.getSelectionKey(selections);
    
    for (const entry of payouts[payoutKey]) {
      const payoutKey = entry.numbers.replace(/\s+/g, '-');
      
      if (this.matchSelections(betType, selectedKey, payoutKey)) {
        // 1口100円で計算されているため、金額に応じて調整
        payout = (entry.amount * amount) / 100;
        break;
      }
    }
    
    return payout;
  }

  // ボックス馬券の払戻金を計算
  calculateBoxPayout(betType, selections, amount, payouts) {
    // ボックス対象の馬券タイプを確認
    if (![this.betTypes.UMAREN, this.betTypes.UMATAN, this.betTypes.SANRENPUKU, this.betTypes.SANRENTAN].includes(betType)) {
      return 0;
    }
    
    // 全組み合わせを生成
    const combinations = this.generateCombinations(selections, this.getRequiredSelections(betType));
    const payoutKey = this.getPayoutKey(betType);
    
    if (!payouts[payoutKey]) {
      return 0;
    }
    
    // 各組み合わせでの的中をチェック
    for (const combo of combinations) {
      const selectedKey = this.getSelectionKey(combo);
      
      for (const entry of payouts[payoutKey]) {
        const payoutKey = entry.numbers.replace(/\s+/g, '-');
        
        if (this.matchSelections(betType, selectedKey, payoutKey)) {
          // 1口分の金額で計算
          const amountPerCombo = amount / combinations.length;
          return (entry.amount * amountPerCombo) / 100;
        }
      }
    }
    
    return 0;
  }

  // フォーメーション馬券の払戻金を計算
  calculateFormationPayout(betType, selections, amount, payouts) {
    // フォーメーション対象の馬券タイプを確認
    if (![this.betTypes.UMAREN, this.betTypes.UMATAN, this.betTypes.SANRENPUKU, this.betTypes.SANRENTAN].includes(betType)) {
      return 0;
    }
    
    const { first, second, third } = selections;
    const payoutKey = this.getPayoutKey(betType);
    
    if (!payouts[payoutKey]) {
      return 0;
    }
    
    // 組み合わせを生成
    let combinations = [];
    
    if (betType === this.betTypes.UMAREN || betType === this.betTypes.UMATAN) {
      // 2頭選択の場合
      for (const f of first) {
        for (const s of second) {
          if (f !== s) {
            combinations.push([f, s]);
          }
        }
      }
    } else {
      // 3頭選択の場合
      for (const f of first) {
        for (const s of second) {
          for (const t of third || []) {
            if (f !== s && f !== t && s !== t) {
              combinations.push([f, s, t]);
            }
          }
        }
      }
    }
    
    // 各組み合わせでの的中をチェック
    for (const combo of combinations) {
      let selectedKey;
      
      // 馬単と三連単は順序が重要
      if (betType === this.betTypes.UMATAN || betType === this.betTypes.SANRENTAN) {
        selectedKey = this.getSelectionKey(combo);
      } else {
        // 馬連と三連複は順序不問
        selectedKey = this.getSelectionKey(combo.sort((a, b) => a - b));
      }
      
      for (const entry of payouts[payoutKey]) {
        const payoutKey = entry.numbers.replace(/\s+/g, '-');
        
        if (this.matchSelections(betType, selectedKey, payoutKey)) {
          // 1口分の金額で計算
          const amountPerCombo = amount / combinations.length;
          return (entry.amount * amountPerCombo) / 100;
        }
      }
    }
    
    return 0;
  }

  // 馬券タイプに応じた払戻キーを取得
  getPayoutKey(betType) {
    const payoutMap = {
      [this.betTypes.TANSHO]: 'tansho',
      [this.betTypes.FUKUSHO]: 'fukusho',
      [this.betTypes.WAKUREN]: 'wakuren',
      [this.betTypes.UMAREN]: 'umaren',
      [this.betTypes.WIDE]: 'wide',
      [this.betTypes.UMATAN]: 'umatan',
      [this.betTypes.SANRENPUKU]: 'sanrenpuku',
      [this.betTypes.SANRENTAN]: 'sanrentan'
    };
    
    return payoutMap[betType] || '';
  }

  // 選択馬番から選択キーを生成
  getSelectionKey(selections) {
    return Array.isArray(selections) ? selections.join('-') : selections;
  }

  // 選択と的中馬番が一致するかチェック
  matchSelections(betType, selectedKey, payoutKey) {
    if (betType === this.betTypes.TANSHO || betType === this.betTypes.FUKUSHO) {
      // 単勝・複勝は完全一致
      return selectedKey === payoutKey;
    } else if ([this.betTypes.UMAREN, this.betTypes.WAKUREN, this.betTypes.WIDE, this.betTypes.SANRENPUKU].includes(betType)) {
      // 順序不問の馬券は組み合わせ一致
      const selected = selectedKey.split('-').sort().join('-');
      const payout = payoutKey.split('-').sort().join('-');
      return selected === payout;
    } else {
      // 順序重要の馬券は完全一致
      return selectedKey === payoutKey;
    }
  }

  // 馬券タイプに必要な選択数を取得
  getRequiredSelections(betType) {
    if ([this.betTypes.TANSHO, this.betTypes.FUKUSHO].includes(betType)) {
      return 1;
    } else if ([this.betTypes.WAKUREN, this.betTypes.UMAREN, this.betTypes.WIDE, this.betTypes.UMATAN].includes(betType)) {
      return 2;
    } else {
      return 3;
    }
  }

  // 組み合わせを生成
  generateCombinations(arr, size) {
    const result = [];
    
    function backtrack(start, current) {
      if (current.length === size) {
        result.push([...current]);
        return;
      }
      
      for (let i = start; i < arr.length; i++) {
        current.push(arr[i]);
        backtrack(i + 1, current);
        current.pop();
      }
    }
    
    backtrack(0, []);
    return result;
  }

  // 馬券の購入枚数（点数）を計算
  calculateTicketCount(betType, method, selections) {
    if (method === this.betMethods.NORMAL) {
      return 1;
    } else if (method === this.betMethods.BOX) {
      const n = selections.length;
      const r = this.getRequiredSelections(betType);
      
      // 組み合わせ数 nCr
      return this.factorial(n) / (this.factorial(r) * this.factorial(n - r));
    } else if (method === this.betMethods.FORMATION) {
      const { first, second, third } = selections;
      
      if (betType === this.betTypes.UMAREN || betType === this.betTypes.UMATAN) {
        return first.length * second.length;
      } else {
        return first.length * second.length * (third?.length || 1);
      }
    }
    
    return 0;
  }

  // 階乗計算
  factorial(n) {
    if (n === 0 || n === 1) {
      return 1;
    }
    return n * this.factorial(n - 1);
  }
}

module.exports = BetCalculator;