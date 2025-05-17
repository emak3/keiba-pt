/**
 * 文字列のバリデーションチェック
 * @param {string} text - チェックする文字列
 * @returns {boolean} 有効な文字列かどうか
 */
export function isValidJapaneseText(text) {
  if (!text) return false;
  
  // 明らかに文字化けしている場合はfalseを返す
  if (/[\uFFFD\u30FB\u309A-\u309C]/.test(text) && text.length > 3) {
    return false;
  }
  
  return true;
}

/**
 * 後方互換性のための関数 - 既存のコードがまだこの関数を使用している場合のため
 */
export function cleanJapaneseText(text) {
  if (!text) return '';
  
  // 明らかに文字化けしている場合は空文字を返す
  if (/[\uFFFD\u30FB\u309A-\u309C]/.test(text) && text.length > 3) {
    return '';
  }
  
  // HTML特殊文字のデコード
  text = text.replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'")
             .replace(/&nbsp;/g, ' ');
  
  // 文字化けした記号などを除去
  text = text.replace(/[^\p{L}\p{N}\p{P}\p{Z}\p{Emoji}]/gu, '');
  
  // 連続する空白を1つに
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * レース名のシンプルな検証
 * @param {string} raceName - レース名
 * @param {string} venue - 開催場所
 * @param {number} number - レース番号
 * @returns {string} 検証済みのレース名または代替テキスト
 */
export function validateRaceName(raceName, venue, number) {
  // 無効な場合のみ代替テキストを提供し、有効な場合は元のレース名を使用
  if (!isValidJapaneseText(raceName) || !raceName || raceName.length < 2) {
    // 元のレース名を保持しようとする
    return `${venue} ${number}R`;
  }
  
  return raceName;
}

/**
 * 後方互換性のための関数 - 既存のコードがまだこの関数を使用している場合のため
 */
export function cleanRaceName(raceName, venue, number) {
  return validateRaceName(raceName, venue, number);
}

/**
 * レース場名のシンプルな検証
 * @param {string} venue - 開催場所
 * @returns {string} 検証済みの開催場所または代替テキスト
 */
export function validateVenueName(venue) {
  // 無効な場合は未知として扱う
  if (!isValidJapaneseText(venue) || !venue || venue.length < 2) {
    return '不明';
  }
  
  return venue;
}

/**
 * 後方互換性のための関数 - 既存のコードがまだこの関数を使用している場合のため
 */
export function cleanVenueName(venue) {
  return validateVenueName(venue);
}

/**
 * レスポンスの文字セットを検出
 * @param {Object} response - Axiosレスポンス
 * @returns {string} 文字セット名
 */
export function detectCharset(response) {
  // ネットケイバは基本的にEUC-JPを使用
  return 'euc-jp';
}

// スクレイパー用の推奨設定
export const recommendedAxiosConfig = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    'Accept-Charset': 'utf-8, iso-8859-1, euc-jp, shift_jis',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': 'https://www.netkeiba.com/'
  },
  responseType: 'arraybuffer',  // バイナリデータとして取得
  responseEncoding: 'binary'
};