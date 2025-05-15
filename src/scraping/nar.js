// nar.js - 地方競馬のレース情報をスクレイピングする
const axios = require('axios');
const cheerio = require('cheerio');
const selectors = require('./selectors').nar;
const { saveRaceData, saveResultData } = require('../db/races');

/**
 * 当日の地方競馬レース一覧を取得する
 */
async function getTodayRaces() {
  try {
    // 当日のレース一覧ページを取得
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    const url = `https://nar.netkeiba.com/top/race_list_sub.html?kaisai_date=${year}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`;
    
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    const races = [];
    
    // 各会場のレース情報を取得
    $('.RaceList_Data').each((i, element) => {
      const track = $(element).find('.Jyo a').text().trim();
      
      $(element).find('li').each((j, race) => {
        const raceNumber = $(race).find('.Race_Num').text().trim();
        const raceId = $(race).find('a').attr('href').match(/race_id=([0-9]+)/)[1];
        const raceName = $(race).find('.Race_Name').text().trim();
        const raceTime = $(race).find('.Race_Time').text().trim();
        
        races.push({
          id: raceId,
          track,
          number: raceNumber,
          name: raceName,
          time: raceTime,
          type: 'nar',
          date: `${year}/${month}/${day}`
        });
      });
    });
    
    return races;
  } catch (error) {
    console.error('地方競馬レース一覧の取得中にエラーが発生しました:', error);
    return [];
  }
}

// jra.js の修正バージョン - エラーハンドリングを強化

/**
 * 特定のレースの出馬表を取得する
 */
async function getRaceDetails(raceId) {
  try {
    const url = `https://nar.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
    
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    // レース基本情報
    const raceName = $(selectors.raceName).text().trim() || 'レース名不明';
    const raceData = $(selectors.raceData).text().trim() || '';
    
    // 発走時間を抽出（エラーハンドリングを追加）
    let raceTime = '00:00';
    const raceTimeMatch = raceData.match(/([0-9]{2}:[0-9]{2})発走/);
    if (raceTimeMatch && raceTimeMatch[1]) {
      raceTime = raceTimeMatch[1];
    }
    
    // レース距離を抽出（エラーハンドリングを追加）
    let raceDistance = '不明';
    const raceDistanceMatch = raceData.match(/([^ ]+)m/);
    if (raceDistanceMatch && raceDistanceMatch[1]) {
      raceDistance = raceDistanceMatch[1];
    }
    
    // 馬場種類を判定（エラーハンドリングを追加）
    let raceSurface = '不明';
    if (raceDistance.includes('芝')) {
      raceSurface = '芝';
    } else {
      raceSurface = 'ダート';
    }
    
    // 出走馬情報
    const horses = [];
    
    $(selectors.horseList).each((i, element) => {
      try {
        const gate = $(element).find('td').eq(0).text().trim() || '0';
        const number = $(element).find('td').eq(1).text().trim() || '0';
        const horseName = $(element).find(selectors.horseName).text().trim() || '不明';
        
        // 馬IDの抽出（エラーハンドリングを追加）
        let horseId = '0';
        const horseLink = $(element).find(selectors.horseName).attr('href');
        if (horseLink) {
          const horseIdMatch = horseLink.match(/horse\/([0-9]+)/);
          if (horseIdMatch && horseIdMatch[1]) {
            horseId = horseIdMatch[1];
          }
        }
        
        const jockey = $(element).find(selectors.jockeyName).text().trim() || '不明';
        const weight = $(element).find('.Weight').text().trim() || '0';
        const oddsElement = $(element).find(selectors.odds);
        let odds = '0';
        if (oddsElement.length > 0) {
          odds = oddsElement.text().trim().replace(/[^0-9.]/g, '') || '0';
        }
        const popularity = $(element).find('.Popular_Ninki').text().trim() || '0';
        
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
        // 個別の馬情報処理でエラーが発生しても全体の処理は継続
      }
    });
    
    const raceDetails = {
      id: raceId,
      name: raceName,
      time: raceTime,
      distance: raceDistance,
      surface: raceSurface,
      horses,
      lastUpdated: new Date().toISOString()
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
      lastUpdated: new Date().toISOString(),
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
    
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    // 着順情報
    const results = [];
    
    $('.ResultTable .HorseList').each((i, element) => {
      const order = $(element).find('.Result_Num').text().trim();
      const number = $(element).find('.Num').text().trim();
      const horseName = $(element).find('.Horse_Name a').text().trim();
      const horseId = $(element).find('.Horse_Name a').attr('href').match(/horse\/([0-9]+)/)[1];
      
      results.push({
        order: parseInt(order, 10),
        number: parseInt(number, 10),
        id: horseId,
        name: horseName
      });
    });
    
    // 払戻金情報
    const payouts = {
      tansho: getPayoutInfo($, selectors.tansho),
      fukusho: getPayoutInfo($, selectors.fukusho),
      wakuren: getPayoutInfo($, selectors.wakuren),
      umaren: getPayoutInfo($, selectors.umaren),
      wide: getPayoutInfo($, selectors.wide),
      umatan: getPayoutInfo($, selectors.umatan),
      sanrentan: getPayoutInfo($, selectors.sanrentan),
      sanrenpuku: getPayoutInfo($, selectors.sanrenpuku)
    };
    
    const resultData = {
      id: raceId,
      results,
      payouts,
      isCompleted: true,
      lastUpdated: new Date().toISOString()
    };
    
    // Firebaseに保存
    await saveResultData(raceId, resultData);
    
    return resultData;
  } catch (error) {
    console.error(`地方競馬レース結果(${raceId})の取得中にエラーが発生しました:`, error);
    return null;
  }
}

/**
 * 払戻金情報を抽出するヘルパー関数
 */
function getPayoutInfo($, selector) {
  const numbers = [];
  $(selector.number).each((i, element) => {
    const num = $(element).text().trim();
    if (num) numbers.push(parseInt(num, 10));
  });
  
  const payouts = [];
  $(selector.pay).each((i, element) => {
    const pay = $(element).text().trim().replace(/[^0-9]/g, '');
    if (pay) payouts.push(parseInt(pay, 10));
  });
  
  const popularities = [];
  $(selector.popularity).each((i, element) => {
    const pop = $(element).text().trim().replace(/[^0-9]/g, '');
    if (pop) popularities.push(parseInt(pop, 10));
  });
  
  const result = [];
  
  // 単勝・馬単・三連単は単一の結果
  if (numbers.length === 1 || numbers.length === 2 || numbers.length === 3) {
    result.push({
      numbers,
      payout: payouts[0],
      popularity: popularities[0]
    });
  } 
  // 複勝・枠連・馬連・ワイド・三連複は複数の結果がある場合がある
  else {
    // 3つごとにグループ化
    for (let i = 0; i < numbers.length; i += 3) {
      const group = numbers.slice(i, i + 3).filter(n => n);
      if (group.length > 0) {
        result.push({
          numbers: group,
          payout: payouts[Math.floor(i / 3)],
          popularity: popularities[Math.floor(i / 3)]
        });
      }
    }
  }
  
  return result;
}

module.exports = {
  getTodayRaces,
  getRaceDetails,
  getRaceResult
};