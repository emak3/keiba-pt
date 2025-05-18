// services/database/betService.js
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
  
  // フォーメーション方式の場合は特別な検証
  if (method === 'formation') {
    if (betType === 'tansho' || betType === 'fukusho') {
      throw new Error(`${betType}はフォーメーション購入できません。`);
    }
    
    // 馬単・三連単は二次元配列
    if (betType === 'umatan' || betType === 'sanrentan') {
      if (!Array.isArray(selections) || !Array.isArray(selections[0])) {
        throw new Error('フォーメーション購入の選択データが不正です。');
      }
      
      // 各着順に最低1頭以上選択されていること
      for (const posSelections of selections) {
        if (!Array.isArray(posSelections) || posSelections.length === 0) {
          throw new Error('各着順に少なくとも1頭選択してください。');
        }
      }
      
      // 着順数の確認
      if ((betType === 'umatan' && selections.length !== 2) || 
          (betType === 'sanrentan' && selections.length !== 3)) {
        throw new Error(`${betType}の着順選択数が正しくありません。`);
      }
    }
    // その他の馬券は一次元配列
    else {
      if (!Array.isArray(selections) || selections.length < requiredSelections[betType]) {
        throw new Error(`${betType}のフォーメーション購入には最低${requiredSelections[betType]}頭を選択してください。`);
      }
    }
    
    return; // フォーメーションの検証はここまで
  }
  
  // 通常・ボックス購入の場合
  const isFlatArray = !Array.isArray(selections[0]);
  const flatSelections = isFlatArray ? selections : selections.flat();
  
  if (method === 'normal') {
    // 馬単・三連単は特別な形式
    if (betType === 'umatan' || betType === 'sanrentan') {
      // フラット配列ならエラー
      if (isFlatArray) {
        // 数が正しいか検証
        if (flatSelections.length !== requiredSelections[betType]) {
          throw new Error(`${betType}には${requiredSelections[betType]}頭を選択してください。`);
        }
      } else {
        // 次元配列の構造を検証
        if ((betType === 'umatan' && selections.length !== 2) ||
            (betType === 'sanrentan' && selections.length !== 3)) {
          throw new Error(`${betType}の着順選択数が正しくありません。`);
        }
      }
    } else {
      // それ以外の馬券
      if (flatSelections.length !== requiredSelections[betType]) {
        throw new Error(`${betType}には${requiredSelections[betType]}頭を選択してください。`);
      }
    }
  } else if (method === 'box') {
    // ボックス購入の検証
    if (betType === 'tansho' || betType === 'fukusho') {
      throw new Error(`${betType}はボックス購入できません。`);
    }
    
    // 必要最小数のチェック
    if (flatSelections.length < requiredSelections[betType]) {
      throw new Error(`${betType}のボックス購入には最低${requiredSelections[betType]}頭を選択してください。`);
    }
    
    // 最大選択数のチェック
    const maxSelections = (betType === 'sanrentan' || betType === 'sanrenpuku') ? 7 : 8;
    if (flatSelections.length > maxSelections) {
      throw new Error(`${betType}のボックス購入は最大${maxSelections}頭までです。`);
    }
  }
  
  // 選択した馬番の重複チェック（通常購入の場合）
  if (method === 'normal' && new Set(flatSelections).size !== flatSelections.length) {
    throw new Error('同じ馬番を複数選択することはできません。');
  }
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
      try {
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
      } catch (error) {
        logger.error(`レース情報取得エラー (betId=${bet.id}): ${error}`);
        return {
          ...bet,
          race: null
        };
      }
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