/**
 * 日付を標準フォーマットに変換する (YYYY/MM/DD)
 * @param {Date} date 日付オブジェクト
 * @returns {string} フォーマットされた日付文字列
 */
function formatStandardDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
}

/**
 * レースIDから日付を抽出する
 * @param {string} raceId レースID (例: 202550051609)
 * @returns {string} 日付文字列 (例: 2025/05/16)
 */
function extractDateFromRaceId(raceId) {
  if (!raceId || raceId.length < 12) return null;
  
  try {
    // 例: 202545051602
    const year = raceId.substring(0, 4);  // 2025
    
    // 月日の部分（5-8文字目が月日）
    const monthDayPart = raceId.substring(6, 10);  // 0516
    const month = monthDayPart.substring(0, 2);    // 05
    const day = monthDayPart.substring(2, 4);      // 16
    
    console.log(`レースID ${raceId} から抽出した日付: ${year}/${month}/${day}`);
    
    return `${year}/${month}/${day}`;
  } catch (error) {
    console.error(`レースID(${raceId})から日付の抽出に失敗しました:`, error);
    return null;
  }
}

/**
 * 現在の日本時間のISOフォーマットを返す
 * @returns {string} 日本時間のISO文字列
 */
function getJapanTimeISOString() {
  const now = new Date();
  // 日本時間に調整（UTC+9）
  now.setTime(now.getTime() + 9 * 60 * 60 * 1000);
  
  // ISO形式の文字列から'Z'を削除して+09:00を追加
  return now.toISOString().replace('Z', '+09:00');
}

module.exports = {
    formatStandardDate,
    extractDateFromRaceId,
    getJapanTimeISOString
};