import axios from 'axios';
import * as cheerio from 'cheerio';
import dayjs from 'dayjs';
import logger from '../../utils/logger.js';
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { v4 as uuidv4 } from 'uuid';
import { saveJraRace, saveNarRace } from '../database/raceService.js';

/**
 * レスポンスの文字セットを検出 (強化版)
 * @param {Object} response - Axiosレスポンス
 * @returns {string} 文字セット名
 */
function detectCharset(response) {
    // HTTP헤더で宣言されたCharsetを確認
    const contentType = response.headers['content-type'] || '';
    const charsetMatch = contentType.match(/charset=([^;]+)/i);

    if (charsetMatch) {
        const charset = charsetMatch[1].trim().toLowerCase();
        logger.debug(`Content-Typeヘッダーから文字セット検出: ${charset}`);
        return charset;
    }

    try {
        // metaタグで宣言されたcharsetを検出（UTF-8でまず試してみる）
        const utf8Sample = iconv.decode(Buffer.from(response.data), 'utf-8');
        const metaCharsetMatch = utf8Sample.match(/<meta[^>]*charset=["']?([^"'>]+)/i);

        if (metaCharsetMatch) {
            const charset = metaCharsetMatch[1].trim().toLowerCase();
            logger.debug(`metaタグから文字セット検出: ${charset}`);
            return charset;
        }

        // EUC-JPで試してみる
        const eucJpSample = iconv.decode(Buffer.from(response.data), 'euc-jp');
        const eucMetaCharsetMatch = eucJpSample.match(/<meta[^>]*charset=["']?([^"'>]+)/i);

        if (eucMetaCharsetMatch) {
            const charset = eucMetaCharsetMatch[1].trim().toLowerCase();
            logger.debug(`EUC-JP解釈からmeta文字セット検出: ${charset}`);
            return charset;
        }
    } catch (error) {
        logger.debug(`metaタグからの文字セット検出に失敗: ${error}`);
    }

    // netkeiba.comはEUC-JPを使っていることが多い
    logger.debug(`文字セットが検出できませんでした。netkeiba.comのため、EUC-JPを使用します。`);
    return 'euc-jp';
}

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
      // リクエスト設定をシンプル化
      const config = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Charset': 'utf-8, euc-jp, shift_jis'
        },
        responseType: 'arraybuffer'
      };
      
      // リクエスト実行
      const response = await axios.get(url, config);
      
      // 直接EUC-JPでデコード
      const html = iconv.decode(Buffer.from(response.data), 'EUC-JP');
      
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

                    races.push({
                        id: raceId,
                        type: 'jra',
                        venue: venueName,
                        number: parseInt(raceNumber, 10) || raceIndex + 1,
                        name: raceName,
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

                    races.push({
                        id: raceId,
                        type: 'nar',
                        venue: venueName,
                        number: parseInt(raceNumber, 10) || raceIndex + 1,
                        name: raceName,
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

// その他必要な強化版関数も同様に実装...