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
        '30': '門別',
        '35': '盛岡',
        '36': '水沢',
        '38': '浦和',
        '39': '福山',
        '40': '船橋',
        '41': '大井',
        '42': '名古屋',
        '43': '笠松',
        '44': '金沢',
        '45': '川崎',
        '46': '園田',
        '47': '姫路',
        '48': '高知',
        '50': '佐賀'
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