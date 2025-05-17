import axios from 'axios';
import * as cheerio from 'cheerio';
import dayjs from 'dayjs';
import logger from '../../utils/logger.js';
import { saveJraRace, updateJraRaceResult } from '../database/raceService.js';
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';

/**
 * レスポンスの文字セットを検出
 * @param {Object} response - Axiosレスポンス
 * @returns {string} 文字セット名
 */
function detectCharset(response) {
  // Content-Typeヘッダーからcharsetを抽出
  const contentType = response.headers['content-type'] || '';
  const charsetMatch = contentType.match(/charset=([^;]+)/i);
  
  if (charsetMatch) {
    const charset = charsetMatch[1].trim().toLowerCase();
    logger.debug(`Content-Typeヘッダーから文字セット検出: ${charset}`);
    return charset;
  }
  
  // バイナリデータとしてのレスポンスからHTMLのmetaタグを確認
  try {
    // いったんUTF-8として解釈
    const tempHtml = iconv.decode(Buffer.from(response.data), 'utf-8');
    const metaCharset = tempHtml.match(/<meta[^>]*charset=["']?([^"'>]+)/i);
    
    if (metaCharset) {
      const charset = metaCharset[1].trim().toLowerCase();
      logger.debug(`HTMLのmetaタグから文字セット検出: ${charset}`);
      return charset;
    }
  } catch (error) {
    logger.debug(`metaタグからの文字セット検出に失敗: ${error}`);
  }
  
  // ネットケイバは基本的にEUC-JPを使用していることが多い
  logger.debug('文字セットが検出できなかったため、デフォルトのEUC-JPを使用します');
  return 'euc-jp';
}

// HTTP リクエスト用のヘッダーを設定
const axiosConfig = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
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
 * 指定された日付の JRA レース一覧を取得
 * @param {string} dateString - YYYYMMDD形式の日付文字列
 * @returns {Promise<Array>} レース情報の配列
 */
export async function fetchJraRaceList(dateString = getTodayDateString()) {
  try {
    const url = `https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=${dateString}`;
    logger.info(`JRAレース情報を取得中: ${url}`);
    
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
    fs.writeFileSync(path.join(debugDir, `jra_${dateString}.html`), html, 'utf-8');
    
    const $ = cheerio.load(html);
    const races = [];
    
    // HTMLの構造を確認
    logger.debug(`JRA HTML取得: ドキュメントのサイズ ${response.data.length} バイト`);
    logger.debug(`JRA HTML構造: .RaceList_Box 要素の数: ${$('.RaceList_Box').length}`);

    // 競馬場ごとのレース情報を抽出
    $('.RaceList_Box').each((venueIndex, venueElement) => {
      // JRAの場合は競馬場名が .RaceList_DataTitle に格納されている
      const venueName = $(venueElement).find('.RaceList_DataTitle').text().trim().replace(/\s+/g, ' ');
      logger.debug(`競馬場${venueIndex+1}: ${venueName}`);
      
      // JRAの場合はレースが .RaceList_DataItem に格納されている
      $(venueElement).find('.RaceList_DataItem').each((raceIndex, raceElement) => {
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
        }
        
        logger.debug(`レース時間: ${raceTime}`);
        
        // レース名を取得 - JRAはRaceList_ItemTitleの中にあるItemTitle
        const raceName = $(raceElement).find('.RaceList_ItemTitle .ItemTitle').text().trim();
        
        logger.debug(`レース情報解析中: 番号=${raceNumber}, 時間=${raceTime}, 名前=${raceName}`);
        
        // レースIDを取得（URLから抽出）
        const raceLink = $(raceElement).find('a').attr('href');
        const raceIdMatch = raceLink ? raceLink.match(/race_id=([0-9]+)/) : null;
        const raceId = raceIdMatch ? raceIdMatch[1] : null;
        
        if (raceId) {
          logger.debug(`レース情報: ${raceNumber}R ${raceName} (${raceTime}) ID:${raceId}`);
          
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
        } else {
          logger.debug(`レースIDが取得できませんでした: ${raceNumber}R ${raceName}`);
        }
      });
    });

    logger.info(`JRA: ${dateString} の ${races.length} 件のレースを取得しました。`);
    
    // 取得したレースをデータベースに保存
    if (races.length > 0) {
      await Promise.all(races.map(race => saveJraRace(race)));
    }
    
    return races;
  } catch (error) {
    logger.error(`JRA レース一覧の取得中にエラーが発生しました: ${error}`);
    if (error.response) {
      logger.error(`ステータスコード: ${error.response.status}`);
      logger.error(`レスポンスヘッダー: ${JSON.stringify(error.response.headers)}`);
    }
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
    logger.info(`JRAレース結果を取得中: ${url}`);
    
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
    fs.writeFileSync(path.join(debugDir, `jra_result_${raceId}.html`), html, 'utf-8');
    
    const $ = cheerio.load(html);
    
    // レース結果が表示されているかを確認
    const hasResults = $('.ResultTableWrap, .Race_Result_Table').length > 0;
    
    if (!hasResults) {
      logger.warn(`レース ${raceId} の結果データが見つかりません。まだレースが終了していない可能性があります。`);
      return null;
    }
    
    // 着順情報
    const results = [];
    
    try {
      // 着順情報
      $('.Result_Table_02 tr').each((index, element) => {
        if (index > 0) { // ヘッダー行をスキップ
          try {
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
          } catch (rowError) {
            logger.error(`着順情報の行解析中にエラー: ${rowError}`);
            // 続行する
          }
        }
      });
      
      logger.debug(`レース ${raceId} の着順情報: ${results.length}件`);
    } catch (resultsError) {
      logger.error(`着順情報の取得中にエラー: ${resultsError}`);
      // 結果が取得できなくても続行
    }
    
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
      try {
        $('.Payout_Detail_Table .Wakuren').each((index, element) => {
          try {
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
          } catch (err) {
            logger.error(`枠連情報の処理でエラー: ${err}`);
          }
        });
      } catch (wakurenError) {
        logger.error(`枠連情報の取得でエラー: ${wakurenError}`);
      }
      
      // 馬連
      try {
        $('.Payout_Detail_Table .Umaren').each((index, element) => {
          try {
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
          } catch (err) {
            logger.error(`馬連情報の処理でエラー: ${err}`);
          }
        });
      } catch (umarenError) {
        logger.error(`馬連情報の取得でエラー: ${umarenError}`);
      }
    
      // ワイド
      try {
        $('.Payout_Detail_Table .Wide').each((index, element) => {
          try {
            $(element).find('.Result ul').each((uliIdx, uliElement) => {
              try {
                const numbers = [];
                $(uliElement).find('li span').each((i, el) => {
                  const num = $(el).text().trim();
                  if (num) numbers.push(parseInt(num, 10));
                });
                
                const payoutTexts = $(element).find('.Payout span').text().trim().split('<br>');
                const payoutText = payoutTexts[uliIdx] ? payoutTexts[uliIdx].replace(/[^\d]/g, '') : '';
                
                const popularities = $(element).find('.Ninki span').text().trim().split(/\s+/);
                const popularity = popularities[uliIdx] ? popularities[uliIdx].replace(/[^\d]/g, '') : '';
                
                if (numbers.length > 0 && payoutText) {
                  payouts.wide.push({
                    numbers,
                    payout: parseInt(payoutText, 10) || 0,
                    popularity: parseInt(popularity, 10) || 0
                  });
                }
              } catch (err) {
                logger.error(`ワイド情報の個別処理でエラー: ${err}`);
              }
            });
          } catch (err) {
            logger.error(`ワイド情報の処理でエラー: ${err}`);
          }
        });
      } catch (wideError) {
        logger.error(`ワイド情報の取得でエラー: ${wideError}`);
      }
      
      // 馬単
      try {
        $('.Payout_Detail_Table .Umatan').each((index, element) => {
          try {
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
          } catch (err) {
            logger.error(`馬単情報の処理でエラー: ${err}`);
          }
        });
      } catch (umatanError) {
        logger.error(`馬単情報の取得でエラー: ${umatanError}`);
      }
    
      // 三連複
      try {
        $('.Payout_Detail_Table .Fuku3').each((index, element) => {
          try {
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
          } catch (err) {
            logger.error(`三連複情報の処理でエラー: ${err}`);
          }
        });
      } catch (sanrenpukuError) {
        logger.error(`三連複情報の取得でエラー: ${sanrenpukuError}`);
      }
      
      // 三連単
      try {
        $('.Payout_Detail_Table .Tan3').each((index, element) => {
          try {
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
          } catch (err) {
            logger.error(`三連単情報の処理でエラー: ${err}`);
          }
        });
      } catch (sanrentanError) {
        logger.error(`三連単情報の取得でエラー: ${sanrentanError}`);
      }
    } catch (payoutsError) {
      logger.error(`払戻情報の全体処理でエラー: ${payoutsError}`);
    }
    
    const raceResults = {
      id: raceId,
      results: results || [], // resultsが未定義の場合は空配列を使用
      payouts
    };
    
    // 結果データが存在するか確認
    const hasValidResults = results && results.length > 0;
    const hasAnyPayouts = Object.values(payouts).some(arr => arr.length > 0);
    
    if (!hasValidResults && !hasAnyPayouts) {
      logger.warn(`レース ${raceId} の有効な結果データが取得できませんでした。`);
      return null;
    }
    
    logger.info(`JRA: レース ${raceId} の結果と払戻情報を取得しました。結果数: ${results.length}`);
    
    // データベースに結果を保存
    await updateJraRaceResult(raceId, raceResults);
    
    return raceResults;
}