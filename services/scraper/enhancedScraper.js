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

                    // 文字化けチェック
                    const hasGarbledName = /[\uFFFD\u30FB\u309A-\u309C]/.test(raceName) ||
                        raceName.includes('��') ||
                        raceName.includes('□') ||
                        raceName.includes('�');

                    if (hasGarbledName) {
                        logger.warn(`レース名が文字化けしている可能性: ${raceName}`);
                    }

                    // 検証済みのレース名を使用
                    const validatedRaceName = validateRaceName(raceName, venueName, parseInt(raceNumber, 10));

                    races.push({
                        id: raceId,
                        type: 'jra',
                        venue: venueName,
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

                    // 文字化けチェック
                    const hasGarbledName = /[\uFFFD\u30FB\u309A-\u309C]/.test(raceName) ||
                        raceName.includes('��') ||
                        raceName.includes('□') ||
                        raceName.includes('�');

                    if (hasGarbledName) {
                        logger.warn(`レース名が文字化けしている可能性: ${raceName}`);
                    }

                    // 検証済みのレース名を使用
                    const validatedRaceName = validateRaceName(raceName, venueName, parseInt(raceNumber, 10));

                    races.push({
                        id: raceId,
                        type: 'nar',
                        venue: venueName,
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
 * JRAレースの出走馬情報を取得 - HTML構造に最適化版
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

        // デバッグ: 最初の行の構造を出力
        let firstRow = $('tr.HorseList').first();
        console.log("=== JRA 最初の行の構造 ===");
        $(firstRow).find('td').each((i, td) => {
            console.log(`td[${i}] class="${$(td).attr('class')}" text="${$(td).text().trim()}"`);
            $(td).find('span').each((j, span) => {
                console.log(`  span[${j}] id="${$(span).attr('id')}" class="${$(span).attr('class')}" text="${$(span).text().trim()}"`);
            });
        });

        // 出走馬テーブルを処理 - 行単位で処理
        $('tr.HorseList').each((index, element) => {
            try {
                // 馬番 - HTML構造に基づいて正確に取得
                let horseNumber = '';
                const umabanTd = $(element).find('td[class^="Umaban"]');
                if (umabanTd.length > 0) {
                    horseNumber = umabanTd.text().trim();
                }

                // 枠番 - HTML構造に基づいて正確に取得
                let frameNumber = '';
                const wakuTd = $(element).find('td[class^="Waku"]');
                if (wakuTd.length > 0) {
                    frameNumber = wakuTd.find('span').text().trim() || wakuTd.text().trim();
                }

                // 馬名
                const horseName = $(element).find('.HorseName a').text().trim();

                // 騎手
                const jockey = $(element).find('.Jockey a').text().trim();

                // 調教師
                const trainer = $(element).find('.Trainer a').text().trim();

                // 馬体重
                const weight = $(element).find('.Weight').text().trim();

                // オッズ - JRA固有の構造から取得 (span#odds-X_XX)
                let odds = 0;
                const oddsSpan = $(element).find('span[id^="odds-"]');
                if (oddsSpan.length > 0) {
                    odds = parseFloat(oddsSpan.text().trim()) || 0;
                }

                // 人気 - JRA固有の構造から取得 (span#ninki-X_XX)
                let popularity = 0;
                const ninkiSpan = $(element).find('span[id^="ninki-"]');
                if (ninkiSpan.length > 0) {
                    popularity = parseInt(ninkiSpan.text().trim(), 10) || 0;
                }

                // デバッグログ
                console.log(`JRA 行[${index + 1}]: 馬番=${horseNumber}, 枠番=${frameNumber}, 馬名=${horseName}, オッズ=${odds}, 人気=${popularity}`);

                // 馬情報を追加 (有効な馬番がある場合のみ)
                if (horseNumber && parseInt(horseNumber, 10) > 0) {
                    horses.push({
                        frameNumber: parseInt(frameNumber, 10) || 0,
                        horseNumber: parseInt(horseNumber, 10) || 0,
                        horseName: cleanJapaneseText(horseName) || `${horseNumber}番馬`,
                        jockey: cleanJapaneseText(jockey) || '不明',
                        trainer: cleanJapaneseText(trainer) || '不明',
                        weight: weight || '',
                        odds: odds,
                        popularity: popularity
                    });
                }
            } catch (rowError) {
                logger.error(`JRA 行処理中にエラー: ${rowError}`);
            }
        });

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
        const url = `https://nar.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
        const debugFilename = `nar_horses_${raceId}_${uuidv4().substring(0, 8)}.html`;

        // 強化版の取得・パース処理
        const { $ } = await fetchAndParse(url, debugFilename);

        const horses = [];

        // デバッグ: 最初の行の構造を出力
        let firstRow = $('tr.HorseList').first();
        console.log("=== NAR 最初の行の構造 ===");
        $(firstRow).find('td').each((i, td) => {
            console.log(`td[${i}] class="${$(td).attr('class')}" text="${$(td).text().trim()}"`);
            $(td).find('span').each((j, span) => {
                console.log(`  span[${j}] id="${$(span).attr('id')}" class="${$(span).attr('class')}" text="${$(span).text().trim()}"`);
            });
        });

        // 出走馬テーブルを処理 - 行単位で処理
        $('tr.HorseList').each((index, element) => {
            try {
                // 馬番 - NAR固有の構造
                let horseNumber = '';
                const umabanTd = $(element).find('td[class^="Umaban"], td.Umaban');
                if (umabanTd.length > 0) {
                    horseNumber = umabanTd.text().trim();
                }

                // 枠番 - NAR固有の構造
                let frameNumber = '';
                const wakuTd = $(element).find('td[class^="Waku"], td.Waku');
                if (wakuTd.length > 0) {
                    frameNumber = wakuTd.text().trim();
                }

                // 馬名
                const horseName = $(element).find('.HorseName a').text().trim();

                // 騎手
                const jockey = $(element).find('.Jockey a, .Jockey span a').text().trim();

                // 調教師
                const trainer = $(element).find('.Trainer a').text().trim();

                // 馬体重
                const weight = $(element).find('.Weight').text().trim();

                // オッズ - NAR固有の構造
                let odds = 0;

                // 1. Odds_Ninkiクラスを持つspan要素
                const oddsNinkiSpan = $(element).find('span.Odds_Ninki');
                if (oddsNinkiSpan.length > 0) {
                    odds = parseFloat(oddsNinkiSpan.text().trim()) || 0;
                }

                // 2. Popular Txt_Rクラスを持つtd要素
                if (odds === 0) {
                    const oddsTd = $(element).find('td.Popular.Txt_R');
                    if (oddsTd.length > 0) {
                        // ブラウザのコンソールログで見ると単純にtext()でとれるはず
                        const oddsTdText = oddsTd.clone().children().remove().end().text().trim();
                        if (oddsTdText) {
                            const oddsMatch = oddsTdText.match(/(\d+\.?\d*)/);
                            if (oddsMatch) {
                                odds = parseFloat(oddsMatch[1]) || 0;
                            }
                        }
                    }
                }

                // 人気 - NAR固有の構造
                let popularity = 0;

                // 1. BgYellowクラスを持つtd内のspan
                const popularityYellowTd = $(element).find('td.BgYellow span');
                if (popularityYellowTd.length > 0) {
                    popularity = parseInt(popularityYellowTd.text().trim(), 10) || 0;
                }

                // 2. Popular Txt_Cクラスを持つtd内のspan
                if (popularity === 0) {
                    const popularityTd = $(element).find('td.Popular.Txt_C span');
                    if (popularityTd.length > 0) {
                        popularity = parseInt(popularityTd.text().trim(), 10) || 0;
                    }
                }

                // デバッグログ
                console.log(`NAR 行[${index + 1}]: 馬番=${horseNumber}, 枠番=${frameNumber}, 馬名=${horseName}, オッズ=${odds}, 人気=${popularity}`);

                // 馬情報の追加（有効な馬番がある場合のみ）
                if (horseNumber && parseInt(horseNumber, 10) > 0) {
                    horses.push({
                        frameNumber: parseInt(frameNumber, 10) || 0,
                        horseNumber: parseInt(horseNumber, 10) || 0,
                        horseName: cleanJapaneseText(horseName) || `${horseNumber}番馬`,
                        jockey: cleanJapaneseText(jockey) || '不明',
                        trainer: cleanJapaneseText(trainer) || '不明',
                        weight: weight || '',
                        odds: odds,
                        popularity: popularity
                    });
                }
            } catch (rowError) {
                logger.error(`NAR 行処理中にエラー: ${rowError}`);
            }
        });

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
    console.log(`全${rows.length}行のデバッグ情報:`);

    rows.each((rowIndex, row) => {
        console.log(`--- 行 ${rowIndex + 1} ---`);
        $(row).find('td').each((cellIndex, cell) => {
            const cellClass = $(cell).attr('class') || 'クラスなし';
            const cellText = $(cell).text().trim();
            console.log(`Cell ${cellIndex + 1}: class="${cellClass}", text="${cellText}"`);
        });
    });
}