/**
 * 文字列のバリデーションチェック - 強化版
 * @param {string} text - チェックする文字列
 * @returns {boolean} 有効な文字列かどうか
 */
export function isValidJapaneseText(text) {
  if (!text) return false;
  
  // 明らかに文字化けしている場合はfalseを返す
  if (/[\uFFFD\u30FB\u309A-\u309C]/.test(text)) {
    return false;
  }

  // 特定の文字化けパターンをチェック
  if (text.includes('��') || text.includes('�') || text.includes('□')) {
    return false;
  }
  
  return true;
}

/**
 * 日本語テキストのクリーニング - 強化版
 * @param {string} text - クリーニングする文字列
 * @returns {string} クリーニングされた文字列
 */
export function cleanJapaneseText(text) {
  if (!text) return '';
  
  // 明らかに文字化けしている場合は空文字を返す
  if (/[\uFFFD\u30FB\u309A-\u309C]/.test(text) || 
      text.includes('��') || 
      text.includes('�') ||
      text.includes('□')) {
    return '';
  }
  
  // HTML特殊文字のデコード
  text = text.replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'")
             .replace(/&nbsp;/g, ' ');
  
  // 不要な制御文字や特殊文字を除去
  text = text.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  
  // 連続する空白を1つに
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * レース名のシンプルな検証と代替テキスト生成
 * @param {string} raceName - レース名
 * @param {string} venue - 開催場所
 * @param {number} number - レース番号
 * @returns {string} 検証済みのレース名または代替テキスト
 */
export function validateRaceName(raceName, venue, number) {
  // 無効な場合は代替テキストを提供
  if (!isValidJapaneseText(raceName) || !raceName || raceName.length < 2) {
    // 標準的なレース名パターンを生成
    return `${venue || '不明'} ${number || '?'}R`;
  }
  
  return raceName;
}

/**
 * レース場名のシンプルな検証
 * @param {string} venue - 開催場所
 * @returns {string} 検証済みの開催場所または代替テキスト
 */
export function validateVenueName(venue) {
  // 無効な場合は未知として扱う
  if (!isValidJapaneseText(venue) || !venue || venue.length < 2) {
    return '不明競馬場';
  }
  
  return venue;
}

/**
 * 後方互換性のための関数
 */
export function cleanRaceName(raceName, venue, number) {
  return validateRaceName(raceName, venue, number);
}

/**
 * 後方互換性のための関数
 */
export function cleanVenueName(venue) {
  return validateVenueName(venue);
}

/**
 * レスポンスの文字セットを検出 - 強化版
 * @param {Object} response - Axiosレスポンス
 * @returns {string} 文字セット名
 */
export function detectCharset(response) {
    // HTTP헤더で宣言されたCharsetを確認
    const contentType = response.headers['content-type'] || '';
    const charsetMatch = contentType.match(/charset=([^;]+)/i);

    if (charsetMatch) {
        const charset = charsetMatch[1].trim().toLowerCase();
        return charset;
    }

    try {
        // metaタグで宣言されたcharsetを検出（UTF-8でまず試してみる）
        const utf8Sample = Buffer.from(response.data).toString('utf8', 0, 1000);
        const metaCharsetMatch = utf8Sample.match(/<meta[^>]*charset=["']?([^"'>]+)/i);

        if (metaCharsetMatch) {
            const charset = metaCharsetMatch[1].trim().toLowerCase();
            return charset;
        }

        // EUC-JPで試してみる
        const eucJpSample = Buffer.from(response.data).toString('binary', 0, 1000);
        const eucMetaCharsetMatch = eucJpSample.match(/<meta[^>]*charset=["']?([^"'>]+)/i);

        if (eucMetaCharsetMatch) {
            const charset = eucMetaCharsetMatch[1].trim().toLowerCase();
            return charset;
        }
    } catch (error) {
        // エラーが発生した場合は無視
    }

    // netkeiba.comはEUC-JPを使っていることが多い
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