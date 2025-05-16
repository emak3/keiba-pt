// nar.js - selectors.jsを活用した修正版

const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const selectors = require('./selectors').nar;
const { saveRaceData, saveResultData } = require('../db/races');
const { getJapanTimeISOString } = require('../utils/date-helper');
const { extractDateFromRaceId } = require('../utils/date-helper');
const { getRaceNumberFromRaceId, getTrackNameFromRaceId } = require('../utils/track-helper');

/**
 * 特定のレースの出馬表を取得する（エンコーディング問題修正）
 */
async function getRaceDetails(raceId) {
  try {
    const url = `https://nar.netkeiba.com/race/shutuba.html?race_id=${raceId}`;

    // ヘッダーにエンコーディング情報を追加
    const response = await axios.get(url, {
      headers: {
        'Accept-Charset': 'utf-8',
        'Accept-Language': 'ja-JP,ja;q=0.9'
      },
      responseType: 'arraybuffer' // バイナリデータとして取得
    });

    // 正しいエンコーディングでレスポンスを解析
    const html = iconv.decode(response.data, 'EUC-JP'); // または 'Shift_JIS'
    const $ = cheerio.load(html);

    // レース基本情報
    const raceName = $(selectors.raceName).text().trim() || 'レース名不明';

    // 発走時間を複数の方法で取得を試みる
    let raceTime = '00:00';
    const raceData = $(selectors.raceData).text().trim() || '';

    // 方法1: 通常の正規表現
    const timeMatch1 = raceData.match(/([0-9]{2}:[0-9]{2})発走/);
    if (timeMatch1 && timeMatch1[1]) {
      raceTime = timeMatch1[1];
    } else {
      // 方法2: 別のセレクタで直接時間を取得
      const timeText = $(selectors.raceTime).first().text().trim();
      const timeMatch2 = timeText.match(/([0-9]{2}:[0-9]{2})/);
      if (timeMatch2 && timeMatch2[1]) {
        raceTime = timeMatch2[1];
      }
    }

    // レース距離と馬場種類を抽出
    let raceDistance = '不明';
    let raceSurface = '不明';

    // 方法1: 標準的な正規表現
    const distanceMatch = raceData.match(/([^ ]+)m/);
    if (distanceMatch && distanceMatch[1]) {
      raceDistance = distanceMatch[1];
    }

    // 馬場種類を判定
    if (raceData.includes('ダ')) {
      raceSurface = 'ダート';
    } else if (raceData.includes('芝')) {
      raceSurface = '芝';
    } else if (raceDistance.includes('ダ')) {
      raceSurface = 'ダート';
    } else if (raceDistance.includes('芝')) {
      raceSurface = '芝';
    }

    // 出走馬情報
    const horses = [];

    $(selectors.horseList).each((i, element) => {
      try {
        // 枠番・馬番の取得
        let gate = $(element).find('.Waku1, .Waku2').text().trim() || '0';
        if (gate === '0') {
          // バックアップ方法で取得を試みる
          gate = $(element).find('td').eq(0).text().trim() || '0';
        }

        // 馬番取得の改善
        let number = $(element).find('.Umaban1, .Umaban2').text().trim() || '0';
        if (number === '0') {
          // バックアップ方法で取得を試みる
          number = $(element).find('td').eq(1).text().trim() || '0';
        }

        // 馬名取得
        let horseName = $(element).find(selectors.horseName).text().trim();
        if (!horseName) {
          horseName = $(element).find(selectors.alternativeHorseName).text().trim() || '不明';
        }

        // 馬IDの抽出
        let horseId = '0';
        const horseLink = $(element).find(selectors.horseName).attr('href') ||
          $(element).find(selectors.alternativeHorseName).attr('href');
        if (horseLink) {
          const horseIdMatch = horseLink.match(/horse\/([0-9]+)/);
          if (horseIdMatch && horseIdMatch[1]) {
            horseId = horseIdMatch[1];
          }
        }

        // 騎手情報
        let jockey = $(element).find(selectors.jockeyName).text().trim();
        if (!jockey) {
          jockey = $(element).find(selectors.alternativeJockey).text().trim() || '不明';
        }

        // 体重データ
        const weight = $(element).find(selectors.weight).text().trim() || '0';

        // オッズ情報
        let odds = 0;
        const oddsEl = $(element).find(selectors.odds);
        if (oddsEl.length > 0) {
          const oddsText = oddsEl.text().trim().replace(/[^0-9.]/g, '');
          if (oddsText) {
            odds = parseFloat(oddsText);
          }
        }

        // 人気順データ
        let popularity = 0;
        const popEl = $(element).find(selectors.popularity);
        if (popEl.length > 0) {
          const popText = popEl.text().trim().replace(/[^0-9]/g, '');
          if (popText) {
            popularity = parseInt(popText, 10);
          }
        }

        horses.push({
          id: horseId,
          gate: parseInt(gate, 10) || 0,
          number: parseInt(number, 10) || 0,
          name: horseName,
          jockey,
          weight,
          odds: odds || 0,
          popularity: popularity || 0
        });
      } catch (horseError) {
        console.error(`出走馬情報の抽出中にエラーが発生しました: ${horseError.message}`);
      }
    });

    console.log(`地方競馬レース情報取得: ${raceName}, 時刻: ${raceTime}, 距離: ${raceDistance}, 馬場: ${raceSurface}, 出走馬: ${horses.length}頭`);

    const raceDetails = {
      id: raceId,
      name: raceName,
      time: raceTime,
      distance: raceDistance,
      surface: raceSurface,
      horses,
      lastUpdated: getJapanTimeISOString()
    };

    // Firebaseに保存
    await saveRaceData(raceId, raceDetails);

    return raceDetails;
  } catch (error) {
    console.error(`地方競馬レース詳細(${raceId})の取得中にエラーが発生しました:`, error);

    // 最低限のデータを返してクラッシュを防ぐ
    return {
      id: raceId,
      name: '情報取得失敗',
      time: '00:00',
      distance: '不明',
      surface: '不明',
      horses: [],
      lastUpdated: getJapanTimeISOString(),
      error: error.message
    };
  }
}

/**
 * レース結果と払戻金を取得する
 */
async function getRaceResult(raceId) {
  try {
    const url = `https://nar.netkeiba.com/race/result.html?race_id=${raceId}`;

    // エンコーディング対応
    const response = await axios.get(url, {
      headers: {
        'Accept-Charset': 'utf-8',
        'Accept-Language': 'ja-JP,ja;q=0.9'
      },
      responseType: 'arraybuffer'
    });

    const html = iconv.decode(response.data, 'EUC-JP');
    const $ = cheerio.load(html);

    // 着順情報
    const results = [];

    $('.ResultTable .HorseList').each((i, element) => {
      try {
        const order = $(element).find('.Result_Num').text().trim() || '0';
        const number = $(element).find('.Num').text().trim() || '0';
        const horseName = $(element).find(selectors.alternativeHorseName).text().trim() || '不明';

        // 馬IDの抽出（エラーハンドリングを追加）
        let horseId = '0';
        const horseLink = $(element).find(selectors.alternativeHorseName).attr('href');
        if (horseLink) {
          const horseIdMatch = horseLink.match(/horse\/([0-9]+)/);
          if (horseIdMatch && horseIdMatch[1]) {
            horseId = horseIdMatch[1];
          }
        }

        results.push({
          order: parseInt(order, 10) || 0,
          number: parseInt(number, 10) || 0,
          id: horseId,
          name: horseName
        });
      } catch (resultError) {
        console.error(`着順情報の抽出中にエラーが発生しました: ${resultError.message}`);
      }
    });

    // 払戻金情報
    const payouts = {
      tansho: getPayoutInfo($, selectors.tansho) || [],
      fukusho: getPayoutInfo($, selectors.fukusho) || [],
      wakuren: getPayoutInfo($, selectors.wakuren) || [],
      umaren: getPayoutInfo($, selectors.umaren) || [],
      wide: getPayoutInfo($, selectors.wide) || [],
      umatan: getPayoutInfo($, selectors.umatan) || [],
      sanrentan: getPayoutInfo($, selectors.sanrentan) || [],
      sanrenpuku: getPayoutInfo($, selectors.sanrenpuku) || []
    };

    const resultData = {
      id: raceId,
      results,
      payouts,
      isCompleted: true,
      lastUpdated: getJapanTimeISOString()
    };

    // Firebaseに保存
    await saveResultData(raceId, resultData);

    return resultData;
  } catch (error) {
    console.error(`地方競馬レース結果(${raceId})の取得中にエラーが発生しました:`, error);

    // 最低限のデータを返してクラッシュを防ぐ
    return {
      id: raceId,
      results: [],
      payouts: {},
      isCompleted: true,
      lastUpdated: getJapanTimeISOString(),
      error: error.message
    };
  }
}

/**
 * 払戻金情報を抽出するヘルパー関数
 */
function getPayoutInfo($, selector) {
  try {
    // 数値の取得（馬番）
    const numbers = [];
    $(selector.number).each((i, element) => {
      const num = $(element).text().trim();
      if (num) {
        const parsedNum = parseInt(num, 10);
        if (!isNaN(parsedNum)) {
          numbers.push(parsedNum);
        }
      }
    });
    
    // 払戻金の取得 - <br>タグや改行で分割して処理
    const payouts = [];
    $(selector.pay).each((i, element) => {
      // HTMLを取得して<br>タグを改行に変換
      const html = $(element).html();
      if (!html) return;
      
      // <br>タグを改行に置換してからテキスト化
      const textWithBreaks = html.replace(/<br\s*\/?>/gi, '\n');
      const payTexts = $(textWithBreaks).text().split('\n');
      
      payTexts.forEach(text => {
        // 数字以外の文字を削除（円やカンマなど）
        const pay = text.replace(/[^0-9]/g, '').trim();
        if (pay) {
          const parsedPay = parseInt(pay, 10);
          if (!isNaN(parsedPay)) {
            payouts.push(parsedPay);
          }
        }
      });
    });
    
    // 人気順の取得 - 同様に改行分割を処理
    const popularities = [];
    $(selector.popularity).each((i, element) => {
      const html = $(element).html();
      if (!html) return;
      
      const textWithBreaks = html.replace(/<br\s*\/?>/gi, '\n');
      const popTexts = $(textWithBreaks).text().split('\n');
      
      popTexts.forEach(text => {
        const popMatch = text.match(/(\d+)人気/);
        if (popMatch && popMatch[1]) {
          const parsedPop = parseInt(popMatch[1], 10);
          if (!isNaN(parsedPop)) {
            popularities.push(parsedPop);
          }
        }
      });
    });

    const result = [];

    // 単勝・複勝の処理
    if (selector.number === '.Tansho .Result div span') {
      // 単勝は1つの馬番と1つの払戻金
      if (numbers.length > 0 && payouts.length > 0) {
        result.push({
          numbers: [numbers[0]],
          payout: payouts[0] || 0,
          popularity: popularities[0] || 0
        });
      }
    } else if (selector.number === '.Fukusho .Result div span') {
      // 複勝の場合は馬番と払戻金の数が一致しない場合がある
      for (let i = 0; i < Math.min(numbers.length, payouts.length); i++) {
        result.push({
          numbers: [numbers[i]],
          payout: payouts[i] || 0,
          popularity: popularities[i] || 0
        });
      }
    } else if (selector.number === '.Umatan .Result ul li span' || 
               selector.number === '.Tan3 .Result ul li span') {
      // 馬単・3連単は順序あり
      const count = selector.number === '.Tan3 .Result ul li span' ? 3 : 2;
      if (numbers.length >= count && payouts.length > 0) {
        result.push({
          numbers: numbers.slice(0, count),
          payout: payouts[0] || 0,
          popularity: popularities[0] || 0
        });
      }
    } else {
      // その他の馬券タイプ（馬連・ワイド・3連複など）
      const count = selector.number === '.Fuku3 .Result ul li span' ? 3 : 2;
      
      // ulタグごとにグループ化
      const groupedNumbers = [];
      let currentGroup = [];
      
      for (let i = 0; i < numbers.length; i++) {
        currentGroup.push(numbers[i]);
        if (currentGroup.length === count) {
          groupedNumbers.push([...currentGroup]);
          currentGroup = [];
        }
      }
      
      // 各グループごとに払戻情報を追加
      for (let i = 0; i < Math.min(groupedNumbers.length, payouts.length); i++) {
        result.push({
          numbers: groupedNumbers[i],
          payout: payouts[i] || 0,
          popularity: popularities[i] || 0
        });
      }
    }

    return result;
  } catch (error) {
    console.error('払戻金情報の抽出中にエラーが発生しました:', error);
    return [];
  }
}

/**
 * 当日の地方競馬レース一覧を取得する
 */
async function getTodayRaces() {
  try {
    // 当日のレース一覧ページを取得
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    const url = `https://nar.netkeiba.com/top/race_list_sub.html?kaisai_date=${year}${month}${day}`;

    // エンコーディング対応
    const response = await axios.get(url, {
      headers: {
        'Accept-Charset': 'utf-8',
        'Accept-Language': 'ja-JP,ja;q=0.9'
      },
      responseType: 'arraybuffer'
    });

    // EUC-JPでデコード
    const html = iconv.decode(response.data, 'EUC-JP');
    const $ = cheerio.load(html);

    const races = [];

    // 各会場のレース情報を取得
    $('.RaceList_Data').each((i, element) => {
      try {
        $(element).find('li').each((j, race) => {
          try {
            const raceNumber = $(race).find('.Race_Num').text().trim();
            const raceLink = $(race).find('a').attr('href');
            let raceId = '';

            if (raceLink) {
              const match = raceLink.match(/race_id=([0-9]+)/);
              if (match && match[1]) {
                raceId = match[1];
              }
            }

            if (!raceId) return;

            const raceName = $(race).find('.Race_Name').text().trim();
            const raceTime = $(race).find('.Race_Time').text().trim();

            // スクレイピングで取得した会場名
            let trackName = null;

            // 会場名が取得できない場合はレースIDから取得
            if (!trackName) {
              trackName = getTrackNameFromRaceId(raceId);
              console.log(`会場名がスクレイピングできなかったため、レースID ${raceId} から会場名 ${trackName} を設定しました`);
            }

            races.push({
              id: raceId,
              track: trackName,
              number: raceNumber,
              name: raceName,
              time: raceTime,
              type: 'nra',
              date: extractDateFromRaceId(raceId),
              isCompleted: false
            });
          } catch (innerError) {
            console.error('レース情報の解析中にエラーが発生しました:', innerError);
          }
        });
      } catch (outerError) {
        console.error('会場情報の解析中にエラーが発生しました:', outerError);
      }
    });
    console.log(`地方競馬レース一覧: ${races.length}件取得`);
    return races;
  } catch (error) {
    console.error('地方競馬レース一覧の取得中にエラーが発生しました:', error);
    return [];
  }
}

module.exports = {
  getTodayRaces,
  getRaceDetails,
  getRaceResult
};