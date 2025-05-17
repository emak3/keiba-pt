import { CronJob } from 'cron';
import dayjs from 'dayjs';
import { fetchJraRaceList, fetchJraRaceResults } from '../scraper/jraScraper.js';
import { fetchNarRaceList, fetchNarRaceResults } from '../scraper/narScraper.js';
import { getActiveRaces } from '../database/raceService.js';
import logger from '../../utils/logger.js';

let client = null;

/**
 * レーススケジューラーを開始
 * @param {Client} discordClient - Discordクライアント
 */
export function startRaceScheduler(discordClient) {
  client = discordClient;
  
  logger.info('レーススケジューラーを開始します。');
  
  // 毎日午前0時にレース一覧を取得（日本時間）
  new CronJob('0 0 0 * * *', fetchDailyRaces, null, true, 'Asia/Tokyo');
  
  // 10分ごとにレース結果を確認（日本時間）
  new CronJob('0 */10 * * * *', checkRaceResults, null, true, 'Asia/Tokyo');
  
  // 起動時に1回実行
  fetchDailyRaces();
  checkRaceResults();
}

/**
 * 本日のレース一覧を取得
 */
async function fetchDailyRaces() {
  try {
    const today = dayjs().format('YYYYMMDD');
    logger.info(`本日 (${today}) のレース一覧を取得します。`);
    
    // JRAのレース一覧を取得
    const jraRaces = await fetchJraRaceList(today);
    
    // NARのレース一覧を取得
    const narRaces = await fetchNarRaceList(today);
    
    const totalRaces = jraRaces.length + narRaces.length;
    logger.info(`本日のレース取得が完了しました。JRA: ${jraRaces.length}件, NAR: ${narRaces.length}件, 合計: ${totalRaces}件`);
    
    // Discordに通知（オプション）
    if (client) {
      const notificationChannel = process.env.NOTIFICATION_CHANNEL_ID;
      if (notificationChannel) {
        const channel = await client.channels.fetch(notificationChannel);
        if (channel) {
          await channel.send({
            content: `🏇 **本日のレース情報を更新しました**\n中央競馬(JRA): ${jraRaces.length}件\n地方競馬(NAR): ${narRaces.length}件\n\n\`/races\` コマンドで本日のレース一覧を確認できます。`
          });
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
          if (race.type === 'jra') {
            await fetchJraRaceResults(race.id);
          } else if (race.type === 'nar') {
            await fetchNarRaceResults(race.id);
          }
          
          // Discordに通知（オプション）
          if (client) {
            const notificationChannel = process.env.NOTIFICATION_CHANNEL_ID;
            if (notificationChannel) {
              const channel = await client.channels.fetch(notificationChannel);
              if (channel) {
                await channel.send({
                  content: `🏁 **レース結果確定**\n${race.venue} ${race.number}R ${race.name}\n\n結果と払戻金の確認は \`/result ${race.id}\` で行えます。`
                });
              }
            }
          }
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