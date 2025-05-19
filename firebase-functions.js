// Firebase Cloud Functions の設定
// index.js

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite'); // 文字コード変換用

admin.initializeApp();
const db = admin.firestore();

// 30分ごとにスクレイピングを実行するスケジュール関数
exports.scrapeRacingData = functions.pubsub.schedule('every 30 minutes').onRun(async (context) => {
  try {
    console.log('定期スクレイピングを開始します...');
    
    // メイン処理（scraper.jsの内容をここに含める）
    await main();
    
    console.log('定期スクレイピングが完了しました');
    return null;
  } catch (error) {
    console.error('スクレイピング処理でエラーが発生しました:', error);
    return null;
  }
});

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
    
    // JRA中央競馬の処理
    await scrapeJraRaces();
    
    // 地方競馬（NAR）の処理
    await scrapeNarRaces();
    
    console.log('データ更新が完了しました');
  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

// JRA中央競馬のスクレイピング
async function scrapeJraRaces() {
  // scraper.jsのscrapeJraRaces関数と同じ内容
}

// 地方競馬（NAR）のスクレイピング
async function scrapeNarRaces() {
  // scraper.jsのscrapeNarRaces関数と同じ内容
}

// JRA中央競馬の開催会場取得
async function scrapeJraVenues() {
  // scraper.jsのscrapeJraVenues関数と同じ内容
}

// 地方競馬（NAR）の開催会場取得
async function scrapeNarVenues() {
  // scraper.jsのscrapeNarVenues関数と同じ内容
}

// 以下、scraper.jsの残りの関数をすべて含める
// ...