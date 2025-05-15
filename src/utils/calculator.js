// calculator.js - 払戻金計算ユーティリティ
/**
 * 払戻金計算用のユーティリティ
 */
const calculator = {
  /**
   * 単勝の払い戻し額を計算
   * @param {Object} bet 馬券情報
   * @param {Array} payoutData 払戻金情報
   * @returns {number} 払戻金額
   */
  calculateTanshoPayoutAmount(bet, payoutData) {
    for (const data of payoutData) {
      if (data.numbers[0] === bet.numbers[0]) {
        return Math.floor(bet.amount * data.payout / 100);
      }
    }
    return 0;
  },

  /**
   * 複勝の払い戻し額を計算
   * @param {Object} bet 馬券情報
   * @param {Array} payoutData 払戻金情報
   * @returns {number} 払戻金額
   */
  calculateFukushoPayoutAmount(bet, payoutData) {
    for (const data of payoutData) {
      if (data.numbers.includes(bet.numbers[0])) {
        return Math.floor(bet.amount * data.payout / 100);
      }
    }
    return 0;
  },

  /**
   * 枠連の払い戻し額を計算
   * @param {Object} bet 馬券情報
   * @param {Array} payoutData 払戻金情報
   * @returns {number} 払戻金額
   */
  calculateWakurenPayoutAmount(bet, payoutData) {
    const sortedBetNumbers = [...bet.numbers].sort((a, b) => a - b);
    
    for (const data of payoutData) {
      const sortedDataNumbers = [...data.numbers].sort((a, b) => a - b);
      
      // 配列同士を比較
      if (JSON.stringify(sortedBetNumbers) === JSON.stringify(sortedDataNumbers)) {
        return Math.floor(bet.amount * data.payout / 100);
      }
    }
    return 0;
  },

  /**
   * 馬連の払い戻し額を計算
   * @param {Object} bet 馬券情報
   * @param {Array} payoutData 払戻金情報
   * @returns {number} 払戻金額
   */
  calculateUmarenPayoutAmount(bet, payoutData) {
    const sortedBetNumbers = [...bet.numbers].sort((a, b) => a - b);
    
    for (const data of payoutData) {
      const sortedDataNumbers = [...data.numbers].sort((a, b) => a - b);
      
      // 配列同士を比較
      if (JSON.stringify(sortedBetNumbers) === JSON.stringify(sortedDataNumbers)) {
        return Math.floor(bet.amount * data.payout / 100);
      }
    }
    return 0;
  },

  /**
   * 馬単の払い戻し額を計算
   * @param {Object} bet 馬券情報
   * @param {Array} payoutData 払戻金情報
   * @returns {number} 払戻金額
   */
  calculateUmatanPayoutAmount(bet, payoutData) {
    for (const data of payoutData) {
      // 順序も含めて完全一致するか確認
      if (JSON.stringify(bet.numbers) === JSON.stringify(data.numbers)) {
        return Math.floor(bet.amount * data.payout / 100);
      }
    }
    return 0;
  },

  /**
   * ワイドの払い戻し額を計算
   * @param {Object} bet 馬券情報
   * @param {Array} payoutData 払戻金情報
   * @returns {number} 払戻金額
   */
  calculateWidePayoutAmount(bet, payoutData) {
    const sortedBetNumbers = [...bet.numbers].sort((a, b) => a - b);
    
    for (const data of payoutData) {
      const sortedDataNumbers = [...data.numbers].sort((a, b) => a - b);
      
      // 配列同士を比較
      if (JSON.stringify(sortedBetNumbers) === JSON.stringify(sortedDataNumbers)) {
        return Math.floor(bet.amount * data.payout / 100);
      }
    }
    return 0;
  },

  /**
   * 三連複の払い戻し額を計算
   * @param {Object} bet 馬券情報
   * @param {Array} payoutData 払戻金情報
   * @returns {number} 払戻金額
   */
  calculateSanrenpukuPayoutAmount(bet, payoutData) {
    const sortedBetNumbers = [...bet.numbers].sort((a, b) => a - b);
    
    for (const data of payoutData) {
      const sortedDataNumbers = [...data.numbers].sort((a, b) => a - b);
      
      // 配列同士を比較
      if (JSON.stringify(sortedBetNumbers) === JSON.stringify(sortedDataNumbers)) {
        return Math.floor(bet.amount * data.payout / 100);
      }
    }
    return 0;
  },

  /**
   * 三連単の払い戻し額を計算
   * @param {Object} bet 馬券情報
   * @param {Array} payoutData 払戻金情報
   * @returns {number} 払戻金額
   */
  calculateSanrentanPayoutAmount(bet, payoutData) {
    for (const data of payoutData) {
      // 順序も含めて完全一致するか確認
      if (JSON.stringify(bet.numbers) === JSON.stringify(data.numbers)) {
        return Math.floor(bet.amount * data.payout / 100);
      }
    }
    return 0;
  },
  
  /**
   * 馬券タイプに応じた払い戻し額を計算
   * @param {Object} bet 馬券情報
   * @param {Object} payouts 全払戻金情報
   * @returns {number} 払戻金額
   */
  calculatePayout(bet, payouts) {
    switch (bet.type) {
      case 'tansho':
        return this.calculateTanshoPayoutAmount(bet, payouts.tansho);
      case 'fukusho':
        return this.calculateFukushoPayoutAmount(bet, payouts.fukusho);
      case 'wakuren':
        return this.calculateWakurenPayoutAmount(bet, payouts.wakuren);
      case 'umaren':
        return this.calculateUmarenPayoutAmount(bet, payouts.umaren);
      case 'umatan':
        return this.calculateUmatanPayoutAmount(bet, payouts.umatan);
      case 'wide':
        return this.calculateWidePayoutAmount(bet, payouts.wide);
      case 'sanrenpuku':
        return this.calculateSanrenpukuPayoutAmount(bet, payouts.sanrenpuku);
      case 'sanrentan':
        return this.calculateSanrentanPayoutAmount(bet, payouts.sanrentan);
      default:
        return 0;
    }
  },
  
  /**
   * ボックス購入の組み合わせを生成
   * @param {Array} numbers 選択された馬番
   * @param {string} betType 馬券タイプ
   * @returns {Array} 組み合わせ一覧
   */
  generateBoxCombinations(numbers, betType) {
    const combinations = [];
    
    if (['tansho', 'fukusho'].includes(betType)) {
      // 単勝・複勝は順列不要
      return numbers.map(n => [n]);
    } else if (['umaren', 'wide', 'wakuren'].includes(betType)) {
      // 2頭選択系（順不同）
      for (let i = 0; i < numbers.length; i++) {
        for (let j = i + 1; j < numbers.length; j++) {
          combinations.push([numbers[i], numbers[j]]);
        }
      }
    } else if (betType === 'umatan') {
      // 馬単（順序あり）
      for (let i = 0; i < numbers.length; i++) {
        for (let j = 0; j < numbers.length; j++) {
          if (i !== j) {
            combinations.push([numbers[i], numbers[j]]);
          }
        }
      }
    } else if (betType === 'sanrenpuku') {
      // 3連複（順不同）
      for (let i = 0; i < numbers.length; i++) {
        for (let j = i + 1; j < numbers.length; j++) {
          for (let k = j + 1; k < numbers.length; k++) {
            combinations.push([numbers[i], numbers[j], numbers[k]]);
          }
        }
      }
    } else if (betType === 'sanrentan') {
      // 3連単（順序あり）
      for (let i = 0; i < numbers.length; i++) {
        for (let j = 0; j < numbers.length; j++) {
          if (i === j) continue;
          for (let k = 0; k < numbers.length; k++) {
            if (i === k || j === k) continue;
            combinations.push([numbers[i], numbers[j], numbers[k]]);
          }
        }
      }
    }
    
    return combinations;
  },
  
  /**
   * フォーメーションの組み合わせを生成
   * @param {Array} first 第1軸
   * @param {Array} second 第2軸
   * @param {Array} third 第3軸
   * @param {string} betType 馬券タイプ
   * @returns {Array} 組み合わせ一覧
   */
  generateFormationCombinations(first, second, third, betType) {
    const combinations = [];
    
    if (['umaren', 'wide'].includes(betType)) {
      // 2頭選択の場合
      for (const num1 of first) {
        for (const num2 of second) {
          if (num1 !== num2) {
            if (betType === 'umaren') {
              combinations.push([num1, num2].sort((a, b) => a - b)); // 順不同
            } else {
              combinations.push([num1, num2]); // ワイドは順序考慮
            }
          }
        }
      }
    } else if (betType === 'umatan') {
      // 馬単（順序あり2頭選択）
      for (const num1 of first) {
        for (const num2 of second) {
          if (num1 !== num2) {
            combinations.push([num1, num2]);
          }
        }
      }
    } else if (['sanrentan', 'sanrenpuku'].includes(betType)) {
      // 3連系
      for (const num1 of first) {
        for (const num2 of second) {
          for (const num3 of third || second) { // 第3軸が指定されていない場合は第2軸を使用
            if (num1 !== num2 && num1 !== num3 && num2 !== num3) {
              if (betType === 'sanrenpuku') {
                combinations.push([num1, num2, num3].sort((a, b) => a - b)); // 順不同
              } else {
                combinations.push([num1, num2, num3]); // 順序あり
              }
            }
          }
        }
      }
    }
    
    // 重複を除去
    return [...new Set(combinations.map(JSON.stringify))].map(JSON.parse);
  },
  
  /**
   * 組み合わせ数を計算
   * @param {number} n 選択された馬番の数
   * @param {string} betType 馬券タイプ
   * @returns {number} 組み合わせ数
   */
  calculateCombinations(n, betType) {
    if (['tansho', 'fukusho'].includes(betType)) {
      return n;
    } else if (['umaren', 'wide', 'wakuren'].includes(betType)) {
      return (n * (n - 1)) / 2; // 順不同の2つ選択
    } else if (betType === 'umatan') {
      return n * (n - 1); // 順序ありの2つ選択
    } else if (betType === 'sanrenpuku') {
      return (n * (n - 1) * (n - 2)) / 6; // 順不同の3つ選択
    } else if (betType === 'sanrentan') {
      return n * (n - 1) * (n - 2); // 順序ありの3つ選択
    }
    return 0;
  }
};

module.exports = {
  calculator
};