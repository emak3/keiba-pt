// bets.js - 馬券データの操作
const { getDb } = require('./firebase');
const { updateUserPoints } = require('./users');

/**
 * 馬券を購入する
 */
async function placeBet(betData) {
  try {
    const db = getDb();
    
    // ユーザーのポイントを減らす
    const pointsUpdate = await updateUserPoints(betData.userId, -betData.amount);
    
    if (!pointsUpdate.success) {
      return {
        success: false,
        message: pointsUpdate.message
      };
    }
    
    // 馬券データを作成
    const newBet = {
      id: db.collection('bets').doc().id,
      userId: betData.userId,
      raceId: betData.raceId,
      type: betData.type, // 'tansho', 'fukusho', 'umaren', etc.
      numbers: betData.numbers, // [1], [2], [1, 2], [1, 2, 3] etc.
      amount: betData.amount,
      settled: false,
      payout: 0,
      createdAt: new Date().toISOString()
    };
    
    // ボックス購入の場合は組み合わせを作成
    if (betData.method === 'box') {
      return await placeBoxBet(newBet);
    }
    
    // フォーメーション購入の場合
    if (betData.method === 'formation') {
      return await placeFormationBet(newBet, betData.first, betData.second, betData.third);
    }
    
    // 通常購入
    await db.collection('bets').doc(newBet.id).set(newBet);
    
    return {
      success: true,
      betId: newBet.id,
      message: '馬券を購入しました'
    };
  } catch (error) {
    console.error('馬券購入中にエラーが発生しました:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * ボックス購入（すべての順列を購入）
 */
async function placeBoxBet(baseBet) {
  try {
    const db = getDb();
    const batch = db.batch();
    
    // 組み合わせを生成
    const combinations = generateBoxCombinations(baseBet.numbers, baseBet.type);
    
    // 各組み合わせに対して馬券を作成
    const unitAmount = Math.floor(baseBet.amount / combinations.length);
    
    for (const numbers of combinations) {
      const bet = {
        ...baseBet,
        id: db.collection('bets').doc().id,
        numbers,
        amount: unitAmount
      };
      
      const docRef = db.collection('bets').doc(bet.id);
      batch.set(docRef, bet);
    }
    
    await batch.commit();
    
    return {
      success: true,
      message: `${combinations.length}通り（BOX）の馬券を購入しました`
    };
  } catch (error) {
    console.error('BOX馬券購入中にエラーが発生しました:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * フォーメーション購入
 */
async function placeFormationBet(baseBet, first, second, third) {
  try {
    const db = getDb();
    const batch = db.batch();
    
    let combinations = [];
    
    // 馬券タイプに応じた組み合わせを生成
    if (['umaren', 'wide'].includes(baseBet.type)) {
      // 2頭選択の場合
      for (const num1 of first) {
        for (const num2 of second) {
          if (num1 !== num2) {
            if (baseBet.type === 'umaren') {
              combinations.push([num1, num2].sort((a, b) => a - b)); // 順不同
            } else {
              combinations.push([num1, num2]); // ワイドは順序考慮
            }
          }
        }
      }
    } else if (baseBet.type === 'umatan') {
      // 馬単（順序あり2頭選択）
      for (const num1 of first) {
        for (const num2 of second) {
          if (num1 !== num2) {
            combinations.push([num1, num2]);
          }
        }
      }
    } else if (['sanrentan', 'sanrenpuku'].includes(baseBet.type)) {
      // 3連系
      for (const num1 of first) {
        for (const num2 of second) {
          for (const num3 of third || second) { // 第3軸が指定されていない場合は第2軸を使用
            if (num1 !== num2 && num1 !== num3 && num2 !== num3) {
              if (baseBet.type === 'sanrenpuku') {
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
    combinations = [...new Set(combinations.map(JSON.stringify))].map(JSON.parse);
    
    // 各組み合わせに対して馬券を作成
    const unitAmount = Math.floor(baseBet.amount / combinations.length);
    
    for (const numbers of combinations) {
      const bet = {
        ...baseBet,
        id: db.collection('bets').doc().id,
        numbers,
        amount: unitAmount
      };
      
      const docRef = db.collection('bets').doc(bet.id);
      batch.set(docRef, bet);
    }
    
    await batch.commit();
    
    return {
      success: true,
      message: `${combinations.length}通り（フォーメーション）の馬券を購入しました`
    };
  } catch (error) {
    console.error('フォーメーション馬券購入中にエラーが発生しました:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * ボックス購入用の組み合わせを生成
 */
function generateBoxCombinations(numbers, betType) {
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
}

/**
 * ユーザーの馬券履歴を取得
 */
async function getUserBets(userId, limit = 20) {
  try {
    const db = getDb();
    const betsRef = db.collection('bets');
    const snapshot = await betsRef
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    
    const bets = [];
    snapshot.forEach(doc => {
      bets.push(doc.data());
    });
    
    return bets;
  } catch (error) {
    console.error(`ユーザー(${userId})の馬券履歴取得中にエラーが発生しました:`, error);
    return [];
  }
}

/**
 * 特定のレースのユーザーの馬券を取得
 */
async function getUserRaceBets(userId, raceId) {
  try {
    const db = getDb();
    const betsRef = db.collection('bets');
    const snapshot = await betsRef
      .where('userId', '==', userId)
      .where('raceId', '==', raceId)
      .orderBy('createdAt', 'desc')
      .get();
    
    const bets = [];
    snapshot.forEach(doc => {
      bets.push(doc.data());
    });
    
    return bets;
  } catch (error) {
    console.error(`ユーザー(${userId})のレース(${raceId})馬券取得中にエラーが発生しました:`, error);
    return [];
  }
}

module.exports = {
  placeBet,
  getUserBets,
  getUserRaceBets
};