// services/scheduler/enhancedRaceScheduler.js
// 強化された文字コード処理対応のレーススケジューラー（修正版）

import { CronJob } from 'cron';
import dayjs from 'dayjs';
import { fetchJraRaceListEnhanced, fetchNarRaceListEnhanced } from '../scraper/enhancedScraper.js';
// 既存のスクレイパーを正しくインポート
import { fetchJraRaceResults } from '../scraper/jraScraper.js';
import { fetchNarRaceResults } from '../scraper/narScraper.js';
import { getActiveRaces, saveJraRace, saveNarRace, updateJraRaceResult, updateNarRaceResult } from '../database/raceService.js';
import logger from '../../utils/logger.js';

let client = null;

/**
 * 強化版レーススケジューラーを開始
 * @param {Client} discordClient - Discordクライアント
 */
export function startEnhancedRaceScheduler(discordClient) {
  client = discordClient;
  
  logger.info('強化版レーススケジューラーを開始します。');
  
  // 毎日午前0時にレース一覧を取得（日本時間）
  new CronJob('0 0 0 * * *', fetchDailyRaces, null, true, 'Asia/Tokyo');
  
  // 10分ごとにレース結果を確認（日本時間）
  new CronJob('0 */10 * * * *', checkRaceResults, null, true, 'Asia/Tokyo');
  
  // 定期的にデータをリフレッシュ（特に文字化け対策として）- 1時間ごと
  new CronJob('0 0 */1 * * *', refreshRaceData, null, true, 'Asia/Tokyo');
  
  // 起動時に1回実行
  fetchDailyRaces();
  checkRaceResults();
}

/**
 * 本日のレース一覧を取得（強化版）
 */
async function fetchDailyRaces() {
  try {
    const today = dayjs().format('YYYYMMDD');
    logger.info(`本日 (${today}) のレース一覧を取得します。`);
    
    // 強化版のスクレイピング処理を使用
    let jraRaces = [];
    let narRaces = [];
    
    try {
      // 中央競馬のレース取得
      jraRaces = await fetchJraRaceListEnhanced(today);
      logger.info(`JRA: ${jraRaces.length}件のレースを取得しました。`);
      
      // 文字化けチェック
      const garbledJraRaces = jraRaces.filter(race => {
        return /[\uFFFD\u30FB\u309A-\u309C]/.test(race.name) || 
               race.name.includes('��') || 
               race.name.includes('□') ||
               race.name.includes('�');
      });
      
      if (garbledJraRaces.length > 0) {
        logger.warn(`JRA: ${garbledJraRaces.length}件のレースで文字化けが検出されました。`);
      }
    } catch (jraError) {
      logger.error(`JRA取得でエラー: ${jraError}`);
    }
    
    try {
      // 地方競馬のレース取得
      narRaces = await fetchNarRaceListEnhanced(today);
      logger.info(`NAR: ${narRaces.length}件のレースを取得しました。`);
      
      // 文字化けチェック
      const garbledNarRaces = narRaces.filter(race => {
        return /[\uFFFD\u30FB\u309A-\u309C]/.test(race.name) || 
               race.name.includes('��') || 
               race.name.includes('□') ||
               race.name.includes('�');
      });
      
      if (garbledNarRaces.length > 0) {
        logger.warn(`NAR: ${garbledNarRaces.length}件のレースで文字化けが検出されました。`);
      }
    } catch (narError) {
      logger.error(`NAR取得でエラー: ${narError}`);
    }
    
    const totalRaces = jraRaces.length + narRaces.length;
    logger.info(`本日のレース取得が完了しました。JRA: ${jraRaces.length}件, NAR: ${narRaces.length}件, 合計: ${totalRaces}件`);
    
    // Discordに通知（オプション）
    if (client) {
      const notificationChannel = process.env.NOTIFICATION_CHANNEL_ID;
      if (notificationChannel) {
        try {
          const channel = await client.channels.fetch(notificationChannel);
          if (channel) {
            await channel.send({
              content: `🏇 **本日のレース情報を更新しました**\n中央競馬(JRA): ${jraRaces.length}件\n地方競馬(NAR): ${narRaces.length}件\n\n\`/races\` コマンドで本日のレース一覧を確認できます。`
            });
          }
        } catch (notifyError) {
          logger.error(`通知送信中にエラー: ${notifyError}`);
        }
      }
    }
  } catch (error) {
    logger.error(`レース一覧取得中にエラーが発生しました: ${error}`);
  }
}

/**
 * レース結果を確認
 */
async function checkRaceResults() {
  try {
    // 開催中のレースを取得
    const activeRaces = await getActiveRaces();
    
    if (activeRaces.length === 0) {
      logger.debug('現在開催中のレースはありません。');
      return;
    }
    
    logger.info(`現在開催中のレース: ${activeRaces.length}件`);
    
    // 現在時刻
    const now = dayjs();
    
    // 各レースをチェック
    for (const race of activeRaces) {
      try {
        // レース時間をパース
        const raceDate = dayjs(
          `${race.date.slice(0, 4)}-${race.date.slice(4, 6)}-${race.date.slice(6, 8)} ${race.time}`,
          'YYYY-MM-DD HH:mm'
        );
        
        // レース終了から5分以上経過しているか
        // 通常のレースは2-3分程度で終わるため、余裕を持って5分後に結果を取得
        const endTime = raceDate.add(5, 'minute');
        
        if (now.isAfter(endTime)) {
          logger.info(`レース ${race.id} (${race.name}) の結果を取得します。`);
          
          // レース種別に応じた結果取得
          let resultData = null;
          try {
            if (race.type === 'jra') {
              resultData = await fetchJraRaceResults(race.id);
              if (resultData) {
                await updateJraRaceResult(race.id, resultData);
                logger.info(`レース ${race.id} のステータスを completed に更新しました。`);
              } else {
                logger.warn(`レース ${race.id} の結果データが取得できませんでした。まだ終了していない可能性があります。`);
              }
            } else if (race.type === 'nar') {
              resultData = await fetchNarRaceResults(race.id);
              if (resultData) {
                await updateNarRaceResult(race.id, resultData);
                logger.info(`レース ${race.id} のステータスを completed に更新しました。`);
              } else {
                logger.warn(`レース ${race.id} の結果データが取得できませんでした。まだ終了していない可能性があります。`);
              }
            }
          } catch (resultError) {
            logger.error(`レース ${race.id} の結果処理中にエラーが発生しました: ${resultError}`);
            // エラーがあっても続行
            resultData = null;
          }
          
          // 結果が取得できた場合のみ通知
          if (resultData && client) {
            const notificationChannel = process.env.NOTIFICATION_CHANNEL_ID;
            if (notificationChannel) {
              try {
                const channel = await client.channels.fetch(notificationChannel);
                if (channel) {
                  await channel.send({
                    content: `🏁 **レース結果確定**\n${race.venue} ${race.number}R ${race.name}\n\n結果と払戻金の確認は \`/result ${race.id}\` で行えます。`
                  });
                }
              } catch (notifyError) {
                logger.error(`通知送信中にエラー: ${notifyError}`);
              }
            }
          }
        } else {
          logger.debug(`レース ${race.id} はまだ終了時間を過ぎていません。(現在: ${now.format('HH:mm')}, 終了予定: ${endTime.format('HH:mm')})`);
        }
      } catch (raceError) {
        logger.error(`レース ${race.id} の結果取得中にエラーが発生しました: ${raceError}`);
        // エラーが発生しても次のレースの処理を続行
      }
    }
  } catch (error) {
    logger.error(`レース結果確認中にエラーが発生しました: ${error}`);
  }
}

/**
 * レースデータの定期リフレッシュ
 * 特に文字化け対策として重要
 */
async function refreshRaceData() {
  try {
    const today = dayjs().format('YYYYMMDD');
    logger.info(`レースデータのリフレッシュを開始します (${today})`);
    
    // 強化版のスクレイピング処理を使用して最新データを取得
    let jraRaces = [];
    
    try {
      jraRaces = await fetchJraRaceListEnhanced(today);
      logger.info(`JRA更新: ${jraRaces.length}件のレース情報をリフレッシュしました。`);
    } catch (jraError) {
      logger.error(`JRAリフレッシュでエラー: ${jraError}`);
    }
    
    let narRaces = [];
    
    try {
      narRaces = await fetchNarRaceListEnhanced(today);
      logger.info(`NAR更新: ${narRaces.length}件のレース情報をリフレッシュしました。`);
    } catch (narError) {
      logger.error(`NARリフレッシュでエラー: ${narError}`);
    }
    
    logger.info(`レースデータリフレッシュが完了しました。JRA: ${jraRaces.length}件, NAR: ${narRaces.length}件`);
  } catch (error) {
    logger.error(`レースデータリフレッシュ中にエラーが発生しました: ${error}`);
  }
}