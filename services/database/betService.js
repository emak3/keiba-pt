import { doc, collection, setDoc, getDoc, getDocs, query, where, limit, orderBy } from 'firebase/firestore';
import { getDb } from '../../config/firebase-config.js';
import { subtractPoints } from './userService.js';
import { getRaceById } from './raceService.js';
import logger from '../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * 馬券購入
 * @param {string} userId - ユーザーID
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ (tansho, fukusho, umaren, wide, umatan, sanrentan, sanrenpuku, wakuren)
 * @param {Array<number|Array<number>>} selections - 選択した馬番配列
 * @param {string} method - 購入方法 (normal, box, formation)
 * @param {number} amount - 購入金額
 * @returns {Promise<Object>} 購入した馬券情報
 */
export async function placeBet(userId, raceId, betType, selections, method, amount) {
  try {
    // 基本的なバリデーション
    if (!userId || !raceId || !betType || !selections || !method || !amount) {
      throw new Error('必須パラメータが不足しています。');
    }
    
    if (isNaN(amount) || amount <= 0 || amount % 100 !== 0) {
      throw new Error('購入金額は100pt単位で指定してください。');
    }
    
    // レース情報を取得
    const race = await getRaceById(raceId);
    if (!race) {
      throw new Error(`レース ${raceId} が見つかりません。`);
    }
    
    // レースがまだ開始していないことを確認
    if (race.status === 'completed') {
      throw new Error('このレースは既に終了しています。');
    }
    
    // レース発走時間の2分前かどうかをチェック
    const now = new Date();
    const raceTime = new Date(race.date.slice(0, 4), 
                             parseInt(race.date.slice(4, 6)) - 1, 
                             race.date.slice(6, 8), 
                             race.time.split(':')[0], 
                             race.time.split(':')[1]);
    
    const twoMinutesBefore = new Date(raceTime.getTime() - 2 * 60 * 1000);
    
    if (now > twoMinutesBefore) {
      throw new Error('このレースは発走2分前を過ぎているため、馬券を購入できません。');
    }
    
    // 馬券タイプに応じたバリデーション
    validateBetSelections(betType, selections, method);
    
    // ポイントを減算
    await subtractPoints(userId, amount);
    
    // 馬券情報を作成
    const betId = uuidv4();
    const betData = {
      id: betId,
      userId,
      raceId,
      betType,
      selections,
      method,
      amount,
      status: 'pending', // pending, processed, cancelled
      payout: 0,
      createdAt: new Date().toISOString()
    };
    
    // データベースに保存
    const db = getDb();
    await setDoc(doc(db, 'bets', betId), betData);
    
    logger.info(`ユーザー ${userId} がレース ${raceId} に ${amount}pt の ${betType} 馬券を購入しました。`);
    
    return betData;
  } catch (error) {
    logger.error(`馬券購入中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * 馬券タイプと選択に応じたバリデーション
 * @param {string} betType - 馬券タイプ
 * @param {Array} selections - 選択した馬番
 * @param {string} method - 購入方法
 */
function validateBetSelections(betType, selections, method) {
  // 馬券タイプごとの必要な選択数
  const requiredSelections = {
    tansho: 1,    // 単勝: 1頭
    fukusho: 1,   // 複勝: 1頭
    wakuren: 2,   // 枠連: 2枠
    umaren: 2,    // 馬連: 2頭
    wide: 2,      // ワイド: 2頭
    umatan: 2,    // 馬単: 2頭
    sanrenpuku: 3, // 三連複: 3頭
    sanrentan: 3   // 三連単: 3頭
  };
  
  // 選択数の検証
  const flatSelections = Array.isArray(selections[0]) ? selections.flat() : selections;
  
  if (method === 'normal') {
    // 通常購入の場合
    if (betType === 'umatan' || betType === 'sanrentan') {
      // 順番ありの馬券は配列の入れ子
      if (!Array.isArray(selections[0])) {
        throw new Error(`${betType}は順番を指定する必要があります。`);
      }
    } else {
      // 順番なしの馬券は単純な配列
      if (flatSelections.length !== requiredSelections[betType]) {
        throw new Error(`${betType}には${requiredSelections[betType]}頭を選択してください。`);
      }
    }
  } else if (method === 'box') {
    // ボックス購入の場合
    if (betType === 'tansho' || betType === 'fukusho') {
      throw new Error(`${betType}はボックス購入できません。`);
    }
    
    if (flatSelections.length < requiredSelections[betType]) {
      throw new Error(`${betType}のボックス購入には最低${requiredSelections[betType]}頭を選択してください。`);
    }
    
    // ボックスの最大選択数の検証（三連系は最大7頭、二連系は最大10頭程度）
    const maxSelections = (betType === 'sanrentan' || betType === 'sanrenpuku') ? 7 : 10;
    if (flatSelections.length > maxSelections) {
      throw new Error(`${betType}のボックス購入は最大${maxSelections}頭までです。`);
    }
  } else if (method === 'formation') {
    // フォーメーション購入の場合
    if (betType === 'tansho' || betType === 'fukusho') {
      throw new Error(`${betType}はフォーメーション購入できません。`);
    }
    
    // フォーメーションの形式に応じたバリデーション
    // ここでは簡略化のため、フォーメーションの詳細検証は省略
    if (!Array.isArray(selections) || selections.length < 2) {
      throw new Error('フォーメーション購入には複数の選択肢が必要です。');
    }
  }
  
  // 選択した馬番の重複チェック（通常購入の場合）
  if (method === 'normal' && new Set(flatSelections).size !== flatSelections.length) {
    throw new Error('同じ馬番を複数選択することはできません。');
  }
}

/**
 * レース結果に基づいて馬券の的中確認と払戻金計算
 * @param {Object} bet - 馬券情報
 * @param {Object} payouts - 払戻情報
 * @returns {number} 払戻金額
 */
export function calculatePayout(bet, payouts) {
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
  
  // 100円単位での払戻計算（100ptが1ユニット）
  return Math.floor(payout * (bet.amount / 100));
}

/**
 * 通常購入馬券の払戻計算
 * @param {Object} bet - 馬券情報
 * @param {Array} payouts - 馬券タイプに対応する払戻情報
 * @returns {number} 払戻金額（100円あたり）
 */
function calculateNormalPayout(bet, payouts) {
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
        isWin = p.numbers.includes(selections[0]) && p.numbers.includes(selections[1]) && 
                p.numbers.length === selections.length;
        break;
        
      case 'umatan': // 馬単
        // 順序付きの2頭選択
        isWin = p.numbers[0] === selections[0] && p.numbers[1] === selections[1];
        break;
        
      case 'sanrenpuku': // 三連複
        // 順不同の3頭選択
        isWin = p.numbers.includes(selections[0]) && 
                p.numbers.includes(selections[1]) && 
                p.numbers.includes(selections[2]) && 
                p.numbers.length === selections.length;
        break;
        
      case 'sanrentan': // 三連単
        // 順序付きの3頭選択
        isWin = p.numbers[0] === selections[0] && 
                p.numbers[1] === selections[1] && 
                p.numbers[2] === selections[2];
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
}

/**
 * ボックス購入馬券の払戻計算
 * @param {Object} bet - 馬券情報
 * @param {Array} payouts - 馬券タイプに対応する払戻情報
 * @returns {number} 払戻金額（100円あたり）
 */
function calculateBoxPayout(bet, payouts) {
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
      // ボックスの組み合わせ数で割る（簡略化のため省略）
      // 実際には組み合わせ計算が必要
      return p.payout;
    }
  }
  
  return 0;
}

/**
 * フォーメーション購入馬券の払戻計算
 * @param {Object} bet - 馬券情報
 * @param {Array} payouts - 馬券タイプに対応する払戻情報
 * @returns {number} 払戻金額（100円あたり）
 */
function calculateFormationPayout(bet, payouts) {
  // フォーメーション馬券の計算は複雑なため、ここでは簡略化
  // 実際の実装では選択フォーメーションに応じた組み合わせ計算が必要
  
  // サンプル実装として、通常馬券と同様の計算を行う
  return calculateNormalPayout(bet, payouts);
}

/**
 * ユーザーの馬券購入履歴を取得
 * @param {string} userId - ユーザーID
 * @param {number} [limit=10] - 取得する馬券数
 * @returns {Promise<Array>} 馬券情報の配列
 */
export async function getUserBets(userId, limitCount = 10) {
  try {
    const db = getDb();
    const betsQuery = query(
      collection(db, 'bets'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );
    
    const betsSnapshot = await getDocs(betsQuery);
    
    const bets = [];
    betsSnapshot.forEach(doc => {
      bets.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // レース情報を付加
    const betsWithRace = await Promise.all(bets.map(async (bet) => {
      const race = await getRaceById(bet.raceId);
      return {
        ...bet,
        race: race ? {
          id: race.id,
          name: race.name,
          venue: race.venue,
          number: race.number,
          date: race.date,
          time: race.time,
          status: race.status
        } : null
      };
    }));
    
    return betsWithRace;
  } catch (error) {
    logger.error(`ユーザー ${userId} の馬券履歴取得中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * 特定のレースに関する馬券を取得
 * @param {string} raceId - レースID
 * @returns {Promise<Array>} 馬券情報の配列
 */
export async function getBetsByRace(raceId) {
  try {
    const db = getDb();
    const betsQuery = query(
      collection(db, 'bets'),
      where('raceId', '==', raceId)
    );
    
    const betsSnapshot = await getDocs(betsQuery);
    
    const bets = [];
    betsSnapshot.forEach(doc => {
      bets.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return bets;
  } catch (error) {
    logger.error(`レース ${raceId} の馬券取得中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * 特定の馬券情報を取得
 * @param {string} betId - 馬券ID
 * @returns {Promise<Object|null>} 馬券情報
 */
export async function getBetById(betId) {
  try {
    const db = getDb();
    const betRef = doc(db, 'bets', betId);
    const docSnap = await getDoc(betRef);
    
    if (docSnap.exists()) {
      return {
        id: docSnap.id,
        ...docSnap.data()
      };
    } else {
      logger.warn(`馬券 ${betId} が見つかりません。`);
      return null;
    }
  } catch (error) {
    logger.error(`馬券 ${betId} の取得中にエラーが発生しました: ${error}`);
    throw error;
  }
}