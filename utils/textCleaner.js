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
  console.log(`うんこおおおおおおおおおおおおおおおおおおおおおおおおおおおおおおおおおお: ${venue}`)
  // 文字化けしているか空の場合は、レース場コードから推測
  if (!cleaned || cleaned.length < 2) {
    return '不明';
  }
  
  // 主要な競馬場名の部分一致による修正
  const venueKeywords = {
    '01': '札幌',
        '02': '函館',
        '03': '福島',
        '04': '新潟',
        '05': '東京',
        '06': '中山',
        '07': '中京',
        '08': '京都',
        '09': '阪神',
        '10': '小倉',
        '31': '北見',
        '32': '岩見沢',
        '33': '帯広',
        '34': '旭川',
        '35': '盛岡',
        '36': '水沢',
        '37': '上山',
        '38': '三条',
        '39': '足利',
        '40': '宇都宮',
        '41': '高崎',
        '42': '浦和',
        '43': '船橋',
        '44': '大井',
        '45': '川崎',
        '46': '金沢',
        '47': '笠松',
        '48': '名古屋',
        '49': '(未使用競馬場)',
        '50': '園田',
        '51': '姫路',
        '52': '益田',
        '53': '福山',
        '54': '高知',
        '55': '佐賀',
        '56': '荒尾',
        '57': '中津',
        '58': '札幌(地方競馬)',
        '59': '函館(地方競馬)',
        '60': '新潟(地方競馬)',
        '61': '中京(地方競馬)'
  };
  
  for (const [keyword, replacement] of Object.entries(venueKeywords)) {
    if (cleaned.includes(keyword)) {
      return replacement;
    }
  }
  
  return cleaned;
}