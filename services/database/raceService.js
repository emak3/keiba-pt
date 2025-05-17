import { doc, collection, setDoc, getDoc, getDocs, query, where, updateDoc } from 'firebase/firestore';
import { getDb } from '../../config/firebase-config.js';
import logger from '../../utils/logger.js';

/**
 * JRA のレース情報を保存/更新
 * @param {Object} race - レース情報オブジェクト
 * @returns {Promise<void>}
 */
export async function saveJraRace(race) {
  try {
    const db = getDb();
    const raceRef = doc(db, 'races', race.id);
    
    // レース情報をクリーンアップ
    const cleanedRace = {
      ...race,
      venue: cleanVenueName(race.venue),
      name: cleanRaceName(race.name, race.venue, race.number)
    };
    
    // 既存データがあるか確認
    const docSnap = await getDoc(raceRef);
    
    if (docSnap.exists()) {
      // ステータスが completed なら更新しない
      const existingData = docSnap.data();
      if (existingData.status === 'completed') {
        logger.debug(`レース ${race.id} は既に完了しているため更新をスキップします。`);
        return;
      }
      
      // 既存データを更新
      await updateDoc(raceRef, {
        ...cleanedRace,
        updatedAt: new Date().toISOString()
      });
      logger.debug(`JRA レース ${race.id} を更新しました。`);
    } else {
      // 新規にデータを保存
      await setDoc(raceRef, {
        ...cleanedRace,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      logger.debug(`JRA レース ${race.id} を新規作成しました。`);
    }
  } catch (error) {
    logger.error(`JRA レース保存中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * NAR のレース情報を保存/更新
 * @param {Object} race - レース情報オブジェクト
 * @returns {Promise<void>}
 */
export async function saveNarRace(race) {
  try {
    const db = getDb();
    const raceRef = doc(db, 'races', race.id);
    
    // レース情報をクリーンアップ
    const cleanedRace = {
      ...race,
      venue: cleanVenueName(race.venue),
      name: cleanRaceName(race.name, race.venue, race.number)
    };
    
    // 既存データがあるか確認
    const docSnap = await getDoc(raceRef);
    
    if (docSnap.exists()) {
      // ステータスが completed なら更新しない
      const existingData = docSnap.data();
      if (existingData.status === 'completed') {
        logger.debug(`レース ${race.id} は既に完了しているため更新をスキップします。`);
        return;
      }
      
      // 既存データを更新
      await updateDoc(raceRef, {
        ...cleanedRace,
        updatedAt: new Date().toISOString()
      });
      logger.debug(`NAR レース ${race.id} を更新しました。`);
    } else {
      // 新規にデータを保存
      await setDoc(raceRef, {
        ...cleanedRace,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      logger.debug(`NAR レース ${race.id} を新規作成しました。`);
    }
  } catch (error) {
    logger.error(`NAR レース保存中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * JRA レースの結果情報を更新
 * @param {string} raceId - レースID
 * @param {Object} resultData - 結果データ
 * @returns {Promise<void>}
 */
export async function updateJraRaceResult(raceId, resultData) {
  try {
    // 結果データがnullの場合は処理しない
    if (!resultData) {
      logger.warn(`レース ${raceId} の結果データがないため更新をスキップします。`);
      return;
    }
    
    const db = getDb();
    const raceRef = doc(db, 'races', raceId);
    
    // 既存データがあるか確認
    const docSnap = await getDoc(raceRef);
    
    if (docSnap.exists()) {
      // 既存データを更新
      await updateDoc(raceRef, {
        status: 'completed',
        results: resultData.results || [],
        payouts: resultData.payouts || {},
        updatedAt: new Date().toISOString()
      });
      logger.info(`JRA レース ${raceId} の結果を更新しました。ステータス: completed`);
      
      // 関連する馬券の処理を実行
      await processBetsForRace(raceId);
    } else {
      logger.warn(`JRA レース ${raceId} が見つかりません。結果の更新をスキップします。`);
    }
  } catch (error) {
    logger.error(`JRA レース結果更新中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * NAR レースの結果情報を更新
 * @param {string} raceId - レースID
 * @param {Object} resultData - 結果データ
 * @returns {Promise<void>}
 */
export async function updateNarRaceResult(raceId, resultData) {
  try {
    // 結果データがnullの場合は処理しない
    if (!resultData) {
      logger.warn(`レース ${raceId} の結果データがないため更新をスキップします。`);
      return;
    }
    
    const db = getDb();
    const raceRef = doc(db, 'races', raceId);
    
    // 既存データがあるか確認
    const docSnap = await getDoc(raceRef);
    
    if (docSnap.exists()) {
      // 既存データを更新
      await updateDoc(raceRef, {
        status: 'completed',
        results: resultData.results || [],
        payouts: resultData.payouts || {},
        updatedAt: new Date().toISOString()
      });
      logger.info(`NAR レース ${raceId} の結果を更新しました。ステータス: completed`);
      
      // 関連する馬券の処理を実行
      await processBetsForRace(raceId);
    } else {
      logger.warn(`NAR レース ${raceId} が見つかりません。結果の更新をスキップします。`);
    }
  } catch (error) {
    logger.error(`NAR レース結果更新中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * 特定のレースIDに関連する馬券を処理
 * @param {string} raceId - レースID
 * @returns {Promise<void>}
 */
async function processBetsForRace(raceId) {
  try {
    const db = getDb();
    
    // このレースに対する馬券を取得
    const betsQuery = query(collection(db, 'bets'), where('raceId', '==', raceId), where('status', '==', 'pending'));
    const betsSnapshot = await getDocs(betsQuery);
    
    if (betsSnapshot.empty) {
      logger.info(`レース ${raceId} に関連する未処理の馬券はありません。`);
      return;
    }
    
    // レース情報を取得
    const raceRef = doc(db, 'races', raceId);
    const raceSnap = await getDoc(raceRef);
    
    if (!raceSnap.exists()) {
      logger.error(`レース ${raceId} が見つかりません。馬券処理をスキップします。`);
      return;
    }
    
    const raceData = raceSnap.data();
    
    if (!raceData.payouts) {
      logger.error(`レース ${raceId} の払戻情報がありません。馬券処理をスキップします。`);
      return;
    }
    
    // 各馬券を処理
    const promises = [];
    
    betsSnapshot.forEach(betDoc => {
      const bet = betDoc.data();
      const betRef = doc(db, 'bets', betDoc.id);
      
      // 払戻金を計算
      const payout = calculatePayout(bet, raceData.payouts);
      
      // 馬券情報を更新
      promises.push(
        updateDoc(betRef, {
          status: 'processed',
          payout,
          processedAt: new Date().toISOString()
        })
      );
      
      // ユーザーのポイントを更新（当たった場合）
      if (payout > 0) {
        const userRef = doc(db, 'users', bet.userId);
        promises.push(
          updateDoc(userRef, {
            points: increment(payout),
            updatedAt: new Date().toISOString()
          })
        );
      }
    });
    
    await Promise.all(promises);
    logger.info(`レース ${raceId} の ${promises.length / 2} 件の馬券を処理しました。`);
  } catch (error) {
    logger.error(`レース ${raceId} の馬券処理中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * 特定の日付のすべてのレースを取得
 * @param {string} dateString - YYYYMMDD形式の日付文字列
 * @returns {Promise<Array>} レース情報の配列
 */
export async function getRacesByDate(dateString) {
  try {
    const db = getDb();
    const racesQuery = query(collection(db, 'races'), where('date', '==', dateString));
    const racesSnapshot = await getDocs(racesQuery);
    
    const races = [];
    racesSnapshot.forEach(doc => {
      const raceData = doc.data();
      
      // レースデータを処理し、ステータスを確認
      const processedRace = processRaceStatus(raceData);
      
      races.push({
        id: doc.id,
        ...processedRace
      });
    });
    
    // レース番号と時間でソート
    races.sort((a, b) => {
      if (a.venue !== b.venue) {
        return a.venue.localeCompare(b.venue);
      }
      if (a.time !== b.time) {
        return a.time.localeCompare(b.time);
      }
      return a.number - b.number;
    });
    
    return races;
  } catch (error) {
    logger.error(`日付 ${dateString} のレース取得中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * レースのステータスを現在時刻に基づいて処理
 * @param {Object} raceData - レースデータ
 * @returns {Object} 処理後のレースデータ
 */
function processRaceStatus(raceData) {
  // レースデータのコピーを作成
  const processedRace = { ...raceData };
  
  // 結果データがあれば、確実に completed に設定
  if (processedRace.results && processedRace.results.length > 0) {
    if (processedRace.status !== 'completed') {
      logger.debug(`レース ${processedRace.id} は結果データがありますが、ステータスが ${processedRace.status} です。completed に更新します。`);
      processedRace.status = 'completed';
    }
    return processedRace;
  }
  
  // 現在時刻を取得
  const now = new Date();
  
  // レース時間をパース
  const raceDate = new Date(
    parseInt(processedRace.date.slice(0, 4)), 
    parseInt(processedRace.date.slice(4, 6)) - 1, 
    parseInt(processedRace.date.slice(6, 8)), 
    parseInt(processedRace.time.split(':')[0]), 
    parseInt(processedRace.time.split(':')[1])
  );
  
  // 発走5分前～発走後2分はin_progress
  const beforeRace = new Date(raceDate.getTime() - 5 * 60 * 1000);
  const afterRace = new Date(raceDate.getTime() + 2 * 60 * 1000);
  const afterRaceCompletion = new Date(raceDate.getTime() + 10 * 60 * 1000); // 10分後には完了しているはず
  
  if (now > afterRaceCompletion) {
    // レース後10分以上経過している場合は完了としてマーク
    if (processedRace.status !== 'completed') {
      logger.debug(`レース ${processedRace.id} は発走時刻から10分以上経過しているため、ステータスを completed に更新します。`);
      processedRace.status = 'completed';
    }
  } else if (now > beforeRace && now < afterRace) {
    // 発走直前～レース中
    if (processedRace.status !== 'in_progress') {
      logger.debug(`レース ${processedRace.id} は現在レース中のため、ステータスを in_progress に更新します。`);
      processedRace.status = 'in_progress';
    }
  } else if (now < beforeRace) {
    // 発走前
    if (processedRace.status !== 'upcoming') {
      logger.debug(`レース ${processedRace.id} はまだ発走前のため、ステータスを upcoming に更新します。`);
      processedRace.status = 'upcoming';
    }
  }
  
  return processedRace;
}

/**
 * 特定のレースIDの詳細情報を取得
 * @param {string} raceId - レースID
 * @returns {Promise<Object>} レース詳細情報
 */
export async function getRaceById(raceId) {
  try {
    const db = getDb();
    const raceRef = doc(db, 'races', raceId);
    const docSnap = await getDoc(raceRef);
    
    if (docSnap.exists()) {
      return {
        id: docSnap.id,
        ...docSnap.data()
      };
    } else {
      logger.warn(`レース ${raceId} が見つかりません。`);
      return null;
    }
  } catch (error) {
    logger.error(`レース ${raceId} の取得中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * 現在開催中のレースを取得
 * @returns {Promise<Array>} 開催中のレース情報の配列
 */
export async function getActiveRaces() {
  try {
    const db = getDb();
    const racesQuery = query(
      collection(db, 'races'),
      where('status', 'in', ['upcoming', 'in_progress']),
      where('date', '==', new Date().toISOString().split('T')[0].replace(/-/g, ''))
    );
    
    const racesSnapshot = await getDocs(racesQuery);
    
    const races = [];
    racesSnapshot.forEach(doc => {
      races.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // レース番号と時間でソート
    races.sort((a, b) => {
      if (a.venue !== b.venue) {
        return a.venue.localeCompare(b.venue);
      }
      if (a.time !== b.time) {
        return a.time.localeCompare(b.time);
      }
      return a.number - b.number;
    });
    
    return races;
  } catch (error) {
    logger.error('開催中のレース取得中にエラーが発生しました:', error);
    throw error;
  }
}