/**
 * レースモデル - Firestore レースデータの構造定義
 */

/**
 * レースオブジェクトの作成
 * @param {string} id - レースID
 * @param {string} type - レースタイプ ('jra' または 'nar')
 * @param {string} venue - 競馬場名
 * @param {number} number - レース番号
 * @param {string} name - レース名
 * @param {string} time - 発走時刻 (HH:MM形式)
 * @param {string} date - 開催日 (YYYYMMDD形式)
 * @param {string} link - レース情報へのリンク
 * @returns {Object} レースオブジェクト
 */
export function createRace(id, type, venue, number, name, time, date, link) {
  const now = new Date().toISOString();
  
  return {
    id,
    type,
    venue,
    number,
    name,
    time,
    date,
    link,
    status: 'upcoming', // upcoming, in_progress, completed
    horses: [],
    results: [],
    payouts: null,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * レースデータの検証
 * @param {Object} raceData - 検証するレースデータ
 * @returns {boolean} 検証結果
 */
export function validateRace(raceData) {
  // 必須フィールドの確認
  if (!raceData.id || !raceData.type || !raceData.venue || 
      !raceData.number || !raceData.name || !raceData.time || 
      !raceData.date) {
    return false;
  }
  
  // レースタイプの確認
  if (raceData.type !== 'jra' && raceData.type !== 'nar') {
    return false;
  }
  
  // レース番号が数値であることを確認
  if (typeof raceData.number !== 'number' || isNaN(raceData.number)) {
    return false;
  }
  
  // 日付フォーマットの確認 (YYYYMMDD)
  if (!/^\d{8}$/.test(raceData.date)) {
    return false;
  }
  
  // 時刻フォーマットの確認 (HH:MM)
  if (!/^\d{2}:\d{2}$/.test(raceData.time)) {
    return false;
  }
  
  // ステータスの確認
  if (raceData.status !== 'upcoming' && raceData.status !== 'in_progress' && raceData.status !== 'completed') {
    return false;
  }
  
  return true;
}

/**
 * 出走馬情報オブジェクトの作成
 * @param {number} frameNumber - 枠番
 * @param {number} horseNumber - 馬番
 * @param {string} horseName - 馬名
 * @param {string} jockey - 騎手名
 * @param {string} trainer - 調教師名
 * @param {string} weight - 馬体重
 * @param {number} odds - オッズ
 * @param {number} popularity - 人気順
 * @returns {Object} 出走馬情報オブジェクト
 */
export function createHorseEntry(frameNumber, horseNumber, horseName, jockey, trainer, weight, odds, popularity) {
  return {
    frameNumber,
    horseNumber,
    horseName,
    jockey,
    trainer,
    weight,
    odds,
    popularity
  };
}

/**
 * レース結果オブジェクトの作成
 * @param {number} order - 着順
 * @param {number} frameNumber - 枠番
 * @param {number} horseNumber - 馬番
 * @param {string} horseName - 馬名
 * @param {string} jockey - 騎手名
 * @returns {Object} レース結果オブジェクト
 */
export function createRaceResult(order, frameNumber, horseNumber, horseName, jockey) {
  return {
    order,
    frameNumber,
    horseNumber,
    horseName,
    jockey
  };
}

/**
 * 払戻情報オブジェクトの作成
 * @returns {Object} 払戻情報オブジェクト
 */
export function createPayoutsObject() {
  return {
    tansho: [], // 単勝
    fukusho: [], // 複勝
    wakuren: [], // 枠連
    umaren: [], // 馬連
    wide: [], // ワイド
    umatan: [], // 馬単
    sanrentan: [], // 三連単
    sanrenpuku: [] // 三連複
  };
}

/**
 * 払戻情報エントリの作成
 * @param {Array<number>} numbers - 馬番または枠番の配列
 * @param {number} payout - 払戻金額
 * @param {number} popularity - 人気順
 * @returns {Object} 払戻情報エントリ
 */
export function createPayoutEntry(numbers, payout, popularity) {
  return {
    numbers,
    payout,
    popularity
  };
}

/**
 * レースステータスの更新
 * @param {string} currentStatus - 現在のステータス
 * @param {string} newStatus - 新しいステータス
 * @returns {string} 更新後のステータス
 */
export function updateRaceStatus(currentStatus, newStatus) {
  const validStatuses = ['upcoming', 'in_progress', 'completed'];
  
  if (!validStatuses.includes(currentStatus)) {
    throw new Error(`現在のステータス '${currentStatus}' が無効です。`);
  }
  
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`新しいステータス '${newStatus}' が無効です。`);
  }
  
  // ステータスの進行方向チェック（後退は許可しない）
  const statusIndex = {
    'upcoming': 0,
    'in_progress': 1,
    'completed': 2
  };
  
  if (statusIndex[newStatus] < statusIndex[currentStatus]) {
    throw new Error(`ステータスを '${currentStatus}' から '${newStatus}' に後退させることはできません。`);
  }
  
  return newStatus;
}