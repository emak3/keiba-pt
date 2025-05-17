/**
 * 文字化け対策のユーティリティ関数
 */

/**
 * 文字化けした文字列をクリーンアップ
 * @param {string} text - クリーンアップする文字列
 * @returns {string} クリーンアップされた文字列
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
 * レース名のクリーンアップと代替テキスト提供
 * @param {string} raceName - レース名
 * @param {string} venue - 開催場所
 * @param {number} number - レース番号
 * @returns {string} クリーンアップされたレース名または代替テキスト
 */
export function cleanRaceName(raceName, venue, number) {
  const cleaned = cleanJapaneseText(raceName);
  
  // 文字化けしているか空の場合は、代替テキストを提供
  if (!cleaned || cleaned.length < 2) {
    // クラスとレース番号による代替名
    const classMap = {
      1: '新馬',
      2: '未勝利',
      3: '1勝クラス',
      4: '2勝クラス', 
      5: '3勝クラス',
      6: 'オープン'
    };
    
    const raceClass = classMap[Math.min(Math.floor(number / 2) + 1, 6)] || 'レース';
    return `${venue} ${number}R ${raceClass}`;
  }
  
  return cleaned;
}

/**
 * レース場名のクリーンアップと代替テキスト提供
 * @param {string} venue - 開催場所
 * @returns {string} クリーンアップされた開催場所または代替テキスト
 */
export function cleanVenueName(venue) {
  const cleaned = cleanJapaneseText(venue);
  
  // 文字化けしているか空の場合は、レース場コードから推測
  if (!cleaned || cleaned.length < 2) {
    return '';
  }
  
  // 主要な競馬場名の部分一致による修正
  const venueKeywords = {
    '東京': '東京',
    '中山': '中山',
    '阪神': '阪神',
    '京都': '京都',
    '福島': '福島',
    '新潟': '新潟',
    '小倉': '小倉',
    '札幌': '札幌',
    '函館': '函館',
    '大井': '大井',
    '川崎': '川崎',
    '船橋': '船橋',
    '浦和': '浦和',
    '名古屋': '名古屋',
    '園田': '園田',
    '姫路': '姫路',
    '高知': '高知',
    '佐賀': '佐賀',
    '金沢': '金沢',
    '笠松': '笠松',
    '盛岡': '盛岡',
    '水沢': '水沢',
    '帯広': '帯広',
    '門別': '門別'
  };
  
  for (const [keyword, replacement] of Object.entries(venueKeywords)) {
    if (cleaned.includes(keyword)) {
      return replacement;
    }
  }
  
  return cleaned;
}