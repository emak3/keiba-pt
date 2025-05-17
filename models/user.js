/**
 * ユーザーモデル - Firestore ユーザーデータの構造定義
 */

/**
 * ユーザーオブジェクトの作成
 * @param {string} id - Discord ユーザーID
 * @param {string} username - Discord ユーザー名
 * @param {string} [avatarUrl] - ユーザーアバターURL
 * @param {number} [points=1000] - 初期ポイント
 * @returns {Object} ユーザーオブジェクト
 */
export function createUser(id, username, avatarUrl = null, points = 1000) {
  const now = new Date().toISOString();
  
  return {
    id,
    username,
    points,
    avatarUrl,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * ユーザーデータの検証
 * @param {Object} userData - 検証するユーザーデータ
 * @returns {boolean} 検証結果
 */
export function validateUser(userData) {
  // 必須フィールドの確認
  if (!userData.id || !userData.username) {
    return false;
  }
  
  // ポイントが数値であることを確認
  if (typeof userData.points !== 'number' || isNaN(userData.points)) {
    return false;
  }
  
  // 日付フィールドの確認
  if (!userData.createdAt || !userData.updatedAt) {
    return false;
  }
  
  return true;
}

/**
 * ユーザーデータの更新オブジェクト作成
 * @param {Object} updateData - 更新するフィールドを含むオブジェクト
 * @returns {Object} 更新用オブジェクト
 */
export function createUserUpdate(updateData) {
  const update = {
    ...updateData,
    updatedAt: new Date().toISOString()
  };
  
  // 作成日は更新しない
  delete update.createdAt;
  // IDは更新しない
  delete update.id;
  
  return update;
}

/**
 * ポイント加算計算
 * @param {number} currentPoints - 現在のポイント
 * @param {number} addPoints - 追加するポイント
 * @returns {number} 計算後のポイント
 */
export function calculateAddPoints(currentPoints, addPoints) {
  if (typeof currentPoints !== 'number' || isNaN(currentPoints)) {
    throw new Error('現在のポイントは数値である必要があります。');
  }
  
  if (typeof addPoints !== 'number' || isNaN(addPoints) || addPoints < 0) {
    throw new Error('追加ポイントは0以上の数値である必要があります。');
  }
  
  return currentPoints + addPoints;
}

/**
 * ポイント減算計算
 * @param {number} currentPoints - 現在のポイント
 * @param {number} subtractPoints - 減算するポイント
 * @returns {number} 計算後のポイント
 */
export function calculateSubtractPoints(currentPoints, subtractPoints) {
  if (typeof currentPoints !== 'number' || isNaN(currentPoints)) {
    throw new Error('現在のポイントは数値である必要があります。');
  }
  
  if (typeof subtractPoints !== 'number' || isNaN(subtractPoints) || subtractPoints < 0) {
    throw new Error('減算ポイントは0以上の数値である必要があります。');
  }
  
  if (currentPoints < subtractPoints) {
    throw new Error(`ポイントが不足しています。（現在: ${currentPoints}, 必要: ${subtractPoints}）`);
  }
  
  return currentPoints - subtractPoints;
}