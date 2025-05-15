// races.js - レースデータの操作
const { getDb } = require('./firebase');

/**
 * レース一覧をデータベースに保存
 * @param {Array} races レース一覧
 */

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

    // まず raceDetails コレクションから詳細情報を取得
    const detailRef = db.collection('raceDetails').doc(raceId);
    const detailDoc = await detailRef.get();

    if (detailDoc.exists) {
      return detailDoc.data();
    }

    // 詳細がなければ基本情報を取得
    const raceRef = db.collection('races').doc(raceId);
    const raceDoc = await raceRef.get();

    if (!raceDoc.exists) {
      return null;
    }

    return raceDoc.data();
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

    // races コレクションの基本情報も更新
    const basicInfo = {
      id: raceId,
      name: raceData.name,
      track: raceData.track || '',
      number: raceData.number || '',
      time: raceData.time,
      type: raceData.type || 'jra',
      date: raceData.date || new Date().toISOString().split('T')[0].replace(/-/g, '/'),
      isCompleted: raceData.isCompleted || false,
      lastUpdated: new Date().toISOString()
    };

    await db.collection('races').doc(raceId).set(basicInfo, { merge: true });

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

async function updateRaceList(races) {
  try {
    const db = getDb();
    
    // 既存のレース一覧を取得
    const existingRaces = await getTodayRaces();
    const existingRaceIds = new Set(existingRaces.map(race => race.id));
    
    // バッチ処理の準備
    const batch = db.batch();
    const maxBatchSize = 500; // Firestore のバッチ上限
    let batchCount = 0;
    let newRaceCount = 0;
    let updatedRaceCount = 0;
    
    // 新しいレースを追加・更新
    for (const race of races) {
      const raceRef = db.collection('races').doc(race.id);
      
      // 基本情報を整理
      const basicInfo = {
        id: race.id,
        name: race.name || '不明',
        track: race.track || '不明',
        number: race.number || '',
        time: race.time || '00:00',
        type: race.type || 'jra',
        date: race.date || new Date().toISOString().split('T')[0].replace(/-/g, '/'),
        isCompleted: race.isCompleted || false,
        lastUpdated: new Date().toISOString()
      };
      
      // 新規または更新
      if (existingRaceIds.has(race.id)) {
        // 既存レースの更新
        batch.set(raceRef, basicInfo, { merge: true });
        updatedRaceCount++;
      } else {
        // 新規レースの追加
        batch.set(raceRef, basicInfo);
        newRaceCount++;
      }
      
      batchCount++;
      
      // バッチサイズの上限に達したらコミット
      if (batchCount >= maxBatchSize) {
        await batch.commit();
        console.log(`${batchCount}件のレースデータを保存しました。`);
        
        // 新しいバッチを開始
        batch = db.batch();
        batchCount = 0;
      }
    }
    
    // 残りのバッチをコミット
    if (batchCount > 0) {
      await batch.commit();
      console.log(`${batchCount}件のレースデータを保存しました。`);
    }
    
    console.log(`レース一覧の更新が完了しました。新規: ${newRaceCount}件, 更新: ${updatedRaceCount}件`);
    return true;
  } catch (error) {
    console.error('レース一覧の更新中にエラーが発生しました:', error);
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
  getAllActiveRaces,
  updateRaceList
};