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
 * JRAレースの出走馬情報を取得 - 取消馬対応版
 * @param {string} raceId - レースID
 * @returns {Promise<Array>} 出走馬情報
 */
export async function fetchJraHorsesEnhanced(raceId) {
    try {
        // URLを構築
        const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
        const debugFilename = `jra_horses_${raceId}.html`;

        // シンプルなHTTP リクエスト設定
        const config = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache'
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

        // cheerioでHTMLをパース
        const $ = cheerio.load(html, {
            decodeEntities: false
        });

        // 出走馬情報の配列
        const horses = [];

        // 出走馬テーブルの行を処理 - すべてのtr.HorseListを取得
        $('tr.HorseList').each((index, row) => {
            try {
                // 基本情報の取得
                const frameCell = $(row).find('td[class^="Waku"]').first();
                const horseNumCell = $(row).find('td[class^="Umaban"]').first();
                const horseNameLink = $(row).find('.HorseName a').first();
                const jockeyLink = $(row).find('.Jockey a').first();
                const trainerLink = $(row).find('.Trainer a').first();
                const weightCell = $(row).find('.Weight').first();

                const frameNumber = frameCell.text().trim().replace(/\D/g, '');
                const horseNumber = horseNumCell.text().trim().replace(/\D/g, '');
                let horseName = horseNameLink.text().trim();
                const jockey = jockeyLink.text().trim();
                const trainer = trainerLink.text().trim();
                const weight = weightCell.text().trim();

                // 取消情報の検出 - 新規追加
                let isCanceled = false;

                // 方法1: 取消セルを探す
                const cancelCell = $(row).find('.Cancel_Txt');
                if (cancelCell.length > 0 && cancelCell.text().trim() === '取消') {
                    isCanceled = true;
                    logger.debug(`馬番${horseNumber}: 取消情報を検出しました (セル)`);
                }

                // 方法2: tr要素のクラスを確認
                if ($(row).hasClass('Cancel')) {
                    isCanceled = true;
                    logger.debug(`馬番${horseNumber}: 取消情報を検出しました (行)`);
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
                        odds: 0,
                        popularity: 0,
                        isCanceled: isCanceled  // 取消フラグを追加
                    });
                }
            } catch (error) {
                logger.error(`行[${index + 1}]の処理中にエラー: ${error}`);
            }
        });

        // 馬番順にソート
        horses.sort((a, b) => a.horseNumber - b.horseNumber);

        // 結果をログに出力
        logger.info(`JRA: レース ${raceId} の出走馬情報 ${horses.length} 件を取得しました。取消馬: ${horses.filter(h => h.isCanceled).length}頭`);

        return horses;
    } catch (error) {
        logger.error(`JRA出走馬情報取得中にエラー: ${error}`);
        throw error;
    }
}

/**
 * NARレースの出走馬情報を取得 - 取消馬対応版
 * @param {string} raceId - レースID
 * @returns {Promise<Array>} 出走馬情報
 */
export async function fetchNarHorsesEnhanced(raceId) {
    try {
        // URLを構築
        const url = `https://nar.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
        const debugFilename = `nar_horses_${raceId}.html`;

        // シンプルなHTTP リクエスト設定
        const config = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache'
            },
            responseType: 'arraybuffer'
        };

        // 直接axiosでHTMLを取得
        logger.info(`NARデータを取得中: ${url}`);
        const response = await axios.get(url, config);

        // EUC-JPでデコード（ネットケイバは基本的にEUC-JP）
        const html = iconv.decode(Buffer.from(response.data), 'euc-jp');

        // デバッグ用にHTMLを保存
        const debugDir = path.join(process.cwd(), 'debug');
        if (!fs.existsSync(debugDir)) {
            fs.mkdirSync(debugDir);
        }
        fs.writeFileSync(path.join(debugDir, debugFilename), html, 'utf-8');

        // cheerioでHTMLをパース
        const $ = cheerio.load(html, {
            decodeEntities: false
        });

        // 出走馬情報の配列
        const horses = [];

        // 出走馬テーブルの行を処理
        $('tr.HorseList').each((index, row) => {
            try {
                // 基本情報の取得
                const frameCell = $(row).find('td[class^="Waku"]').first();
                const horseNumCell = $(row).find('td[class^="Umaban"]').first();
                const horseNameLink = $(row).find('.HorseName a').first();
                const jockeyLink = $(row).find('.Jockey a').first();
                const trainerLink = $(row).find('.Trainer a').first();
                const weightCell = $(row).find('.Weight').first();

                const frameNumber = frameCell.text().trim().replace(/\D/g, '');
                const horseNumber = horseNumCell.text().trim().replace(/\D/g, '');
                let horseName = horseNameLink.text().trim();
                const jockey = jockeyLink.text().trim();
                const trainer = trainerLink.text().trim();
                const weight = weightCell.text().trim();

                // 取消情報の検出 - 新規追加
                let isCanceled = false;

                // 方法1: 取消セルを探す
                const cancelCell = $(row).find('.Cancel_Txt');
                if (cancelCell.length > 0 && cancelCell.text().trim() === '取消') {
                    isCanceled = true;
                    logger.debug(`馬番${horseNumber}: 取消情報を検出しました (セル)`);
                }

                // 方法2: tr要素のクラスを確認
                if ($(row).hasClass('Cancel')) {
                    isCanceled = true;
                    logger.debug(`馬番${horseNumber}: 取消情報を検出しました (行)`);
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
                        odds: 0,
                        popularity: 0,
                        isCanceled: isCanceled  // 取消フラグを追加
                    });
                }
            } catch (error) {
                logger.error(`行[${index + 1}]の処理中にエラー: ${error}`);
            }
        });

        // 馬番順にソート
        horses.sort((a, b) => a.horseNumber - b.horseNumber);

        // 結果をログに出力
        logger.info(`NAR: レース ${raceId} の出走馬情報 ${horses.length} 件を取得しました。取消馬: ${horses.filter(h => h.isCanceled).length}頭`);

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