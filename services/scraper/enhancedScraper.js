// 修正バージョン - TypeScriptエラー解決済み

import axios from 'axios';
import * as cheerio from 'cheerio';
import dayjs from 'dayjs';
import logger from '../../utils/logger.js';
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { v4 as uuidv4 } from 'uuid';
import { saveJraRace, saveNarRace, getRaceById } from '../database/raceService.js';

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
 * レースIDから会場コードを抽出して検証
 * @param {string} raceId - レースID
 * @returns {string} 会場コード
 */
function extractVenueCodeFromRaceId(raceId) {
    // レースIDのフォーマット: YYMMPPDDRR (年月日会場R)
    // 例: 202535051311 (2025年・35(盛岡)・05(月日)・13(レース番号))
    if (raceId && raceId.length >= 8) {
        return raceId.substring(4, 6);
    }
    return '00';
}

/**
 * 会場コードからレース種別を判定
 * @param {string} venueCode - 会場コード
 * @returns {string} レース種別 ('jra' または 'nar')
 */
function determineRaceTypeFromVenueCode(venueCode) {
    const code = parseInt(venueCode, 10);
    // 01-10はJRA、それ以外はNAR
    return (code >= 1 && code <= 10) ? 'jra' : 'nar';
}

/**
 * 会場コードから会場名を取得
 * @param {string} venueCode - 会場コード
 * @returns {string} 会場名
 */
function getVenueNameFromCode(venueCode) {
    const venueMap = {
        '01': '札幌',
        '02': '函館',
        '03': '福島',
        '04': '新潟',
        '05': '東京',
        '06': '中山',
        '07': '中京',
        '08': '京都',
        '09': '阪神',
        '10': '小倉',
        '31': '北見',
        '32': '岩見沢',
        '33': '帯広',
        '34': '旭川',
        '35': '盛岡',
        '36': '水沢',
        '37': '上山',
        '38': '三条',
        '39': '足利',
        '40': '宇都宮',
        '41': '高崎',
        '42': '浦和',
        '43': '船橋',
        '44': '大井',
        '45': '川崎',
        '46': '金沢',
        '47': '笠松',
        '48': '名古屋',
        '49': '未登録',
        '50': '園田',
        '51': '姫路',
        '52': '益田',
        '53': '福山',
        '54': '高知',
        '55': '佐賀',
        '56': '荒尾',
        '57': '中津',
        '58': '札幌(地方)',
        '59': '函館(地方)',
        '60': '新潟(地方)',
        '61': '中京(地方)',
        '65': '帯広(ば)'
    };
    
    return venueMap[venueCode] || '不明競馬場';
}

/**
 * 今日の日付を「YYYYMMDD」形式で取得
 * @returns {string} YYYYMMDD形式の日付
 */
function getTodayDateString() {
    return dayjs().format('YYYYMMDD');
}

/**
 * 会場名を整形：「○回○○○日目」の形式を保持しつつ、文字化けを修正
 * @param {string} venueName - 元の会場名
 * @returns {string} 整形された会場名
 */
function formatVenueName(venueName) {
    if (!venueName) return '不明競馬場';

    // 「○回」「○日目」のパターンを抽出
    const roundPattern = /([\d]+回)/;
    const dayPattern = /([\d]+日目)/;

    // メイン会場名を抽出（数字を含まない部分）
    const mainVenuePattern = /(?:[\d]+回)?([^\d]+)(?:[\d]+日目)?/;

    const roundMatch = venueName.match(roundPattern);
    const dayMatch = venueName.match(dayPattern);
    const mainVenueMatch = venueName.match(mainVenuePattern);

    let mainVenue = '';
    let roundInfo = '';
    let dayInfo = '';

    if (mainVenueMatch && mainVenueMatch[1]) {
        mainVenue = mainVenueMatch[1].trim();
    }

    if (roundMatch && roundMatch[1]) {
        roundInfo = roundMatch[1];
    }

    if (dayMatch && dayMatch[1]) {
        dayInfo = dayMatch[1];
    }

    // 文字化けチェック
    if (/[\uFFFD\u30FB\u309A-\u309C]/.test(mainVenue) ||
        mainVenue.includes('��') ||
        mainVenue.includes('□') ||
        mainVenue.includes('�')) {
        mainVenue = validateVenueName(mainVenue);
    }

    // 整形した会場名を組み立て
    let formattedName = '';

    if (roundInfo) {
        formattedName += roundInfo + ' ';
    }

    formattedName += mainVenue;

    if (dayInfo) {
        formattedName += ' ' + dayInfo;
    }

    return formattedName.trim();
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
            const rawVenueName = $(venueElement).find('.RaceList_DataTitle').text().trim();
            // 「○回○○○日目」の形式を保持しつつ整形
            const venueName = formatVenueName(rawVenueName);
            logger.debug(`競馬場${venueIndex + 1}: ${venueName} (元: ${rawVenueName})`);

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

                    // レースIDからの会場コード検証 - JRAかどうか確認
                    const venueCode = extractVenueCodeFromRaceId(raceId);
                    const detectedType = determineRaceTypeFromVenueCode(venueCode);
                    const detectedVenueName = getVenueNameFromCode(venueCode);
                    
                    // タイプ不一致の警告
                    if (detectedType !== 'jra') {
                        logger.warn(`JRAページから取得したレースIDがJRCではない可能性: ${raceId} (タイプ:${detectedType}, 会場:${detectedVenueName})`);
                        // ただしJRA情報として処理は続行
                    }

                    // 文字化けチェック
                    const hasGarbledName = /[\uFFFD\u30FB\u309A-\u309C]/.test(raceName) ||
                        raceName.includes('��') ||
                        raceName.includes('□') ||
                        raceName.includes('�');

                    if (hasGarbledName) {
                        logger.warn(`レース名が文字化けしている可能性: ${raceName}`);
                    }

                    // 検証済みのレース名を使用
                    let validatedRaceName = validateRaceName(raceName, venueName, parseInt(raceNumber, 10));
                    
                    // 会場名を検証 - レースIDから会場名を取得して補足
                    let finalVenueName = venueName;
                    if (detectedVenueName && detectedVenueName !== '不明競馬場') {
                        // レースIDから抽出した会場名を優先（より信頼性が高い）
                        finalVenueName = detectedVenueName;
                        logger.debug(`会場名をレースIDから検出された名前に更新: ${finalVenueName} (元:${venueName})`);
                    }

                    races.push({
                        id: raceId,
                        type: 'jra',
                        venue: finalVenueName,
                        number: parseInt(raceNumber, 10) || raceIndex + 1,
                        name: validatedRaceName,
                        time: raceTime,
                        date: dateString,
                        status: 'upcoming',
                        link: `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`,
                        venueCode: venueCode // 会場コードも保存
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
            const rawVenueName = $(venueElement).find('.RaceList_DataTitle').text().trim();
            // 「○回○○○日目」の形式を保持しつつ整形
            const venueName = formatVenueName(rawVenueName);
            logger.debug(`競馬場${venueIndex + 1}: ${venueName} (元: ${rawVenueName})`);

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

                    // レースIDからの会場コード検証 - NARかどうか確認
                    const venueCode = extractVenueCodeFromRaceId(raceId);
                    const detectedType = determineRaceTypeFromVenueCode(venueCode);
                    const detectedVenueName = getVenueNameFromCode(venueCode);
                    
                    // タイプ不一致の警告
                    if (detectedType !== 'nar') {
                        logger.warn(`NARページから取得したレースIDがNARではない可能性: ${raceId} (タイプ:${detectedType}, 会場:${detectedVenueName})`);
                        // ただしNAR情報として処理は続行
                    }

                    // 文字化けチェック
                    const hasGarbledName = /[\uFFFD\u30FB\u309A-\u309C]/.test(raceName) ||
                        raceName.includes('��') ||
                        raceName.includes('□') ||
                        raceName.includes('�');

                    if (hasGarbledName) {
                        logger.warn(`レース名が文字化けしている可能性: ${raceName}`);
                    }

                    // 検証済みのレース名を使用
                    let validatedRaceName = validateRaceName(raceName, venueName, parseInt(raceNumber, 10));
                    
                    // 会場名を検証 - レースIDから会場名を取得して補足
                    let finalVenueName = venueName;
                    if (detectedVenueName && detectedVenueName !== '不明競馬場') {
                        // レースIDから抽出した会場名を優先（より信頼性が高い）
                        finalVenueName = detectedVenueName;
                        logger.debug(`会場名をレースIDから検出された名前に更新: ${finalVenueName} (元:${venueName})`);
                    }

                    races.push({
                        id: raceId,
                        type: 'nar',
                        venue: finalVenueName,
                        number: parseInt(raceNumber, 10) || raceIndex + 1,
                        name: validatedRaceName,
                        time: raceTime,
                        date: dateString,
                        status: 'upcoming',
                        link: `https://nar.netkeiba.com/race/shutuba.html?race_id=${raceId}`,
                        venueCode: venueCode // 会場コードも保存
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
 * 直接レースIDを指定して出走馬データを取得する前に、レース情報を再検証
 * @param {string} raceId - レースID
 * @returns {Promise<Object>} 検証済みレース情報
 */
async function verifyRaceInformation(raceId) {
    try {
        // データベースからレース情報を取得
        const savedRace = await getRaceById(raceId);
        
        // レースIDから会場コードを取得
        const venueCode = extractVenueCodeFromRaceId(raceId);
        const detectedType = determineRaceTypeFromVenueCode(venueCode);
        const detectedVenueName = getVenueNameFromCode(venueCode);
        
        // 保存されたレース情報がない場合は新規作成
        if (!savedRace) {
            logger.warn(`レースID ${raceId} の情報がデータベースにありません。新規に作成します。`);
            
            // 現在の日付から推測
            const today = dayjs().format('YYYYMMDD');
            
            return {
                id: raceId,
                type: detectedType,
                venue: detectedVenueName,
                number: parseInt(raceId.slice(10, 12), 10) || 0,
                name: `${detectedVenueName} ${parseInt(raceId.slice(10, 12), 10) || 0}R`,
                time: "00:00",
                date: today,
                status: 'upcoming',
                link: `https://${detectedType === 'jra' ? 'race' : 'nar'}.netkeiba.com/race/shutuba.html?race_id=${raceId}`,
                venueCode: venueCode
            };
        }
        
        // 既存のレース情報の会場情報を検証
        if (savedRace.venue !== detectedVenueName && detectedVenueName !== '不明競馬場') {
            logger.warn(`レースID ${raceId} の会場情報の不一致: DB=${savedRace.venue}, 検出=${detectedVenueName}`);
            // レースIDから取得した会場名を優先
            savedRace.venue = detectedVenueName;
        }
        
        // レースタイプを検証
        if (savedRace.type !== detectedType) {
            logger.warn(`レースID ${raceId} のタイプ情報の不一致: DB=${savedRace.type}, 検出=${detectedType}`);
            // レースIDから取得したタイプを優先
            savedRace.type = detectedType;
        }
        
        // 会場コードを追加
        savedRace.venueCode = venueCode;
        
        return savedRace;
    } catch (error) {
        logger.error(`レース情報検証中にエラー: ${error}`);
        throw error;
    }
}

/**
 * JRAレースの出走馬情報を取得 - HTML構造に最適化版
 * @param {string} raceId - レースID
 * @returns {Promise<Array>} 出走馬情報
 */
export async function fetchJraHorsesEnhanced(raceId) {
    try {
        // まずレース情報を検証
        const verifiedRace = await verifyRaceInformation(raceId);
        
        // レースタイプがJRAでなければ警告
        if (verifiedRace.type !== 'jra') {
            logger.warn(`レースID ${raceId} はJRA形式ではありませんが、JRA出走馬取得を試みます。`);
        }
        
        const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
        const debugFilename = `jra_horses_${raceId}_${uuidv4().substring(0, 8)}.html`;

        // 強化版の取得・パース処理
        const { $ } = await fetchAndParse(url, debugFilename);

        const horses = [];

        // デバッグ: 最初の行の構造を出力
        let firstRow = $('tr.HorseList').first();
        logger.debug("=== JRA 最初の行の構造 ===");
        $(firstRow).find('td').each((i, td) => {
            logger.debug(`td[${i}] class="${$(td).attr('class')}" text="${$(td).text().trim()}"`);
        });

        // オッズカラムとninkiカラムの出力
        const oddsColumn = $(firstRow).find('td.Popular, td.Txt_R');
        if (oddsColumn.length > 0) {
            logger.debug(`JRA オッズカラム: class="${oddsColumn.attr('class')}" text="${oddsColumn.text().trim()}"`);
            oddsColumn.find('span').each((i, span) => {
                logger.debug(`  span[${i}] id="${$(span).attr('id')}" class="${$(span).attr('class')}" text="${$(span).text().trim()}"`);
            });
        }

        // 出走馬テーブルを処理 - 行単位で処理
        $('tr.HorseList').each((index, element) => {
            try {
                // 馬番 - HTML構造に基づいて正確に取得
                let horseNumber = '';
                const umabanSelectors = [
                    'td.Umaban', 
                    'td.Umaban1', 
                    'td.Umaban2', 
                    'td:nth-child(2)',
                    'td:nth-child(3)'
                ];
                
                for (const selector of umabanSelectors) {
                    const cell = $(element).find(selector);
                    if (cell.length > 0) {
                        const text = cell.text().trim().replace(/\D/g, '');
                        if (text) {
                            horseNumber = text;
                            break;
                        }
                    }
                }

                // 枠番 - HTML構造に基づいて正確に取得
                let frameNumber = '';
                const wakuSelectors = [
                    'td.Waku', 
                    'td.Waku1', 
                    'td.Waku2', 
                    'td:first-child',
                    'td:nth-child(1)'
                ];
                
                for (const selector of wakuSelectors) {
                    const cell = $(element).find(selector);
                    if (cell.length > 0) {
                        let text = '';
                        // まずspanの中を探す
                        const span = cell.find('span').first();
                        if (span.length > 0) {
                            text = span.text().trim().replace(/\D/g, '');
                        }
                        
                        // spanが見つからないか空の場合はセル自体のテキストを使用
                        if (!text) {
                            text = cell.text().trim().replace(/\D/g, '');
                        }
                        
                        if (text) {
                            frameNumber = text;
                            break;
                        }
                    }
                }

                // 馬名 - 複数のセレクタパターンで試行
                let horseName = '';
                const horseNameSelectors = [
                    '.HorseName a', 
                    'td:nth-child(4) a',
                    'a[target="_blank"][title]',
                    'a[href*="horse"]'
                ];
                
                for (const selector of horseNameSelectors) {
                    const nameElem = $(element).find(selector);
                    if (nameElem.length > 0) {
                        const text = nameElem.text().trim();
                        if (text) {
                            horseName = text;
                            break;
                        }
                    }
                }

                // 騎手名 - 複数のセレクタパターンで試行
                let jockey = '';
                const jockeySelectors = [
                    '.Jockey a', 
                    'td:nth-child(6) a',
                    'td:nth-child(7) a',
                    'a[href*="jockey"]'
                ];
                
                for (const selector of jockeySelectors) {
                    const jockeyElem = $(element).find(selector);
                    if (jockeyElem.length > 0) {
                        const text = jockeyElem.text().trim();
                        if (text) {
                            jockey = text;
                            break;
                        }
                    }
                }

                // 調教師名 - 複数のセレクタパターンで試行
                let trainer = '';
                const trainerSelectors = [
                    '.Trainer a', 
                    'td:nth-child(8) a',
                    'td:nth-child(9) a',
                    'a[href*="trainer"]'
                ];
                
                for (const selector of trainerSelectors) {
                    const trainerElem = $(element).find(selector);
                    if (trainerElem.length > 0) {
                        const text = trainerElem.text().trim();
                        if (text) {
                            trainer = text;
                            break;
                        }
                    }
                }

                // 馬体重 - 複数のセレクタパターンで試行
                let weight = '';
                const weightSelectors = [
                    '.Weight', 
                    'td:nth-child(9)',
                    'td:nth-child(10)'
                ];
                
                for (const selector of weightSelectors) {
                    const weightElem = $(element).find(selector);
                    if (weightElem.length > 0) {
                        const text = weightElem.text().trim();
                        if (text) {
                            weight = text;
                            break;
                        }
                    }
                }

                // オッズ - JRA固有の構造から慎重に取得
                let odds = 0;
                
                // 方法1: oddsのID属性を持つspanから取得
                const oddsSpans = $(element).find('span[id^="odds-"]');
                if (oddsSpans.length > 0) {
                    const oddsText = oddsSpans.first().text().trim();
                    if (oddsText && oddsText !== '---.-') {
                        odds = parseFloat(oddsText) || 0;
                    }
                }
                
                // 方法2: Popular または Txt_R クラスのtdから取得
                if (odds === 0) {
                    const popularTd = $(element).find('td.Popular, td.Txt_R, td:nth-child(9)');
                    if (popularTd.length > 0) {
                        const oddsText = popularTd.text().trim().replace(/[^\d\.]/g, '');
                        if (oddsText) {
                            odds = parseFloat(oddsText) || 0;
                        }
                    }
                }

                // 方法3: より一般的なセレクタで試行
                if (odds === 0) {
                    const oddsCells = $(element).find('td:nth-child(9), td:nth-child(10), td:nth-child(11)');
                    
                    // ループを使用するが、breakの代わりにフラグを使用
                    let foundOdds = false;
                    oddsCells.each((i, cell) => {
                        if (foundOdds) return; // すでに見つかっている場合はスキップ
                        
                        const text = $(cell).text().trim();
                        // オッズらしき数値を探す（小数点を含む数値）
                        if (text && /\d+\.\d+/.test(text)) {
                            const match = text.match(/(\d+\.\d+)/);
                            if (match) {
                                odds = parseFloat(match[1]) || 0;
                                foundOdds = true; // 見つかったらフラグをセット
                            }
                        }
                    });
                }

                // 人気 - JRA固有の構造から慎重に取得
                let popularity = 0;
                
                // 方法1: ninkiのID属性を持つspanから取得
                const ninkiSpans = $(element).find('span[id^="ninki-"]');
                if (ninkiSpans.length > 0) {
                    const ninkiText = ninkiSpans.first().text().trim();
                    if (ninkiText && ninkiText !== '**') {
                        popularity = parseInt(ninkiText, 10) || 0;
                    }
                }
                
                // 方法2: Popular_Ninki または Txt_C クラスのtdから取得
                if (popularity === 0) {
                    const ninkiTd = $(element).find('td.Popular_Ninki, td.Txt_C, td:nth-child(10)');
                    if (ninkiTd.length > 0) {
                        const spanText = ninkiTd.find('span').text().trim();
                        const ninkiText = spanText || ninkiTd.text().trim();
                        if (ninkiText && ninkiText !== '**') {
                            const match = ninkiText.match(/(\d+)/);
                            if (match) {
                                popularity = parseInt(match[1], 10) || 0;
                            }
                        }
                    }
                }

                // 方法3: より一般的なセレクタで試行
                if (popularity === 0) {
                    const popCells = $(element).find('td:nth-child(10), td:nth-child(11), td:nth-child(12)');
                    
                    // ループを使用するが、breakの代わりにフラグを使用
                    let foundPopularity = false;
                    popCells.each((i, cell) => {
                        if (foundPopularity) return; // すでに見つかっている場合はスキップ
                        
                        const text = $(cell).text().trim();
                        // 人気順はシンプルな1桁か2桁の数字
                        if (text && /^\d{1,2}$/.test(text)) {
                            popularity = parseInt(text, 10) || 0;
                            foundPopularity = true; // 見つかったらフラグをセット
                        }
                    });
                }

                // デバッグログ
                logger.debug(`JRA 行[${index + 1}]: 馬番=${horseNumber}, 枠番=${frameNumber}, 馬名=${horseName}, オッズ=${odds}, 人気=${popularity}`);

                // データの妥当性チェック
                if (horseNumber && parseInt(horseNumber, 10) > 0 && parseInt(horseNumber, 10) <= 28) {
                    // 馬名のバリデーション - 空または不自然な場合はスキップ
                    if (!horseName || horseName.length < 2 || /^\d+$/.test(horseName)) {
                        logger.warn(`不正な馬名をスキップ: ${horseName} (馬番: ${horseNumber})`);
                        return; // continue と同じ効果
                    }
                    
                    horses.push({
                        frameNumber: parseInt(frameNumber, 10) || 0,
                        horseNumber: parseInt(horseNumber, 10),
                        horseName: cleanJapaneseText(horseName) || `${horseNumber}番馬`,
                        jockey: cleanJapaneseText(jockey) || '不明',
                        trainer: cleanJapaneseText(trainer) || '不明',
                        weight: weight || '',
                        odds: odds,
                        popularity: popularity
                    });
                } else {
                    logger.warn(`無効な馬番をスキップ: ${horseNumber}`);
                }
            } catch (rowError) {
                logger.error(`JRA 行処理中にエラー: ${rowError}`);
            }
        });

        // 特殊なケース：出走馬情報が見つからなかった場合の代替方法
        if (horses.length === 0) {
            logger.warn(`JRA: 標準的な方法で出走馬情報が取得できませんでした。代替方法を試みます。`);
            
            // すべての行を詳細にデバッグ
            debugAllRows($, 'table tr');
            
            // 別のテーブル構造を探す
            $('table tr').each((index, row) => {
                // ヘッダー行をスキップ
                if (index === 0 || $(row).find('th').length > 0) {
                    return;
                }
                
                try {
                    // すべてのセルを調査
                    const cells = $(row).find('td');
                    if (cells.length < 5) return;
                    
                    // 各情報を取得
                    const frameNumber = $(cells[0]).text().trim().replace(/\D/g, '');
                    const horseNumber = $(cells[1]).text().trim().replace(/\D/g, '');
                    const horseName = $(cells).find('a[href*="horse"]').text().trim();
                    const jockey = $(cells).find('a[href*="jockey"]').text().trim();
                    
                    // データの妥当性チェック
                    if (horseNumber && parseInt(horseNumber, 10) > 0 && parseInt(horseNumber, 10) <= 28 && horseName) {
                        horses.push({
                            frameNumber: parseInt(frameNumber, 10) || 0,
                            horseNumber: parseInt(horseNumber, 10),
                            horseName: cleanJapaneseText(horseName) || `${horseNumber}番馬`,
                            jockey: cleanJapaneseText(jockey) || '不明',
                            trainer: '不明',
                            weight: '',
                            odds: 0,
                            popularity: 0
                        });
                    }
                } catch (altRowError) {
                    logger.error(`JRA 代替行処理中にエラー: ${altRowError}`);
                }
            });
        }

        // 結果を並べ替え（馬番順）
        horses.sort((a, b) => a.horseNumber - b.horseNumber);

        logger.info(`JRA: レース ${raceId} の出走馬情報 ${horses.length} 件を取得しました。`);
        return horses;
    } catch (error) {
        logger.error(`JRA出走馬情報取得中にエラー: ${error}`);
        throw error;
    }
}

/**
 * NARレースの出走馬情報を取得 - HTML構造に最適化版
 * @param {string} raceId - レースID
 * @returns {Promise<Array>} 出走馬情報
 */
export async function fetchNarHorsesEnhanced(raceId) {
    try {
        // まずレース情報を検証
        const verifiedRace = await verifyRaceInformation(raceId);
        
        // レースタイプがNARでなければ警告
        if (verifiedRace.type !== 'nar') {
            logger.warn(`レースID ${raceId} はNAR形式ではありませんが、NAR出走馬取得を試みます。`);
        }
        
        const url = `https://nar.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
        const debugFilename = `nar_horses_${raceId}_${uuidv4().substring(0, 8)}.html`;

        // 強化版の取得・パース処理
        const { $ } = await fetchAndParse(url, debugFilename);

        const horses = [];

        // デバッグ: 最初の行の構造を出力
        let firstRow = $('tr.HorseList').first();
        logger.debug("=== NAR 最初の行の構造 ===");
        $(firstRow).find('td').each((i, td) => {
            logger.debug(`td[${i}] class="${$(td).attr('class')}" text="${$(td).text().trim()}"`);
            $(td).find('span').each((j, span) => {
                logger.debug(`  span[${j}] id="${$(span).attr('id')}" class="${$(span).attr('class')}" text="${$(span).text().trim()}"`);
            });
        });

        // 出走馬テーブルを処理 - 行単位で処理
        $('tr.HorseList').each((index, element) => {
            try {
                // 馬番 - 複数のセレクタパターンで試行
                let horseNumber = '';
                const umabanSelectors = [
                    'td.Umaban', 
                    'td.Umaban1', 
                    'td.Umaban2', 
                    'td:nth-child(2)',
                    'td:nth-child(3)'
                ];
                
                for (const selector of umabanSelectors) {
                    const cell = $(element).find(selector);
                    if (cell.length > 0) {
                        const text = cell.text().trim().replace(/\D/g, '');
                        if (text) {
                            horseNumber = text;
                            break;
                        }
                    }
                }

                // 枠番 - 複数のセレクタパターンで試行
                let frameNumber = '';
                const wakuSelectors = [
                    'td.Waku', 
                    'td.Waku1', 
                    'td.Waku2', 
                    'td:first-child',
                    'td:nth-child(1)'
                ];
                
                for (const selector of wakuSelectors) {
                    const cell = $(element).find(selector);
                    if (cell.length > 0) {
                        const text = cell.text().trim().replace(/\D/g, '');
                        if (text) {
                            frameNumber = text;
                            break;
                        }
                    }
                }

                // 馬名 - 複数のセレクタパターンで試行
                let horseName = '';
                const horseNameSelectors = [
                    '.HorseName a', 
                    'td:nth-child(4) a',
                    'a[target="_blank"][title]',
                    'a[href*="horse"]'
                ];
                
                for (const selector of horseNameSelectors) {
                    const nameElem = $(element).find(selector);
                    if (nameElem.length > 0) {
                        const text = nameElem.text().trim();
                        if (text) {
                            horseName = text;
                            break;
                        }
                    }
                }

                // 騎手 - 複数のセレクタパターンで試行
                let jockey = '';
                const jockeySelectors = [
                    '.Jockey a', 
                    '.Jockey span a',
                    'td:nth-child(6) a',
                    'td:nth-child(7) a',
                    'a[href*="jockey"]'
                ];
                
                for (const selector of jockeySelectors) {
                    const jockeyElem = $(element).find(selector);
                    if (jockeyElem.length > 0) {
                        const text = jockeyElem.text().trim();
                        if (text) {
                            jockey = text;
                            break;
                        }
                    }
                }

                // 調教師名 - 複数のセレクタパターンで試行
                let trainer = '';
                const trainerSelectors = [
                    '.Trainer a', 
                    'td:nth-child(8) a',
                    'td:nth-child(9) a',
                    'a[href*="trainer"]'
                ];
                
                for (const selector of trainerSelectors) {
                    const trainerElem = $(element).find(selector);
                    if (trainerElem.length > 0) {
                        const text = trainerElem.text().trim();
                        if (text) {
                            trainer = text;
                            break;
                        }
                    }
                }

                // 馬体重 - 複数のセレクタパターンで試行
                let weight = '';
                const weightSelectors = [
                    '.Weight', 
                    'td:nth-child(8)',
                    'td:nth-child(9)',
                    'td:nth-child(10)'
                ];
                
                for (const selector of weightSelectors) {
                    const weightElem = $(element).find(selector);
                    if (weightElem.length > 0) {
                        const text = weightElem.text().trim();
                        if (text) {
                            weight = text;
                            break;
                        }
                    }
                }

                // オッズ - NAR固有の構造から慎重に取得
                let odds = 0;
                
                // 1. .Odds_Ninki クラスを持つspanから取得
                const oddsNinkiSpan = $(element).find('span.Odds_Ninki');
                if (oddsNinkiSpan.length > 0) {
                    const oddsText = oddsNinkiSpan.text().trim();
                    if (oddsText && oddsText !== '---.-') {
                        odds = parseFloat(oddsText) || 0;
                    }
                }
                
                // 2. td.Popular.Txt_Rから取得
                if (odds === 0) {
                    const oddsCells = $(element).find('td.Popular.Txt_R');
                    if (oddsCells.length > 0) {
                        // 最初にspanを探す
                        const spanText = oddsCells.find('span').text().trim();
                        if (spanText) {
                            odds = parseFloat(spanText) || 0;
                        } else {
                            // spanがない場合はtd自体のテキストを使用
                            const cellText = oddsCells.text().trim().replace(/[^\d\.]/g, '');
                            if (cellText) {
                                odds = parseFloat(cellText) || 0;
                            }
                        }
                    }
                }
                
                // 3. より一般的なセレクタで試行
                if (odds === 0) {
                    const oddsCells = $(element).find('td:nth-child(9), td:nth-child(10), td:nth-child(11)');
                    
                    // ループを使用するが、breakの代わりにフラグを使用
                    let foundOdds = false;
                    oddsCells.each((i, cell) => {
                        if (foundOdds) return; // すでに見つかっている場合はスキップ
                        
                        const text = $(cell).text().trim();
                        // オッズらしき数値を探す（小数点を含む数値）
                        if (text && /\d+\.\d+/.test(text)) {
                            const match = text.match(/(\d+\.\d+)/);
                            if (match) {
                                odds = parseFloat(match[1]) || 0;
                                foundOdds = true; // 見つかったらフラグをセット
                            }
                        }
                    });
                }

                // 人気 - NAR固有の構造から慎重に取得
                let popularity = 0;
                
                // 1. td.Popular.Txt_C.BgYellowから取得
                const popularityHighlightCell = $(element).find('td.Popular.Txt_C.BgYellow, td.BgYellow');
                if (popularityHighlightCell.length > 0) {
                    const spanText = popularityHighlightCell.find('span').text().trim();
                    const popText = spanText || popularityHighlightCell.text().trim();
                    if (popText) {
                        popularity = parseInt(popText, 10) || 0;
                    }
                }
                
                // 2. td.Popular.Txt_Cから取得
                if (popularity === 0) {
                    const popularityCell = $(element).find('td.Popular.Txt_C');
                    if (popularityCell.length > 0) {
                        const spanText = popularityCell.find('span').text().trim();
                        const popText = spanText || popularityCell.text().trim();
                        if (popText && popText !== '**') {
                            const match = popText.match(/(\d+)/);
                            if (match) {
                                popularity = parseInt(match[1], 10) || 0;
                            }
                        }
                    }
                }
                
                // 3. より一般的なセレクタで試行
                if (popularity === 0) {
                    const popCells = $(element).find('td:nth-child(10), td:nth-child(11), td:nth-child(12)');
                    
                    // ループを使用するが、breakの代わりにフラグを使用
                    let foundPopularity = false;
                    popCells.each((i, cell) => {
                        if (foundPopularity) return; // すでに見つかっている場合はスキップ
                        
                        const text = $(cell).text().trim();
                        // 人気順はシンプルな1桁か2桁の数字
                        if (text && /^\d{1,2}$/.test(text)) {
                            popularity = parseInt(text, 10) || 0;
                            foundPopularity = true; // 見つかったらフラグをセット
                        }
                    });
                }

                // デバッグログ
                logger.debug(`NAR 行[${index + 1}]: 馬番=${horseNumber}, 枠番=${frameNumber}, 馬名=${horseName}, オッズ=${odds}, 人気=${popularity}`);

                // データの妥当性チェック
                if (horseNumber && parseInt(horseNumber, 10) > 0 && parseInt(horseNumber, 10) <= 16) {
                    // 馬名のバリデーション - 空または不自然な場合はスキップ
                    if (!horseName || horseName.length < 2 || /^\d+$/.test(horseName)) {
                        logger.warn(`不正な馬名をスキップ: ${horseName} (馬番: ${horseNumber})`);
                        return; // continue と同じ効果
                    }
                    
                    horses.push({
                        frameNumber: parseInt(frameNumber, 10) || 0,
                        horseNumber: parseInt(horseNumber, 10),
                        horseName: cleanJapaneseText(horseName) || `${horseNumber}番馬`,
                        jockey: cleanJapaneseText(jockey) || '不明',
                        trainer: cleanJapaneseText(trainer) || '不明',
                        weight: weight || '',
                        odds: odds,
                        popularity: popularity
                    });
                } else {
                    logger.warn(`無効な馬番をスキップ: ${horseNumber}`);
                }
            } catch (rowError) {
                logger.error(`NAR 行処理中にエラー: ${rowError}`);
            }
        });

        // 特殊なケース：出走馬情報が見つからなかった場合の代替方法
        if (horses.length === 0) {
            logger.warn(`NAR: 標準的な方法で出走馬情報が取得できませんでした。代替方法を試みます。`);
            
            // すべての行を詳細にデバッグ
            debugAllRows($, 'table tr');
            
            // Shutuba_Table や RaceTableArea も探す
            $('.Shutuba_Table tr, .RaceTableArea tr').each((index, row) => {
                // ヘッダー行をスキップ
                if (index === 0 || $(row).find('th').length > 0) {
                    return;
                }
                
                try {
                    // すべてのセルを調査
                    const cells = $(row).find('td');
                    if (cells.length < 4) return;
                    
                    // 各情報を取得
                    const frameNumber = $(cells[0]).text().trim().replace(/\D/g, '');
                    const horseNumber = $(cells[1]).text().trim().replace(/\D/g, '');
                    const horseName = $(cells).find('a[href*="horse"]').text().trim();
                    const jockey = $(cells).find('a[href*="jockey"]').text().trim();
                    
                    // 馬番の妥当性チェック
                    if (horseNumber && parseInt(horseNumber, 10) > 0 && parseInt(horseNumber, 10) <= 16 && horseName) {
                        horses.push({
                            frameNumber: parseInt(frameNumber, 10) || 0,
                            horseNumber: parseInt(horseNumber, 10),
                            horseName: cleanJapaneseText(horseName) || `${horseNumber}番馬`,
                            jockey: cleanJapaneseText(jockey) || '不明',
                            trainer: '不明',
                            weight: '',
                            odds: 0,
                            popularity: 0
                        });
                    }
                } catch (altRowError) {
                    logger.error(`NAR 代替行処理中にエラー: ${altRowError}`);
                }
            });
        }

        // 結果を並べ替え（馬番順）
        horses.sort((a, b) => a.horseNumber - b.horseNumber);

        logger.info(`NAR: レース ${raceId} の出走馬情報 ${horses.length} 件を取得しました。`);
        return horses;
    } catch (error) {
        logger.error(`NAR出走馬情報取得中にエラー: ${error}`);
        throw error;
    }
}

// デバッグ用の補助関数 - 行が少ない場合は直接すべての行と値を出力
function debugAllRows($, selector) {
    const rows = $(selector);
    logger.debug(`全${rows.length}行のデバッグ情報:`);

    rows.each((rowIndex, row) => {
        logger.debug(`--- 行 ${rowIndex + 1} ---`);
        $(row).find('td').each((cellIndex, cell) => {
            const cellClass = $(cell).attr('class') || 'クラスなし';
            const cellText = $(cell).text().trim();
            logger.debug(`Cell ${cellIndex + 1}: class="${cellClass}", text="${cellText}"`);
        });
    });
}