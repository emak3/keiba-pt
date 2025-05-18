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

    // 競馬場ごとのレース情報を抽出
    $('.RaceList_Box').each((venueIndex, venueElement) => {
      const venueName = $(venueElement).find('.RaceList_DataTitle').text().trim().replace(/\s+/g, ' ');

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

        // レースIDを取得（URLから抽出）
        const raceLink = $(raceElement).find('a').attr('href');
        const raceIdMatch = raceLink ? raceLink.match(/race_id=([0-9]+)/) : null;
        const raceId = raceIdMatch ? raceIdMatch[1] : null;

        if (raceId) {

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
 * NAR用の払戻情報を抽出する関数（完全修正版）
 * @param {CheerioStatic} $ - Cheerioオブジェクト
 * @param {Cheerio} payoutTable - 払戻表を含む要素
 * @param {string} selector - 払戻情報のセレクタ
 * @param {Array} targetArray - 結果を格納する配列
 * @param {boolean} isMultiple - 複数の組み合わせがあるかどうか
 */
function extractNarPayout($, payoutTable, selector, targetArray, isMultiple = false) {
  try {
    // デバッグ情報
    console.log(`NAR払戻情報抽出: ${selector} の処理を開始`);

    const elements = payoutTable.find(selector);

    if (elements.length === 0) {
      console.log(`セレクタ ${selector} に該当する要素が見つかりませんでした`);

      // 三連単の場合、複数のセレクタを試す
      if (selector === '.Tan3') {
        const altSelectors = ['.Sanrentan', '.SanrenTan', '.Rentan3', '.SanTan'];
        for (const altSelector of altSelectors) {
          const altElements = payoutTable.find(altSelector);
          if (altElements.length > 0) {
            console.log(`代替セレクタ ${altSelector} で要素が見つかりました`);
            elements = altElements;
            break;
          }
        }
      }

      if (elements.length === 0) {
        return;
      }
    }

    elements.each((index, element) => {
      try {
        if (isMultiple) {
          // 複数結果がある場合（複勝・ワイド）の処理
          const uniqueCombinations = new Map(); // 組み合わせを一意に特定するためのマップ

          // テキスト全体から数値を抽出
          const rawResultText = $(element).find('.Result').text().trim();
          console.log(`NAR複数結果の生テキスト: ${rawResultText}`);

          // 馬番グループを抽出
          const horseGroups = [];
          const payoutValues = [];
          const popularityValues = [];

          // 馬番グループを抽出する処理
          $(element).find('.Result ul, .Result div').each((i, group) => {
            const numbers = [];
            $(group).find('span, li').each((j, item) => {
              const num = $(item).text().trim().replace(/\D/g, '');
              if (num) numbers.push(parseInt(num, 10));
            });

            if (numbers.length > 0) {
              horseGroups.push([...new Set(numbers)]); // 重複を排除
            }
          });

          // 全ての組み合わせテキストから抽出するバックアップ処理
          if (horseGroups.length === 0) {
            console.log(`グループからの抽出に失敗、テキスト全体から抽出を試みます`);

            // 各種パターンでの抽出を試みる
            const patternsToTry = [
              /(\d+)-(\d+)/g,   // 12-13形式
              /(\d+)→(\d+)/g,   // 12→13形式
              /(\d+)⇒(\d+)/g,   // 12⇒13形式
              /(\d+)[^\d]+(\d+)/g  // 数字間に何かある形式
            ];

            for (const pattern of patternsToTry) {
              const matches = [...rawResultText.matchAll(pattern)];
              if (matches.length > 0) {
                for (const match of matches) {
                  const nums = [];
                  for (let i = 1; i < match.length; i++) {
                    if (match[i] && !isNaN(parseInt(match[i], 10))) {
                      nums.push(parseInt(match[i], 10));
                    }
                  }
                  if (nums.length > 0) {
                    horseGroups.push(nums);
                  }
                }
                break; // 最初に成功したパターンで処理を終了
              }
            }

            // 上記でも取得できない場合は単純に数値を抽出してグループ化
            if (horseGroups.length === 0) {
              const allNumbers = [];
              const numMatches = rawResultText.match(/\d+/g) || [];
              numMatches.forEach(num => {
                if (num && !isNaN(parseInt(num, 10))) {
                  allNumbers.push(parseInt(num, 10));
                }
              });

              if (selector === '.Fukusho') {
                // 複勝は個別の馬番
                allNumbers.forEach(n => horseGroups.push([n]));
              } else if (selector === '.Wide') {
                // ワイドは2頭ずつ（隣接する数値をペアに）
                for (let i = 0; i < allNumbers.length; i++) {
                  for (let j = i + 1; j < allNumbers.length; j++) {
                    // 同じ数値のペアは除外
                    if (allNumbers[i] !== allNumbers[j]) {
                      horseGroups.push([allNumbers[i], allNumbers[j]]);
                      break; // 各数値について最初の組み合わせのみ
                    }
                  }
                }
              }
            }
          }

          console.log(`抽出された馬番グループ: ${JSON.stringify(horseGroups)}`);

          // 払戻金と人気を抽出
          const payoutText = $(element).find('.Payout').text().trim();
          const popularityText = $(element).find('.Ninki').text().trim();

          console.log(`払戻金テキスト: ${payoutText}`);
          console.log(`人気テキスト: ${popularityText}`);

          // 払戻金の抽出改善
          const payoutMatches = payoutText.match(/(\d[\d,]*)円/g) || [];
          payoutMatches.forEach(p => {
            const num = p.replace(/[^\d,]/g, '').replace(/,/g, '');
            if (num) payoutValues.push(parseInt(num, 10));
          });

          // フォールバック
          if (payoutValues.length === 0) {
            const cleanedText = payoutText.replace(/,/g, ''); // カンマを除去
            const payoutParts = cleanedText.split('円');
            payoutParts.forEach(p => {
              const cleaned = p.trim().replace(/[^\d]/g, '');
              if (cleaned) payoutValues.push(parseInt(cleaned, 10));
            });
          }

          // 人気順の抽出
          const popularityMatches = popularityText.match(/(\d+)人気/g) || [];
          popularityMatches.forEach(p => {
            const num = p.replace(/[^\d]/g, '');
            if (num) popularityValues.push(parseInt(num, 10));
          });

          // フォールバック
          if (popularityValues.length === 0) {
            const popularityParts = popularityText.split('人気');
            popularityParts.forEach(p => {
              const cleaned = p.trim().replace(/[^\d]/g, '');
              if (cleaned) popularityValues.push(parseInt(cleaned, 10));
            });
          }

          console.log(`抽出された払戻金: ${JSON.stringify(payoutValues)}`);
          console.log(`抽出された人気順: ${JSON.stringify(popularityValues)}`);

          // 特別処理: ワイド馬券の重複排除
          if (selector === '.Wide') {
            const processedGroups = [];
            const processedPayouts = [];
            const processedPopularities = [];
            const processedKeys = new Set();

            for (let i = 0; i < horseGroups.length; i++) {
              // 2頭の組み合わせか確認
              if (horseGroups[i].length === 2) {
                // 組み合わせをソートして正規化
                const sortedGroup = [...horseGroups[i]].sort((a, b) => a - b);
                const key = sortedGroup.join('-');

                // 重複チェック
                if (!processedKeys.has(key)) {
                  processedKeys.add(key);
                  processedGroups.push(sortedGroup);

                  if (i < payoutValues.length) {
                    processedPayouts.push(payoutValues[i]);
                  } else {
                    processedPayouts.push(0);
                  }

                  if (i < popularityValues.length) {
                    processedPopularities.push(popularityValues[i]);
                  } else {
                    processedPopularities.push(0);
                  }
                }
              }
            }

            // 処理済みデータで置き換え
            horseGroups.length = 0;
            payoutValues.length = 0;
            popularityValues.length = 0;

            horseGroups.push(...processedGroups);
            payoutValues.push(...processedPayouts);
            popularityValues.push(...processedPopularities);

            console.log(`ワイド重複排除後: ${JSON.stringify(horseGroups)}`);
          }

          // 欠落データの補完
          while (payoutValues.length < horseGroups.length) {
            payoutValues.push(0);
          }

          while (popularityValues.length < horseGroups.length) {
            popularityValues.push(0);
          }

          // 各組合せの払戻情報を作成
          for (let i = 0; i < horseGroups.length; i++) {
            if (i < payoutValues.length && payoutValues[i] > 0 && horseGroups[i].length > 0) {
              targetArray.push({
                numbers: horseGroups[i],
                payout: payoutValues[i],
                popularity: i < popularityValues.length ? popularityValues[i] : 0
              });
            }
          }

          console.log(`${selector} の処理結果: ${JSON.stringify(targetArray)}`);
        } else {
          // 単一結果の処理（例：単勝、馬連、三連単など）
          const numbers = [];

          // 様々なセレクタを試行して馬番を抽出
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

          // テキスト全体から数値を抽出（バックアップ）
          if (numbers.length === 0) {
            const resultText = $(element).find('.Result').text().trim();

            // 「〇-〇-〇」のような形式を探す
            const dashFormat = resultText.match(/(\d+)-(\d+)(?:-(\d+))?/);
            if (dashFormat) {
              for (let i = 1; i < dashFormat.length; i++) {
                if (dashFormat[i] && !isNaN(parseInt(dashFormat[i], 10))) {
                  numbers.push(parseInt(dashFormat[i], 10));
                }
              }
            }
            // 「〇→〇→〇」のような形式を探す
            else if (resultText.includes('→')) {
              const arrowFormat = resultText.match(/(\d+)→(\d+)(?:→(\d+))?/);
              if (arrowFormat) {
                for (let i = 1; i < arrowFormat.length; i++) {
                  if (arrowFormat[i] && !isNaN(parseInt(arrowFormat[i], 10))) {
                    numbers.push(parseInt(arrowFormat[i], 10));
                  }
                }
              }
            }
            // 単純に数字を抽出
            else {
              const numMatches = resultText.match(/\d+/g) || [];
              numMatches.forEach(num => {
                if (num) numbers.push(parseInt(num, 10));
              });
            }
          }

          // 重複を排除した配列
          const uniqueNumbers = [...new Set(numbers)];

          console.log(`${selector} の抽出された馬番: ${JSON.stringify(uniqueNumbers)}`);

          // 三連単の特別処理
          if (selector === '.Tan3' && uniqueNumbers.length === 0) {
            console.log(`三連単の特別処理を試行`);

            // テキスト全体から抽出
            const resultText = $(element).find('.Result').text().trim();
            console.log(`三連単の結果テキスト: ${resultText}`);

            // 特殊パターンでの抽出を試みる
            const patternMatches = resultText.match(/(\d+)[^\d]+(\d+)[^\d]+(\d+)/);
            if (patternMatches && patternMatches.length >= 4) {
              for (let i = 1; i < 4; i++) {
                if (patternMatches[i] && !isNaN(parseInt(patternMatches[i], 10))) {
                  uniqueNumbers.push(parseInt(patternMatches[i], 10));
                }
              }
            }

            // それでも取得できない場合は単純に数値を抽出
            if (uniqueNumbers.length === 0) {
              const numMatches = resultText.match(/\d+/g) || [];
              const tempNumbers = [];
              numMatches.forEach(num => {
                if (!isNaN(parseInt(num, 10))) {
                  tempNumbers.push(parseInt(num, 10));
                }
              });

              // 先頭から最大3つの数値を使用
              for (let i = 0; i < Math.min(3, tempNumbers.length); i++) {
                uniqueNumbers.push(tempNumbers[i]);
              }
            }

            console.log(`三連単の特別処理結果: ${JSON.stringify(uniqueNumbers)}`);
          }

          // 修正: 枠連で同一枠の場合はデュプリケート
          if (selector === '.Wakuren' && uniqueNumbers.length === 1) {
            uniqueNumbers.push(uniqueNumbers[0]);
          }

          // 修正: 払戻金を正確に抽出
          const payoutText = $(element).find('.Payout span, .Payout').text().trim();
          let payout = 0;

          // 数値のみのパターンを検出（カンマ区切りにも対応）
          const payoutMatch = payoutText.match(/(\d[\d,]*)円/);
          if (payoutMatch && payoutMatch[1]) {
            payout = parseInt(payoutMatch[1].replace(/,/g, ''), 10);
          } else {
            // 従来の方法でも試す
            payout = parseInt(payoutText.replace(/[^\d]/g, ''), 10) || 0;
          }

          // 人気順を抽出
          const popularityText = $(element).find('.Ninki span, .Ninki').text().trim();
          let popularity = 0;

          // 数値のみのパターンを検出
          const popularityMatch = popularityText.match(/(\d+)人気/);
          if (popularityMatch && popularityMatch[1]) {
            popularity = parseInt(popularityMatch[1], 10);
          } else {
            // 従来の方法でも試す
            popularity = parseInt(popularityText.replace(/[^\d]/g, ''), 10) || 0;
          }

          console.log(`${selector} の払戻金: ${payout}円, 人気: ${popularity}人気`);

          // 有効な情報のみを追加
          if (uniqueNumbers.length > 0 && payout > 0) {
            targetArray.push({
              numbers: uniqueNumbers,
              payout,
              popularity
            });

            console.log(`${selector} を追加: ${JSON.stringify({
              numbers: uniqueNumbers,
              payout,
              popularity
            })}`);
          }
        }
      } catch (err) {
        console.error(`NAR払戻情報の処理でエラー (${selector}): ${err}`);
      }
    });
  } catch (err) {
    console.error(`NAR払戻情報セレクタ処理でエラー (${selector}): ${err}`);
  }
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

    // 修正: レース結果の存在確認方法を強化
    // 複数のセレクタでレース結果テーブルを検索
    const resultSelectors = [
      '.Race_Result_Table',
      '.RaceTable01',
      '.ResultTableWrap table',
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
      '.Payout table',
      '.Payout'
    ];

    let payoutTableExists = false;
    for (const selector of payoutSelectors) {
      if ($(selector).length > 0) {
        payoutTableExists = true;
        break;
      }
    }

    // 修正: ページに「レース結果」というテキストがあるか確認
    const hasResultText = $('html').text().includes('レース結果') ||
      $('html').text().includes('race result') ||
      $('html').text().includes('Result');

    // 修正: より柔軟な結果確認条件
    if (!resultTableExists && !payoutTableExists && !hasResultText) {
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
        '.ResultTableWrap table tr',
        '.RaceTableArea table tr',
        '#All_Result_Table tr'
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

      // 払戻情報の抽出（複数のセレクタを試行）
      const payoutTableSelectors = [
        '.Payout_Detail_Table',
        '.Race_Payoff_Table',
        '.Payout'
      ];

      let payoutTable = null;

      for (const selector of payoutTableSelectors) {
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

        // ワイド（複数結果あり）- 修正: フラグをtrueにして複数結果として処理
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