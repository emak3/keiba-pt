// races.js - レースデータの操作
const admin = require('firebase-admin');
const { getDb } = require('./firebase');
const { getJapanTimeISOString } = require('../utils/date-helper');
const { extractDateFromRaceId } = require('../utils/date-helper');
const { getRaceNumberFromRaceId, getTrackNameFromRaceId } = require('../utils/track-helper');

/**
 * レース一覧をデータベースに保存
 * @param {Array} races レース一覧
 */

async function fixRaceDates() {
  try {
    const db = getDb();
    const racesRef = db.collection('races');
    const snapshot = await racesRef.get();

    const batch = db.batch();
    let updateCount = 0;

    snapshot.forEach(doc => {
      const race = doc.data();
      const raceId = race.id;

      if (raceId && raceId.length >= 10) {
        try {
          // レースIDから日付を抽出
          const year = raceId.substring(0, 4);
          const monthDay = raceId.substring(6, 10);
          const month = monthDay.substring(0, 2);
          const day = monthDay.substring(2, 4);

          const correctDate = `${year}/${month}/${day}`;

          if (race.date !== correctDate) {
            batch.update(doc.ref, {
              date: correctDate,
              lastUpdated: getJapanTimeISOString()
            });
            updateCount++;
          }
        } catch (err) {
          console.error(`レースID(${raceId})の処理中にエラー:`, err);
        }
      }
    });

    if (updateCount > 0) {
      await batch.commit();
      console.log(`${updateCount}件のレース日付を修正しました`);
    } else {
      console.log('修正が必要なレース日付はありませんでした');
    }

    return { success: true, updatedCount: updateCount };
  } catch (error) {
    console.error('レース日付の修正中にエラーが発生しました:', error);
    return { success: false, error: error.message };
  }
}
/**
 * 当日のレース一覧を取得する
 */
async function getTodayRaces() {
  try {
    const db = getDb();

    // 現在の日付を取得（ゼロパディングあり）
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateString = `${year}/${month}/${day}`;

    console.log(`本日の日付: ${dateString}`);

    const racesRef = db.collection('races');
    const snapshot = await racesRef.where('date', '==', dateString).get();

    console.log(`取得したレース数: ${snapshot.size}件`);

    // 複数のフォーマットでの日付文字列
    const dateFormats = [
      `${year}/${month}/${day}`,                          // パディングなし (2025/5/16)
      `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`,  // パディングあり (2025/05/16)
      `${year}-${month}-${day}`,                         // ISO形式パディングなし
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`   // ISO形式パディングあり
    ];

    console.log(`検索する日付フォーマット: ${dateFormats.join(', ')}`);

    let races = [];
    // 各フォーマットで検索を試みる
    for (const dateString of dateFormats) {
      const racesRef = db.collection('races');
      const snapshot = await racesRef.where('date', '==', dateString).get();

      console.log(`日付 "${dateString}" での取得レース数: ${snapshot.size}件`);

      if (snapshot.size > 0) {
        snapshot.forEach(doc => {
          races.push(doc.data());
        });
        console.log(`フォーマット "${dateString}" で ${snapshot.size}件のレースを取得しました`);
        break;  // 見つかったらループを終了
      }
    }

    // どのフォーマットでも見つからなかった場合
    if (races.length === 0) {
      console.log('いずれの日付フォーマットでもレースが見つかりませんでした');

      // 最新のレースデータを確認（デバッグ用）
      const recentSnapshot = await db.collection('races')
        .orderBy('lastUpdated', 'desc')
        .limit(3)
        .get();

      console.log('最新のレースデータ:');
      recentSnapshot.forEach(doc => {
        const race = doc.data();
        console.log(`ID: ${race.id}, 日付: ${race.date}, 更新: ${race.lastUpdated}`);
      });
    }

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
    const trackName = getTrackNameFromRaceId(raceId);
    // races コレクションの基本情報も更新
    const basicInfo = {
      id: raceId,
      name: raceData.name,
      track: raceData.track || trackName,
      number: raceData.number || getRaceNumberFromRaceId(raceId),
      time: raceData.time,
      type: raceData.type || 'jra',
      date: raceData.date || extractDateFromRaceId(raceId),
      isCompleted: raceData.isCompleted || false,
      lastUpdated: getJapanTimeISOString()
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
    console.log(`レース結果(${raceId})の保存を開始します...`);
    
    const db = getDb();
    
    // データの整合性チェック
    if (!resultData.payouts) {
      console.error('払戻情報が含まれていません');
      return false;
    }
    
    // 有効な払戻情報があるか確認
    let hasValidPayouts = false;
    for (const type in resultData.payouts) {
      if (resultData.payouts[type] && resultData.payouts[type].length > 0) {
        hasValidPayouts = true;
        break;
      }
    }
    
    if (!hasValidPayouts) {
      console.warn('有効な払戻情報が見つかりません。スクレイピングが正しく機能していない可能性があります。');
      // それでも保存を続行
    }
    
    // まずはraceResultsにデータを保存
    await db.collection('raceResults').doc(raceId).set(resultData, { merge: true });
    console.log(`レース結果(${raceId})をデータベースに保存しました`);
    
    // レースの状態を明示的に完了に更新
    await updateRaceStatus({
      id: raceId,
      isCompleted: true
    });
    console.log(`レース(${raceId})の状態を完了に更新しました`);
    
    // 馬券の払い戻し処理を別途実行
    const payoutResult = await processBetPayouts(raceId);
    console.log(`払戻処理結果: ${payoutResult ? '成功' : '失敗'}`);
    
    return true;
  } catch (error) {
    console.error(`レース結果(${raceId})の保存中にエラーが発生しました:`, error);
    console.error('スタックトレース:', error.stack);
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
        lastUpdated: getJapanTimeISOString()
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
    console.log(`レースID: ${raceId} の馬券精算処理を開始します...`);
    const db = getDb();
    
    // レース結果を取得
    const resultRef = db.collection('raceResults').doc(raceId);
    const resultDoc = await resultRef.get();
    
    if (!resultDoc.exists) {
      console.error(`レース結果(${raceId})が見つかりません`);
      return false;
    }
    
    const resultData = resultDoc.data();
    
    if (!resultData.payouts) {
      console.error(`レース結果(${raceId})に払戻情報がありません`);
      return false;
    }
    
    // 払戻情報の存在確認
    let hasPayoutData = false;
    for (const type in resultData.payouts) {
      if (resultData.payouts[type] && resultData.payouts[type].length > 0) {
        hasPayoutData = true;
        break;
      }
    }
    
    if (!hasPayoutData) {
      console.error(`レース結果(${raceId})に有効な払戻情報がありません`);
      return false;
    }
    
    // 未精算の馬券を取得
    const betsRef = db.collection('bets');
    const snapshot = await betsRef
      .where('raceId', '==', raceId)
      .where('settled', '==', false)
      .get();
    
    console.log(`処理対象の馬券数: ${snapshot.size}件`);
    
    if (snapshot.empty) {
      console.log(`処理対象の馬券がありません。`);
      return true;
    }
    
    // 各馬券に対して払い戻し処理を実行
    const batch = db.batch();
    let count = 0;
    let totalPayout = 0;
    const maxBatchSize = 450; // Firestoreのバッチ上限に近い値
    let batches = [batch];
    let currentBatchIndex = 0;
    
    snapshot.forEach(doc => {
      try {
        const bet = doc.data();
        let payout = 0;
        
        // 馬券タイプに応じた払い戻し計算
        console.log(`馬券ID: ${doc.id}, タイプ: ${bet.type}, 番号: ${bet.numbers.join(',')}`);
        
        switch (bet.type) {
          case 'tansho':
            if (resultData.payouts.tansho && resultData.payouts.tansho.length > 0) {
              payout = calculateTanshoPayoutAmount(bet, resultData.payouts.tansho);
            }
            break;
          case 'fukusho':
            if (resultData.payouts.fukusho && resultData.payouts.fukusho.length > 0) {
              payout = calculateFukushoPayoutAmount(bet, resultData.payouts.fukusho);
            }
            break;
          case 'wakuren':
            if (resultData.payouts.wakuren && resultData.payouts.wakuren.length > 0) {
              payout = calculateWakurenPayoutAmount(bet, resultData.payouts.wakuren);
            }
            break;
          case 'umaren':
            if (resultData.payouts.umaren && resultData.payouts.umaren.length > 0) {
              payout = calculateUmarenPayoutAmount(bet, resultData.payouts.umaren);
            }
            break;
          case 'umatan':
            if (resultData.payouts.umatan && resultData.payouts.umatan.length > 0) {
              payout = calculateUmatanPayoutAmount(bet, resultData.payouts.umatan);
            }
            break;
          case 'wide':
            if (resultData.payouts.wide && resultData.payouts.wide.length > 0) {
              payout = calculateWidePayoutAmount(bet, resultData.payouts.wide);
            }
            break;
          case 'sanrentan':
            if (resultData.payouts.sanrentan && resultData.payouts.sanrentan.length > 0) {
              payout = calculateSanrentanPayoutAmount(bet, resultData.payouts.sanrentan);
            }
            break;
          case 'sanrenpuku':
            if (resultData.payouts.sanrenpuku && resultData.payouts.sanrenpuku.length > 0) {
              payout = calculateSanrenpukuPayoutAmount(bet, resultData.payouts.sanrenpuku);
            }
            break;
        }
        
        console.log(`払戻金額: ${payout}pt`);
        totalPayout += payout;
        
        // バッチサイズチェック
        if (count >= maxBatchSize) {
          count = 0;
          batches.push(db.batch());
          currentBatchIndex++;
        }
        
        // 馬券情報を更新
        batches[currentBatchIndex].update(doc.ref, {
          settled: true,
          payout,
          settledAt: new Date().toISOString()
        });
        
        // ユーザーのポイントを更新
        if (payout > 0) {
          const userRef = db.collection('users').doc(bet.userId);
          batches[currentBatchIndex].update(userRef, {
            points: admin.firestore.FieldValue.increment(payout)
          });
        }
        
        count++;
      } catch (betError) {
        console.error(`馬券処理中にエラー: ${betError.message}`);
      }
    });
    
    // バッチ処理を実行
    if (batches.length > 0) {
      console.log(`${snapshot.size}件の馬券を処理します... 総払戻: ${totalPayout}pt, バッチ数: ${batches.length}`);
      
      for (let i = 0; i < batches.length; i++) {
        try {
          if (i > 0) {
            // 連続リクエストを避けるために少し待機
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          await batches[i].commit();
          console.log(`バッチ ${i+1}/${batches.length} コミット完了`);
        } catch (batchError) {
          console.error(`バッチ ${i+1} コミット中にエラー:`, batchError);
        }
      }
      
      console.log(`精算処理が完了しました`);
    }
    
    return true;
  } catch (error) {
    console.error(`馬券払い戻し処理(${raceId})中にエラーが発生しました:`, error);
    console.error(`スタックトレース:`, error.stack);
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

async function debugRaceData(specificDate = null) {
  try {
    const db = getDb();

    // 日付を取得（指定されていれば使用、なければ今日の日付）
    const target = specificDate ? new Date(specificDate) : new Date();
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, '0');
    const day = String(target.getDate()).padStart(2, '0');

    // 複数のフォーマットで試す
    const formats = [
      `${year}/${month}/${day}`,  // パディングあり
      `${year}/${target.getMonth() + 1}/${target.getDate()}`, // パディングなし
      `${year}-${month}-${day}`   // ISO形式
    ];

    console.log("検索する日付フォーマット:", formats);

    // 各フォーマットでレースを検索
    for (const format of formats) {
      const snapshot = await db.collection('races').where('date', '==', format).get();
      console.log(`日付「${format}」でのレース数: ${snapshot.size}件`);

      if (snapshot.size > 0) {
        console.log("見つかったレースの例:");
        let count = 0;
        snapshot.forEach(doc => {
          if (count < 3) { // 最初の3件だけ表示
            const race = doc.data();
            console.log(`ID: ${race.id}, 名前: ${race.name}, 会場: ${race.track}, タイプ: ${race.type}`);
            count++;
          }
        });
      }
    }

    // 当日のすべてのレースを取得してみる（日付に関係なく）
    const allRaces = await db.collection('races').get();
    console.log(`総レース数: ${allRaces.size}件`);

    // 最近追加されたレースを確認
    const recentRaces = await db.collection('races')
      .orderBy('lastUpdated', 'desc')
      .limit(5)
      .get();

    console.log("最近追加されたレース:");
    recentRaces.forEach(doc => {
      const race = doc.data();
      console.log(`ID: ${race.id}, 日付: ${race.date}, 名前: ${race.name}, 更新: ${race.lastUpdated}`);
    });

    return "デバッグ完了";
  } catch (error) {
    console.error('デバッグ中にエラーが発生しました:', error);
    return { error: error.message };
  }
}

module.exports = {
  fixRaceDates,
  getTodayRaces,
  getRaceById,
  saveRaceData,
  saveResultData,
  updateRaceStatus,
  getAllActiveRaces,
  updateRaceList,
  debugRaceData
};