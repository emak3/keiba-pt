// utils/safe-helpers.js - 安全なデータアクセス用のヘルパー関数

/**
 * 安全に配列の map 操作を行うヘルパー関数
 * @param {Array|undefined|null} array マップする配列
 * @param {Function} mapFn マッピング関数
 * @param {Array} defaultValue 配列が無効な場合のデフォルト値
 * @returns {Array} マップ結果または代替値
 */
function safeMap(array, mapFn, defaultValue = []) {
  if (!array || !Array.isArray(array) || array.length === 0) {
    return defaultValue;
  }
  return array.map(mapFn);
}

/**
 * オブジェクトのプロパティに安全にアクセスするヘルパー関数
 * @param {Object} obj 対象オブジェクト
 * @param {string} path ドット区切りのプロパティパス (例: "user.profile.name")
 * @param {*} defaultValue プロパティが存在しない場合のデフォルト値
 * @returns {*} プロパティの値またはデフォルト値
 */
function safeGet(obj, path, defaultValue = undefined) {
  if (!obj) return defaultValue;
  
  const keys = path.split('.');
  let result = obj;
  
  for (const key of keys) {
    if (result === undefined || result === null) {
      return defaultValue;
    }
    result = result[key];
  }
  
  return result !== undefined ? result : defaultValue;
}

/**
 * 文字列を安全に取得するヘルパー関数
 * @param {*} value 変換する値
 * @param {string} defaultValue 値が無効な場合のデフォルト値
 * @returns {string} 文字列または代替文字列
 */
function safeString(value, defaultValue = '') {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return String(value);
}

/**
 * 数値を安全に取得するヘルパー関数
 * @param {*} value 変換する値
 * @param {number} defaultValue 値が無効な場合のデフォルト値
 * @returns {number} 数値または代替数値
 */
function safeNumber(value, defaultValue = 0) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

module.exports = {
  safeMap,
  safeGet,
  safeString,
  safeNumber
};