// services/scraper/narScraper.js の修正版
// extractNarPayout関数とupdateNarRaceResult問題の修正

import axios from 'axios';
import * as cheerio from 'cheerio';
import dayjs from 'dayjs';
import logger from '../../utils/logger.js';
// 正しいインポート - raceServiceから必要な関数をインポート
import { saveNarRace, updateNarRaceResult } from '../database/raceService.js';
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
 * NAR レース情報を取得する関数
 * @param {string} url - 取得するURL
 * @param {string} debugFileName - デバッグ用のファイル名
 * @returns {Promise<{html: string, $: CheerioStatic}>} HTML文字列とCheerioオブジェクト
 */
async function fetchAndParse(url, debugFileName) {
  logger.info(`NARデータを取得中: ${url}`);

  const response = await axios.get(url, axiosConfig);
  
  // 文字コードを動的に検出
  const charset = detectCharset(response);
  logger.debug(`検出された文字コード: ${charset}`);

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
 * 指定された日付の NAR (地方競馬) レース一覧を取得
 * @param {string} dateString - YYYYMMDD形式の日付文字列
 * @returns {Promise<Array>} レース情報の配列
 */
export async function fetchNarRaceList(dateString = getTodayDateString()) {
  try {
    const url = `https://nar.netkeiba.com/top/race_list_sub.html?kaisai_date=${dateString}`;
    
    // fetchAndParse関数を使用してHTMLを取得とパース
    const { $ } = await fetchAndParse(url, `nar_${dateString}.html`);
    const races = [];

    // HTMLの構造を確認
    logger.debug(`NAR HTML構造: .RaceList_Box 要素の数: ${$('.RaceList_Box').length}`);

    // 競馬場ごとのレース情報を抽出
    $('.RaceList_Box').each((venueIndex, venueElement) => {
      const venueName = $(venueElement).find('.RaceList_DataTitle').text().trim().replace(/\s+/g, ' ');
      logger.debug(`競馬場${venueIndex + 1}: ${venueName}`);

      $(venueElement).find('.RaceList_DataItem').each((raceIndex, raceElement) => {
        const raceNumber = $(raceElement).find('.Race_Num').text().trim().replace(/\D/g, '');
        let raceTime = '';
        
        // レース時間を取得 - 複数の候補を試す
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
        
        const raceName = $(raceElement).find('.RaceList_ItemTitle .ItemTitle').text().trim();

        logger.debug(`レース情報解析中: 番号=${raceNumber}, 時間=${raceTime}, 名前=${raceName}`);

        // レースIDを取得（URLから抽出）
        const raceLink = $(raceElement).find('a').attr('href');
        const raceIdMatch = raceLink ? raceLink.match(/race_id=([0-9]+)/) : null;
        const raceId = raceIdMatch ? raceIdMatch[1] : null;

        if (raceId) {
          logger.debug(`レース情報: ${raceNumber}R ${raceName} (${raceTime}) ID:${raceId}`);

          // 検証済みのレース名と開催場所を使用
          const validatedVenue = cleanVenueName(venueName);
          // レース名の処理 - 文字化けしていない限り、元のレース名を維持
          const validatedRaceName = cleanRaceName(raceName, validatedVenue, parseInt(raceNumber, 10));

          races.push({
            id: raceId,
            type: 'nar',
            venue: validatedVenue,
            number: parseInt(raceNumber, 10),
            name: validatedRaceName,
            time: raceTime,
            date: dateString,
            status: 'upcoming', // upcoming, in_progress, completed
            link: `https://nar.netkeiba.com/race/shutuba.html?race_id=${raceId}`
          });
        } else {
          logger.debug(`レースIDが取得できませんでした: ${raceNumber}R ${raceName}`);
        }
      });
    });

    logger.info(`NAR: ${dateString} の ${races.length} 件のレースを取得しました。`);

    // 取得したレースをデータベースに保存
    if (races.length > 0) {
      await Promise.all(races.map(race => saveNarRace(race)));
    }

    return races;
  } catch (error) {
    logger.error(`NAR レース一覧の取得中にエラーが発生しました: ${error}`);
    if (error.response) {
      logger.error(`ステータスコード: ${error.response.status}`);
      logger.error(`レスポンスヘッダー: ${JSON.stringify(error.response.headers)}`);
    }
    throw error;
  }
}

/**
 * NAR レースの出馬表情報を取得
 * @param {string} raceId - レースID
 * @returns {Promise<Object>} 出馬表情報
 */
export async function fetchNarRaceEntries(raceId) {
  try {
    const url = `https://nar.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
    const { $ } = await fetchAndParse(url, `nar_entries_${raceId}.html`);

    // レース基本情報
    const raceName = $('.RaceName').text().trim();
    let raceTime = '';
    
    // 時間抽出を複数パターン試行
    const timeMatches = $('.RaceData01').text().match(/([0-9]{1,2}:[0-9]{2})/);
    if (timeMatches && timeMatches.length > 1) {
      raceTime = timeMatches[1];
    }
    
    const raceDetails = $('.RaceData02').text().trim();

    // 出走馬情報
    const horses = [];
    
    // 複数のセレクタパターンを試行
    const horseRowSelectors = [
      '.HorseList',
      '.Shutuba_Table tr:not(:first-child)',
      '.RaceTableArea tr:not(:first-child)'
    ];
    
    let horseRows = [];
    
    // いずれかのセレクタで馬情報を取得
    for (const selector of horseRowSelectors) {
      const rows = $(selector);
      if (rows.length > 0) {
        horseRows = rows;
        break;
      }
    }
    
    horseRows.each((index, element) => {
      // 枠番と馬番の複数セレクタを試行
      const frameSelectors = ['.Waku', '.Waku1', '.Waku2', '.Waku3', '.Waku4', '.Waku5', '.Waku6', '.Waku7', '.Waku8', 'td:nth-child(1)'];
      const horseNumSelectors = ['.Umaban', '.Umaban1', '.Umaban2', '.Umaban3', '.Umaban4', '.Umaban5', '.Umaban6', '.Umaban7', '.Umaban8', 'td:nth-child(2)'];
      
      let frameNumber = '';
      let horseNumber = '';
      
      // 枠番の抽出
      for (const selector of frameSelectors) {
        const cell = $(element).find(selector);
        if (cell.length > 0) {
          frameNumber = cell.text().trim().replace(/\D/g, '');
          if (frameNumber) break;
        }
      }
      
      // 馬番の抽出
      for (const selector of horseNumSelectors) {
        const cell = $(element).find(selector);
        if (cell.length > 0) {
          horseNumber = cell.text().trim().replace(/\D/g, '');
          if (horseNumber) break;
        }
      }
      
      // 馬名、騎手、調教師の抽出
      const horseName = $(element).find('.HorseName a, td:nth-child(4) a').first().text().trim();
      const jockey = $(element).find('.Jockey a, td:nth-child(7) a').first().text().trim();
      const trainer = $(element).find('.Trainer a, td:nth-child(9) a').first().text().trim();
      const weight = $(element).find('.Weight, td:nth-child(12)').first().text().trim();
      
      // オッズと人気の抽出
      let odds = '';
      let popularity = '';
      
      const oddsSelectors = ['.Popular.Txt_R', '.Odds', 'td:nth-child(10)'];
      const popularitySelectors = ['.Popular.Txt_C span', '.Popular span', 'td:nth-child(11)'];
      
      for (const selector of oddsSelectors) {
        const cell = $(element).find(selector);
        if (cell.length > 0) {
          odds = cell.text().trim().replace(/[^\d\.]/g, '');
          if (odds) break;
        }
      }
      
      for (const selector of popularitySelectors) {
        const cell = $(element).find(selector);
        if (cell.length > 0) {
          popularity = cell.text().trim().replace(/\D/g, '');
          if (popularity) break;
        }
      }

      // 馬情報の追加（必須項目があれば）
      if (horseName && (horseNumber || frameNumber)) {
        horses.push({
          frameNumber: parseInt(frameNumber, 10) || 0,
          horseNumber: parseInt(horseNumber, 10) || 0,
          horseName: cleanJapaneseText(horseName),
          jockey: cleanJapaneseText(jockey || '不明'),
          trainer: cleanJapaneseText(trainer || '不明'),
          weight: weight || '',
          odds: parseFloat(odds) || 0,
          popularity: parseInt(popularity, 10) || 0
        });
      }
    });

    const raceInfo = {
      id: raceId,
      name: cleanJapaneseText(raceName),
      time: raceTime,
      raceDetails: cleanJapaneseText(raceDetails),
      horses
    };

    logger.info(`NAR: レース ${raceId} の出馬表を取得しました。出走頭数: ${horses.length}`);

    return raceInfo;
  } catch (error) {
    logger.error(`NAR 出馬表の取得中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * 払戻情報を抽出する関数
 * @param {CheerioStatic} $ - Cheerioオブジェクト
 * @param {Cheerio} payoutTable - 払戻表を含む要素
 * @param {string} selector - 払戻情報のセレクタ
 * @param {Array} targetArray - 結果を格納する配列
 * @param {boolean} isMultiple - 複数の組み合わせがあるかどうか
 */
function extractNarPayout($, payoutTable, selector, targetArray, isMultiple = false) {
  const elements = payoutTable.find(selector);
  
  if (elements.length === 0) {
    logger.debug(`NAR: ${selector} の要素が見つかりません`);
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
            numberGroups.push(numbers);
          }
        });
        
        // グループが見つからない場合はすべての数字を検索
        if (numberGroups.length === 0) {
          const numberElements = $(element).find('.Result span, .Result li');
          const numbers = [];
          
          numberElements.each((i, el) => {
            const num = $(el).text().trim().replace(/\D/g, '');
            if (num) {
              numbers.push(parseInt(num, 10));
            }
          });
          
          // 複勝の場合は個別の馬番を分ける
          if (selector === '.Fukusho') {
            numbers.forEach(n => {
              numberGroups.push([n]);
            });
          } 
          // ワイドの場合は2つずつペアにする
          else if (selector === '.Wide' && numbers.length >= 2) {
            for (let i = 0; i < numbers.length; i += 2) {
              if (i + 1 < numbers.length) {
                numberGroups.push([numbers[i], numbers[i + 1]]);
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
        const numbers = [];
        
        // 様々なセレクタを試行
        const numberSelectors = [
          '.Result span', 
          '.Result li', 
          '.Result ul li span',
          '.Result div span'
        ];
        
        // いずれかのセレクタで馬番を取得
        for (const numSelector of numberSelectors) {
          $(element).find(numSelector).each((i, el) => {
            const num = $(el).text().trim().replace(/\D/g, '');
            if (num) numbers.push(parseInt(num, 10));
          });
          
          if (numbers.length > 0) break;
        }
        
        // 複数のセレクタで払戻金と人気を取得
        const payoutSelectors = ['.Payout span', '.Payout'];
        const popularitySelectors = ['.Ninki span', '.Ninki'];
        
        let payoutText = '';
        let popularityText = '';
        
        for (const pSelector of payoutSelectors) {
          const elem = $(element).find(pSelector);
          if (elem.length > 0) {
            payoutText = elem.text().trim();
            break;
          }
        }
        
        for (const popSelector of popularitySelectors) {
          const elem = $(element).find(popSelector);
          if (elem.length > 0) {
            popularityText = elem.text().trim();
            break;
          }
        }
        
        const payout = parseInt(payoutText.replace(/[^\d]/g, ''), 10) || 0;
        const popularity = parseInt(popularityText.replace(/[^\d]/g, ''), 10) || 0;
        
        if (numbers.length > 0 && payout > 0) {
          targetArray.push({
            numbers,
            payout,
            popularity
          });
        }
      }
    } catch (err) {
      logger.error(`NAR: ${selector} 払戻情報の抽出でエラー: ${err}`);
    }
  });
}

/**
 * NAR レースの結果と払戻情報を取得
 * @param {string} raceId - レースID
 * @returns {Promise<Object>} 結果と払戻情報
 */
export async function fetchNarRaceResults(raceId) {
  try {
    const url = `https://nar.netkeiba.com/race/result.html?race_id=${raceId}`;
    logger.info(`NARレース結果を取得中: ${url}`);

    const { $ } = await fetchAndParse(url, `nar_result_${raceId}.html`);

    // レース結果が表示されているかを確認（複数のセレクタを試行）
    const resultSelectors = [
      '.ResultTableWrap', 
      '.Race_Result_Table', 
      '.Payout_Detail_Table',
      '.RaceTableArea'
    ];
    
    let hasResults = false;
    
    for (const selector of resultSelectors) {
      if ($(selector).length > 0) {
        hasResults = true;
        break;
      }
    }

    if (!hasResults) {
      logger.warn(`レース ${raceId} の結果データが見つかりません。まだレースが終了していない可能性があります。`);
      return null;
    }

    // 払戻情報の初期化
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

    // 着順情報の初期化
    const results = [];

    try {
      // 着順情報の抽出（複数のセレクタを試行）
      const resultTableSelectors = [
        '.Race_Result_Table tr',
        '.RaceTable01 tr',
        '.ResultTableWrap table tr'
      ];
      
      let resultRows = null;
      
      // いずれかのセレクタでテーブル行を取得
      for (const selector of resultTableSelectors) {
        const rows = $(selector);
        if (rows.length > 1) { // ヘッダー行を除いて1つ以上の行があれば採用
          resultRows = rows;
          break;
        }
      }
      
      if (resultRows && typeof resultRows.each === 'function') {
        resultRows.each((index, row) => {
          // ヘッダー行をスキップ
          if (index === 0 || $(row).find('th').length > 0) {
            return;
          }
          
          try {
            const cells = $(row).find('td');
            
            // 各セルからデータを抽出
            let order = '';
            let frameNumber = '';
            let horseNumber = '';
            let horseName = '';
            let jockey = '';
            
            // テーブル構造に応じて柔軟に対応
            for (let i = 0; i < cells.length; i++) {
              const cellText = $(cells[i]).text().trim();
              
              // 位置に基づいて情報を判別
              if (i === 0 && /^[0-9０-９優除中失]+$/.test(cellText)) {
                order = cellText;
              } else if (i === 1 && /^[1-8]$/.test(cellText)) {
                frameNumber = cellText;
              } else if (i === 2 && /^\d{1,2}$/.test(cellText)) {
                horseNumber = cellText;
              } else if (i >= 3 && i <= 4 && $(cells[i]).find('a').length > 0) {
                horseName = $(cells[i]).find('a').text().trim();
              } else if (i >= 6 && i <= 7 && $(cells[i]).find('a').length > 0) {
                jockey = $(cells[i]).find('a').text().trim();
              }
              
              // セルの内容から種類を自動判別
              if (!order && /^[0-9０-９優除中失]+$/.test(cellText)) {
                order = cellText;
              } else if (!frameNumber && /^[1-8]$/.test(cellText)) {
                frameNumber = cellText;
              } else if (!horseNumber && /^\d{1,2}$/.test(cellText)) {
                horseNumber = cellText;
              } else if (!horseName && $(cells[i]).find('a').length > 0) {
                horseName = $(cells[i]).find('a').text().trim();
              } else if (!jockey && i > 3 && $(cells[i]).find('a').length > 0) {
                jockey = $(cells[i]).find('a').text().trim();
              }
            }
            
            // 有効なデータがあれば結果に追加（最低限、馬名か馬番があれば）
            if ((order || frameNumber || horseNumber) && (horseName || horseNumber)) {
              results.push({
                order: /^\d+$/.test(order) ? parseInt(order, 10) : 0,
                frameNumber: parseInt(frameNumber, 10) || 0,
                horseNumber: parseInt(horseNumber, 10) || 0,
                horseName: cleanJapaneseText(horseName || '不明'),
                jockey: cleanJapaneseText(jockey || '不明')
              });
            }
          } catch (rowError) {
            logger.error(`NAR: 着順情報の行処理でエラー: ${rowError}`);
          }
        });
      } else {
        // 通常のセレクタが失敗した場合、別の方法を試す
        logger.debug(`通常のテーブル構造が見つかりませんでした。別の方法を試みます。`);
        
        // 馬名リンクから出走馬を取得する
        const horseLinks = $('.Horse_Name a, .HorseName a');
        
        if (horseLinks && horseLinks.length > 0) {
          horseLinks.each((index, link) => {
            try {
              const horseName = $(link).text().trim();
              const parentRow = $(link).closest('tr');
              
              let order = '0';
              let frameNumber = '0';
              let horseNumber = '0';
              let jockey = '不明';
              
              // 親行から情報を取得
              if (parentRow.length > 0) {
                const cells = parentRow.find('td');
                
                if (cells.length > 0) order = $(cells[0]).text().trim();
                if (cells.length > 1) frameNumber = $(cells[1]).text().trim();
                if (cells.length > 2) horseNumber = $(cells[2]).text().trim();
                
                // 騎手を探す
                parentRow.find('a').each((i, a) => {
                  const text = $(a).text().trim();
                  if (text !== horseName && text.length > 1) {
                    jockey = text;
                  }
                });
              }
              
              results.push({
                order: /^\d+$/.test(order) ? parseInt(order, 10) : 0,
                frameNumber: parseInt(frameNumber, 10) || 0,
                horseNumber: parseInt(horseNumber, 10) || 0,
                horseName: cleanJapaneseText(horseName),
                jockey: cleanJapaneseText(jockey)
              });
            } catch (linkError) {
              logger.error(`NAR: 馬名リンク処理でエラー: ${linkError}`);
            }
          });
        }
      }
      
      logger.debug(`レース ${raceId} の着順情報: ${results.length}件`);
      
      // 払戻情報の抽出（複数のセレクタを試行）
      const payoutSelectors = ['.Payout_Detail_Table', '.Payout'];
      let payoutTable = null;
      
      for (const selector of payoutSelectors) {
        const table = $(selector);
        if (table.length > 0) {
          payoutTable = table;
          break;
        }
      }
      
      if (payoutTable) {
        // 単勝
        try {
          extractNarPayout($, payoutTable, '.Tansho', payouts.tansho, false);
        } catch (e) {
          logger.error(`NAR: 単勝情報の抽出でエラー: ${e}`);
        }
        
        // 複勝（複数結果あり）
        try {
          extractNarPayout($, payoutTable, '.Fukusho', payouts.fukusho, true);
        } catch (e) {
          logger.error(`NAR: 複勝情報の抽出でエラー: ${e}`);
        }
        
        // 枠連
        try {
          extractNarPayout($, payoutTable, '.Wakuren', payouts.wakuren, false);
        } catch (e) {
          logger.error(`NAR: 枠連情報の抽出でエラー: ${e}`);
        }
        
        // 馬連
        try {
          extractNarPayout($, payoutTable, '.Umaren', payouts.umaren, false);
        } catch (e) {
          logger.error(`NAR: 馬連情報の抽出でエラー: ${e}`);
        }
        
        // ワイド（複数結果あり）
        try {
          extractNarPayout($, payoutTable, '.Wide', payouts.wide, true);
        } catch (e) {
          logger.error(`NAR: ワイド情報の抽出でエラー: ${e}`);
        }
        
        // 馬単
        try {
          extractNarPayout($, payoutTable, '.Umatan', payouts.umatan, false);
        } catch (e) {
          logger.error(`NAR: 馬単情報の抽出でエラー: ${e}`);
        }
        
        // 三連複
        try {
          extractNarPayout($, payoutTable, '.Fuku3', payouts.sanrenpuku, false);
        } catch (e) {
          logger.error(`NAR: 三連複情報の抽出でエラー: ${e}`);
        }
        
        // 三連単
        try {
          extractNarPayout($, payoutTable, '.Tan3', payouts.sanrentan, false);
        } catch (e) {
          logger.error(`NAR: 三連単情報の抽出でエラー: ${e}`);
        }
      } else {
        logger.warn(`レース ${raceId} の払戻情報テーブルが見つかりません。`);
      }

      const raceResults = {
        id: raceId,
        results: results || [],
        payouts
      };

      // 結果データが存在するか確認
      const hasValidResults = results && results.length > 0;
      const hasAnyPayouts = Object.values(payouts).some(arr => arr.length > 0);

      if (!hasValidResults && !hasAnyPayouts) {
        logger.warn(`レース ${raceId} の有効な結果データが取得できませんでした。`);
        return null;
      }

      logger.info(`NAR: レース ${raceId} の結果と払戻情報を取得しました。結果数: ${results ? results.length : 0}`);

      try {
        // データベースに結果を保存
        await updateNarRaceResult(raceId, raceResults);
      } catch (updateError) {
        logger.error(`レース結果の更新中にエラー: ${updateError}`);
        // エラーがあっても処理を続行
      }

      return raceResults;
    } catch (error) {
      logger.error(`NAR レース結果の処理中にエラーが発生しました: ${error}`);
      throw error;
    }
  } catch (error) {
    logger.error(`NAR レース結果の取得中にエラーが発生しました: ${error}`);
    throw error;
  }
}