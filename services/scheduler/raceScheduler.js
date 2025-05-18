import { CronJob } from 'cron';
import dayjs from 'dayjs';
import { fetchJraRaceList, fetchJraRaceResults } from '../scraper/jraScraper.js';
import { fetchNarRaceList, fetchNarRaceResults } from '../scraper/narScraper.js';
import { fetchRaceCalendar, fetchJraRacesAlternative, fetchNarRacesAlternative } from '../scraper/alternativeScraper.js';
import { getActiveRaces, saveJraRace, saveNarRace } from '../database/raceService.js';
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
    
    // 開催情報をまず確認
    const calendarInfo = await fetchRaceCalendar(today);
    logger.info(`カレンダー情報: JRA ${calendarInfo.jra.length}会場, NAR ${calendarInfo.nar.length}会場`);
    
    let jraRaces = [];
    let narRaces = [];
    
    // 標準の方法でレースを取得
    try {
      jraRaces = await fetchJraRaceList(today);
    } catch (jraError) {
      logger.error(`標準JRA取得でエラー: ${jraError}`);
    }
    
    try {
      narRaces = await fetchNarRaceList(today);
    } catch (narError) {
      logger.error(`標準NAR取得でエラー: ${narError}`);
    }
    
    // 標準の方法で取得できなかった場合、代替方法を試す
    if (jraRaces.length === 0 && calendarInfo.jra.length > 0) {
      logger.info('JRAレース情報が取得できなかったため、代替方法を試みます。');
      try {
        const alternativeJraRaces = await fetchJraRacesAlternative(today);
        if (alternativeJraRaces.length > 0) {
          logger.info(`代替方法で ${alternativeJraRaces.length} 件のJRAレースを取得しました。`);
          // データベースに保存
          await Promise.all(alternativeJraRaces.map(race => saveJraRace(race)));
          jraRaces = alternativeJraRaces;
        }
      } catch (altJraError) {
        logger.error(`代替JRA取得でもエラー: ${altJraError}`);
      }
    }
    
    if (narRaces.length === 0 && calendarInfo.nar.length > 0) {
      logger.info('NARレース情報が取得できなかったため、代替方法を試みます。');
      try {
        const alternativeNarRaces = await fetchNarRacesAlternative(today);
        if (alternativeNarRaces.length > 0) {
          logger.info(`代替方法で ${alternativeNarRaces.length} 件のNARレースを取得しました。`);
          // データベースに保存
          await Promise.all(alternativeNarRaces.map(race => saveNarRace(race)));
          narRaces = alternativeNarRaces;
        }
      } catch (altNarError) {
        logger.error(`代替NAR取得でもエラー: ${altNarError}`);
      }
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
                    content: `🏁 **レース結果確定**\n${race.venue} ${race.number}R ${race.name}\n\n結果と払戻金の確認は \`/result race_id: ${race.id}\` で行えます。`
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