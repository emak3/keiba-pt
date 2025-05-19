// server-scraper.js - netkeibaからデータをスクレイピングしてFirebaseに保存するスクリプト
// 独自サーバー上で実行することを想定しています

const admin = require('firebase-admin');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite'); // 文字コード変換用
const path = require('path');
const fs = require('fs');

// サービスアカウントキーの読み込み
// サービスアカウントキーのパスを環境に合わせて調整してください
const serviceAccountPath = path.resolve(__dirname, './serviceAccountKey.json');
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

// メイン処理
async function main() {
  try {
    console.log('データスクレイピングを開始します...');
    const startTime = Date.now();
    
    // JRA中央競馬の処理
    await scrapeJraRaces();
    
    // 地方競馬（NAR）の処理
    await scrapeNarRaces();
    
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000;
    console.log(`データ更新が完了しました。実行時間: ${executionTime}秒`);
    
    // プロセスを正常終了
    process.exit(0);
  } catch (error) {
    console.error('エラーが発生しました:', error);
    // エラーで終了
    process.exit(1);
  }
}

// JRA中央競馬のスクレイピング
async function scrapeJraRaces() {
  console.log('JRA中央競馬の情報を取得中...');
  
  try {
    // 開催中の会場を取得
    const jraVenues = await scrapeJraVenues();
    
    // 会場情報をFirestoreに保存
    await db.collection('racing_data').doc('jra_venues').set({
      venues: jraVenues,
      lastUpdated: admin.firestore.Timestamp.now()
    });
    
    // 各会場のレース情報を取得・保存
    for (const venue of jraVenues) {
      console.log(`JRA会場「${venueCodeMap[venue.code] || venue.name}」の処理を開始`);
      const races = await scrapeJraRaceList(venue.code);
      
      // レース一覧を保存
      await db.collection('racing_data').doc(`jra_races_${venue.code}`).set({
        venueCode: venue.code,
        venueName: venueCodeMap[venue.code] || venue.name,
        races: races,
        lastUpdated: admin.firestore.Timestamp.now()
      });
      
      // 各レースの詳細を取得・保存
      for (const race of races) {
        console.log(`  レース: ${race.number}R ${race.name}の情報を取得中...`);
        const raceDetails = await scrapeJraRaceDetails(race.id);
        
        // レース詳細を保存
        await db.collection('racing_data').doc(`jra_race_details_${venue.code}_${race.id}`).set({
          ...raceDetails,
          venueCode: venue.code,
          venueName: venueCodeMap[venue.code] || venue.name,
          raceId: race.id,
          raceName: race.name,
          raceNumber: race.number,
          lastUpdated: admin.firestore.Timestamp.now()
        });
      }
    }
    
    console.log('JRA中央競馬の情報取得が完了しました');
  } catch (error) {
    console.error('JRA中央競馬の情報取得に失敗しました:', error);
    throw error;
  }
}

// 地方競馬（NAR）のスクレイピング
async function scrapeNarRaces() {
  console.log('地方競馬（NAR）の情報を取得中...');
  
  try {
    // 開催中の会場を取得
    const narVenues = await scrapeNarVenues();
    
    // 会場情報をFirestoreに保存
    await db.collection('racing_data').doc('nar_venues').set({
      venues: narVenues,
      lastUpdated: admin.firestore.Timestamp.now()
    });
    
    // 各会場のレース情報を取得・保存
    for (const venue of narVenues) {
      console.log(`NAR会場「${venueCodeMap[venue.code] || venue.name}」の処理を開始`);
      const races = await scrapeNarRaceList(venue.code);
      
      // レース一覧を保存
      await db.collection('racing_data').doc(`nar_races_${venue.code}`).set({
        venueCode: venue.code,
        venueName: venueCodeMap[venue.code] || venue.name,
        races: races,
        lastUpdated: admin.firestore.Timestamp.now()
      });
      
      // 各レースの詳細を取得・保存
      for (const race of races) {
        console.log(`  レース: ${race.number}R ${race.name}の情報を取得中...`);
        const raceDetails = await scrapeNarRaceDetails(race.id);
        
        // レース詳細を保存
        await db.collection('racing_data').doc(`nar_race_details_${venue.code}_${race.id}`).set({
          ...raceDetails,
          venueCode: venue.code,
          venueName: venueCodeMap[venue.code] || venue.name,
          raceId: race.id,
          raceName: race.name,
          raceNumber: race.number,
          lastUpdated: admin.firestore.Timestamp.now()
        });
      }
    }
    
    console.log('地方競馬（NAR）の情報取得が完了しました');
  } catch (error) {
    console.error('地方競馬（NAR）の情報取得に失敗しました:', error);
    throw error;
  }
}

// JRA中央競馬の開催会場取得
async function scrapeJraVenues() {
  console.log('JRA中央競馬の開催会場を取得中...');
  
  try {
    // 文字化け対策のためレスポンスタイプを設定
    const response = await axios.get('https://race.netkeiba.com/top/', {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const html = iconv.decode(response.data, 'shift_jis');
    const $ = cheerio.load(html);
    
    const venues = [];
    
    // 会場情報を抽出
    $('.RaceKaisai_Inner ul li').each((i, elem) => {
      const venueLink = $(elem).find('a').attr('href');
      const venueName = $(elem).find('a').text().trim();
      
      // URLからvenue_idを抽出
      const venueIdMatch = venueLink.match(/jyoCD=(\w+)/);
      if (venueIdMatch) {
        const venueId = venueIdMatch[1];
        venues.push({
          code: venueId,
          name: venueName
        });
      }
    });
    
    console.log(`${venues.length}件のJRA会場情報を取得しました`);
    return venues;
  } catch (error) {
    console.error('JRA会場情報の取得に失敗しました:', error);
    throw error;
  }
}

// 地方競馬（NAR）の開催会場取得
async function scrapeNarVenues() {
  console.log('地方競馬（NAR）の開催会場を取得中...');
  
  try {
    // 文字化け対策のためレスポンスタイプを設定
    const response = await axios.get('https://nar.netkeiba.com/top/', {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const html = iconv.decode(response.data, 'shift_jis');
    const $ = cheerio.load(html);
    
    const venues = [];
    
    // 会場情報を抽出（地方競馬用のセレクタ）
    $('.RaceKaisai_Inner ul li').each((i, elem) => {
      const venueLink = $(elem).find('a').attr('href');
      const venueName = $(elem).find('a').text().trim();
      
      // URLからvenue_idを抽出
      const venueIdMatch = venueLink.match(/jyoCD=(\w+)/);
      if (venueIdMatch) {
        const venueId = venueIdMatch[1];
        venues.push({
          code: venueId,
          name: venueName
        });
      }
    });
    
    console.log(`${venues.length}件の地方競馬会場情報を取得しました`);
    return venues;
  } catch (error) {
    console.error('地方競馬会場情報の取得に失敗しました:', error);
    throw error;
  }
}

// JRA中央競馬のレース一覧取得
async function scrapeJraRaceList(venueCode) {
  console.log(`JRA会場（${venueCode}）のレース一覧を取得中...`);
  
  try {
    // 文字化け対策のためレスポンスタイプを設定
    const response = await axios.get(`https://race.netkeiba.com/top/race_list.html?jyoCD=${venueCode}`, {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const html = iconv.decode(response.data, 'shift_jis');
    const $ = cheerio.load(html);
    
    const races = [];
    
    // レース情報を抽出
    $('.RaceList_Box .RaceList_Item').each((i, elem) => {
      const raceLink = $(elem).find('a').attr('href');
      const raceName = $(elem).find('.RaceName').text().trim();
      const raceNumber = $(elem).find('.Race_Num').text().trim().replace(/R/g, '');
      const startTime = $(elem).find('.RaceTime').text().trim();
      
      // URLからrace_idを抽出
      const raceIdMatch = raceLink.match(/race_id=(\w+)/);
      if (raceIdMatch) {
        const raceId = raceIdMatch[1];
        races.push({
          id: raceId,
          number: parseInt(raceNumber),
          name: raceName,
          startTime: startTime
        });
      }
    });
    
    console.log(`${races.length}件のJRAレース情報を取得しました`);
    return races;
  } catch (error) {
    console.error(`JRA会場（${venueCode}）のレース一覧の取得に失敗しました:`, error);
    throw error;
  }
}

// 地方競馬（NAR）のレース一覧取得
async function scrapeNarRaceList(venueCode) {
  console.log(`地方競馬会場（${venueCode}）のレース一覧を取得中...`);
  
  try {
    // 文字化け対策のためレスポンスタイプを設定
    const response = await axios.get(`https://nar.netkeiba.com/top/race_list.html?jyoCD=${venueCode}`, {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const html = iconv.decode(response.data, 'shift_jis');
    const $ = cheerio.load(html);
    
    const races = [];
    
    // レース情報を抽出（地方競馬用のセレクタ）
    $('.RaceList_Box .RaceList_Item').each((i, elem) => {
      const raceLink = $(elem).find('a').attr('href');
      const raceName = $(elem).find('.RaceName').text().trim();
      const raceNumber = $(elem).find('.Race_Num').text().trim().replace(/R/g, '');
      const startTime = $(elem).find('.RaceTime').text().trim();
      
      // URLからrace_idを抽出
      const raceIdMatch = raceLink.match(/race_id=(\w+)/);
      if (raceIdMatch) {
        const raceId = raceIdMatch[1];
        races.push({
          id: raceId,
          number: parseInt(raceNumber),
          name: raceName,
          startTime: startTime
        });
      }
    });
    
    console.log(`${races.length}件の地方競馬レース情報を取得しました`);
    return races;
  } catch (error) {
    console.error(`地方競馬会場（${venueCode}）のレース一覧の取得に失敗しました:`, error);
    throw error;
  }
}

// JRA中央競馬のレース詳細取得
async function scrapeJraRaceDetails(raceId) {
  console.log(`JRAレース詳細を取得中... レースID: ${raceId}`);
  
  try {
    // リクエスト間隔を空ける（サーバー負荷軽減）
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 出馬表ページを取得
    const entryResponse = await axios.get(`https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`, {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const entryHtml = iconv.decode(entryResponse.data, 'shift_jis');
    const entryPage = cheerio.load(entryHtml);
    
    // オッズページを取得
    const oddsResponse = await axios.get(`https://race.netkeiba.com/odds/index.html?race_id=${raceId}`, {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const oddsHtml = iconv.decode(oddsResponse.data, 'shift_jis');
    const oddsPage = cheerio.load(oddsHtml);
    
    // 三連複ページを取得
    const trioResponse = await axios.get(`https://race.netkeiba.com/odds/index.html?race_id=${raceId}&rf=shutuba_submenu&type=b3`, {
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
    
    return {
      raceInfo: raceInfo,
      horses: horses,
      oddsInfo: oddsInfo
    };
  } catch (error) {
    console.error(`JRAレース詳細の取得に失敗しました... レースID: ${raceId}:`, error);
    throw error;
  }
}

// 地方競馬（NAR）のレース詳細取得
async function scrapeNarRaceDetails(raceId) {
  console.log(`地方競馬レース詳細を取得中... レースID: ${raceId}`);
  
  try {
    // リクエスト間隔を空ける（サーバー負荷軽減）
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 出馬表ページを取得
    const entryResponse = await axios.get(`https://nar.netkeiba.com/race/shutuba.html?race_id=${raceId}`, {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const entryHtml = iconv.decode(entryResponse.data, 'shift_jis');
    const entryPage = cheerio.load(entryHtml);
    
    // オッズページを取得
    const oddsResponse = await axios.get(`https://nar.netkeiba.com/odds/index.html?race_id=${raceId}`, {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const oddsHtml = iconv.decode(oddsResponse.data, 'shift_jis');
    const oddsPage = cheerio.load(oddsHtml);
    
    // 三連複ページを取得（地方競馬用）
    const trioResponse = await axios.get(`https://nar.netkeiba.com/odds/index.html?race_id=${raceId}&rf=shutuba_submenu&type=b3`, {
      responseType: 'arraybuffer'
    });
    
    // Shift-JISからUTF-8に変換
    const trioHtml = iconv.decode(trioResponse.data, 'shift_jis');
    const trioPage = cheerio.load(trioHtml);
    
    // 基本レース情報を抽出（地方競馬用にセレクタ調整）
    const raceInfo = scrapeRaceInfoNar(entryPage);
    
    // 出走馬情報を抽出（地方競馬用にセレクタ調整）
    const horses = scrapeHorsesNar(entryPage, oddsPage);
    
    // オッズ情報を抽出（地方競馬用にセレクタ調整）
    const oddsInfo = {
      win: scrapeWinOddsNar(oddsPage),
      place: scrapePlaceOddsNar(oddsPage),
      trio: scrapeTrioOddsNar(trioPage)
    };
    
    return {
      raceInfo: raceInfo,
      horses: horses,
      oddsInfo: oddsInfo
    };
  } catch (error) {
    console.error(`地方競馬レース詳細の取得に失敗しました... レースID: ${raceId}:`, error);
    throw error;
  }
}

// レース基本情報を抽出（JRA）
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

// レース基本情報を抽出（NAR）
function scrapeRaceInfoNar(entryPage) {
  // レースデータを抽出（地方競馬用セレクタ）
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

// 出走馬情報を抽出（JRA）
function scrapeHorses(entryPage, oddsPage) {
  const horses = [];
  
  // 出馬表からデータを抽出
  entryPage('.Shutuba_Table tbody tr').each((i, elem) => {
    const $elem = cheerio(elem);
    
    // 取消馬の判定
    const isCanceled = $elem.hasClass('Cancel');
    
    // 枠番を取得
    const frameNumber = parseInt($elem.find('td').first().text().trim());
    
    // 馬番を取得
    const number = parseInt($elem.find('td').eq(1).text().trim());
    
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

// 出走馬情報を抽出（NAR）
function scrapeHorsesNar(entryPage, oddsPage) {
  const horses = [];
  
  // 出馬表からデータを抽出（地方競馬用セレクタ）
  entryPage('.Shutuba_Table tbody tr').each((i, elem) => {
    const $elem = cheerio(elem);
    
    // 取消馬の判定
    const isCanceled = $elem.hasClass('Cancel');
    
    // 枠番を取得
    const frameNumber = parseInt($elem.find('td').first().text().trim());
    
    // 馬番を取得
    const number = parseInt($elem.find('td').eq(1).text().trim());
    
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

// 単勝オッズの抽出（JRA）
function scrapeWinOdds(oddsPage) {
  const winOdds = [];
  
  oddsPage('tr[id^="tr_"]').each((i, elem) => {
    const $elem = cheerio(elem);
    
    // 取消馬は除外
    if ($elem.hasClass('Cancel')) {
      return;
    }
    
    const horseNumber = parseInt($elem.find('.Waku').text().trim());
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

// 単勝オッズの抽出（NAR）
function scrapeWinOddsNar(oddsPage) {
  const winOdds = [];
  
  oddsPage('tr[id^="tr_"]').each((i, elem) => {
    const $elem = cheerio(elem);
    
    // 取消馬は除外
    if ($elem.hasClass('Cancel')) {
      return;
    }
    
    const horseNumber = parseInt($elem.find('.Waku').text().trim());
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

// 複勝オッズの抽出（JRA）
function scrapePlaceOdds(oddsPage) {
  const placeOdds = [];
  
  oddsPage('tr[id^="tr_"]').each((i, elem) => {
    const $elem = cheerio(elem);
    
    // 取消馬は除外
    if ($elem.hasClass('Cancel')) {
      return;
    }
    
    const horseNumber = parseInt($elem.find('.Waku').text().trim());
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

// 複勝オッズの抽出（NAR）
function scrapePlaceOddsNar(oddsPage) {
  const placeOdds = [];
  
  oddsPage('tr[id^="tr_"]').each((i, elem) => {
    const $elem = cheerio(elem);
    
    // 取消馬は除外
    if ($elem.hasClass('Cancel')) {
      return;
    }
    
    const horseNumber = parseInt($elem.find('.Waku').text().trim());
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

// 三連複オッズの抽出（JRA）
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

// 三連複オッズの抽出（NAR）
function scrapeTrioOddsNar(trioPage) {
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