// date-scraper.js - 日付指定でのレーススクレイピング

const admin = require('firebase-admin');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const path = require('path');
const fs = require('fs');

// サービスアカウントキーの読み込み
// サービスアカウントキーのパスを環境に合わせて調整してください
const serviceAccountPath = path.resolve(__dirname, './server/serviceAccountKey.json');
const serviceAccount = require(serviceAccountPath);

// Firebase Adminの初期化
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
console.log('Firebase Admin SDKが初期化されました');

// 競馬場コード変換テーブル
const venueCodeMap = {
    // JRA
    '01': '札幌', '02': '函館', '03': '福島', '04': '新潟', 
    '05': '東京', '06': '中山', '07': '中京', '08': '京都', 
    '09': '阪神', '10': '小倉',
    // 地方競馬（NAR）
    '31': '北見', '32': '岩見沢', '33': '帯広', '34': '旭川', 
    '35': '盛岡', '36': '水沢', '37': '上山', '38': '三条', 
    '39': '足利', '40': '宇都宮', '41': '高崎', '42': '浦和', 
    '43': '船橋', '44': '大井', '45': '川崎', '46': '金沢', 
    '47': '笠松', '48': '名古屋', '49': '(未使用)', '50': '園田', 
    '51': '姫路', '52': '益田', '53': '福山', '54': '高知', 
    '55': '佐賀', '56': '荒尾', '57': '中津', '58': '札幌(地方)', 
    '59': '函館(地方)', '60': '新潟(地方)', '61': '中京(地方)', '65': '帯広(ば)'
};

// 引数から日付を取得
let targetDate = '';
if (process.argv.length > 2) {
  targetDate = process.argv[2];
} else {
  // 日付が指定されなければ今日の日付を使用
  const today = new Date();
  const year = today.getFullYear();
  const month = (today.getMonth() + 1).toString().padStart(2, '0');
  const day = today.getDate().toString().padStart(2, '0');
  targetDate = `${year}${month}${day}`;
}

console.log(`指定された日付: ${targetDate}`);

// メイン処理
async function main() {
  try {
    console.log(`${targetDate}のレースデータスクレイピングを開始します...`);
    const startTime = Date.now();
    
    // JRA中央競馬の処理
    await scrapeJraRacesByDate(targetDate);
    
    // 地方競馬（NAR）の処理
    await scrapeNarRacesByDate(targetDate);
    
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000;
    console.log(`${targetDate}のデータ更新が完了しました。実行時間: ${executionTime}秒`);
    
    // プロセスを正常終了
    process.exit(0);
  } catch (error) {
    console.error('エラーが発生しました:', error);
    // エラーで終了
    process.exit(1);
  }
}

// JRA中央競馬の日付指定スクレイピング
async function scrapeJraRacesByDate(date) {
  console.log(`JRA中央競馬の${date}のレース情報を取得中...`);
  
  try {
    // 日付指定でレース一覧ページを取得
    const response = await axios.get(`https://race.netkeiba.com/top/race_list.html?kaisai_date=${date}`, {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const html = iconv.decode(response.data, 'shift_jis');
    const $ = cheerio.load(html);
    
    // 日付のレース情報
    const dateRaces = {
      date: date,
      venues: [],
      lastUpdated: admin.firestore.Timestamp.now()
    };
    
    // 会場ごとのセクションを処理
    $('.RaceList_DataList').each((i, section) => {
      const venueInfo = $(section).find('.RaceList_DataHead a');
      const venueUrl = venueInfo.attr('href') || '';
      const venueName = venueInfo.text().trim();
      
      // 会場コードを抽出
      let venueCode = '';
      const venueMatch = venueUrl.match(/jyoCD=(\w+)/);
      if (venueMatch) {
        venueCode = venueMatch[1];
      } else {
        // コードが抽出できない場合はスキップ
        return;
      }
      
      const races = [];
      
      // 会場のレース一覧を取得
      $(section).find('.RaceList_Item').each((j, raceItem) => {
        const raceLink = $(raceItem).find('a').attr('href') || '';
        const raceName = $(raceItem).find('.RaceName').text().trim();
        const raceNumber = $(raceItem).find('.Race_Num').text().trim().replace(/R/g, '');
        const startTime = $(raceItem).find('.RaceTime').text().trim();
        
        // レースIDを抽出
        const raceIdMatch = raceLink.match(/race_id=(\w+)/);
        if (raceIdMatch) {
          const raceId = raceIdMatch[1];
          races.push({
            id: raceId,
            number: parseInt(raceNumber, 10) || 0,
            name: raceName,
            startTime: startTime
          });
        }
      });
      
      if (races.length > 0) {
        dateRaces.venues.push({
          code: venueCode,
          name: venueCodeMap[venueCode] || venueName,
          races: races
        });
      }
    });
    
    // Firestoreに保存
    if (dateRaces.venues.length > 0) {
      await db.collection('racing_data').doc(`jra_date_${date}`).set(dateRaces);
      console.log(`JRAの${date}のレース情報をFirestoreに保存しました (${dateRaces.venues.length}会場)`);
      
      // 各レースの詳細情報も取得
      for (const venue of dateRaces.venues) {
        console.log(`${venue.name}の詳細情報を取得中...`);
        for (const race of venue.races) {
          await scrapeRaceDetails('jra', venue.code, race.id);
        }
      }
    } else {
      console.log(`JRAの${date}にはレースが登録されていません`);
    }
    
    return dateRaces;
  } catch (error) {
    console.error(`JRAの${date}のレース情報取得に失敗しました:`, error);
    throw error;
  }
}

// NAR地方競馬の日付指定スクレイピング
async function scrapeNarRacesByDate(date) {
  console.log(`NAR地方競馬の${date}のレース情報を取得中...`);
  
  try {
    // 日付指定でレース一覧ページを取得
    const response = await axios.get(`https://nar.netkeiba.com/top/race_list.html?kaisai_date=${date}`, {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const html = iconv.decode(response.data, 'shift_jis');
    const $ = cheerio.load(html);
    
    // 日付のレース情報
    const dateRaces = {
      date: date,
      venues: [],
      lastUpdated: admin.firestore.Timestamp.now()
    };
    
    // 会場ごとのセクションを処理
    $('.RaceList_DataList').each((i, section) => {
      const venueInfo = $(section).find('.RaceList_DataHead a');
      const venueUrl = venueInfo.attr('href') || '';
      const venueName = venueInfo.text().trim();
      
      // 会場コードを抽出
      let venueCode = '';
      const venueMatch = venueUrl.match(/jyoCD=(\w+)/);
      if (venueMatch) {
        venueCode = venueMatch[1];
      } else {
        // コードが抽出できない場合はスキップ
        return;
      }
      
      const races = [];
      
      // 会場のレース一覧を取得
      $(section).find('.RaceList_Item').each((j, raceItem) => {
        const raceLink = $(raceItem).find('a').attr('href') || '';
        const raceName = $(raceItem).find('.RaceName').text().trim();
        const raceNumber = $(raceItem).find('.Race_Num').text().trim().replace(/R/g, '');
        const startTime = $(raceItem).find('.RaceTime').text().trim();
        
        // レースIDを抽出
        const raceIdMatch = raceLink.match(/race_id=(\w+)/);
        if (raceIdMatch) {
          const raceId = raceIdMatch[1];
          races.push({
            id: raceId,
            number: parseInt(raceNumber, 10) || 0,
            name: raceName,
            startTime: startTime
          });
        }
      });
      
      if (races.length > 0) {
        dateRaces.venues.push({
          code: venueCode,
          name: venueCodeMap[venueCode] || venueName,
          races: races
        });
      }
    });
    
    // Firestoreに保存
    if (dateRaces.venues.length > 0) {
      await db.collection('racing_data').doc(`nar_date_${date}`).set(dateRaces);
      console.log(`NARの${date}のレース情報をFirestoreに保存しました (${dateRaces.venues.length}会場)`);
      
      // 各レースの詳細情報も取得
      for (const venue of dateRaces.venues) {
        console.log(`${venue.name}の詳細情報を取得中...`);
        for (const race of venue.races) {
          await scrapeRaceDetails('nar', venue.code, race.id);
        }
      }
    } else {
      console.log(`NARの${date}にはレースが登録されていません`);
    }
    
    return dateRaces;
  } catch (error) {
    console.error(`NARの${date}のレース情報取得に失敗しました:`, error);
    throw error;
  }
}

// レース詳細情報を取得・保存する関数
async function scrapeRaceDetails(type, venueCode, raceId) {
  console.log(`${type.toUpperCase()}レース詳細を取得中... 会場:${venueCode} レースID:${raceId}`);
  
  try {
    // リクエスト間隔を空ける（サーバー負荷軽減）
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // URIのドメイン部分を決定
    const domain = type === 'jra' ? 'race.netkeiba.com' : 'nar.netkeiba.com';
    
    // 出馬表ページを取得
    const entryResponse = await axios.get(`https://${domain}/race/shutuba.html?race_id=${raceId}`, {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const entryHtml = iconv.decode(entryResponse.data, 'shift_jis');
    const entryPage = cheerio.load(entryHtml);
    
    // オッズページを取得
    const oddsResponse = await axios.get(`https://${domain}/odds/index.html?race_id=${raceId}`, {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const oddsHtml = iconv.decode(oddsResponse.data, 'shift_jis');
    const oddsPage = cheerio.load(oddsHtml);
    
    // 三連複ページを取得
    const trioResponse = await axios.get(`https://${domain}/odds/index.html?race_id=${raceId}&rf=shutuba_submenu&type=b3`, {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const trioHtml = iconv.decode(trioResponse.data, 'shift_jis');
    const trioPage = cheerio.load(trioHtml);
    
    // 基本レース情報を抽出
    const raceInfo = scrapeRaceInfo(entryPage);
    
    // 出走馬情報を抽出
    const horses = scrapeHorses(entryPage, oddsPage);
    
    // オッズ情報を抽出
    const oddsInfo = {
      win: scrapeWinOdds(oddsPage),
      place: scrapePlaceOdds(oddsPage),
      trio: scrapeTrioOdds(trioPage)
    };
    
    const raceDetails = {
      raceInfo: raceInfo,
      horses: horses,
      oddsInfo: oddsInfo,
      venueCode: venueCode,
      venueName: venueCodeMap[venueCode] || '',
      raceId: raceId,
      lastUpdated: admin.firestore.Timestamp.now()
    };
    
    // Firestoreに保存
    const docRef = `${type}_race_details_${venueCode}_${raceId}`;
    await db.collection('racing_data').doc(docRef).set(raceDetails);
    
    console.log(`${type.toUpperCase()}のレース詳細を保存しました: ${venueCode} ${raceId}`);
    return raceDetails;
  } catch (error) {
    console.error(`レース詳細の取得に失敗しました: ${type} ${venueCode} ${raceId}`, error);
    return null;
  }
}

// レース基本情報を抽出
function scrapeRaceInfo(entryPage) {
  // レースデータを抽出
  const raceData = entryPage('.RaceData01').text().trim();
  const raceClass = entryPage('.RaceData02').text().trim();
  
  // 正規表現でレースデータを抽出
  const distanceMatch = raceData.match(/(\d+)m/);
  const distance = distanceMatch ? parseInt(distanceMatch[1]) : null;
  
  const courseTypeMatch = raceData.match(/(芝|ダート)/);
  const courseType = courseTypeMatch ? courseTypeMatch[1] : null;
  
  const conditionMatch = raceData.match(/(良|稍重|重|不良)/);
  const condition = conditionMatch ? conditionMatch[1] : null;
  
  // レース名と発走時間
  const raceName = entryPage('.RaceName').text().trim();
  const startTime = entryPage('.RaceData01 .RaceTime').text().trim().replace('発走 ', '');
  
  return {
    raceName: raceName,
    startTime: startTime,
    distance: distance,
    courseType: courseType,
    condition: condition,
    raceClass: raceClass,
    prizeInfo: entryPage('.RaceData02').next().text().trim()
  };
}

// 出走馬情報を抽出
function scrapeHorses(entryPage, oddsPage) {
  const horses = [];
  
  // 出馬表からデータを抽出
  entryPage('.Shutuba_Table tbody tr').each((i, elem) => {
    const $elem = cheerio(elem);
    
    // 取消馬の判定
    const isCanceled = $elem.hasClass('Cancel');
    
    // 枠番を取得
    const frameNumber = parseInt($elem.find('td').first().text().trim()) || 0;
    
    // 馬番を取得
    const number = parseInt($elem.find('td').eq(1).text().trim()) || 0;
    
    // 馬名を取得
    const horseName = $elem.find('.HorseName a').text().trim();
    
    // 性別と年齢を抽出
    const genderAgeText = $elem.find('.Barei').text().trim();
    let gender = '', age = '';
    if (genderAgeText) {
      gender = genderAgeText.substring(0, 1); // 牡/牝/セ
      age = genderAgeText.substring(1);
    }
    
    // 騎手名を取得
    const jockey = $elem.find('.Jockey a').text().trim();
    
    // 斤量を取得
    const weight = $elem.find('td').eq(5).text().trim();
    
    // 厩舎を取得
    const stableLabel = $elem.find('.Trainer span').text().trim();
    const trainer = $elem.find('.Trainer a').text().trim();
    
    // 馬体重を取得
    const bodyWeightText = $elem.find('.Weight').text().trim();
    let bodyWeight = '', weightDiff = '';
    
    if (bodyWeightText) {
      const weightMatch = bodyWeightText.match(/(\d+)(\((.+)\))?/);
      if (weightMatch) {
        bodyWeight = weightMatch[1];
        weightDiff = weightMatch[3] || '';
      }
    }
    
    // オッズ情報を取得
    let odds = null;
    if (!isCanceled) {
      const horseRow = oddsPage(`tr[id="tr_${number}"]`);
      if (horseRow.length > 0) {
        const winOdds = parseFloat(horseRow.find('.Odds.Odds_Ninki').text().trim()) || null;
        const popularity = parseInt(horseRow.find('.Popular_Ninki').text().trim()) || null;
        const placeOdds = horseRow.find('.Odds_Fukusho').text().trim() || null;
        
        odds = {
          win: winOdds,
          place: placeOdds,
          popularity: popularity
        };
      }
    }
    
    horses.push({
      number: number,
      name: horseName,
      frameNumber: frameNumber,
      gender: gender,
      age: age,
      weight: weight,
      jockey: jockey,
      stable: stableLabel,
      trainer: trainer,
      bodyWeight: bodyWeight,
      weightDiff: weightDiff,
      odds: odds,
      status: isCanceled ? 'cancel' : 'normal'
    });
  });
  
  return horses;
}

// 単勝オッズの抽出
function scrapeWinOdds(oddsPage) {
  const winOdds = [];
  
  oddsPage('tr[id^="tr_"]').each((i, elem) => {
    const $elem = cheerio(elem);
    
    // 取消馬は除外
    if ($elem.hasClass('Cancel')) {
      return;
    }
    
    const horseNumber = parseInt($elem.find('.Waku').text().trim()) || 0;
    const horseName = $elem.find('.HorseName a').text().trim();
    const odds = parseFloat($elem.find('.Odds.Odds_Ninki').text().trim()) || null;
    const popularity = parseInt($elem.find('.Popular_Ninki').text().trim()) || null;
    
    winOdds.push({
      number: horseNumber,
      name: horseName,
      odds: odds,
      popularity: popularity
    });
  });
  
  return winOdds;
}

// 複勝オッズの抽出
function scrapePlaceOdds(oddsPage) {
  const placeOdds = [];
  
  oddsPage('tr[id^="tr_"]').each((i, elem) => {
    const $elem = cheerio(elem);
    
    // 取消馬は除外
    if ($elem.hasClass('Cancel')) {
      return;
    }
    
    const horseNumber = parseInt($elem.find('.Waku').text().trim()) || 0;
    const horseName = $elem.find('.HorseName a').text().trim();
    const odds = $elem.find('.Odds_Fukusho').text().trim() || null;
    
    placeOdds.push({
      number: horseNumber,
      name: horseName,
      odds: odds
    });
  });
  
  return placeOdds;
}

// 三連複オッズの抽出
function scrapeTrioOdds(trioPage) {
  const trioOdds = [];
  
  trioPage('tr[id^="tr_"]').each((i, elem) => {
    const $elem = cheerio(elem);
    
    const combination = $elem.find('td:nth-child(1)').text().trim();
    const odds = parseFloat($elem.find('td:nth-child(2)').text().trim()) || null;
    const popularity = parseInt($elem.find('td:nth-child(3)').text().trim()) || null;
    
    trioOdds.push({
      combination: combination,
      odds: odds,
      popularity: popularity
    });
  });
  
  return trioOdds;
}

// スクリプト実行
main();