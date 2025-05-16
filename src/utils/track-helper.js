/**
 * レースIDからレース番号（R）を取得する
 * @param {string} raceId レースID（例：202550051609）
 * @returns {string} レース番号
 */
function getRaceNumberFromRaceId(raceId) {
    if (!raceId || raceId.length < 2) return '0';

    // 最後の2桁を取得
    const raceNumber = raceId.slice(-2);

    // 先頭の0を削除（例：09→9）
    const numberAsInt = parseInt(raceNumber, 10);

    return String(numberAsInt);
}

/**
 * レースIDから会場名を取得する
 * @param {string} raceId レースID
 * @returns {string} 会場名
 */
function getTrackNameFromRaceId(raceId) {
    if (!raceId || raceId.length < 8) return '不明';

    // 会場コードを抽出（5-6桁目）
    const venueCode = raceId.substring(4, 6);

    // 中央競馬（JRA）の会場
    const jraVenues = {
        '01': '札幌',
        '02': '函館',
        '03': '福島',
        '04': '新潟',
        '05': '東京',
        '06': '中山',
        '07': '中京',
        '08': '京都',
        '09': '阪神',
        '10': '小倉'
    };

    // 地方競馬（NAR）の会場
    const narVenues = {
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
        '61': '中京(地方競馬)',
        '65': '帯広(ば)'
    };

    // コードに対応する会場名を返す
    if (jraVenues[venueCode]) {
        return jraVenues[venueCode];
    } else if (narVenues[venueCode]) {
        return narVenues[venueCode];
    } else {
        // 未知のコードの場合はコードそのものを返す
        return `会場${venueCode}`;
    }
}

module.exports = {
    getRaceNumberFromRaceId,
    getTrackNameFromRaceId
};