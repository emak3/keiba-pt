import { userModel, raceModel, betModel } from './index.js';
import logger from '../utils/logger.js';

/**
 * データベースから取得したユーザーデータの検証と変換
 * @param {Object} userData - 検証するユーザーデータ
 * @returns {Object|null} 検証・変換後のユーザーデータまたはnull
 */
export function validateUserData(userData) {
  try {
    if (!userData) {
      return null;
    }
    
    // 基本的な検証
    if (!userModel.validateUser(userData)) {
      logger.warn('無効なユーザーデータ:', userData);
      return null;
    }
    
    // ポイントを数値に変換（Firestoreから数値型として取得できない場合の対応）
    if (typeof userData.points === 'string') {
      userData.points = parseInt(userData.points, 10);
      if (isNaN(userData.points)) {
        userData.points = 0;
      }
    }
    
    return userData;
  } catch (error) {
    logger.error('ユーザーデータの検証中にエラーが発生しました:', error);
    return null;
  }
}

/**
 * データベースから取得したレースデータの検証と変換
 * @param {Object} raceData - 検証するレースデータ
 * @returns {Object|null} 検証・変換後のレースデータまたはnull
 */
export function validateRaceData(raceData) {
  try {
    if (!raceData) {
      return null;
    }
    
    // 基本的な検証
    if (!raceModel.validateRace(raceData)) {
      logger.warn('無効なレースデータ:', raceData);
      return null;
    }
    
    // レース番号を数値に変換
    if (typeof raceData.number === 'string') {
      raceData.number = parseInt(raceData.number, 10);
      if (isNaN(raceData.number)) {
        raceData.number = 0;
      }
    }
    
    // 出走馬情報の検証と変換
    if (raceData.horses && Array.isArray(raceData.horses)) {
      raceData.horses = raceData.horses.map(horse => {
        // 馬番と枠番を数値に変換
        if (typeof horse.horseNumber === 'string') {
          horse.horseNumber = parseInt(horse.horseNumber, 10);
        }
        if (typeof horse.frameNumber === 'string') {
          horse.frameNumber = parseInt(horse.frameNumber, 10);
        }
        // オッズを数値に変換
        if (typeof horse.odds === 'string') {
          horse.odds = parseFloat(horse.odds);
        }
        // 人気を数値に変換
        if (typeof horse.popularity === 'string') {
          horse.popularity = parseInt(horse.popularity, 10);
        }
        
        return horse;
      });
    }
    
    // レース結果の検証と変換
    if (raceData.results && Array.isArray(raceData.results)) {
      raceData.results = raceData.results.map(result => {
        // 着順、馬番、枠番を数値に変換
        if (typeof result.order === 'string') {
          result.order = parseInt(result.order, 10);
        }
        if (typeof result.horseNumber === 'string') {
          result.horseNumber = parseInt(result.horseNumber, 10);
        }
        if (typeof result.frameNumber === 'string') {
          result.frameNumber = parseInt(result.frameNumber, 10);
        }
        
        return result;
      });
    }
    
    // 払戻情報の検証と変換
    if (raceData.payouts) {
      Object.keys(raceData.payouts).forEach(payoutType => {
        if (Array.isArray(raceData.payouts[payoutType])) {
          raceData.payouts[payoutType] = raceData.payouts[payoutType].map(payout => {
            // 払戻金と人気を数値に変換
            if (typeof payout.payout === 'string') {
              payout.payout = parseInt(payout.payout, 10);
            }
            if (typeof payout.popularity === 'string') {
              payout.popularity = parseInt(payout.popularity, 10);
            }
            
            // 馬番配列の要素を数値に変換
            if (Array.isArray(payout.numbers)) {
              payout.numbers = payout.numbers.map(num => 
                typeof num === 'string' ? parseInt(num, 10) : num
              );
            }
            
            return payout;
          });
        }
      });
    }
    
    return raceData;
  } catch (error) {
    logger.error('レースデータの検証中にエラーが発生しました:', error);
    return null;
  }
}

/**
 * データベースから取得した馬券データの検証と変換
 * @param {Object} betData - 検証する馬券データ
 * @returns {Object|null} 検証・変換後の馬券データまたはnull
 */
export function validateBetData(betData) {
  try {
    if (!betData) {
      return null;
    }
    
    // 基本的な検証
    if (!betModel.validateBet(betData)) {
      logger.warn('無効な馬券データ:', betData);
      return null;
    }
    
    // 金額を数値に変換
    if (typeof betData.amount === 'string') {
      betData.amount = parseInt(betData.amount, 10);
      if (isNaN(betData.amount)) {
        betData.amount = 0;
      }
    }
    
    // 払戻金を数値に変換
    if (typeof betData.payout === 'string') {
      betData.payout = parseInt(betData.payout, 10);
      if (isNaN(betData.payout)) {
        betData.payout = 0;
      }
    }
    
    // 選択馬番の変換
    if (Array.isArray(betData.selections)) {
      // 1次元配列の場合
      if (!Array.isArray(betData.selections[0])) {
        betData.selections = betData.selections.map(sel => 
          typeof sel === 'string' ? parseInt(sel, 10) : sel
        );
      } 
      // 2次元配列の場合
      else {
        betData.selections = betData.selections.map(selArray => {
          if (Array.isArray(selArray)) {
            return selArray.map(sel => 
              typeof sel === 'string' ? parseInt(sel, 10) : sel
            );
          }
          return selArray;
        });
      }
    }
    
    return betData;
  } catch (error) {
    logger.error('馬券データの検証中にエラーが発生しました:', error);
    return null;
  }
}