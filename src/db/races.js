// races.js - レースデータの操作
const { getDb } = require('./firebase');

/**
 * 当日のレース一覧を取得する
 */
async function getTodayRaces() {
  try {
    const db = getDb();
    
    // 現在の日付を取得
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const dateString = `${year}/${month}/${day}`;
    
    const racesRef = db.collection('races');
    const snapshot = await racesRef.where('date', '==', dateString).get();
    
    const races = [];
    snapshot.forEach(doc => {
      races.push(doc.data());
    });
    
    return races;
  } catch (error) {
    console.error('レース一覧の取得中にエラーが発生しました:', error);
    return [];
  }
}

/**
 * 特定のレース情報を取得する
 */
async function getRaceById(raceId) {
  try {
    const db = getDb();
    const raceRef = db.collection('races').doc(raceId);
    const doc = await raceRef.get();
    
    if (!doc.exists) {
      return null;
    }
    
    return doc.data();
  } catch (error) {
    console.error(`レース情報(${raceId})の取得中にエラーが発生しました:`, error);
    return null;
  }
}

/**
 * レース情報をデータベースに保存する
 */
async function saveRaceData(raceId, raceData) {
  try {
    const db = getDb();
    await db.collection('raceDetails').doc(raceId).set(raceData, { merge: true });
    return true;
  } catch (error) {
    console.error(`レース情報(${raceId})の保存中にエラーが発生しました:`, error);
    return false;
  }
}

/**
 * レース結果をデータベースに保存する
 */
async function saveResultData(raceId, resultData) {
  try {
    const db = getDb();
    await db.collection('raceResults').doc(raceId).set(resultData, { merge: true });
    
    // レースの状態を完了に更新
    await updateRaceStatus({
      id: raceId,
      isCompleted: true
    });
    
    // 馬券の払い戻し処理を実行
    await processBetPayouts(raceId);
    
    return true;
  } catch (error) {
    console.error(`レース結果(${raceId})の保存中にエラーが発生しました:`, error);
    return false;
  }
}

/**
 * レースの状態を更新する
 */
async function updateRaceStatus(raceData) {
  try {
    const db = getDb();
    await db.collection('races').doc(raceData.id).set(raceData, { merge: true });
    return true;
  } catch (error) {
    console.error(`レース状態(${raceData.id})の更新中にエラーが発生しました:`, error);
    return false;
  }
}

/**
 * 未完了のレース一覧を取得する
 */
async function getAllActiveRaces() {
  try {
    const db = getDb();
    
    // 現在の日付を取得
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const dateString = `${year}/${month}/${day}`;
    
    const racesRef = db.collection('races');
    const snapshot = await racesRef
      .where('date', '==', dateString)
      .where('isCompleted', '==', false)
      .get();
    
    const races = [];
    snapshot.forEach(doc => {
      races.push(doc.data());
    });
    
    return races;
  } catch (error) {
    console.error('アクティブなレース一覧の取得中にエラーが発生しました:', error);
    return [];
  }
}

/**
 * レース結果に基づいて馬券の払い戻し処理を行う
 */
async function processBetPayouts(raceId) {
  try {
    const db = getDb();
    
    // レース結果を取得
    const resultRef = db.collection('raceResults').doc(raceId);
    const resultDoc = await resultRef.get();
    
    if (!resultDoc.exists) {
      console.error(`レース結果(${raceId})が見つかりません`);
      return false;
    }
    
    const resultData = resultDoc.data();
    const payouts = resultData.payouts;
    
    // このレースの馬券一覧を取得
    const betsRef = db.collection('bets');
    const snapshot = await betsRef.where('raceId', '==', raceId).where('settled', '==', false).get();
    
    // 各馬券に対して払い戻し処理を実行
    const batch = db.batch();
    
    snapshot.forEach(doc => {
      const bet = doc.data();
      let payout = 0;
      
      // 馬券タイプに応じた払い戻し計算
      switch (bet.type) {
        case 'tansho':
          payout = calculateTanshoPayoutAmount(bet, payouts.tansho);
          break;
        case 'fukusho':
          payout = calculateFukushoPayoutAmount(bet, payouts.fukusho);
          break;
        case 'wakuren':
          payout = calculateWakurenPayoutAmount(bet, payouts.wakuren);
          break;
        case 'umaren':
          payout = calculateUmarenPayoutAmount(bet, payouts.umaren);
          break;
        case 'umatan':
          payout = calculateUmatanPayoutAmount(bet, payouts.umatan);
          break;
        case 'wide':
          payout = calculateWidePayoutAmount(bet, payouts.wide);
          break;
        case 'sanrentan':
          payout = calculateSanrentanPayoutAmount(bet, payouts.sanrentan);
          break;
        case 'sanrenpuku':
          payout = calculateSanrenpukuPayoutAmount(bet, payouts.sanrenpuku);
          break;
      }
      
      // 馬券情報を更新
      batch.update(doc.ref, {
        settled: true,
        payout,
        settledAt: new Date().toISOString()
      });
      
      // ユーザーのポイントを更新
      if (payout > 0) {
        const userRef = db.collection('users').doc(bet.userId);
        batch.update(userRef, {
          points: admin.firestore.FieldValue.increment(payout)
        });
      }
    });
    
    // バッチ処理を実行
    await batch.commit();
    
    return true;
  } catch (error) {
    console.error(`馬券払い戻し処理(${raceId})中にエラーが発生しました:`, error);
    return false;
  }
}

/**
 * 単勝の払い戻し額を計算
 */
function calculateTanshoPayoutAmount(bet, payoutData) {
  for (const data of payoutData) {
    if (data.numbers[0] === bet.numbers[0]) {
      return Math.floor(bet.amount * data.payout / 100);
    }
  }
  return 0;
}

/**
 * 複勝の払い戻し額を計算
 */
function calculateFukushoPayoutAmount(bet, payoutData) {
  for (const data of payoutData) {
    if (data.numbers.includes(bet.numbers[0])) {
      return Math.floor(bet.amount * data.payout / 100);
    }
  }
  return 0;
}

/**
 * 枠連の払い戻し額を計算
 */
function calculateWakurenPayoutAmount(bet, payoutData) {
  for (const data of payoutData) {
    // 組み合わせが一致するか確認
    const match1 = data.numbers.includes(bet.numbers[0]) && data.numbers.includes(bet.numbers[1]);
    
    if (match1) {
      return Math.floor(bet.amount * data.payout / 100);
    }
  }
  return 0;
}

/**
 * 馬連の払い戻し額を計算
 */
function calculateUmarenPayoutAmount(bet, payoutData) {
  for (const data of payoutData) {
    // 組み合わせが一致するか確認
    const match1 = data.numbers.includes(bet.numbers[0]) && data.numbers.includes(bet.numbers[1]);
    
    if (match1) {
      return Math.floor(bet.amount * data.payout / 100);
    }
  }
  return 0;
}

/**
 * 馬単の払い戻し額を計算
 */
function calculateUmatanPayoutAmount(bet, payoutData) {
  for (const data of payoutData) {
    // 組み合わせと順序が一致するか確認
    const match = data.numbers[0] === bet.numbers[0] && data.numbers[1] === bet.numbers[1];
    
    if (match) {
      return Math.floor(bet.amount * data.payout / 100);
    }
  }
  return 0;
}

/**
 * ワイドの払い戻し額を計算
 */
function calculateWidePayoutAmount(bet, payoutData) {
  for (const data of payoutData) {
    // 組み合わせが一致するか確認
    const match = data.numbers.includes(bet.numbers[0]) && data.numbers.includes(bet.numbers[1]);
    
    if (match) {
      return Math.floor(bet.amount * data.payout / 100);
    }
  }
  return 0;
}

/**
 * 三連単の払い戻し額を計算
 */
function calculateSanrentanPayoutAmount(bet, payoutData) {
  for (const data of payoutData) {
    // 組み合わせと順序が一致するか確認
    const match = 
      data.numbers[0] === bet.numbers[0] && 
      data.numbers[1] === bet.numbers[1] && 
      data.numbers[2] === bet.numbers[2];
    
    if (match) {
      return Math.floor(bet.amount * data.payout / 100);
    }
  }
  return 0;
}

/**
 * 三連複の払い戻し額を計算
 */
function calculateSanrenpukuPayoutAmount(bet, payoutData) {
  for (const data of payoutData) {
    // 組み合わせが一致するか確認
    const match = 
      data.numbers.includes(bet.numbers[0]) && 
      data.numbers.includes(bet.numbers[1]) && 
      data.numbers.includes(bet.numbers[2]);
    
    if (match) {
      return Math.floor(bet.amount * data.payout / 100);
    }
  }
  return 0;
}

module.exports = {
  getTodayRaces,
  getRaceById,
  saveRaceData,
  saveResultData,
  updateRaceStatus,
  getAllActiveRaces
};