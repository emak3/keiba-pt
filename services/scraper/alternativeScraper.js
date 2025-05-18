import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import logger from '../../utils/logger.js';
import iconv from 'iconv-lite';

// textCleaner.js をインポート（修正後のファイル）
import { detectCharset, validateRaceName, validateVenueName, recommendedAxiosConfig } from '../../utils/textCleaner.js';

// HTTP リクエスト用のヘッダーを更新
const axiosConfig = recommendedAxiosConfig;

/**
 * 共通のデータ取得関数
 * @param {string} url - 取得するURL
 * @param {string} debugFileName - デバッグ用のファイル名
 * @returns {Promise<{html: string, $: CheerioStatic}>} HTML文字列とCheerioオブジェクト
 */
async function fetchAndParse(url, debugFileName) {
  logger.info(`データを取得中: ${url}`);

  const response = await axios.get(url, axiosConfig);
  
  // 文字コードを動的に検出
  const charset = detectCharset(response);

  // レスポンスを検出された文字コードで変換
  const html = iconv.decode(Buffer.from(response.data), charset);

  // デバッグ用にHTMLを保存
  const debugDir = path.join(process.cwd(), 'debug');
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir);
  }
  
  if (debugFileName) {
    fs.writeFileSync(path.join(debugDir, debugFileName), html, 'utf-8');
  }

  // Cheerioでパース
  const $ = cheerio.load(html);
  
  return { html, $ };
}

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
    
    // fetchAndParse関数を使用してHTMLを取得とパース
    const { $ } = await fetchAndParse(url, 'netkeiba_main.html');
    
    // JRAとNARの開催情報を取得
    const jraVenues = [];
    const narVenues = [];
    
    // カレンダー部分を探す
    $('.Race_Calendar_List').each((i, element) => {
      // 日付を確認
      const dateText = $(element).find('.Race_Calendar_Date').text().trim();
      
      // 開催場所を探す
      $(element).find('.Race_Calendar_Data a').each((j, venueEl) => {
        const venueText = $(venueEl).text().trim();
        const venueUrl = $(venueEl).attr('href') || '';
        
        if (venueUrl.includes('race.netkeiba.com')) {
          jraVenues.push(venueText);
        } else if (venueUrl.includes('nar.netkeiba.com')) {
          narVenues.push(venueText);
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
    
    // fetchAndParse関数を使用してHTMLを取得とパース
    const { $ } = await fetchAndParse(url, 'jra_main.html');
    const races = [];
    
    // レーステーブルを探す
    
    // 競馬場情報を抽出
    $('.RaceList_Box').each((venueIdx, venueElement) => {
      // 競馬場名を取得
      const venueName = $(venueElement).find('.RaceList_DataTitle').text().trim().replace(/\s+/g, ' ');
      
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
        
        // レース名を取得
        const raceName = $(raceElement).find('.RaceList_ItemTitle .ItemTitle').text().trim();
        
        // レースリンクとIDを取得
        const raceLink = $(raceElement).find('a').attr('href');
        
        // レースIDを抽出
        const raceIdMatch = raceLink ? raceLink.match(/race_id=([0-9]+)/) : null;
        if (raceIdMatch) {
          const raceId = raceIdMatch[1];
          
          // 検証済みのレース名と開催場所を使用
          const validatedVenue = validateVenueName(venueName);
          const validatedRaceName = validateRaceName(raceName, validatedVenue, parseInt(raceNumber, 10));
          
          if (raceId && raceNumber) {
            races.push({
              id: raceId,
              type: 'jra',
              venue: validatedVenue,
              number: parseInt(raceNumber, 10),
              name: validatedRaceName,
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
    
    // fetchAndParse関数を使用してHTMLを取得とパース
    const { $ } = await fetchAndParse(url, 'nar_main.html');
    const races = [];
    
    // レーステーブルを探す
    
    // 現在開催中のレースセクションを探す
    $('.RaceList_Data').each((venueIdx, venueElement) => {
      const venueName = $(venueElement).find('h3, .RaceList_DataTitle').text().trim();
      
      // 各レースを取得
      $(venueElement).find('.RaceList_DataItem, .RaceList_Item').each((raceIdx, raceElement) => {
        const raceInfo = $(raceElement).text().trim();
        const raceLink = $(raceElement).find('a').attr('href');
        
        // レースIDを抽出
        const raceIdMatch = raceLink ? raceLink.match(/race_id=([0-9]+)/) : null;
        if (raceIdMatch) {
          const raceId = raceIdMatch[1];
          
          // レース番号と時間を抽出
          const raceNumberMatch = raceInfo.match(/(\d+)R/);
          const raceTimeMatch = raceInfo.match(/(\d+:\d+)/);
          
          const raceNumber = raceNumberMatch ? raceNumberMatch[1] : '';
          const raceTime = raceTimeMatch ? raceTimeMatch[1] : '';
          
          // レース名の抽出
          let raceName = '';
          if (raceInfo.includes('(')) {
            raceName = raceInfo.split('(')[0].replace(/\d+R/, '').trim();
          } else {
            raceName = raceInfo.replace(/\d+R/, '').replace(/\d+:\d+/, '').trim();
          }
          
          // 検証済みのレース名と開催場所を使用
          const validatedVenue = validateVenueName(venueName);
          const validatedRaceName = validateRaceName(raceName, validatedVenue, parseInt(raceNumber, 10));
          
          if (raceId && raceNumber) {
            races.push({
              id: raceId,
              type: 'nar',
              venue: validatedVenue,
              number: parseInt(raceNumber, 10),
              name: validatedRaceName || `${validatedVenue} ${raceNumber}R`,
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