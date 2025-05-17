/**
 * 馬券モデル - Firestore 馬券データの構造定義
 */

/**
 * 馬券オブジェクトの作成
 * @param {string} id - 馬券ID
 * @param {string} userId - ユーザーID
 * @param {string} raceId - レースID
 * @param {string} betType - 馬券タイプ (tansho, fukusho, umaren, wide, umatan, sanrentan, sanrenpuku, wakuren)
 * @param {Array<number|Array<number>>} selections - 選択した馬番配列
 * @param {string} method - 購入方法 (normal, box, formation)
 * @param {number} amount - 購入金額
 * @returns {Object} 馬券オブジェクト
 */
export function createBet(id, userId, raceId, betType, selections, method, amount) {
  return {
    id,
    userId,
    raceId,
    betType,
    selections,
    method,
    amount,
    status: 'pending', // pending, processed, cancelled
    payout: 0,
    createdAt: new Date().toISOString(),
    processedAt: null
  };
}

/**
 * 馬券データの検証
 * @param {Object} betData - 検証する馬券データ
 * @returns {boolean} 検証結果
 */
export function validateBet(betData) {
  // 必須フィールドの確認
  if (!betData.id || !betData.userId || !betData.raceId || 
      !betData.betType || !betData.selections || !betData.method || 
      betData.amount === undefined) {
    return false;
  }
  
  // 馬券タイプの確認
  const validBetTypes = ['tansho', 'fukusho', 'umaren', 'wide', 'umatan', 'sanrentan', 'sanrenpuku', 'wakuren'];
  if (!validBetTypes.includes(betData.betType)) {
    return false;
  }
  
  // 購入方法の確認
  const validMethods = ['normal', 'box', 'formation'];
  if (!validMethods.includes(betData.method)) {
    return false;
  }
  
  // 購入金額の確認
  if (typeof betData.amount !== 'number' || isNaN(betData.amount) || betData.amount <= 0 || betData.amount % 100 !== 0) {
    return false;
  }
  
  // 馬券選択の確認
  if (!Array.isArray(betData.selections) || betData.selections.length === 0) {
    return false;
  }
  
  // ステータスの確認
  const validStatuses = ['pending', 'processed', 'cancelled'];
  if (!validStatuses.includes(betData.status)) {
    return false;
  }
  
  // 払戻金の確認
  if (typeof betData.payout !== 'number' || isNaN(betData.payout) || betData.payout < 0) {
    return false;
  }
  
  return true;
}

/**
 * 馬券タイプごとの必要選択数を取得
 * @param {string} betType - 馬券タイプ
 * @returns {number} 必要な選択数
 */
export function getRequiredSelections(betType) {
  const requirements = {
    tansho: 1,     // 単勝: 1頭
    fukusho: 1,    // 複勝: 1頭
    wakuren: 2,    // 枠連: 2枠
    umaren: 2,     // 馬連: 2頭
    wide: 2,       // ワイド: 2頭
    umatan: 2,     // 馬単: 2頭
    sanrenpuku: 3, // 三連複: 3頭
    sanrentan: 3   // 三連単: 3頭
  };
  
  return requirements[betType] || 0;
}

/**
 * 馬券選択の検証
 * @param {string} betType - 馬券タイプ
 * @param {Array<number|Array<number>>} selections - 選択した馬番配列
 * @param {string} method - 購入方法
 * @returns {boolean} 検証結果
 */
export function validateBetSelections(betType, selections, method) {
  const requiredSelections = getRequiredSelections(betType);
  
  if (requiredSelections === 0) {
    return false; // 無効な馬券タイプ
  }
  
  // 通常購入の検証
  if (method === 'normal') {
    // 順序ありの馬券（馬単・三連単）
    if (betType === 'umatan' || betType === 'sanrentan') {
      // 2次元配列であることを確認
      if (!Array.isArray(selections[0])) {
        return false;
      }
      
      // 選択数の確認
      if (selections.length !== requiredSelections) {
        return false;
      }
      
      // 各配列の要素が少なくとも1つあることを確認
      for (const sel of selections) {
        if (!Array.isArray(sel) || sel.length === 0) {
          return false;
        }
      }
    } else {
      // 順序なしの馬券
      if (!Array.isArray(selections) || selections.length !== requiredSelections) {
        return false;
      }
      
      // 数値であることを確認
      for (const sel of selections) {
        if (typeof sel !== 'number' || isNaN(sel) || sel <= 0) {
          return false;
        }
      }
      
      // 重複がないことを確認
      if (new Set(selections).size !== selections.length) {
        return false;
      }
    }
  }
  
  // ボックス購入の検証
  else if (method === 'box') {
    // 単勝・複勝はボックス購入不可
    if (betType === 'tansho' || betType === 'fukusho') {
      return false;
    }
    
    // 1次元配列であることを確認
    if (Array.isArray(selections[0])) {
      return false;
    }
    
    // 最低選択数の確認
    if (selections.length < requiredSelections) {
      return false;
    }
    
    // 数値であることを確認
    for (const sel of selections) {
      if (typeof sel !== 'number' || isNaN(sel) || sel <= 0) {
        return false;
      }
    }
    
    // 重複がないことを確認
    if (new Set(selections).size !== selections.length) {
      return false;
    }
    
    // 選択数の上限確認（通常は三連系で7頭、二連系で10頭程度）
    const maxSelections = (betType === 'sanrentan' || betType === 'sanrenpuku') ? 7 : 10;
    if (selections.length > maxSelections) {
      return false;
    }
  }
  
  // フォーメーション購入の検証
  else if (method === 'formation') {
    // 単勝・複勝はフォーメーション購入不可
    if (betType === 'tansho' || betType === 'fukusho') {
      return false;
    }
    
    // 馬単・三連単の場合は2次元配列
    if (betType === 'umatan' || betType === 'sanrentan') {
      if (!Array.isArray(selections) || selections.length !== requiredSelections) {
        return false;
      }
      
      // 各配列の要素が配列であることを確認
      for (const sel of selections) {
        if (!Array.isArray(sel) || sel.length === 0) {
          return false;
        }
        
        // 数値であることを確認
        for (const num of sel) {
          if (typeof num !== 'number' || isNaN(num) || num <= 0) {
            return false;
          }
        }
        
        // 重複がないことを確認
        if (new Set(sel).size !== sel.length) {
          return false;
        }
      }
    } else {
      // その他の馬券タイプは1次元配列
      if (!Array.isArray(selections) || selections.length < requiredSelections) {
        return false;
      }
      
      // 数値であることを確認
      for (const sel of selections) {
        if (typeof sel !== 'number' || isNaN(sel) || sel <= 0) {
          return false;
        }
      }
      
      // 重複がないことを確認
      if (new Set(selections).size !== selections.length) {
        return false;
      }
    }
  } else {
    return false; // 無効な購入方法
  }
  
  return true;
}

/**
 * 馬券の処理ステータスを更新
 * @param {Object} bet - 馬券オブジェクト
 * @param {string} newStatus - 新しいステータス ('processed' または 'cancelled')
 * @param {number} [payout=0] - 払戻金額（処理済みの場合）
 * @returns {Object} 更新された馬券オブジェクト
 */
export function updateBetStatus(bet, newStatus, payout = 0) {
  if (bet.status !== 'pending') {
    throw new Error(`既に処理済みの馬券 (${bet.id}) のステータスを変更することはできません。`);
  }
  
  if (newStatus !== 'processed' && newStatus !== 'cancelled') {
    throw new Error(`無効なステータス: ${newStatus}`);
  }
  
  if (newStatus === 'processed' && (typeof payout !== 'number' || isNaN(payout) || payout < 0)) {
    throw new Error(`無効な払戻金額: ${payout}`);
  }
  
  return {
    ...bet,
    status: newStatus,
    payout: newStatus === 'processed' ? payout : 0,
    processedAt: new Date().toISOString()
  };
}