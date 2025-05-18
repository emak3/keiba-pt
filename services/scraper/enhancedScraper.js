// services/scraper/enhancedScraper.js の修正版

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
 * オッズ文字列を正しく解析する関数
 * @param {string} oddsText - オッズのテキスト表現
 * @returns {number} 正規化されたオッズ値
 */
function parseOddsValue(oddsText) {
    // 空やnullの場合は0を返す
    if (!oddsText) return 0;

    // 数値以外の文字を取り除く（小数点は保持）
    const cleanedText = oddsText.replace(/[^\d\.]/g, '');

    // 変換できない場合は0を返す
    if (!cleanedText) return 0;

    // 小数点を含む場合はそのまま変換
    if (cleanedText.includes('.')) {
        return parseFloat(cleanedText) || 0;
    }

    // 小数点がないが、2桁以上の場合は100で割る（4600 → 46.0）
    if (cleanedText.length >= 2) {
        // テキストが全て数字で、値が100以上の場合は100で割る
        const value = parseInt(cleanedText, 10);
        if (value >= 100) {
            return value / 100;
        }
    }

    // それ以外はそのまま浮動小数点で返す
    return parseFloat(cleanedText) || 0;
}


/**
 * JRAレースの出走馬情報を取得 - オッズ抽出を強化したバージョン
 * @param {string} raceId - レースID
 * @returns {Promise<Array>} 出走馬情報
 */
export async function fetchJraHorsesEnhanced(raceId) {
    try {
        // まずレース情報を検証
        const verifiedRace = await verifyRaceInformation(raceId);
        
        // URLを構築
        const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
        const debugFilename = `jra_horses_${raceId}_${uuidv4().substring(0, 8)}.html`;

        // シンプルなHTTP リクエスト設定
        const config = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            responseType: 'arraybuffer'
        };

        // 直接axiosでHTMLを取得
        logger.info(`データを取得中: ${url}`);
        const response = await axios.get(url, config);
        
        // EUC-JPでデコード（ネットケイバは基本的にEUC-JP）
        const html = iconv.decode(Buffer.from(response.data), 'euc-jp');
        
        // デバッグ用にHTMLを保存
        const debugDir = path.join(process.cwd(), 'debug');
        if (!fs.existsSync(debugDir)) {
            fs.mkdirSync(debugDir);
        }
        fs.writeFileSync(path.join(debugDir, debugFilename), html, 'utf-8');
        
        // オッズ情報をHTMLから探索（JavaScriptデータを探す）
        const oddsRegex = /odds\[[^\]]*\]\s*=\s*"([^"]+)"/g;
        const popRegex = /ninki\[[^\]]*\]\s*=\s*"([^"]+)"/g;
        
        let oddsMatches = [];
        let popMatches = [];
        let match;
        
        // オッズ情報を抽出
        while ((match = oddsRegex.exec(html)) !== null) {
            oddsMatches.push(match[1]);
        }
        
        // 人気順情報を抽出
        while ((match = popRegex.exec(html)) !== null) {
            popMatches.push(match[1]);
        }
        
        logger.debug(`JavaScriptから抽出: オッズデータ ${oddsMatches.length}件, 人気順データ ${popMatches.length}件`);
        
        // cheerioでHTMLをパース
        const $ = cheerio.load(html, {
            decodeEntities: false // HTML実体参照をデコードしない
        });
        
        // オッズ値を解析する補助関数
        function parseOddsValue(text) {
            if (!text) return 0;
            text = text.trim();
            
            // "---.-" や "0" などの特殊値は0として扱う
            if (text === '---.-' || text === '--' || text === '**' || text === '0') {
                return 0;
            }
            
            // カンマを削除して数値に変換
            const cleanText = text.replace(/,/g, '');
            const match = cleanText.match(/(\d+(?:\.\d+)?)/);
            if (match) {
                return parseFloat(match[1]);
            }
            
            return 0;
        }
        
        // 人気順を解析する補助関数
        function parsePopularityValue(text) {
            if (!text) return 0;
            text = text.trim();
            
            // "**" や "-" などの特殊値は0として扱う
            if (text === '**' || text === '-' || text === '--') {
                return 0;
            }
            
            // 数値のみを抽出
            const match = text.match(/(\d+)/);
            if (match) {
                return parseInt(match[1], 10);
            }
            
            return 0;
        }
        
        // 出走馬情報の配列
        const horses = [];
        
        // 出走馬テーブルの行を処理
        $('tr.HorseList').each((index, row) => {
            try {
                // 直接HTMLを出力（最初の数行だけ）
                if (index < 3) {
                    const rowHtml = $(row).html();
                    logger.debug(`行[${index+1}]の生HTML: ${rowHtml.substring(0, 300)}...`);
                }
                
                // 基本情報の取得（クラス名で明確に特定）
                const frameCell = $(row).find('td[class^="Waku"]').first();
                const horseNumCell = $(row).find('td[class^="Umaban"]').first();
                const horseNameLink = $(row).find('.HorseName a').first();
                const jockeyLink = $(row).find('.Jockey a').first();
                const trainerLink = $(row).find('.Trainer a').first();
                const weightCell = $(row).find('.Weight').first();
                
                // セルから直接テキストを抽出（最小限の処理）
                const frameNumber = frameCell.text().trim().replace(/\D/g, '');
                const horseNumber = horseNumCell.text().trim().replace(/\D/g, '');
                const horseName = horseNameLink.text().trim();
                const jockey = jockeyLink.text().trim();
                const trainer = trainerLink.text().trim();
                const weight = weightCell.text().trim();
                
                // ===== オッズ取得 - 強化版 =====
                let odds = 0;
                let rawOddsText = '';
                
                // 方法1: span[id^="odds-"] を探す（基本パターン）
                const oddsSpan = $(row).find('span[id^="odds-"]');
                if (oddsSpan.length > 0) {
                    const oddsText = oddsSpan.text().trim();
                    rawOddsText = oddsText;
                    odds = parseOddsValue(oddsText);
                    logger.debug(`方法1でオッズ取得: id=${oddsSpan.attr('id')}, text=${oddsText}, value=${odds}`);
                }
                
                // 方法2: td.Popular.Txt_R から探す（バックアップ）
                if (odds === 0) {
                    const oddsCell = $(row).find('td.Txt_R.Popular, td.Popular.Txt_R');
                    if (oddsCell.length > 0) {
                        // span要素があればそこから取得
                        const span = oddsCell.find('span').first();
                        if (span.length > 0) {
                            const spanText = span.text().trim();
                            rawOddsText = spanText;
                            odds = parseOddsValue(spanText);
                        } else {
                            // span要素がなければセル全体から取得
                            const cellText = oddsCell.text().trim();
                            rawOddsText = cellText;
                            odds = parseOddsValue(cellText);
                        }
                        logger.debug(`方法2でオッズ取得: text=${rawOddsText}, value=${odds}`);
                    }
                }
                
                // 方法3: オッズ部分を正規表現で探す
                if (odds === 0 && index < oddsMatches.length) {
                    rawOddsText = oddsMatches[index];
                    odds = parseOddsValue(rawOddsText);
                    logger.debug(`方法3でオッズ取得: JavaScript変数から text=${rawOddsText}, value=${odds}`);
                }
                
                // ===== 人気順取得 - 強化版 =====
                let popularity = 0;
                let rawPopText = '';
                
                // 方法1: span[id^="ninki-"] を探す（基本パターン）
                const ninkiSpan = $(row).find('span[id^="ninki-"]');
                if (ninkiSpan.length > 0) {
                    const ninkiText = ninkiSpan.text().trim();
                    rawPopText = ninkiText;
                    popularity = parsePopularityValue(ninkiText);
                    logger.debug(`方法1で人気順取得: id=${ninkiSpan.attr('id')}, text=${ninkiText}, value=${popularity}`);
                }
                
                // 方法2: td.Popular.Popular_Ninki から探す（バックアップ）
                if (popularity === 0) {
                    const ninkiCell = $(row).find('td.Popular_Ninki, td.Popular.Popular_Ninki');
                    if (ninkiCell.length > 0) {
                        // span要素があればそこから取得
                        const span = ninkiCell.find('span').first();
                        if (span.length > 0) {
                            const spanText = span.text().trim();
                            rawPopText = spanText;
                            popularity = parsePopularityValue(spanText);
                        } else {
                            // span要素がなければセル全体から取得
                            const cellText = ninkiCell.text().trim();
                            rawPopText = cellText;
                            popularity = parsePopularityValue(cellText);
                        }
                        logger.debug(`方法2で人気順取得: text=${rawPopText}, value=${popularity}`);
                    }
                }
                
                // 方法3: 人気順部分を正規表現で探す
                if (popularity === 0 && index < popMatches.length) {
                    rawPopText = popMatches[index];
                    popularity = parsePopularityValue(rawPopText);
                    logger.debug(`方法3で人気順取得: JavaScript変数から text=${rawPopText}, value=${popularity}`);
                }
                
                // 馬番と馬名が有効な場合のみ配列に追加
                if (horseNumber && horseName) {
                    horses.push({
                        frameNumber: parseInt(frameNumber, 10) || 0,
                        horseNumber: parseInt(horseNumber, 10),
                        horseName: horseName,
                        jockey: jockey || '不明',
                        trainer: trainer || '不明',
                        weight: weight || '',
                        odds: odds,
                        popularity: popularity,
                        // 生の値も保持（デバッグ用）
                        oddsRaw: rawOddsText,
                        ninkiRaw: rawPopText
                    });
                }
            } catch (error) {
                logger.error(`行[${index+1}]の処理中にエラー: ${error}`);
            }
        });
        
        // HorseListが見つからない場合は代替手段を試す
        if (horses.length === 0) {
            logger.warn(`HorseList行が見つかりませんでした。代替手段を試みます。`);
            
            // すべてのテーブルから馬情報を探す
            $('table tr').each((index, row) => {
                try {
                    // ヘッダー行をスキップ
                    if (index === 0 || $(row).find('th').length > 0) return;
                    
                    // セルが少なすぎる行はスキップ
                    const cells = $(row).find('td');
                    if (cells.length < 5) return;
                    
                    // 馬情報を抽出
                    let horseNumber = '';
                    let frameNumber = '';
                    let horseName = '';
                    let jockey = '';
                    
                    // 馬番と枠番の候補
                    const firstCellText = $(cells[0]).text().trim();
                    const secondCellText = $(cells[1]).text().trim();
                    
                    // 馬番と枠番を推測
                    if (/^\d{1,2}$/.test(secondCellText)) {
                        horseNumber = secondCellText;
                        if (/^\d{1}$/.test(firstCellText) && parseInt(firstCellText) < 9) {
                            frameNumber = firstCellText;
                        }
                    }
                    
                    // 馬名を探す（リンクから）
                    const horseLinks = $(row).find('a[href*="horse"]');
                    if (horseLinks.length > 0) {
                        horseName = horseLinks.first().text().trim();
                    }
                    
                    // 騎手を探す（リンクから）
                    const jockeyLinks = $(row).find('a[href*="jockey"]');
                    if (jockeyLinks.length > 0) {
                        jockey = jockeyLinks.first().text().trim();
                    }
                    
                    // オッズと人気順を探す
                    let odds = 0;
                    let popularity = 0;
                    let rawOddsText = '';
                    let rawPopText = '';
                    
                    // すべてのセルを調査
                    cells.each((cellIndex, cell) => {
                        const cellText = $(cell).text().trim();
                        
                        // オッズっぽい値を探す（小数点を含む）
                        if (/\d+\.\d+/.test(cellText) && !rawOddsText) {
                            rawOddsText = cellText;
                            odds = parseOddsValue(cellText);
                        }
                        
                        // 人気順っぽい値を探す（1〜2桁の数字）
                        if (/^\s*\d{1,2}\s*$/.test(cellText) && parseInt(cellText) > 0 && parseInt(cellText) < 20 && !rawPopText) {
                            rawPopText = cellText;
                            popularity = parsePopularityValue(cellText);
                        }
                    });
                    
                    // 馬番と馬名が有効な場合のみ配列に追加
                    if (horseNumber && horseName) {
                        horses.push({
                            frameNumber: parseInt(frameNumber, 10) || 0,
                            horseNumber: parseInt(horseNumber, 10),
                            horseName: horseName,
                            jockey: jockey || '不明',
                            trainer: '不明',
                            weight: '',
                            odds: odds,
                            popularity: popularity,
                            // 生の値も保持（デバッグ用）
                            oddsRaw: rawOddsText,
                            ninkiRaw: rawPopText
                        });
                    }
                } catch (error) {
                    logger.error(`代替テーブル行[${index}]の処理中にエラー: ${error}`);
                }
            });
        }
        
        // 馬番順にソート
        horses.sort((a, b) => a.horseNumber - b.horseNumber);
        
        // オッズと人気順の統計
        const horsesWithOdds = horses.filter(h => h.odds > 0).length;
        const horsesWithPopularity = horses.filter(h => h.popularity > 0).length;
        
        // 結果をログに出力
        logger.info(`JRA: レース ${raceId} の出走馬情報 ${horses.length} 件を取得しました。オッズあり: ${horsesWithOdds}件, 人気順あり: ${horsesWithPopularity}件`);
        
        // オッズと人気順の詳細をログに出力
        horses.forEach((horse, index) => {
            logger.debug(`馬[${index+1}]: ${horse.horseNumber}番 ${horse.horseName}, オッズ=${horse.odds}(生値:"${horse.oddsRaw}"), 人気=${horse.popularity}(生値:"${horse.ninkiRaw}")`);
        });
        
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
                let rawOddsText = '';

                // 1. .Odds_Ninki クラスを持つspanから取得
                const oddsNinkiSpan = $(element).find('span.Odds_Ninki');
                if (oddsNinkiSpan.length > 0) {
                    const oddsText = oddsNinkiSpan.text().trim();
                    rawOddsText = oddsText;
                    if (oddsText && oddsText !== '---.-') {
                        // 修正: オッズを正しく解析
                        odds = parseOddsValue(oddsText);
                    }
                }

                // 2. td.Popular.Txt_Rから取得
                if (odds === 0) {
                    const oddsCells = $(element).find('td.Popular.Txt_R');
                    if (oddsCells.length > 0) {
                        // 最初にspanを探す
                        const spanText = oddsCells.find('span').text().trim();
                        rawOddsText = spanText || oddsCells.text().trim();
                        if (spanText) {
                            // 修正: オッズを正しく解析
                            odds = parseOddsValue(spanText);
                        } else {
                            // spanがない場合はtd自体のテキストを使用
                            const cellText = oddsCells.text().trim();
                            rawOddsText = cellText;
                            // 修正: オッズを正しく解析
                            odds = parseOddsValue(cellText);
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
                        rawOddsText = text;
                        // オッズらしき数値を探す（小数点を含む数値またはオッズらしき数値）
                        if (text && /\d+\.?\d*/.test(text)) {
                            // 修正: オッズを正しく解析
                            odds = parseOddsValue(text);
                            foundOdds = true; // 見つかったらフラグをセット
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
                logger.debug(`NAR 行[${index + 1}]: 馬番=${horseNumber}, 枠番=${frameNumber}, 馬名=${horseName}, オッズ=${odds} (元テキスト:${rawOddsText}), 人気=${popularity}`);

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