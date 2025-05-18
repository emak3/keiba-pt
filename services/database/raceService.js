// services/database/raceService.js
import { doc, collection, setDoc, getDoc, getDocs, query, where, updateDoc, increment } from 'firebase/firestore';
import { getDb } from '../../config/firebase-config.js';
import logger from '../../utils/logger.js';

import * as textCleaner from '../../utils/textCleaner.js';
const { cleanJapaneseText, cleanVenueName, cleanRaceName } = textCleaner;

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
        return;
      }
      
      // 既存データを更新
      await updateDoc(raceRef, {
        ...cleanedRace,
        updatedAt: new Date().toISOString()
      });
    } else {
      // 新規にデータを保存
      await setDoc(raceRef, {
        ...cleanedRace,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
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
        return;
      }
      
      // 既存データを更新
      await updateDoc(raceRef, {
        ...cleanedRace,
        updatedAt: new Date().toISOString()
      });
    } else {
      // 新規にデータを保存
      await setDoc(raceRef, {
        ...cleanedRace,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
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
    const results = [];
    
    betsSnapshot.forEach(betDoc => {
      try {
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
        
        // 結果ログ用に保存
        results.push({
          userId: bet.userId,
          betId: betDoc.id,
          raceId: raceId,
          betType: bet.betType,
          method: bet.method,
          amount: bet.amount,
          payout: payout
        });
        
      } catch (betError) {
        logger.error(`馬券処理中にエラー (${betDoc.id}): ${betError}`);
      }
    });
    
    try {
      // 一括で更新処理を実行
      await Promise.all(promises);
      
      // 処理結果のログ
      const totalBets = results.length;
      const hitBets = results.filter(r => r.payout > 0).length;
      
      logger.info(`レース ${raceId} の馬券処理完了 - 全${totalBets}件 (的中 ${hitBets}件)`);
      
      // 当たり馬券のログ（500pt以上の払戻のみ）
      results.filter(r => r.payout >= 500).forEach(result => {
        logger.info(`高額的中馬券: ${result.userId} が ${result.betType} で ${result.payout}pt 獲得（購入: ${result.amount}pt）`);
      });
    } catch (bulkError) {
      logger.error(`馬券一括処理中にエラー: ${bulkError}`);
    }
  } catch (error) {
    logger.error(`レース ${raceId} の馬券処理中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * レース結果に基づいて馬券の的中確認と払戻金計算
 * @param {Object} bet - 馬券情報
 * @param {Object} payouts - 払戻情報
 * @returns {number} 払戻金額
 */
function calculatePayout(bet, payouts) {
  try {
    // レースの払戻情報が存在しない場合
    if (!payouts) {
      return 0;
    }
    
    // 馬券タイプに対応する払戻情報がない場合
    const betTypePayoutMap = {
      tansho: payouts.tansho,
      fukusho: payouts.fukusho,
      wakuren: payouts.wakuren,
      umaren: payouts.umaren,
      wide: payouts.wide,
      umatan: payouts.umatan,
      sanrenpuku: payouts.sanrenpuku,
      sanrentan: payouts.sanrentan
    };
    
    const targetPayouts = betTypePayoutMap[bet.betType];
    if (!targetPayouts || targetPayouts.length === 0) {
      return 0;
    }
    
    // 馬券の購入方法に応じた的中確認
    let payout = 0;
    
    try {
      switch (bet.method) {
        case 'normal':
          payout = calculateNormalPayout(bet, targetPayouts);
          break;
        case 'box':
          payout = calculateBoxPayout(bet, targetPayouts);
          break;
        case 'formation':
          payout = calculateFormationPayout(bet, targetPayouts);
          break;
        default:
          logger.warn(`未知の馬券購入方法: ${bet.method}`);
          return 0;
      }
    } catch (methodError) {
      logger.error(`馬券計算中にエラー (method=${bet.method}): ${methodError}`);
      return 0;
    }
    
    // 100円単位での払戻計算（100ptが1ユニット）
    return Math.floor(payout * (bet.amount / 100));
  } catch (error) {
    logger.error(`払戻金計算中にエラー: ${error}`);
    return 0;
  }
}

/**
 * 通常購入馬券の払戻計算
 * @param {Object} bet - 馬券情報
 * @param {Array} payouts - 馬券タイプに対応する払戻情報
 * @returns {number} 払戻金額（100円あたり）
 */
function calculateNormalPayout(bet, payouts) {
  try {
    const selections = bet.selections;
    
    // 的中馬券を検索
    for (const p of payouts) {
      // 馬券タイプごとの的中判定
      let isWin = false;
      
      switch (bet.betType) {
        case 'tansho': // 単勝
        case 'fukusho': // 複勝
          isWin = p.numbers.includes(selections[0]);
          break;
          
        case 'wakuren': // 枠連
        case 'umaren': // 馬連
        case 'wide': // ワイド
          // 順不同の2頭/枠選択
          if (Array.isArray(selections) && !Array.isArray(selections[0])) {
            isWin = p.numbers.includes(selections[0]) && 
                    p.numbers.includes(selections[1]) && 
                    p.numbers.length === selections.length;
          }
          break;
          
        case 'umatan': // 馬単
          // 順序付きの2頭選択
          if (Array.isArray(selections) && Array.isArray(selections[0])) {
            const firstHorse = selections[0][0];
            const secondHorse = selections[1][0];
            isWin = p.numbers[0] === firstHorse && p.numbers[1] === secondHorse;
          } else if (Array.isArray(selections) && selections.length === 2) {
            isWin = p.numbers[0] === selections[0] && p.numbers[1] === selections[1];
          }
          break;
          
        case 'sanrenpuku': // 三連複
          // 順不同の3頭選択
          if (Array.isArray(selections) && !Array.isArray(selections[0])) {
            isWin = p.numbers.includes(selections[0]) && 
                    p.numbers.includes(selections[1]) && 
                    p.numbers.includes(selections[2]) && 
                    p.numbers.length === selections.length;
          }
          break;
          
        case 'sanrentan': // 三連単
          // 順序付きの3頭選択
          if (Array.isArray(selections) && Array.isArray(selections[0])) {
            const firstHorse = selections[0][0];
            const secondHorse = selections[1][0];
            const thirdHorse = selections[2][0];
            isWin = p.numbers[0] === firstHorse && 
                    p.numbers[1] === secondHorse && 
                    p.numbers[2] === thirdHorse;
          } else if (Array.isArray(selections) && selections.length === 3) {
            isWin = p.numbers[0] === selections[0] && 
                    p.numbers[1] === selections[1] && 
                    p.numbers[2] === selections[2];
          }
          break;
          
        default:
          logger.warn(`未知の馬券タイプ: ${bet.betType}`);
          return 0;
      }
      
      if (isWin) {
        return p.payout;
      }
    }
    
    return 0;
  } catch (error) {
    logger.error(`通常馬券の計算でエラー: ${error}`);
    return 0;
  }
}

/**
 * ボックス購入馬券の払戻計算
 * @param {Object} bet - 馬券情報
 * @param {Array} payouts - 馬券タイプに対応する払戻情報
 * @returns {number} 払戻金額（100円あたり）
 */
function calculateBoxPayout(bet, payouts) {
  try {
    const selections = bet.selections;
    
    // 的中馬券を検索
    for (const p of payouts) {
      // 馬券タイプごとの的中判定
      let isWin = false;
      
      switch (bet.betType) {
        case 'wakuren': // 枠連
        case 'umaren': // 馬連
        case 'wide': // ワイド
          // ボックスの場合、選択した馬/枠が的中した払戻に含まれているかチェック
          isWin = p.numbers.every(num => selections.includes(num));
          break;
          
        case 'umatan': // 馬単
          // 馬単ボックスは、選択した馬が的中した払戻に含まれているかチェック
          isWin = p.numbers.every(num => selections.includes(num));
          break;
          
        case 'sanrenpuku': // 三連複
          // 三連複ボックスは、選択した馬が的中した払戻に含まれているかチェック
          isWin = p.numbers.every(num => selections.includes(num));
          break;
          
        case 'sanrentan': // 三連単
          // 三連単ボックスは、選択した馬が的中した払戻に含まれているかチェック
          isWin = p.numbers.every(num => selections.includes(num));
          break;
          
        default:
          logger.warn(`未知のボックス馬券タイプ: ${bet.betType}`);
          return 0;
      }
      
      if (isWin) {
        // ボックスの組み合わせ数で割る
        const combinationCount = calculateCombinations(selections.length, 
                                                      bet.betType === 'umatan' || bet.betType === 'sanrentan');
        
        // 組み合わせが1以上の場合のみ
        if (combinationCount > 0) {
          return p.payout / combinationCount;
        }
        
        return p.payout;
      }
    }
    
    return 0;
  } catch (error) {
    logger.error(`ボックス馬券の計算でエラー: ${error}`);
    return 0;
  }
}

/**
 * フォーメーション購入馬券の払戻計算
 * @param {Object} bet - 馬券情報
 * @param {Array} payouts - 馬券タイプに対応する払戻情報
 * @returns {number} 払戻金額（100円あたり）
 */
function calculateFormationPayout(bet, payouts) {
  try {
    const selections = bet.selections;
    
    // 的中馬券を検索
    for (const payout of payouts) {
      let isWin = false;
      
      // フォーメーションタイプに応じた的中確認
      if (bet.betType === 'umatan' || bet.betType === 'sanrentan') {
        // 順序付きフォーメーション
        if (Array.isArray(selections) && Array.isArray(selections[0])) {
          // 馬単の場合
          if (bet.betType === 'umatan') {
            const firstPositionHorses = selections[0]; // 1着の馬
            const secondPositionHorses = selections[1]; // 2着の馬
            
            isWin = firstPositionHorses.includes(payout.numbers[0]) && 
                    secondPositionHorses.includes(payout.numbers[1]);
          } 
          // 三連単の場合
          else if (bet.betType === 'sanrentan') {
            const firstPositionHorses = selections[0]; // 1着の馬
            const secondPositionHorses = selections[1]; // 2着の馬
            const thirdPositionHorses = selections[2]; // 3着の馬
            
            isWin = firstPositionHorses.includes(payout.numbers[0]) && 
                    secondPositionHorses.includes(payout.numbers[1]) && 
                    thirdPositionHorses.includes(payout.numbers[2]);
          }
          
          if (isWin) {
            // 組み合わせ数を計算
            const combinations = selections.reduce((total, horses) => total * horses.length, 1);
            
            // 最低1組以上ある場合のみ
            if (combinations > 0) {
              return payout.payout / combinations;
            }
            
            return payout.payout;
          }
        }
      } else {
        // 順不同のフォーメーション（馬連・三連複など）
        const selectedHorses = selections; // 選択した馬の配列
        
        // 的中馬券に含まれる馬がすべて選択した馬に含まれるか確認
        isWin = payout.numbers.every(num => selectedHorses.includes(num));
        
        if (isWin) {
          // 組み合わせ数を計算（nCr）
          const r = payout.numbers.length; // 何頭選ぶか（馬連なら2、三連複なら3）
          const combinations = calculateCombinations(selectedHorses.length, false, r);
          
          // 最低1組以上ある場合のみ
          if (combinations > 0) {
            return payout.payout / combinations;
          }
          
          return payout.payout;
        }
      }
    }
    
    return 0;
  } catch (error) {
    logger.error(`フォーメーション馬券の計算でエラー: ${error}`);
    return 0;
  }
}

/**
 * 組み合わせ数を計算
 * @param {number} n - 全体の数
 * @param {boolean} ordered - 順序ありかどうか
 * @param {number} [r] - 選ぶ数（省略時はnCrではなくnPn）
 * @returns {number} 組み合わせ数
 */
function calculateCombinations(n, ordered = false, r = null) {
  try {
    if (n <= 0) return 0;
    
    // 選ぶ数が指定されていない場合は全体と同じ
    if (r === null) r = n;
    
    // 不正な選択数
    if (r > n || r <= 0) return 0;
    
    // 順列（順序あり）の場合 - nPr = n! / (n-r)!
    if (ordered) {
      let result = 1;
      for (let i = 0; i < r; i++) {
        result *= (n - i);
      }
      return result;
    }
    
    // 組み合わせ（順序なし）の場合 - nCr = n! / (r! * (n-r)!)
    let result = 1;
    // 分子: n * (n-1) * ... * (n-r+1)
    for (let i = 0; i < r; i++) {
      result *= (n - i);
    }
    // 分母: r!
    for (let i = 1; i <= r; i++) {
      result /= i;
    }
    
    return Math.round(result);
  } catch (error) {
    logger.error(`組み合わせ計算でエラー: ${error}`);
    return 1; // エラー時は1を返す（影響を最小限に）
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
      processedRace.status = 'completed';
    }
  } else if (now > beforeRace && now < afterRace) {
    // 発走直前～レース中
    if (processedRace.status !== 'in_progress') {
      processedRace.status = 'in_progress';
    }
  } else if (now < beforeRace) {
    // 発走前
    if (processedRace.status !== 'upcoming') {
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
      const raceData = docSnap.data();
      
      // ステータスを現在時刻に基づいて処理
      const processedRace = processRaceStatus(raceData);
      
      return {
        id: docSnap.id,
        ...processedRace
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
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    
    const racesQuery = query(
      collection(db, 'races'),
      where('date', '==', today)
    );
    
    const racesSnapshot = await getDocs(racesQuery);
    
    const races = [];
    racesSnapshot.forEach(doc => {
      const raceData = doc.data();
      
      // ステータスを現在時刻に基づいて処理
      const processedRace = processRaceStatus(raceData);
      
      // only get races that are not completed
      if (processedRace.status !== 'completed') {
        races.push({
          id: doc.id,
          ...processedRace
        });
      }
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