import axios from 'axios';
import * as cheerio from 'cheerio';
import dayjs from 'dayjs';
import logger from '../../utils/logger.js';
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { v4 as uuidv4 } from 'uuid';
import { saveJraRace, saveNarRace } from '../database/raceService.js';

// 文字エンコーディング関連の関数をインポート
import { 
    detectCharset, 
    validateRaceName, 
    validateVenueName, 
    cleanJapaneseText, 
    recommendedAxiosConfig 
} from '../../utils/textCleaner.js';

/**
 * 強化版スクレイピング処理
 * @param {string} url - 取得するURL
 * @param {string} debugFilename - デバッグ用ファイル名
 * @returns {Promise<{$: CheerioStatic, html: string}>} パース済みCheerioオブジェクトとHTML
 */
async function fetchAndParse(url, debugFilename = null) {
  let retryCount = 0;
  const maxRetries = 3;
  let delay = 1000; // 初期遅延1秒
  
  logger.info(`データ取得中: ${url}`);
  
  while (retryCount < maxRetries) {
    try {
      // リクエスト設定を適用
      const config = recommendedAxiosConfig;
      
      // リクエスト実行
      const response = await axios.get(url, config);
      
      // 文字コードを検出
      const charset = detectCharset(response);
      logger.debug(`検出された文字コード: ${charset}`);
      
      // 指定された文字コードでデコード
      const html = iconv.decode(Buffer.from(response.data), charset);
      
      // デバッグ用にファイル保存
      if (debugFilename) {
        const debugDir = path.join(process.cwd(), 'debug');
        if (!fs.existsSync(debugDir)) {
          fs.mkdirSync(debugDir);
        }
        
        // デコードしたHTMLを保存
        fs.writeFileSync(path.join(debugDir, debugFilename), html, 'utf-8');
      }
      
      // Cheerioでパース
      const $ = cheerio.load(html, {
        decodeEntities: false // HTML実体参照をデコードしない
      });
      
      return { $, html };
      
    } catch (error) {
      retryCount++;
      
      if (retryCount >= maxRetries) {
        logger.error(`最大再試行回数(${maxRetries})に達しました: ${error}`);
        throw error;
      }
      
      logger.warn(`リクエスト失敗 (${retryCount}/${maxRetries}): ${error}. ${delay}ms後に再試行します。`);
      
      // 指数バックオフで待機
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // 次回の待機時間を2倍に
    }
  }
}

/**
 * 今日の日付を「YYYYMMDD」形式で取得
 * @returns {string} YYYYMMDD形式の日付
 */
function getTodayDateString() {
    return dayjs().format('YYYYMMDD');
}

/**
 * 強化版JRAレース一覧取得
 * @param {string} dateString - YYYYMMDD形式の日付
 * @returns {Promise<Array>} レース一覧
 */
export async function fetchJraRaceListEnhanced(dateString = getTodayDateString()) {
    try {
        const url = `https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=${dateString}`;
        const debugFilename = `jra_${dateString}_${uuidv4().substring(0, 8)}.html`;

        // 強化版の取得・パース処理
        const { $ } = await fetchAndParse(url, debugFilename);

        const races = [];

        // 競馬場ごとに処理
        $('.RaceList_Box').each((venueIndex, venueElement) => {
            // 競馬場名を取得
            const venueName = $(venueElement).find('.RaceList_DataTitle').text().trim();
            logger.debug(`競馬場${venueIndex + 1}: ${venueName}`);

            // 各レースを処理
            $(venueElement).find('.RaceList_DataItem').each((raceIndex, raceElement) => {
                // レース番号
                const raceNumber = $(raceElement).find('.Race_Num').text().trim().replace(/\D/g, '');

                // レース時間
                let raceTime = '';
                const timeSelectors = ['.RaceData span', '.RaceData', '.RaceList_Itemtime'];

                for (const selector of timeSelectors) {
                    const timeElement = $(raceElement).find(selector);
                    if (timeElement.length > 0) {
                        const timeText = timeElement.text().trim();
                        const match = timeText.match(/(\d{1,2}:\d{2})/);
                        if (match) {
                            raceTime = match[1];
                            break;
                        }
                    }
                }

                // レース名
                const raceName = $(raceElement).find('.RaceList_ItemTitle .ItemTitle').text().trim();

                // レースID取得
                const raceLink = $(raceElement).find('a').attr('href');
                const raceIdMatch = raceLink ? raceLink.match(/race_id=([0-9]+)/) : null;
                const raceId = raceIdMatch ? raceIdMatch[1] : null;

                if (raceId) {
                    // レース情報をログ出力
                    logger.debug(`レース情報: ${raceNumber}R ${raceName} (${raceTime}) ID:${raceId}`);

                    // 文字化けチェック
                    const hasGarbledName = /[\uFFFD\u30FB\u309A-\u309C]/.test(raceName) ||
                        raceName.includes('��') ||
                        raceName.includes('□') ||
                        raceName.includes('�');

                    if (hasGarbledName) {
                        logger.warn(`レース名が文字化けしている可能性: ${raceName}`);
                    }

                    // 検証済みの競馬場名とレース名を使用
                    const validatedVenue = validateVenueName(venueName);
                    const validatedRaceName = validateRaceName(raceName, validatedVenue, parseInt(raceNumber, 10));

                    races.push({
                        id: raceId,
                        type: 'jra',
                        venue: validatedVenue,
                        number: parseInt(raceNumber, 10) || raceIndex + 1,
                        name: validatedRaceName,
                        time: raceTime,
                        date: dateString,
                        status: 'upcoming',
                        link: `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`
                    });
                }
            });
        });

        logger.info(`JRA: ${dateString} の ${races.length} 件のレースを取得しました。`);

        // データベースに保存
        if (races.length > 0) {
            await Promise.all(races.map(race => saveJraRace(race)));
        }

        return races;
    } catch (error) {
        logger.error(`JRAレース一覧取得中にエラー: ${error}`);
        throw error;
    }
}

/**
 * 強化版NARレース一覧取得
 * @param {string} dateString - YYYYMMDD形式の日付
 * @returns {Promise<Array>} レース一覧
 */
export async function fetchNarRaceListEnhanced(dateString = getTodayDateString()) {
    try {
        const url = `https://nar.netkeiba.com/top/race_list_sub.html?kaisai_date=${dateString}`;
        const debugFilename = `nar_${dateString}_${uuidv4().substring(0, 8)}.html`;

        // 強化版の取得・パース処理
        const { $ } = await fetchAndParse(url, debugFilename);

        const races = [];

        // 競馬場ごとに処理
        $('.RaceList_Box').each((venueIndex, venueElement) => {
            // 競馬場名を取得
            const venueName = $(venueElement).find('.RaceList_DataTitle').text().trim();
            logger.debug(`競馬場${venueIndex + 1}: ${venueName}`);

            // 各レースを処理
            $(venueElement).find('.RaceList_DataItem').each((raceIndex, raceElement) => {
                // レース番号
                const raceNumber = $(raceElement).find('.Race_Num').text().trim().replace(/\D/g, '');

                // レース時間
                let raceTime = '';
                const timeSelectors = ['.RaceData span', '.RaceData', '.RaceList_Itemtime'];

                for (const selector of timeSelectors) {
                    const timeElement = $(raceElement).find(selector);
                    if (timeElement.length > 0) {
                        const timeText = timeElement.text().trim();
                        const match = timeText.match(/(\d{1,2}:\d{2})/);
                        if (match) {
                            raceTime = match[1];
                            break;
                        }
                    }
                }

                // レース名
                const raceName = $(raceElement).find('.RaceList_ItemTitle .ItemTitle').text().trim();

                // レースID取得
                const raceLink = $(raceElement).find('a').attr('href');
                const raceIdMatch = raceLink ? raceLink.match(/race_id=([0-9]+)/) : null;
                const raceId = raceIdMatch ? raceIdMatch[1] : null;

                if (raceId) {
                    // レース情報をログ出力
                    logger.debug(`レース情報: ${raceNumber}R ${raceName} (${raceTime}) ID:${raceId}`);

                    // 文字化けチェック
                    const hasGarbledName = /[\uFFFD\u30FB\u309A-\u309C]/.test(raceName) ||
                        raceName.includes('��') ||
                        raceName.includes('□') ||
                        raceName.includes('�');

                    if (hasGarbledName) {
                        logger.warn(`レース名が文字化けしている可能性: ${raceName}`);
                    }

                    // 検証済みの競馬場名とレース名を使用
                    const validatedVenue = validateVenueName(venueName);
                    const validatedRaceName = validateRaceName(raceName, validatedVenue, parseInt(raceNumber, 10));

                    races.push({
                        id: raceId,
                        type: 'nar',
                        venue: validatedVenue,
                        number: parseInt(raceNumber, 10) || raceIndex + 1,
                        name: validatedRaceName,
                        time: raceTime,
                        date: dateString,
                        status: 'upcoming',
                        link: `https://nar.netkeiba.com/race/shutuba.html?race_id=${raceId}`
                    });
                }
            });
        });

        logger.info(`NAR: ${dateString} の ${races.length} 件のレースを取得しました。`);

        // データベースに保存
        if (races.length > 0) {
            await Promise.all(races.map(race => saveNarRace(race)));
        }

        return races;
    } catch (error) {
        logger.error(`NARレース一覧取得中にエラー: ${error}`);
        throw error;
    }
}

/**
 * JRAレースの出走馬情報を取得 - 強化版
 * @param {string} raceId - レースID
 * @returns {Promise<Array>} 出走馬情報
 */
export async function fetchJraHorsesEnhanced(raceId) {
    try {
        const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
        const debugFilename = `jra_horses_${raceId}_${uuidv4().substring(0, 8)}.html`;

        // 強化版の取得・パース処理
        const { $ } = await fetchAndParse(url, debugFilename);

        const horses = [];

        // 出走馬テーブルを処理
        $('.HorseList').each((index, element) => {
            const frameNumber = $(element).find('.Waku').text().trim();
            const horseNumber = $(element).find('.Umaban').text().trim();
            const horseName = $(element).find('.HorseName a').text().trim();
            const jockey = $(element).find('.Jockey a').text().trim();
            const trainer = $(element).find('.Trainer a').text().trim();
            const weight = $(element).find('.Weight').text().trim();
            const odds = $(element).find('.Popular span').first().text().trim();
            const popularity = $(element).find('.Popular_Ninki span').text().trim();

            // 馬名の文字化けチェック
            const hasGarbledName = /[\uFFFD\u30FB\u309A-\u309C]/.test(horseName) ||
                horseName.includes('��') ||
                horseName.includes('□') ||
                horseName.includes('�');

            if (hasGarbledName) {
                logger.warn(`馬名が文字化けしている可能性: ${horseName}`);
            }

            // 馬情報を追加
            horses.push({
                frameNumber: parseInt(frameNumber, 10) || 0,
                horseNumber: parseInt(horseNumber, 10) || 0,
                horseName: cleanJapaneseText(horseName) || `${horseNumber}番馬`,
                jockey: cleanJapaneseText(jockey) || '騎手不明',
                trainer: cleanJapaneseText(trainer) || '調教師不明',
                weight: weight || '',
                odds: parseFloat(odds) || 0,
                popularity: parseInt(popularity, 10) || 0
            });
        });

        logger.info(`JRA: レース ${raceId} の出走馬情報 ${horses.length} 件を取得しました。`);
        return horses;
    } catch (error) {
        logger.error(`JRA出走馬情報取得中にエラー: ${error}`);
        throw error;
    }
}

/**
 * NARレースの出走馬情報を取得 - 強化版
 * @param {string} raceId - レースID
 * @returns {Promise<Array>} 出走馬情報
 */
export async function fetchNarHorsesEnhanced(raceId) {
    try {
        const url = `https://nar.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
        const debugFilename = `nar_horses_${raceId}_${uuidv4().substring(0, 8)}.html`;

        // 強化版の取得・パース処理
        const { $ } = await fetchAndParse(url, debugFilename);

        const horses = [];

        // 出走馬テーブルを処理（複数のセレクタパターンを試行）
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
        
        // 各行を処理
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

            // 馬名の文字化けチェック
            const hasGarbledName = /[\uFFFD\u30FB\u309A-\u309C]/.test(horseName) ||
                horseName.includes('��') ||
                horseName.includes('□') ||
                horseName.includes('�');

            if (hasGarbledName) {
                logger.warn(`馬名が文字化けしている可能性: ${horseName}`);
            }

            // 馬情報の追加（必須項目があれば）
            if (horseName && (horseNumber || frameNumber)) {
                horses.push({
                    frameNumber: parseInt(frameNumber, 10) || 0,
                    horseNumber: parseInt(horseNumber, 10) || 0,
                    horseName: cleanJapaneseText(horseName) || `${horseNumber}番馬`,
                    jockey: cleanJapaneseText(jockey) || '騎手不明',
                    trainer: cleanJapaneseText(trainer) || '調教師不明',
                    weight: weight || '',
                    odds: parseFloat(odds) || 0,
                    popularity: parseInt(popularity, 10) || 0
                });
            }
        });

        logger.info(`NAR: レース ${raceId} の出走馬情報 ${horses.length} 件を取得しました。`);
        return horses;
    } catch (error) {
        logger.error(`NAR出走馬情報取得中にエラー: ${error}`);
        throw error;
    }
}