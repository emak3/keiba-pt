import axios from 'axios';
import cheerio from 'cheerio';
import dayjs from 'dayjs';
import logger from '../../utils/logger.js';
import { saveJraRace, updateJraRaceResult } from '../database/raceService.js';

/**
 * 今日の日付を「YYYYMMDD」形式で取得
 * @returns {string} YYYYMMDD形式の日付
 */
function getTodayDateString() {
  return dayjs().format('YYYYMMDD');
}

/**
 * 指定された日付の JRA レース一覧を取得
 * @param {string} dateString - YYYYMMDD形式の日付文字列
 * @returns {Promise<Array>} レース情報の配列
 */
export async function fetchJraRaceList(dateString = getTodayDateString()) {
  try {
    const url = `https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=${dateString}`;
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    const races = [];

    // 競馬場ごとのレース情報を抽出
    $('.RaceList_Box').each((venueIndex, venueElement) => {
      const venueName = $(venueElement).find('.RaceList_Data h3').text().trim();
      
      $(venueElement).find('.RaceList_ItemBox').each((raceIndex, raceElement) => {
        const raceNumber = $(raceElement).find('.Race_Num').text().trim().replace(/\D/g, '');
        const raceTime = $(raceElement).find('.RaceList_DataItem .RaceList_Itemtime').text().trim();
        const raceName = $(raceElement).find('.RaceList_DataItem .ItemTitle').text().trim();
        
        // レースIDを取得（URLから抽出）
        const raceLink = $(raceElement).find('a').attr('href');
        const raceIdMatch = raceLink ? raceLink.match(/race_id=([0-9]+)/) : null;
        const raceId = raceIdMatch ? raceIdMatch[1] : null;
        
        if (raceId) {
          races.push({
            id: raceId,
            type: 'jra',
            venue: venueName,
            number: parseInt(raceNumber, 10),
            name: raceName,
            time: raceTime,
            date: dateString,
            status: 'upcoming', // upcoming, in_progress, completed
            link: `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`
          });
        }
      });
    });

    logger.info(`JRA: ${dateString} の ${races.length} 件のレースを取得しました。`);
    
    // 取得したレースをデータベースに保存
    await Promise.all(races.map(race => saveJraRace(race)));
    
    return races;
  } catch (error) {
    logger.error(`JRA レース一覧の取得中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * JRA レースの出馬表情報を取得
 * @param {string} raceId - レースID
 * @returns {Promise<Object>} 出馬表情報
 */
export async function fetchJraRaceEntries(raceId) {
  try {
    const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    // レース基本情報
    const raceName = $('.RaceName').text().trim();
    const courseInfo = $('.RaceData01').text().trim();
    const raceDetails = $('.RaceData02').text().trim();
    
    // 出走馬情報
    const horses = [];
    $('.HorseList').each((index, element) => {
      const frameNumber = $(element).find('.Waku').text().trim();
      const horseNumber = $(element).find('.Umaban').text().trim();
      const horseName = $(element).find('.HorseName a').text().trim();
      const jockey = $(element).find('.Jockey a').text().trim();
      const trainer = $(element).find('.Trainer a').text().trim();
      const weight = $(element).find('.Weight').text().trim();
      const odds = $(element).find('.Popular span').first().text().trim();
      const popularity = $(element).find('.Popular_Ninki span').text().trim();
      
      horses.push({
        frameNumber: parseInt(frameNumber, 10) || 0,
        horseNumber: parseInt(horseNumber, 10) || 0,
        horseName,
        jockey,
        trainer,
        weight,
        odds: parseFloat(odds) || 0,
        popularity: parseInt(popularity, 10) || 0
      });
    });
    
    const raceInfo = {
      id: raceId,
      name: raceName,
      courseInfo,
      raceDetails,
      horses
    };
    
    logger.info(`JRA: レース ${raceId} の出馬表を取得しました。出走頭数: ${horses.length}`);
    
    return raceInfo;
  } catch (error) {
    logger.error(`JRA 出馬表の取得中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * JRA レースの結果と払戻情報を取得
 * @param {string} raceId - レースID
 * @returns {Promise<Object>} 結果と払戻情報
 */
export async function fetchJraRaceResults(raceId) {
  try {
    const url = `https://race.netkeiba.com/race/result.html?race_id=${raceId}`;
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    // 着順情報
    const results = [];
    $('.Result_Table_02 tr').each((index, element) => {
      if (index > 0) { // ヘッダー行をスキップ
        const order = $(element).find('td').eq(0).text().trim();
        const frameNumber = $(element).find('td').eq(1).text().trim();
        const horseNumber = $(element).find('td').eq(2).text().trim();
        const horseName = $(element).find('td').eq(3).find('a').text().trim();
        const jockey = $(element).find('td').eq(6).find('a').text().trim();
        
        if (order && horseName) {
          results.push({
            order: parseInt(order, 10) || 0,
            frameNumber: parseInt(frameNumber, 10) || 0,
            horseNumber: parseInt(horseNumber, 10) || 0,
            horseName,
            jockey
          });
        }
      }
    });
    
    // 払戻情報
    const payouts = {
      tansho: [], // 単勝
      fukusho: [], // 複勝
      wakuren: [], // 枠連
      umaren: [], // 馬連
      wide: [], // ワイド
      umatan: [], // 馬単
      sanrentan: [], // 三連単
      sanrenpuku: [] // 三連複
    };
    
    // 単勝
    $('.Payout_Detail_Table .Tansho').each((index, element) => {
      const numbers = [];
      $(element).find('.Result span').each((i, el) => {
        const num = $(el).text().trim();
        if (num) numbers.push(parseInt(num, 10));
      });
      
      const payout = $(element).find('.Payout span').text().trim().replace(/[^\d]/g, '');
      const popularity = $(element).find('.Ninki span').text().trim().replace(/[^\d]/g, '');
      
      if (numbers.length > 0 && payout) {
        payouts.tansho.push({
          numbers,
          payout: parseInt(payout, 10) || 0,
          popularity: parseInt(popularity, 10) || 0
        });
      }
    });
    
    // 複勝
    $('.Payout_Detail_Table .Fukusho').each((index, element) => {
      const allNumbers = [];
      const allPayouts = [];
      const allPopularities = [];
      
      $(element).find('.Result span').each((i, el) => {
        const num = $(el).text().trim();
        if (num) allNumbers.push(parseInt(num, 10));
      });
      
      $(element).find('.Payout span').text().trim().split('<br>').forEach(p => {
        const payout = p.replace(/[^\d]/g, '');
        if (payout) allPayouts.push(parseInt(payout, 10) || 0);
      });
      
      $(element).find('.Ninki span').each((i, el) => {
        const popularity = $(el).text().trim().replace(/[^\d]/g, '');
        if (popularity) allPopularities.push(parseInt(popularity, 10) || 0);
      });
      
      // 複勝は馬番ごとに分ける
      for (let i = 0; i < allNumbers.length; i++) {
        if (allNumbers[i]) {
          payouts.fukusho.push({
            numbers: [allNumbers[i]],
            payout: allPayouts[i] || 0,
            popularity: allPopularities[i] || 0
          });
        }
      }
    });
    
    // 枠連
    $('.Payout_Detail_Table .Wakuren').each((index, element) => {
      const numbers = [];
      $(element).find('.Result ul li span').each((i, el) => {
        const num = $(el).text().trim();
        if (num) numbers.push(parseInt(num, 10));
      });
      
      const payout = $(element).find('.Payout span').text().trim().replace(/[^\d]/g, '');
      const popularity = $(element).find('.Ninki span').text().trim().replace(/[^\d]/g, '');
      
      if (numbers.length > 0 && payout) {
        payouts.wakuren.push({
          numbers,
          payout: parseInt(payout, 10) || 0,
          popularity: parseInt(popularity, 10) || 0
        });
      }
    });
    
    // 馬連
    $('.Payout_Detail_Table .Umaren').each((index, element) => {
      const numbers = [];
      $(element).find('.Result ul li span').each((i, el) => {
        const num = $(el).text().trim();
        if (num) numbers.push(parseInt(num, 10));
      });
      
      const payout = $(element).find('.Payout span').text().trim().replace(/[^\d]/g, '');
      const popularity = $(element).find('.Ninki span').text().trim().replace(/[^\d]/g, '');
      
      if (numbers.length > 0 && payout) {
        payouts.umaren.push({
          numbers,
          payout: parseInt(payout, 10) || 0,
          popularity: parseInt(popularity, 10) || 0
        });
      }
    });
    
    // ワイド
    $('.Payout_Detail_Table .Wide').each((index, element) => {
      $(element).find('.Result ul').each((uliIdx, uliElement) => {
        const numbers = [];
        $(uliElement).find('li span').each((i, el) => {
          const num = $(el).text().trim();
          if (num) numbers.push(parseInt(num, 10));
        });
        
        const payouts = $(element).find('.Payout span').text().trim().split('<br>');
        const payout = payouts[uliIdx] ? payouts[uliIdx].replace(/[^\d]/g, '') : '';
        
        const popularities = $(element).find('.Ninki span').text().trim().split(/\s+/);
        const popularity = popularities[uliIdx] ? popularities[uliIdx].replace(/[^\d]/g, '') : '';
        
        if (numbers.length > 0 && payout) {
          payouts.wide.push({
            numbers,
            payout: parseInt(payout, 10) || 0,
            popularity: parseInt(popularity, 10) || 0
          });
        }
      });
    });
    
    // 馬単
    $('.Payout_Detail_Table .Umatan').each((index, element) => {
      const numbers = [];
      $(element).find('.Result ul li span').each((i, el) => {
        const num = $(el).text().trim();
        if (num) numbers.push(parseInt(num, 10));
      });
      
      const payout = $(element).find('.Payout span').text().trim().replace(/[^\d]/g, '');
      const popularity = $(element).find('.Ninki span').text().trim().replace(/[^\d]/g, '');
      
      if (numbers.length > 0 && payout) {
        payouts.umatan.push({
          numbers,
          payout: parseInt(payout, 10) || 0,
          popularity: parseInt(popularity, 10) || 0
        });
      }
    });
    
    // 三連複
    $('.Payout_Detail_Table .Fuku3').each((index, element) => {
      const numbers = [];
      $(element).find('.Result ul li span').each((i, el) => {
        const num = $(el).text().trim();
        if (num) numbers.push(parseInt(num, 10));
      });
      
      const payout = $(element).find('.Payout span').text().trim().replace(/[^\d]/g, '');
      const popularity = $(element).find('.Ninki span').text().trim().replace(/[^\d]/g, '');
      
      if (numbers.length > 0 && payout) {
        payouts.sanrenpuku.push({
          numbers,
          payout: parseInt(payout, 10) || 0,
          popularity: parseInt(popularity, 10) || 0
        });
      }
    });
    
    // 三連単
    $('.Payout_Detail_Table .Tan3').each((index, element) => {
      const numbers = [];
      $(element).find('.Result ul li span').each((i, el) => {
        const num = $(el).text().trim();
        if (num) numbers.push(parseInt(num, 10));
      });
      
      const payout = $(element).find('.Payout span').text().trim().replace(/[^\d]/g, '');
      const popularity = $(element).find('.Ninki span').text().trim().replace(/[^\d]/g, '');
      
      if (numbers.length > 0 && payout) {
        payouts.sanrentan.push({
          numbers,
          payout: parseInt(payout, 10) || 0,
          popularity: parseInt(popularity, 10) || 0
        });
      }
    });
    
    const raceResults = {
      id: raceId,
      results,
      payouts
    };
    
    logger.info(`JRA: レース ${raceId} の結果と払戻情報を取得しました。`);
    
    // データベースに結果を保存
    await updateJraRaceResult(raceId, raceResults);
    
    return raceResults;
  } catch (error) {
    logger.error(`JRA レース結果の取得中にエラーが発生しました: ${error}`);
    throw error;
  }
}