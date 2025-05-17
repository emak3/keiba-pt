const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const selectors = require('./selectors').jra;
const { saveRaceData, saveResultData } = require('../db/races');
const { getJapanTimeISOString } = require('../utils/date-helper');
const { extractDateFromRaceId } = require('../utils/date-helper');
const { getRaceNumberFromRaceId, getTrackNameFromRaceId } = require('../utils/track-helper');

/**
 * 特定のレースの出馬表を取得する（エンコーディング問題修正）
 */
async function getRaceDetails(raceId) {
  // 元の関数の内容をそのまま維持
  try {
    const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;

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
      const timeText = $(selectors.alternativeTime).first().text().trim();
      const timeMatch2 = timeText.match(/([0-9]{2}:[0-9]{2})/);
      if (timeMatch2 && timeMatch2[1]) {
        raceTime = timeMatch2[1];
      }
    }

    // レース距離を抽出（複数の方法で試みる）
    let raceDistance = '不明';
    let raceSurface = '不明';

    const distanceMatch = raceData.match(/([^ ]+)m/);
    if (distanceMatch && distanceMatch[1]) {
      raceDistance = distanceMatch[1];
      // 馬場種類を判定
      if (raceDistance.includes('芝')) {
        raceSurface = '芝';
      } else {
        raceSurface = 'ダート';
      }
    }

    // 出走馬情報
    const horses = [];

    $(selectors.horseList).each((i, element) => {
      try {
        const gate = $(element).find('td').eq(0).text().trim() || '0';
        const number = $(element).find('td').eq(1).text().trim() || '0';

        // 馬名取得（通常のセレクタと代替セレクタを試みる）
        let horseName = $(element).find(selectors.horseName).text().trim();
        if (!horseName) {
          horseName = $(element).find(selectors.alternativeHorseName).text().trim() || '不明';
        }

        // 馬IDの抽出（エラーハンドリングを追加）
        let horseId = '0';
        const horseLink = $(element).find(selectors.horseName).attr('href') ||
          $(element).find(selectors.alternativeHorseName).attr('href');
        if (horseLink) {
          const horseIdMatch = horseLink.match(/horse\/([0-9]+)/);
          if (horseIdMatch && horseIdMatch[1]) {
            horseId = horseIdMatch[1];
          }
        }

        // 騎手情報取得（通常のセレクタと代替セレクタを試みる）
        let jockey = $(element).find(selectors.jockeyName).text().trim();
        if (!jockey) {
          jockey = $(element).find(selectors.alternativeJockey).text().trim() || '不明';
        }

        // 体重データ
        const weight = $(element).find(selectors.weight).text().trim() || '0';

        // オッズ情報
        const oddsElement = $(element).find(selectors.odds);
        let odds = '0';
        if (oddsElement.length > 0) {
          odds = oddsElement.text().trim().replace(/[^0-9.]/g, '') || '0';
        }

        // 人気順データ
        const popularityElement = $(element).find(selectors.popularity);
        let popularity = '0';
        if (popularityElement.length > 0) {
          popularity = popularityElement.text().trim().replace(/[^0-9]/g, '') || '0';
        }

        horses.push({
          id: horseId,
          gate: parseInt(gate, 10) || 0,
          number: parseInt(number, 10) || 0,
          name: horseName,
          jockey,
          weight,
          odds: parseFloat(odds || 0) || 0,
          popularity: parseInt(popularity || 0, 10) || 0
        });
      } catch (horseError) {
        console.error(`出走馬情報の抽出中にエラーが発生しました: ${horseError.message}`);
      }
    });

    console.log(`レース情報取得: ${raceName}, 時刻: ${raceTime}, 距離: ${raceDistance}, 馬場: ${raceSurface}, 出走馬: ${horses.length}頭`);

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
    console.error(`レース詳細(${raceId})の取得中にエラーが発生しました:`, error);

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
  // 元の関数の内容をそのまま維持
  try {
    console.log(`レース結果取得開始: ${raceId}`);
    const url = `https://race.netkeiba.com/race/result.html?race_id=${raceId}`;

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

    // ページタイトルをログ出力 (確認用)
    console.log('ページタイトル:', $('title').text().trim());

    // 結果ページかどうか確認 (レース終了前の場合はレース結果ページが存在しない)
    if ($('.ResultTableWrap').length === 0) {
      console.log(`レース ${raceId} の結果ページがまだありません (レース未終了の可能性)`);
      return {
        id: raceId,
        results: [],
        payouts: {},
        isCompleted: false,
        lastUpdated: getJapanTimeISOString()
      };
    }

    // 着順情報
    const results = [];

    $('.ResultTableWrap .HorseList').each((i, element) => {
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

    // 着順が取得できたか確認
    if (results.length === 0) {
      console.log(`レース ${raceId} の着順情報が取得できませんでした`);
    } else {
      console.log(`レース ${raceId} の着順情報: ${results.length}件`);
    }

    // 払戻金情報を取得
    let payoutSectionExists = false;

    // 「払戻金」セクションの存在チェック
    if ($('.Result_Pay_Back').length > 0 || $('.ResultPaybackLeftWrap').length > 0) {
      payoutSectionExists = true;
      console.log(`レース ${raceId} の払戻金セクションが見つかりました`);
    } else {
      console.log(`レース ${raceId} の払戻金セクションが見つかりません`);
    }

    // 標準的な抽出方法で払戻金情報を抽出
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

    // 払戻情報があるか確認
    let hasPayoutData = false;
    for (const type in payouts) {
      if (payouts[type] && payouts[type].length > 0) {
        console.log(`${type}情報: ${payouts[type].length}件`);
        hasPayoutData = true;
      }
    }

    // 標準的な抽出に失敗した場合は直接抽出を試みる
    if (!hasPayoutData && payoutSectionExists) {
      console.log('標準的な抽出に失敗したため、直接HTMLから抽出を試みます');

      // 単勝情報の直接抽出
      const tanshoNum = $('.Tansho .Result div span').first().text().trim();
      const tanshoPayout = $('.Tansho .Payout span').first().text().trim();
      const tanshoPopularity = $('.Tansho .Ninki span').first().text().trim();

      if (tanshoNum && tanshoPayout) {
        const number = parseInt(tanshoNum.replace(/[^\d]/g, ''), 10);
        const pay = parseInt(tanshoPayout.replace(/[^\d]/g, ''), 10);
        const pop = tanshoPopularity ? parseInt(tanshoPopularity.replace(/[^\d]/g, ''), 10) : 0;

        if (!isNaN(number) && !isNaN(pay)) {
          payouts.tansho = [{
            numbers: [number],
            payout: pay,
            popularity: pop
          }];
          console.log('直接抽出した単勝情報:', payouts.tansho);
          hasPayoutData = true;
        }
      }

      // 複勝情報の直接抽出
      const fukushoNumbers = [];
      const fukushoPayouts = [];
      const fukushoPopularities = [];

      // 複勝の馬番取得
      $('.Fukusho .Result div span').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text) {
          const num = parseInt(text.replace(/[^\d]/g, ''), 10);
          if (!isNaN(num)) fukushoNumbers.push(num);
        }
      });

      // 複勝の払戻金取得
      const fukushoPayText = $('.Fukusho .Payout span').text().trim();
      fukushoPayText.split(/\s*[\n\r]+\s*/).forEach(text => {
        if (text) {
          const pay = parseInt(text.replace(/[^\d]/g, ''), 10);
          if (!isNaN(pay)) fukushoPayouts.push(pay);
        }
      });

      // 複勝の人気順取得
      const fukushoPopText = $('.Fukusho .Ninki span').text().trim();
      fukushoPopText.split(/\s*[\n\r]+\s*/).forEach(text => {
        if (text) {
          const pop = parseInt(text.replace(/[^\d]/g, ''), 10);
          if (!isNaN(pop)) fukushoPopularities.push(pop);
        }
      });

      // 複勝情報の組み立て
      if (fukushoNumbers.length > 0 && fukushoPayouts.length > 0) {
        payouts.fukusho = [];
        for (let i = 0; i < Math.min(fukushoNumbers.length, fukushoPayouts.length); i++) {
          payouts.fukusho.push({
            numbers: [fukushoNumbers[i]],
            payout: fukushoPayouts[i],
            popularity: i < fukushoPopularities.length ? fukushoPopularities[i] : 0
          });
        }
        console.log('直接抽出した複勝情報:', payouts.fukusho);
        hasPayoutData = true;
      }

      // 馬連情報の直接抽出
      const umarenNum1 = $('.Umaren .Result ul li span').eq(0).text().trim();
      const umarenNum2 = $('.Umaren .Result ul li span').eq(1).text().trim();
      const umarenPayout = $('.Umaren .Payout span').first().text().trim();
      const umarenPopularity = $('.Umaren .Ninki span').first().text().trim();

      if (umarenNum1 && umarenNum2 && umarenPayout) {
        const number1 = parseInt(umarenNum1.replace(/[^\d]/g, ''), 10);
        const number2 = parseInt(umarenNum2.replace(/[^\d]/g, ''), 10);
        const pay = parseInt(umarenPayout.replace(/[^\d]/g, ''), 10);
        const pop = umarenPopularity ? parseInt(umarenPopularity.replace(/[^\d]/g, ''), 10) : 0;

        if (!isNaN(number1) && !isNaN(number2) && !isNaN(pay)) {
          payouts.umaren = [{
            numbers: [number1, number2],
            payout: pay,
            popularity: pop
          }];
          console.log('直接抽出した馬連情報:', payouts.umaren);
          hasPayoutData = true;
        }
      }

      // ワイド情報の直接抽出
      const wideGroups = [];
      let currentWideGroup = [];

      // ワイドの馬番を2頭ずつのグループに分ける
      $('.Wide .Result ul li span').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text) {
          const num = parseInt(text.replace(/[^\d]/g, ''), 10);
          if (!isNaN(num)) {
            currentWideGroup.push(num);
            if (currentWideGroup.length === 2) {
              wideGroups.push([...currentWideGroup]);
              currentWideGroup = [];
            }
          }
        }
      });

      // ワイドの払戻金と人気順を取得
      const widePayouts = [];
      const widePopularities = [];

      const widePayText = $('.Wide .Payout span').text().trim();
      widePayText.split(/\s*[\n\r]+\s*/).forEach(text => {
        if (text) {
          const pay = parseInt(text.replace(/[^\d]/g, ''), 10);
          if (!isNaN(pay)) widePayouts.push(pay);
        }
      });

      const widePopText = $('.Wide .Ninki span').text().trim();
      widePopText.split(/\s*[\n\r]+\s*/).forEach(text => {
        if (text) {
          const pop = parseInt(text.replace(/[^\d]/g, ''), 10);
          if (!isNaN(pop)) widePopularities.push(pop);
        }
      });

      // ワイド情報の組み立て
      if (wideGroups.length > 0 && widePayouts.length > 0) {
        payouts.wide = [];
        for (let i = 0; i < Math.min(wideGroups.length, widePayouts.length); i++) {
          payouts.wide.push({
            numbers: wideGroups[i],
            payout: widePayouts[i],
            popularity: i < widePopularities.length ? widePopularities[i] : 0
          });
        }
        console.log('直接抽出したワイド情報:', payouts.wide);
        hasPayoutData = true;
      }

      // 馬単情報の直接抽出
      const umatanNum1 = $('.Umatan .Result ul li span').eq(0).text().trim();
      const umatanNum2 = $('.Umatan .Result ul li span').eq(1).text().trim();
      const umatanPayout = $('.Umatan .Payout span').first().text().trim();
      const umatanPopularity = $('.Umatan .Ninki span').first().text().trim();

      if (umatanNum1 && umatanNum2 && umatanPayout) {
        const number1 = parseInt(umatanNum1.replace(/[^\d]/g, ''), 10);
        const number2 = parseInt(umatanNum2.replace(/[^\d]/g, ''), 10);
        const pay = parseInt(umatanPayout.replace(/[^\d]/g, ''), 10);
        const pop = umatanPopularity ? parseInt(umatanPopularity.replace(/[^\d]/g, ''), 10) : 0;

        if (!isNaN(number1) && !isNaN(number2) && !isNaN(pay)) {
          payouts.umatan = [{
            numbers: [number1, number2],
            payout: pay,
            popularity: pop
          }];
          console.log('直接抽出した馬単情報:', payouts.umatan);
          hasPayoutData = true;
        }
      }

      // 三連複情報の直接抽出
      const sanrenpukuNum1 = $('.Fuku3 .Result ul li span').eq(0).text().trim();
      const sanrenpukuNum2 = $('.Fuku3 .Result ul li span').eq(1).text().trim();
      const sanrenpukuNum3 = $('.Fuku3 .Result ul li span').eq(2).text().trim();
      const sanrenpukuPayout = $('.Fuku3 .Payout span').first().text().trim();
      const sanrenpukuPopularity = $('.Fuku3 .Ninki span').first().text().trim();

      if (sanrenpukuNum1 && sanrenpukuNum2 && sanrenpukuNum3 && sanrenpukuPayout) {
        const number1 = parseInt(sanrenpukuNum1.replace(/[^\d]/g, ''), 10);
        const number2 = parseInt(sanrenpukuNum2.replace(/[^\d]/g, ''), 10);
        const number3 = parseInt(sanrenpukuNum3.replace(/[^\d]/g, ''), 10);
        const pay = parseInt(sanrenpukuPayout.replace(/[^\d]/g, ''), 10);
        const pop = sanrenpukuPopularity ? parseInt(sanrenpukuPopularity.replace(/[^\d]/g, ''), 10) : 0;

        if (!isNaN(number1) && !isNaN(number2) && !isNaN(number3) && !isNaN(pay)) {
          payouts.sanrenpuku = [{
            numbers: [number1, number2, number3],
            payout: pay,
            popularity: pop
          }];
          console.log('直接抽出した3連複情報:', payouts.sanrenpuku);
          hasPayoutData = true;
        }
      }

      // 三連単情報の直接抽出
      const sanrentanNum1 = $('.Tan3 .Result ul li span').eq(0).text().trim();
      const sanrentanNum2 = $('.Tan3 .Result ul li span').eq(1).text().trim();
      const sanrentanNum3 = $('.Tan3 .Result ul li span').eq(2).text().trim();
      const sanrentanPayout = $('.Tan3 .Payout span').first().text().trim();
      const sanrentanPopularity = $('.Tan3 .Ninki span').first().text().trim();

      if (sanrentanNum1 && sanrentanNum2 && sanrentanNum3 && sanrentanPayout) {
        const number1 = parseInt(sanrentanNum1.replace(/[^\d]/g, ''), 10);
        const number2 = parseInt(sanrentanNum2.replace(/[^\d]/g, ''), 10);
        const number3 = parseInt(sanrentanNum3.replace(/[^\d]/g, ''), 10);
        const pay = parseInt(sanrentanPayout.replace(/[^\d]/g, ''), 10);
        const pop = sanrentanPopularity ? parseInt(sanrentanPopularity.replace(/[^\d]/g, ''), 10) : 0;

        if (!isNaN(number1) && !isNaN(number2) && !isNaN(number3) && !isNaN(pay)) {
          payouts.sanrentan = [{
            numbers: [number1, number2, number3],
            payout: pay,
            popularity: pop
          }];
          console.log('直接抽出した3連単情報:', payouts.sanrentan);
          hasPayoutData = true;
        }
      }

      // 枠連情報の直接抽出（存在する場合）
      const wakurenNum1 = $('.Wakuren .Result ul li span').eq(0).text().trim();
      const wakurenNum2 = $('.Wakuren .Result ul li span').eq(1).text().trim();
      const wakurenPayout = $('.Wakuren .Payout span').first().text().trim();
      const wakurenPopularity = $('.Wakuren .Ninki span').first().text().trim();

      if (wakurenNum1 && wakurenNum2 && wakurenPayout) {
        const number1 = parseInt(wakurenNum1.replace(/[^\d]/g, ''), 10);
        const number2 = parseInt(wakurenNum2.replace(/[^\d]/g, ''), 10);
        const pay = parseInt(wakurenPayout.replace(/[^\d]/g, ''), 10);
        const pop = wakurenPopularity ? parseInt(wakurenPopularity.replace(/[^\d]/g, ''), 10) : 0;

        if (!isNaN(number1) && !isNaN(number2) && !isNaN(pay)) {
          payouts.wakuren = [{
            numbers: [number1, number2],
            payout: pay,
            popularity: pop
          }];
          console.log('直接抽出した枠連情報:', payouts.wakuren);
          hasPayoutData = true;
        }
      }

      // 直接TextContentを取得して数値抽出する最後の手段
      if (!hasPayoutData) {
        console.log('セレクタベースの抽出に失敗しました。テキストコンテンツから直接抽出を試みます');

        // 単勝
        const tanshoText = $('.Tansho').text();
        const tanshoMatch = tanshoText.match(/(\d+)[\s\S]*?(\d+)円[\s\S]*?(\d+)人気/);
        if (tanshoMatch) {
          payouts.tansho = [{
            numbers: [parseInt(tanshoMatch[1], 10)],
            payout: parseInt(tanshoMatch[2], 10),
            popularity: parseInt(tanshoMatch[3], 10)
          }];
          console.log('テキストから抽出した単勝情報:', payouts.tansho);
          hasPayoutData = true;
        }

        // 馬連
        const umarenText = $('.Umaren').text();
        const umarenMatch = umarenText.match(/(\d+)[\s\S]*?(\d+)[\s\S]*?(\d+),?(\d*)円[\s\S]*?(\d+)人気/);
        if (umarenMatch) {
          const payout = umarenMatch[4] ?
            parseInt(umarenMatch[3] + umarenMatch[4], 10) :
            parseInt(umarenMatch[3], 10);

          payouts.umaren = [{
            numbers: [parseInt(umarenMatch[1], 10), parseInt(umarenMatch[2], 10)],
            payout: payout,
            popularity: parseInt(umarenMatch[5], 10)
          }];
          console.log('テキストから抽出した馬連情報:', payouts.umaren);
          hasPayoutData = true;
        }

        // 他の馬券タイプも同様に処理...
      }
    }

    // レース完了フラグの判定
    // 着順情報があり、かつ払戻情報があるか、払戻セクションが存在する場合に完了とみなす
    const isCompleted = results.length > 0 && (hasPayoutData || payoutSectionExists);

    // デバッグ出力
    console.log('抽出した払戻金情報:', JSON.stringify(payouts, null, 2));

    const resultData = {
      id: raceId,
      results,
      payouts,
      isCompleted,
      lastUpdated: getJapanTimeISOString()
    };

    // Firebaseに保存
    if (isCompleted) {
      console.log(`レース ${raceId} の結果を保存します (完了済み)`);
      await saveResultData(raceId, resultData);
    } else {
      console.log(`レース ${raceId} はまだ完了していません`);
    }

    return resultData;
  } catch (error) {
    console.error(`レース結果(${raceId})の取得中にエラーが発生しました:`, error);

    // 最低限のデータを返してクラッシュを防ぐ
    return {
      id: raceId,
      results: [],
      payouts: {},
      isCompleted: false,
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
    // デバッグ出力
    console.log('払戻情報抽出開始。セレクタ:', selector);

    // 数値の取得（馬番）
    const numbers = [];
    $(selector.number).each((i, element) => {
      const num = $(element).text().trim();
      console.log(`馬番テキスト [${i}]: "${num}"`);
      if (num) {
        const parsedNum = parseInt(num, 10);
        if (!isNaN(parsedNum)) {
          numbers.push(parsedNum);
        }
      }
    });
    console.log('抽出した馬番:', numbers);

    // 払戻金の取得
    const payouts = [];
    $(selector.pay).each((i, element) => {
      try {
        // 直接テキストを抽出して数値のみを取得
        const payText = $(element).text().trim();
        console.log(`払戻金テキスト [${i}]: "${payText}"`);

        // 数字のみを抽出
        const pay = parseInt(payText.replace(/[^\d]/g, ''), 10);
        if (!isNaN(pay)) {
          payouts.push(pay);
        }
      } catch (err) {
        console.error(`払戻金抽出エラー: ${err.message}`);
      }
    });
    console.log('抽出した払戻金:', payouts);

    // 人気順の取得
    const popularities = [];
    $(selector.popularity).each((i, element) => {
      try {
        // 直接テキストを抽出して数値のみを取得
        const popText = $(element).text().trim();
        console.log(`人気順テキスト [${i}]: "${popText}"`);

        // 数字のみを抽出
        const popMatch = popText.match(/(\d+)人気/);
        if (popMatch && popMatch[1]) {
          const popularity = parseInt(popMatch[1], 10);
          popularities.push(popularity);
        }
      } catch (err) {
        console.error(`人気順抽出エラー: ${err.message}`);
      }
    });
    console.log('抽出した人気順:', popularities);

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
          popularity: i < popularities.length ? popularities[i] : 0
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
          popularity: i < popularities.length ? popularities[i] : 0
        });
      }
    }

    console.log('整形後の払戻情報:', result);
    return result;
  } catch (error) {
    console.error('払戻金情報の抽出中にエラーが発生しました:', error);
    console.error('スタックトレース:', error.stack);
    return [];
  }
}

/**
 * 当日のJRAレース一覧を取得する
 */
async function getTodayRaces() {
  try {
    console.log('JRAレース一覧を取得しています...');
    
    // 当日の日付
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    console.log(`今日の日付: ${year}/${month}/${day}`);
    
    // URLバリエーション
    const urls = [
      `https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=${year}${month}${day}`
    ];
    
    let races = [];
    
    for (const url of urls) {
      console.log(`JRAスクレイピングURL: ${url}`);
      
      try {
        const response = await axios.get(url, {
          headers: {
            'Accept-Charset': 'utf-8',
            'Accept-Language': 'ja-JP,ja;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          responseType: 'arraybuffer',
          timeout: 10000
        });
        
        const html = iconv.decode(response.data, 'EUC-JP');
        const $ = cheerio.load(html);
        
        console.log('ページタイトル:', $('title').text().trim());
        
        // 方法1: すべてのリンクから直接レースIDを抽出
        const foundRaces = [];
        
        // レースへのリンクを探す (shutuba.html, denma.html, race.html などを含むリンク)
        $('a').each((i, link) => {
          const href = $(link).attr('href');
          if (!href) return;
          
          // 複数のパターンを試す
          const raceIdPatterns = [
            /race\/shutuba\.html\?race_id=(\d{12})/,
            /race\/denma\.html\?race_id=(\d{12})/,
            /race\/race\.html\?race_id=(\d{12})/
          ];
          
          let raceId = null;
          for (const pattern of raceIdPatterns) {
            const match = href.match(pattern);
            if (match && match[1]) {
              raceId = match[1];
              break;
            }
          }
          
          if (!raceId || raceId.length !== 12) return;
          
          // JRAのレースIDパターンを持つか確認
          // 5-6桁目が01-10の場合はJRA
          const venueCode = raceId.substring(4, 6);
          const isJRA = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].includes(venueCode);
          
          if (!isJRA) return;
          
          // レース番号を抽出（末尾2桁）
          const raceNumber = raceId.slice(-2).replace(/^0/, '');
          
          // レース名と時間の取得
          let raceName = '';
          let raceTime = '00:00';
          
          // リンクのテキストを確認
          const linkText = $(link).text().trim();
          if (linkText) {
            // リンクテキストがレース名の場合もある
            raceName = linkText;
          }
          
          // 親要素から情報を抽出
          let parentEl = $(link).parent();
          for (let i = 0; i < 3; i++) { // 最大3階層まで遡る
            const parentText = parentEl.text().trim();
            
            // レース番号の表記を探す
            if (!raceName && parentText.includes('R')) {
              const raceNameMatch = parentText.match(/(\d+)R\s*(.*?)(?:\s|$)/);
              if (raceNameMatch) {
                raceName = raceNameMatch[2] || `${raceNameMatch[1]}R`;
              }
            }
            
            // 時間表記を探す
            const timeMatch = parentText.match(/(\d+):(\d+)/);
            if (timeMatch) {
              raceTime = `${timeMatch[1]}:${timeMatch[2]}`;
            }
            
            parentEl = parentEl.parent(); // 一階層上に移動
          }
          
          // 会場名を取得
          const trackName = getTrackNameFromRaceId(raceId);
          
          // レース情報を保存
          foundRaces.push({
            id: raceId,
            track: trackName,
            number: raceNumber,
            name: raceName || `${raceNumber}R`,
            time: raceTime,
            type: 'jra',
            date: `${year}/${month}/${day}`,
            isCompleted: false
          });
        });
        
        // 重複を除去して追加
        for (const race of foundRaces) {
          if (!races.some(r => r.id === race.id)) {
            races.push(race);
          }
        }
        
        if (foundRaces.length > 0) {
          console.log(`${url} から ${foundRaces.length} 件のレースを取得`);
          break;
        }
      } catch (urlError) {
        console.log(`${url} からの取得中にエラー:`, urlError.message);
      }
    }
    
    // レースが一つも見つからない場合は、HTMLからレースIDを直接抽出
    if (races.length === 0) {
      console.log('レースが見つかりませんでした。HTMLからレースIDを直接抽出します...');
      
      for (const url of urls) {
        try {
          const response = await axios.get(url, {
            headers: {
              'Accept-Charset': 'utf-8',
              'Accept-Language': 'ja-JP,ja;q=0.9',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            responseType: 'arraybuffer'
          });
          
          const html = iconv.decode(response.data, 'EUC-JP');
          
          // HTMLテキスト全体からレースIDを抽出
          const raceIdMatches = html.match(/race_id=(\d{12})/g);
          if (raceIdMatches && raceIdMatches.length > 0) {
            console.log(`HTML内に ${raceIdMatches.length} 件のレースID候補を発見`);
            
            const uniqueIds = [...new Set(raceIdMatches.map(m => m.replace('race_id=', '')))];
            const seenIds = new Set();
            
            for (const id of uniqueIds) {
              // JRAのレースIDパターンを持つか確認
              const venueCode = id.substring(4, 6);
              const isJRA = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].includes(venueCode);
              
              if (!isJRA) continue;
              
              // レース番号を抽出（末尾2桁）
              const raceNumber = id.slice(-2).replace(/^0/, '');
              
              if (!seenIds.has(id)) {
                seenIds.add(id);
                races.push({
                  id: id,
                  track: getTrackNameFromRaceId(id),
                  number: raceNumber,
                  name: `${raceNumber}R`,
                  time: '00:00',
                  type: 'jra',
                  date: `${year}/${month}/${day}`,
                  isCompleted: false
                });
              }
            }
            
            if (races.length > 0) {
              console.log(`HTML構造解析から ${races.length} 件のレースを抽出`);
              break;
            }
          }
        } catch (error) {
          console.log(`${url} のHTML解析中にエラー:`, error.message);
        }
      }
    }
    
    // 重複を除去して会場・レース番号でソート
    const uniqueRaces = [];
    const seenIds = new Set();
    
    for (const race of races) {
      if (!seenIds.has(race.id)) {
        seenIds.add(race.id);
        uniqueRaces.push(race);
      }
    }
    
    // レースを会場とレース番号でソート
    uniqueRaces.sort((a, b) => {
      if (a.track !== b.track) {
        return a.track.localeCompare(b.track);
      }
      return parseInt(a.number) - parseInt(b.number);
    });
    
    console.log(`JRAレース一覧: ${uniqueRaces.length}件取得`);
    return uniqueRaces;
  } catch (error) {
    console.error('JRAレース一覧の取得中にエラーが発生しました:', error);
    return [];
  }
}

module.exports = {
  getTodayRaces,
  getRaceDetails,
  getRaceResult
};