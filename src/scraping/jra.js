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
    // 当日のレース一覧ページを取得
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    const url = `https://race.netkeiba.com/top/race_list.html?kaisai_date=${year}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`;

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
    $('.RaceList_DataItem').each((i, element) => {
      try {
        const track = $(element).find('.RaceList_DataTitle').text().trim();

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
              type: 'jra',
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

    console.log(`JRAレース一覧: ${races.length}件取得`);
    return races;
  } catch (error) {
    console.error('JRAレース一覧の取得中にエラーが発生しました:', error);
    return [];
  }
}

// テスト用のスクレイピング関数を追加
async function testScrapeRaceResult(raceId) {
  try {
    console.log(`テストスクレイピング開始: ${raceId}`);
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

    // 一部のHTMLコードをデバッグ表示
    console.log('ページタイトル:', $('title').text());
    
    // 単勝セレクタの出力
    console.log('単勝セレクタ確認:');
    console.log('単勝の数:', $(selectors.tansho.number).length);
    console.log('単勝の情報:');
    $(selectors.tansho.number).each((i, elem) => {
      console.log(`[${i}] テキスト: "${$(elem).text().trim()}"`);
    });
    
    // 払戻金をテスト
    console.log('払戻金テスト:');
    $(selectors.tansho.pay).each((i, elem) => {
      console.log(`[${i}] HTML: "${$(elem).html()}"`);
      console.log(`[${i}] テキスト: "${$(elem).text().trim()}"`);
    });
    
    return {
      success: true,
      message: 'テスト完了'
    };
  } catch (error) {
    console.error('テストスクレイピング中にエラーが発生しました:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  getTodayRaces,
  getRaceDetails,
  getRaceResult,
  testScrapeRaceResult
};