import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import logger from '../../utils/logger.js';
import iconv from 'iconv-lite';

// HTTP リクエスト用のヘッダーを設定
const axiosConfig = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': 'https://www.netkeiba.com/'
  },
  responseType: 'arraybuffer',  // バイナリデータとして取得
  responseEncoding: 'binary'
};

/**
 * 今日の日付を「YYYYMMDD」形式で取得
 * @returns {string} YYYYMMDD形式の日付
 */
function getTodayDateString() {
  return dayjs().format('YYYYMMDD');
}

/**
 * 指定された日付の競馬開催情報を取得 (メインページから)
 * @param {string} dateString - YYYYMMDD形式の日付文字列
 * @returns {Promise<Object>} JRAとNARの開催情報
 */
export async function fetchRaceCalendar(dateString = getTodayDateString()) {
  try {
    // メインページを取得
    const url = 'https://www.netkeiba.com/';
    logger.info(`ネットケイバのメインページを取得中: ${url}`);
    
    const response = await axios.get(url, axiosConfig);
    
    // ネットケイバはEUC-JPを使用しているため、強制的に指定
    const charset = 'euc-jp';
    logger.debug(`レスポンスの文字コードを ${charset} として処理します`);
    
    // レスポンスをUTF-8に変換
    const html = iconv.decode(Buffer.from(response.data), charset);
    
    // デバッグ用にHTMLを保存
    const debugDir = path.join(process.cwd(), 'debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir);
    }
    fs.writeFileSync(path.join(debugDir, 'netkeiba_main.html'), html, 'utf-8');
    
    const $ = cheerio.load(html);
    
    // JRAとNARの開催情報を取得
    const jraVenues = [];
    const narVenues = [];
    
    // カレンダー部分を探す
    $('.Race_Calendar_List').each((i, element) => {
      // 日付を確認
      const dateText = $(element).find('.Race_Calendar_Date').text().trim();
      logger.debug(`カレンダーの日付: ${dateText}`);
      
      // 開催場所を探す
      $(element).find('.Race_Calendar_Data a').each((j, venueEl) => {
        const venueText = $(venueEl).text().trim();
        const venueUrl = $(venueEl).attr('href') || '';
        
        if (venueUrl.includes('race.netkeiba.com')) {
          jraVenues.push(venueText);
          logger.debug(`JRA開催場所: ${venueText}`);
        } else if (venueUrl.includes('nar.netkeiba.com')) {
          narVenues.push(venueText);
          logger.debug(`NAR開催場所: ${venueText}`);
        }
      });
    });
    
    logger.info(`本日の開催情報: JRA ${jraVenues.length}会場, NAR ${narVenues.length}会場`);
    
    return {
      jra: jraVenues,
      nar: narVenues
    };
    
  } catch (error) {
    logger.error(`開催情報取得中にエラーが発生しました: ${error}`);
    if (error.response) {
      logger.error(`ステータスコード: ${error.response.status}`);
      logger.error(`レスポンスヘッダー: ${JSON.stringify(error.response.headers)}`);
    }
    throw error;
  }
}

/**
 * 代替のレース情報取得方法
 * JRAのトップページから直接レース情報を取得
 * @param {string} dateString - YYYYMMDD形式の日付文字列
 * @returns {Promise<Array>} レース情報の配列
 */
export async function fetchJraRacesAlternative(dateString = getTodayDateString()) {
  try {
    // JRAのメインページを取得
    const url = 'https://race.netkeiba.com/top/';
    logger.info(`JRAメインページを取得中: ${url}`);
    
    const response = await axios.get(url, axiosConfig);
    
    // ネットケイバはEUC-JPを使用しているため、強制的に指定
    const charset = 'euc-jp';
    logger.debug(`レスポンスの文字コードを ${charset} として処理します`);
    
    // レスポンスをUTF-8に変換
    const html = iconv.decode(Buffer.from(response.data), charset);
    
    // デバッグ用にHTMLを保存
    const debugDir = path.join(process.cwd(), 'debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir);
    }
    fs.writeFileSync(path.join(debugDir, 'jra_main.html'), html, 'utf-8');
    
    const $ = cheerio.load(html);
    const races = [];
    
    // レーステーブルを探す
    logger.debug('JRAメインページからレース一覧を探しています...');
    
    // 競馬場情報を抽出
    $('.RaceList_Box').each((venueIdx, venueElement) => {
      // 競馬場名を取得
      const venueName = $(venueElement).find('.RaceList_DataTitle').text().trim().replace(/\s+/g, ' ');
      logger.debug(`開催場: ${venueName}`);
      
      if (!venueName) {
        return; // 競馬場名がなければスキップ
      }
      
      // 各レースを取得
      $(venueElement).find('.RaceList_DataItem').each((raceIdx, raceElement) => {
        // レース番号を取得
        const raceNumber = $(raceElement).find('.Race_Num').text().trim().replace(/\D/g, '');
        
        // レース時間を取得 - 複数の候補を試す
        let raceTime = '';
        if ($(raceElement).find('.RaceData span').length > 0) {
          raceTime = $(raceElement).find('.RaceData span').first().text().trim();
        } else if ($(raceElement).find('.RaceData').length > 0) {
          // RaceDataがあるが中にspanがない場合
          const raceDataText = $(raceElement).find('.RaceData').text().trim();
          const timeMatch = raceDataText.match(/(\d{1,2}:\d{2})/);
          if (timeMatch) {
            raceTime = timeMatch[1];
          }
        } else if ($(raceElement).find('.RaceList_Itemtime').length > 0) {
          // 古い構造の場合
          raceTime = $(raceElement).find('.RaceList_Itemtime').text().trim();
        } else {
          // 全テキストから時間を抽出する
          const allText = $(raceElement).text().trim();
          const timeMatch = allText.match(/(\d{1,2}:\d{2})/);
          if (timeMatch) {
            raceTime = timeMatch[1];
          }
        }
        
        logger.debug(`レース時間: ${raceTime}`);
        
        // レース名を取得
        const raceName = $(raceElement).find('.RaceList_ItemTitle .ItemTitle').text().trim();
        
        logger.debug(`解析したレース情報: 番号=${raceNumber}, 時間=${raceTime}, 名前=${raceName}`);
        
        // レースリンクとIDを取得
        const raceLink = $(raceElement).find('a').attr('href');
        logger.debug(`レースリンク: ${raceLink}`);
        
        // レースIDを抽出
        const raceIdMatch = raceLink ? raceLink.match(/race_id=([0-9]+)/) : null;
        if (raceIdMatch) {
          const raceId = raceIdMatch[1];
          
          // レース番号と時間を抽出
          const raceNumberMatch = raceInfo.match(/(\d+)R/);
          const raceTimeMatch = raceInfo.match(/(\d+:\d+)/);
          
          const raceNumber = raceNumberMatch ? raceNumberMatch[1] : '';
          const raceTime = raceTimeMatch ? raceTimeMatch[1] : '';
          
          // レース名の抽出は複雑なため、ページタイトルやその他の情報から推測
          let raceName = '';
          if (raceInfo.includes('(')) {
            raceName = raceInfo.split('(')[0].replace(/\d+R/, '').trim();
          } else {
            raceName = raceInfo.replace(/\d+R/, '').replace(/\d+:\d+/, '').trim();
          }
          
          if (raceId && raceNumber) {
            races.push({
              id: raceId,
              type: 'jra',
              venue: venueName,
              number: parseInt(raceNumber, 10),
              name: raceName || `${venueName} ${raceNumber}R`,
              time: raceTime,
              date: dateString,
              status: 'upcoming',
              link: `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`
            });
          }
        }
      });
    });
    
    logger.info(`JRA代替方法: ${races.length}件のレースを取得しました`);
    return races;
    
  } catch (error) {
    logger.error(`JRA代替方法でのレース取得中にエラーが発生しました: ${error}`);
    if (error.response) {
      logger.error(`ステータスコード: ${error.response.status}`);
    }
    return [];
  }
}

/**
 * 代替のレース情報取得方法
 * NARのトップページから直接レース情報を取得
 * @param {string} dateString - YYYYMMDD形式の日付文字列
 * @returns {Promise<Array>} レース情報の配列
 */
export async function fetchNarRacesAlternative(dateString = getTodayDateString()) {
  try {
    // NARのメインページを取得
    const url = 'https://nar.netkeiba.com/top/';
    logger.info(`NARメインページを取得中: ${url}`);
    
    const response = await axios.get(url, axiosConfig);
    
    // ネットケイバはEUC-JPを使用しているため、強制的に指定
    const charset = 'euc-jp';
    logger.debug(`レスポンスの文字コードを ${charset} として処理します`);
    
    // レスポンスをUTF-8に変換
    const html = iconv.decode(Buffer.from(response.data), charset);
    
    // デバッグ用にHTMLを保存
    const debugDir = path.join(process.cwd(), 'debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir);
    }
    fs.writeFileSync(path.join(debugDir, 'nar_main.html'), html, 'utf-8');
    
    const $ = cheerio.load(html);
    const races = [];
    
    // レーステーブルを探す
    logger.debug('NARメインページからレース一覧を探しています...');
    
    // 現在開催中のレースセクションを探す
    $('.RaceList_Data').each((venueIdx, venueElement) => {
      const venueName = $(venueElement).find('h3, .RaceList_DataTitle').text().trim();
      logger.debug(`開催場: ${venueName}`);
      
      // 各レースを取得
      $(venueElement).find('.RaceList_DataItem, .RaceList_Item').each((raceIdx, raceElement) => {
        const raceInfo = $(raceElement).text().trim();
        const raceLink = $(raceElement).find('a').attr('href');
        logger.debug(`レース情報: ${raceInfo}, リンク: ${raceLink}`);
        
        // レースIDを抽出
        const raceIdMatch = raceLink ? raceLink.match(/race_id=([0-9]+)/) : null;
        if (raceIdMatch) {
          const raceId = raceIdMatch[1];
          
          // レース番号と時間を抽出
          const raceNumberMatch = raceInfo.match(/(\d+)R/);
          const raceTimeMatch = raceInfo.match(/(\d+:\d+)/);
          
          const raceNumber = raceNumberMatch ? raceNumberMatch[1] : '';
          const raceTime = raceTimeMatch ? raceTimeMatch[1] : '';
          
          // レース名の抽出は複雑なため、ページタイトルやその他の情報から推測
          let raceName = '';
          if (raceInfo.includes('(')) {
            raceName = raceInfo.split('(')[0].replace(/\d+R/, '').trim();
          } else {
            raceName = raceInfo.replace(/\d+R/, '').replace(/\d+:\d+/, '').trim();
          }
          
          if (raceId && raceNumber) {
            races.push({
              id: raceId,
              type: 'nar',
              venue: venueName,
              number: parseInt(raceNumber, 10),
              name: raceName || `${venueName} ${raceNumber}R`,
              time: raceTime,
              date: dateString,
              status: 'upcoming',
              link: `https://nar.netkeiba.com/race/shutuba.html?race_id=${raceId}`
            });
          }
        }
      });
    });
    
    logger.info(`NAR代替方法: ${races.length}件のレースを取得しました`);
    return races;
    
  } catch (error) {
    logger.error(`NAR代替方法でのレース取得中にエラーが発生しました: ${error}`);
    if (error.response) {
      logger.error(`ステータスコード: ${error.response.status}`);
    }
    return [];
  }
}