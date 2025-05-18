import axios from 'axios';
import * as cheerio from 'cheerio';
import dayjs from 'dayjs';
import logger from '../../utils/logger.js';
import { saveJraRace, updateJraRaceResult } from '../database/raceService.js';
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';

// 修正: 必要な関数をすべてインポート
import { 
  detectCharset, 
  validateRaceName, 
  validateVenueName, 
  cleanJapaneseText, // 後方互換用
  cleanRaceName, // 後方互換用 
  cleanVenueName, // 後方互換用
  recommendedAxiosConfig 
} from '../../utils/textCleaner.js';

// HTTP リクエスト用のヘッダーを更新
const axiosConfig = recommendedAxiosConfig;

/**
 * JRA レース情報を取得する関数
 * @param {string} url - 取得するURL
 * @param {string} debugFileName - デバッグ用のファイル名
 * @returns {Promise<{html: string, $: CheerioStatic}>} HTML文字列とCheerioオブジェクト
 */
async function fetchAndParse(url, debugFileName) {
  logger.info(`JRAデータを取得中: ${url}`);

  // axiosの設定をシンプル化
  const config = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Charset': 'utf-8, euc-jp, shift_jis'
    },
    responseType: 'arraybuffer'
  };

  const response = await axios.get(url, config);
  
  // 直接EUC-JPでデコード（ネットケイバ標準エンコーディング）
  const html = iconv.decode(Buffer.from(response.data), 'EUC-JP');

  // デバッグ用にHTMLを保存（オプション）
  if (debugFileName) {
    const debugDir = path.join(process.cwd(), 'debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir);
    }
    fs.writeFileSync(path.join(debugDir, debugFileName), html, 'utf-8');
  }

  // Cheerioでパース
  const $ = cheerio.load(html, { decodeEntities: false });
  
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
 * 指定された日付の JRA レース一覧を取得
 * @param {string} dateString - YYYYMMDD形式の日付文字列
 * @returns {Promise<Array>} レース情報の配列
 */
export async function fetchJraRaceList(dateString = getTodayDateString()) {
  try {
    const url = `https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=${dateString}`;
    
    // fetchAndParse関数を使用してHTMLを取得とパース
    const { $ } = await fetchAndParse(url, `jra_${dateString}.html`);
    const races = [];

    // 競馬場ごとのレース情報を抽出
    $('.RaceList_Box').each((venueIndex, venueElement) => {
      // JRAの場合は競馬場名が .RaceList_DataTitle に格納されている
      const venueName = $(venueElement).find('.RaceList_DataTitle').text().trim().replace(/\s+/g, ' ');

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

        // レース名を取得 - JRAはRaceList_ItemTitleの中にあるItemTitle
        const raceName = $(raceElement).find('.RaceList_ItemTitle .ItemTitle').text().trim();

        // レースIDを取得（URLから抽出）
        const raceLink = $(raceElement).find('a').attr('href');
        const raceIdMatch = raceLink ? raceLink.match(/race_id=([0-9]+)/) : null;
        const raceId = raceIdMatch ? raceIdMatch[1] : null;

        if (raceId) {

          // 検証済みのレース名と開催場所を使用（後方互換性のため、cleanVenueName, cleanRaceName を使用）
          const validatedVenue = cleanVenueName(venueName);
          // レース名の処理 - 文字化けしていない限り、元のレース名を維持
          const validatedRaceName = cleanRaceName(raceName, validatedVenue, parseInt(raceNumber, 10));

          races.push({
            id: raceId,
            type: 'jra',
            venue: validatedVenue,
            number: parseInt(raceNumber, 10),
            name: validatedRaceName,
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
    const response = await axios.get(url, axiosConfig);
    
    // 文字コードをEUC-JPに指定
    const charset = 'euc-jp';
    // レスポンスをUTF-8に変換
    const html = iconv.decode(Buffer.from(response.data), charset);
    
    const $ = cheerio.load(html);

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
        horseName: cleanJapaneseText(horseName),
        jockey: cleanJapaneseText(jockey || '不明'),
        trainer: cleanJapaneseText(trainer || '不明'),
        weight,
        odds: parseFloat(odds) || 0,
        popularity: parseInt(popularity, 10) || 0
      });
    });

    const raceInfo = {
      id: raceId,
      name: cleanJapaneseText(raceName),
      courseInfo: cleanJapaneseText(courseInfo),
      raceDetails: cleanJapaneseText(raceDetails),
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

    // レスポンスをUTF-8に変換
    const html = iconv.decode(Buffer.from(response.data), charset);

    // デバッグ用にHTMLを保存
    const debugDir = path.join(process.cwd(), 'debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir);
    }
    fs.writeFileSync(path.join(debugDir, `jra_result_${raceId}.html`), html, 'utf-8');

    const $ = cheerio.load(html);

    // 修正: レース結果の存在確認方法を強化
    // 複数のセレクタで結果テーブルを検索
    const resultSelectors = [
      '.ResultTableWrap table', 
      '.Race_Result_Table',
      '.RaceTableArea table',
      '#All_Result_Table'
    ];
    
    let resultTableExists = false;
    for (const selector of resultSelectors) {
      if ($(selector).length > 0) {
        resultTableExists = true;
        break;
      }
    }
    
    // 払戻テーブルも同様に複数のセレクタで検索
    const payoutSelectors = [
      '.Payout_Detail_Table',
      '.Race_Payoff_Table',
      '.Payout table'
    ];
    
    let payoutTableExists = false;
    for (const selector of payoutSelectors) {
      if ($(selector).length > 0) {
        payoutTableExists = true;
        break;
      }
    }

    // 修正: ページに「レース結果」というテキストがあるか確認
    const hasResultText = html.includes('レース結果') || 
                          html.includes('race result') || 
                          html.includes('Result');

    // 修正: より柔軟な結果確認条件
    if (!resultTableExists && !payoutTableExists && !hasResultText) {
      logger.warn(`レース ${raceId} の結果データが見つかりません。まだレースが終了していない可能性があります。`);
      return null;
    }

    // 着順情報
    const results = [];

    // 結果テーブルがある場合のみ処理
    if (resultTableExists) {
      try {
        // 複数のセレクタから結果テーブルの行を取得
        const resultRows = $('.ResultTableWrap table tr, .Race_Result_Table tr, .RaceTableArea table tr, #All_Result_Table tr');
        
        if (resultRows.length > 0) {
          resultRows.each((index, element) => {
            // ヘッダー行をスキップ
            if (index === 0 || $(element).find('th').length > 0) {
              return;
            }

            try {
              const cells = $(element).find('td');

              // 特定のセルから情報を取得
              const order = $(cells[0]).text().trim();
              const frameNumber = $(cells.length > 1 ? cells[1] : null).text().trim();
              const horseNumber = $(cells.length > 2 ? cells[2] : null).text().trim();
              let horseName = '';
              let jockey = '';
              
              // 馬名とジョッキーの取得（複数のパターンを試行）
              for (let i = 3; i < Math.min(cells.length, 8); i++) {
                const cellText = $(cells[i]).text().trim();
                const hasLink = $(cells[i]).find('a').length > 0;
                
                if (hasLink && !horseName) {
                  horseName = $(cells[i]).find('a').text().trim();
                } else if (hasLink && !jockey && i >= 6) {
                  jockey = $(cells[i]).find('a').text().trim();
                }
              }

              // 文字化けや不正な値を検出
              const validOrder = /^[0-9０-９優除中失]+$/.test(order) || order === '';
              const validHorseName = horseName && horseName.length > 1;

              if (validOrder && validHorseName) {
                results.push({
                  order: parseInt(order, 10) || 0,
                  frameNumber: parseInt(frameNumber, 10) || 0,
                  horseNumber: parseInt(horseNumber, 10) || 0,
                  horseName: cleanJapaneseText(horseName),
                  jockey: cleanJapaneseText(jockey || '不明')
                });
              }
            } catch (rowError) {
              logger.error(`着順情報の行解析中にエラー: ${rowError}`);
            }
          });
        } else {
          // 馬名リンクからでも情報を取得
          const horseLinks = $('.Horse_Name a, .HorseName a');
          
          if (horseLinks.length > 0) {
            horseLinks.each((i, link) => {
              const horseName = $(link).text().trim();
              const parent = $(link).closest('tr');
              
              // 親要素から着順などを取得
              if (parent.length > 0) {
                const cells = parent.find('td');
                const order = cells.first().text().trim();
                const frameNumber = cells.eq(1).text().trim();
                const horseNumber = cells.eq(2).text().trim();
                
                let jockey = '不明';
                parent.find('a').each((j, a) => {
                  const aText = $(a).text().trim();
                  // リンクテキストが馬名と違えば騎手と判断
                  if (aText && aText !== horseName) {
                    jockey = aText;
                    return false; // ループ終了
                  }
                });
                
                results.push({
                  order: parseInt(order, 10) || 0,
                  frameNumber: parseInt(frameNumber, 10) || 0,
                  horseNumber: parseInt(horseNumber, 10) || 0,
                  horseName: cleanJapaneseText(horseName),
                  jockey: cleanJapaneseText(jockey)
                });
              }
            });
          }
        }
      } catch (resultsError) {
        logger.error(`着順情報の取得中にエラー: ${resultsError}`);
      }
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

    // 払戻表がある場合のみ処理
    if (payoutTableExists) {
      try {
        // 単勝
        extractPayoutData($, '.Tansho', payouts.tansho, findHorseNumbersInResult);

        // 複勝
        extractPayoutData($, '.Fukusho', payouts.fukusho, findHorseNumbersInResult, true);

        // 枠連
        extractPayoutData($, '.Wakuren', payouts.wakuren, findFrameNumbersInResult);

        // 馬連
        extractPayoutData($, '.Umaren', payouts.umaren, findHorseNumbersInResult);

        // ワイド - 修正: フラグをtrueにして複数結果として処理
        extractPayoutData($, '.Wide', payouts.wide, findHorseNumbersInResult, true);

        // 馬単
        extractPayoutData($, '.Umatan', payouts.umatan, findHorseNumbersInResult);

        // 三連複
        extractPayoutData($, '.Fuku3', payouts.sanrenpuku, findHorseNumbersInResult);

        // 三連単
        extractPayoutData($, '.Tan3', payouts.sanrentan, findHorseNumbersInResult);
      } catch (payoutsError) {
        logger.error(`払戻情報の全体処理でエラー: ${payoutsError}`);
      }
    }

    const raceResults = {
      id: raceId,
      results: results || [],
      payouts
    };

    // 結果データが存在するか確認（修正: 条件を緩和）
    // 着順だけでも、払戻だけでも、どちらか一方があれば有効な結果とみなす
    const hasValidResults = results && results.length > 0;
    const hasAnyPayouts = Object.values(payouts).some(arr => arr.length > 0);

    if (!hasValidResults && !hasAnyPayouts) {
      logger.warn(`レース ${raceId} の有効な結果データが取得できませんでした。`);
      // 修正: 空の結果でも返す（必要に応じて更新できるように）
      return {
        id: raceId,
        results: [],
        payouts: {
          tansho: [], fukusho: [], wakuren: [], umaren: [], 
          wide: [], umatan: [], sanrentan: [], sanrenpuku: []
        }
      };
    }

    logger.info(`JRA: レース ${raceId} の結果と払戻情報を取得しました。結果数: ${results ? results.length : 0}`);

    try {
      // データベースに結果を保存
      await updateJraRaceResult(raceId, raceResults);
    } catch (updateError) {
      logger.error(`レース結果の更新中にエラー: ${updateError}`);
      // エラーがあっても処理を続行
    }

    return raceResults;
  } catch (error) {
    logger.error(`JRA レース結果の取得中にエラーが発生しました: ${error}`);
    // エラーが発生した場合でもnullではなく空データを返す
    return {
      id: raceId,
      results: [],
      payouts: {
        tansho: [], fukusho: [], wakuren: [], umaren: [], 
        wide: [], umatan: [], sanrentan: [], sanrenpuku: []
      }
    };
  }
}

/**
 * HTMLから払戻情報を抽出する汎用関数
 * @param {CheerioStatic} $ - Cheerioオブジェクト
 * @param {string} selector - 払戻情報のセレクタ
 * @param {Array} targetArray - 結果を格納する配列
 * @param {Function} numbersFinder - 馬番/枠番を抽出する関数
 * @param {boolean} isMultiple - 複数の組み合わせがあるかどうか
 */
function extractPayoutData($, selector, targetArray, numbersFinder, isMultiple = false) {
  try {
    // 複数のセレクタを試す
    const elements = $(`.Payout_Detail_Table ${selector}, .Race_Payoff_Table ${selector}, .Payout ${selector}`);
    
    if (elements.length === 0) {
      return;
    }
    
    elements.each((index, element) => {
      try {
        if (isMultiple) {
          // 複数結果がある場合（複勝・ワイド）の処理
          const numberGroups = [];
          
          // 馬番グループを抽出
          $(element).find('.Result ul, .Result div').each((i, group) => {
            const numbers = [];
            $(group).find('span, li').each((j, item) => {
              const num = $(item).text().trim().replace(/\D/g, '');
              if (num) numbers.push(parseInt(num, 10));
            });
            
            if (numbers.length > 0) {
              // 修正: ワイド馬券の場合は2つずつペアにする
              if (selector === '.Wide' && numbers.length >= 2) {
                for (let n = 0; n < numbers.length; n += 2) {
                  if (n + 1 < numbers.length) {
                    numberGroups.push([numbers[n], numbers[n+1]]);
                  }
                }
              } else {
                numberGroups.push([...new Set(numbers)]); // 重複を排除
              }
            }
          });
          
          // グループが見つからない場合はすべてのテキストから抽出
          if (numberGroups.length === 0) {
            const allText = $(element).find('.Result').text().trim();
            const allNumbers = [];
            
            // テキストから数字を抽出
            const numMatches = allText.match(/\d+/g) || [];
            numMatches.forEach(num => {
              if (num && !isNaN(parseInt(num, 10))) {
                allNumbers.push(parseInt(num, 10));
              }
            });
            
            // 複勝の場合は個別の馬番を分ける
            if (selector === '.Fukusho') {
              allNumbers.forEach(n => numberGroups.push([n]));
            } 
            // ワイドの場合は2つずつペアにする
            else if (selector === '.Wide' && allNumbers.length >= 2) {
              for (let i = 0; i < allNumbers.length; i += 2) {
                if (i + 1 < allNumbers.length) {
                  numberGroups.push([allNumbers[i], allNumbers[i + 1]]);
                }
              }
            }
          }
          
          // 払戻金と人気を抽出（複数の場合は分割して取得）
          const payoutText = $(element).find('.Payout').text().trim();
          const popularityText = $(element).find('.Ninki').text().trim();
          
          const payoutValues = [];
          const popularityValues = [];
          
          // 円で区切る（複数の払戻がある場合）
          payoutText.split(/円/).forEach(p => {
            const cleaned = p.trim().replace(/[^\d]/g, '');
            if (cleaned) payoutValues.push(parseInt(cleaned, 10));
          });
          
          // 人気で区切る（複数の人気順がある場合）
          popularityText.split(/人気/).forEach(p => {
            const cleaned = p.trim().replace(/[^\d]/g, '');
            if (cleaned) popularityValues.push(parseInt(cleaned, 10));
          });
          
          // 払戻情報が不足している場合は追加
          while (payoutValues.length < numberGroups.length) {
            payoutValues.push(0);
          }
          
          while (popularityValues.length < numberGroups.length) {
            popularityValues.push(0);
          }
          
          // 各組合せの払戻情報を作成
          for (let i = 0; i < numberGroups.length; i++) {
            if (i < payoutValues.length && payoutValues[i] > 0) {
              targetArray.push({
                numbers: numberGroups[i],
                payout: payoutValues[i],
                popularity: i < popularityValues.length ? popularityValues[i] : 0
              });
            }
          }
        } else {
          // 単一結果の処理
          const numbers = numbersFinder($, element);
          
          // 重複を除去
          const uniqueNumbers = [...new Set(numbers)];
          
          const payoutText = $(element).find('.Payout span, .Payout').text().trim();
          const payout = parseInt(payoutText.replace(/[^\d]/g, ''), 10) || 0;
          
          const popularityText = $(element).find('.Ninki span, .Ninki').text().trim();
          const popularity = parseInt(popularityText.replace(/[^\d]/g, ''), 10) || 0;
          
          if (uniqueNumbers.length > 0 && payout > 0) {
            targetArray.push({
              numbers: uniqueNumbers,
              payout,
              popularity
            });
          }
        }
      } catch (err) {
        logger.error(`払戻情報の処理でエラー (${selector}): ${err}`);
      }
    });
  } catch (err) {
    logger.error(`払戻情報セレクタ処理でエラー (${selector}): ${err}`);
  }
}

/**
 * 結果要素から馬番を抽出
 * @param {CheerioStatic} $ - Cheerioオブジェクト
 * @param {Element} element - 対象要素
 * @returns {Array<number>} 馬番の配列
 */
function findHorseNumbersInResult($, element) {
  const numbers = [];

  // 単勝・複勝タイプ（spanタグ内）
  $(element).find('.Result span, .Result div span').each((i, el) => {
    const num = $(el).text().trim();
    if (num && /^\d+$/.test(num)) {
      numbers.push(parseInt(num, 10));
    }
  });

  // 馬連・三連系タイプ（li span内）
  if (numbers.length === 0) {
    $(element).find('.Result ul li span').each((i, el) => {
      const num = $(el).text().trim();
      if (num && /^\d+$/.test(num)) {
        numbers.push(parseInt(num, 10));
      }
    });
  }

  // 結果全体のテキストから数字を抽出（バックアップ）
  if (numbers.length === 0) {
    const resultText = $(element).find('.Result').text().trim();
    const numMatches = resultText.match(/\d+/g) || [];
    
    numMatches.forEach(num => {
      if (!isNaN(parseInt(num, 10))) {
        numbers.push(parseInt(num, 10));
      }
    });
  }

  return numbers;
}

/**
 * 結果要素から枠番を抽出
 * @param {CheerioStatic} $ - Cheerioオブジェクト
 * @param {Element} element - 対象要素
 * @returns {Array<number>} 枠番の配列
 */
function findFrameNumbersInResult($, element) {
  const numbers = [];

  $(element).find('.Result ul li span').each((i, el) => {
    const num = $(el).text().trim();
    if (num && /^\d+$/.test(num)) {
      numbers.push(parseInt(num, 10));
    }
  });

  // 結果全体のテキストから数字を抽出（バックアップ）
  if (numbers.length === 0) {
    const resultText = $(element).find('.Result').text().trim();
    const numMatches = resultText.match(/\d+/g) || [];
    
    numMatches.forEach(num => {
      if (!isNaN(parseInt(num, 10))) {
        numbers.push(parseInt(num, 10));
      }
    });
  }

  return numbers;
}