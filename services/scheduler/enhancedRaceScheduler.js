// services/scheduler/enhancedRaceScheduler.js
// 強化された文字コード処理対応のレーススケジューラー（修正版）

import { CronJob } from 'cron';
import dayjs from 'dayjs';
import {
  fetchJraRaceListEnhanced,
  fetchNarRaceListEnhanced,
  fetchJraHorsesEnhanced,
  fetchNarHorsesEnhanced
} from '../scraper/enhancedScraper.js';
// 既存のスクレイパーを正しくインポート
import { fetchJraRaceResults } from '../scraper/jraScraper.js';
import { fetchNarRaceResults } from '../scraper/narScraper.js';
import {
  getActiveRaces,
  saveJraRace,
  saveNarRace,
  updateJraRaceResult,
  updateNarRaceResult,
  getRaceById,
  getRacesByDate,
  getUnprocessedRaces  // 追加: 未処理レースを取得する関数をインポート
} from '../database/raceService.js';
import logger from '../../utils/logger.js';

let client = null;

// 追加: 結果取得用の定数
const RESULT_CHECK_MINUTES = 15; // 発走後15分後に結果を取得
const MAX_RETRY_COUNT = 3;      // 最大再試行回数

// 追加: 再試行待ちのレースを保持する配列
let pendingRaces = [];

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

  // 定期的に出走馬情報を更新 - 1時間ごと
  new CronJob('0 0 */1 * * *', updateHorsesInfo, null, true, 'Asia/Tokyo');

  // 追加: 朝6時と9時に強制アップデート（当日の開催情報がより確定している時間帯）
  new CronJob('0 0 6,9 * * *', () => updateHorsesInfo(true), null, true, 'Asia/Tokyo');

  // 追加: 毎日午前0時15分と0時30分に、今日のレースの出馬表を確実に取得
  new CronJob('0 15,30 0 * * *', async () => {
    const today = dayjs().format('YYYYMMDD');
    await updateTodaysHorsesInfo(today);
  }, null, true, 'Asia/Tokyo');

  // 追加: 未処理レースの再確認 - 30分ごと
  new CronJob('0 */30 * * * *', recheckPendingRaces, null, true, 'Asia/Tokyo');

  // 起動時に1回実行
  fetchDailyRaces();
  checkRaceResults();

  // 1分後に今日のレース出馬表を確実に更新
  setTimeout(async () => {
    const today = dayjs().format('YYYYMMDD');
    try {
      logger.info('起動時の今日のレース出馬表の取得を開始します...');
      await updateTodaysHorsesInfo(today);
      logger.info('起動時の今日のレース出馬表の取得が完了しました');
    } catch (error) {
      logger.error(`起動時の出馬表取得中にエラー: ${error}`);
    }
  }, 60 * 1000);

  // 5分後に出走馬情報を更新（従来のActiveRaces方式）
  setTimeout(() => updateHorsesInfo(true), 5 * 60 * 1000);

  // 10分後に未処理レースを確認
  setTimeout(recheckPendingRaces, 10 * 60 * 1000);
}

/**
 * 特定の日付のレースの出走馬情報を更新する
 * @param {string} dateString - YYYYMMDD形式の日付
 */
async function updateTodaysHorsesInfo(dateString) {
  try {
    logger.info(`特定の日付(${dateString})のレースの出馬表情報の更新を開始します`);

    // 特定の日付のレース一覧を取得
    const races = await getRacesByDate(dateString);

    if (races.length === 0) {
      logger.info(`日付 ${dateString} のレースが見つかりません。`);
      return;
    }

    logger.info(`${dateString}の日付のレース ${races.length}件を処理します`);

    // 各レースの出走馬情報を更新
    let jraUpdateCount = 0;
    let narUpdateCount = 0;
    let errorCount = 0;

    // バッチ処理によるレース出馬表の取得
    const batchSize = 5; // 一度に処理するレース数
    const delay = 3000;  // バッチ間の待機時間(ms)

    for (let i = 0; i < races.length; i += batchSize) {
      const batch = races.slice(i, i + batchSize);

      logger.info(`バッチ処理 ${Math.floor(i / batchSize) + 1}/${Math.ceil(races.length / batchSize)}: ${batch.length}件のレースの馬情報を取得中...`);

      // バッチ内の各レースを並行処理
      await Promise.all(batch.map(async (race) => {
        try {
          // レース情報を再取得して最新状態を確認
          const raceData = await getRaceById(race.id);

          // 既に終了済みのレースはスキップ
          if (raceData && raceData.status === 'completed') {
            logger.debug(`レース ${race.id} は既に終了しているため、スキップします。`);
            return;
          }

          // レース種別に応じた出走馬情報の取得
          let horses = [];

          if (race.type === 'jra') {
            logger.debug(`JRAレース ${race.id} (${race.venue} ${race.number}R ${race.name}) の出馬表を取得します`);
            horses = await fetchJraHorsesEnhanced(race.id);
            if (horses && horses.length > 0) {
              // レース情報を更新
              await saveJraRace({
                ...race,
                horses
              });
              logger.debug(`JRAレース ${race.id} の出馬表を更新しました (${horses.length}頭)`);
              jraUpdateCount++;
            } else {
              logger.warn(`JRAレース ${race.id} の出馬表が取得できませんでした`);
            }
          } else if (race.type === 'nar') {
            logger.debug(`NARレース ${race.id} (${race.venue} ${race.number}R ${race.name}) の出馬表を取得します`);
            horses = await fetchNarHorsesEnhanced(race.id);
            if (horses && horses.length > 0) {
              // レース情報を更新
              await saveNarRace({
                ...race,
                horses
              });
              logger.debug(`NARレース ${race.id} の出馬表を更新しました (${horses.length}頭)`);
              narUpdateCount++;
            } else {
              logger.warn(`NARレース ${race.id} の出馬表が取得できませんでした`);
            }
          }
        } catch (batchError) {
          logger.error(`バッチ処理中のレース ${race.id} の出走馬情報更新中にエラー: ${batchError}`);
          errorCount++;
        }
      }));

      // 次のバッチ処理前に少し待機（サーバー負荷軽減のため）
      if (i + batchSize < races.length) {
        logger.info(`次のバッチ処理まで ${delay / 1000} 秒待機...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    logger.info(`${dateString}のレースの出馬表情報の更新が完了しました。JRA: ${jraUpdateCount}件, NAR: ${narUpdateCount}件, エラー: ${errorCount}件`);
  } catch (error) {
    logger.error(`特定日付のレース出馬表更新中にエラーが発生しました: ${error}`);
    throw error; // 上位関数でのエラーハンドリングのために再スロー
  }
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

    // 出走馬情報の取得も実行
    // 修正: 特定の日付(今日)のレースの出馬表を強制的に取得
    try {
      logger.info('レース取得完了後、今日のレースの出馬表情報の取得を開始します...');
      await updateTodaysHorsesInfo(today);
      logger.info('今日のレースの出馬表情報の取得が完了しました。');
    } catch (horsesError) {
      logger.error(`出馬表取得中にエラーが発生しました: ${horsesError}`);

      // エラーが発生しても5分後に再試行
      logger.info('5分後に出馬表の再取得を試みます...');
      setTimeout(async () => {
        try {
          await updateTodaysHorsesInfo(today);
          logger.info('出馬表情報の再取得が完了しました。');
        } catch (retryError) {
          logger.error(`出馬表の再取得中にエラーが発生しました: ${retryError}`);
        }
      }, 5 * 60 * 1000);
    }

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

        // 修正: レース終了から15分以上経過しているか
        // 通常のレースは2-3分程度で終わるため、発走から15分後に結果を取得
        const endTime = raceDate.add(RESULT_CHECK_MINUTES, 'minute');

        if (now.isAfter(endTime)) {
          logger.info(`レース ${race.id} (${race.name}) の結果を取得します。`);

          // レース種別に応じた結果取得
          let resultData = null;
          try {
            if (race.type === 'jra') {
              resultData = await fetchJraRaceResults(race.id);
              if (resultData && (resultData.results.length > 0 || Object.values(resultData.payouts).some(arr => arr.length > 0))) {
                await updateJraRaceResult(race.id, resultData);
                logger.info(`レース ${race.id} のステータスを completed に更新しました。`);

                // 結果通知
                await notifyRaceResult(race);

              } else {
                // 修正: 結果が取得できなかった場合は保留リストに追加
                logger.warn(`レース ${race.id} の結果データが取得できませんでした。保留リストに追加します。`);
                addToPendingRaces(race);
              }
            } else if (race.type === 'nar') {
              resultData = await fetchNarRaceResults(race.id);
              if (resultData && (resultData.results.length > 0 || Object.values(resultData.payouts).some(arr => arr.length > 0))) {
                await updateNarRaceResult(race.id, resultData);
                logger.info(`レース ${race.id} のステータスを completed に更新しました。`);

                // 結果通知
                await notifyRaceResult(race);

              } else {
                // 修正: 結果が取得できなかった場合は保留リストに追加
                logger.warn(`レース ${race.id} の結果データが取得できませんでした。保留リストに追加します。`);
                addToPendingRaces(race);
              }
            }
          } catch (resultError) {
            logger.error(`レース ${race.id} の結果処理中にエラーが発生しました: ${resultError}`);
            // エラーがあった場合も保留リストに追加
            addToPendingRaces(race);
          }
        } else {
          logger.debug(`レース ${race.id} はまだ終了時間を過ぎていません。(現在: ${now.format('HH:mm')}, 結果取得予定: ${endTime.format('HH:mm')})`);
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
 * 保留中のレースを再チェック
 */
async function recheckPendingRaces() {
  try {
    if (pendingRaces.length === 0) {
      // 追加: データベースからも未処理レースを検索
      const today = dayjs().format('YYYYMMDD');
      const unprocessedRaces = await getUnprocessedRaces(today);

      if (unprocessedRaces.length > 0) {
        logger.info(`データベースから未処理レース ${unprocessedRaces.length}件を取得しました。`);

        // 現在時刻
        const now = dayjs();

        // 発走時刻から15分以上経過しているレースのみを保留リストに追加
        for (const race of unprocessedRaces) {
          const raceDate = dayjs(
            `${race.date.slice(0, 4)}-${race.date.slice(4, 6)}-${race.date.slice(6, 8)} ${race.time}`,
            'YYYY-MM-DD HH:mm'
          );

          const endTime = raceDate.add(RESULT_CHECK_MINUTES, 'minute');

          if (now.isAfter(endTime)) {
            addToPendingRaces(race);
          }
        }
      }

      if (pendingRaces.length === 0) {
        return; // 保留レースがなければ終了
      }
    }

    logger.info(`保留中のレース ${pendingRaces.length}件を再チェックします。`);

    // 保留リストのコピーを作成（処理中に配列が変わるのを防ぐ）
    const racesToCheck = [...pendingRaces];

    // 保留リストをクリア（処理中に新しい保留レースが追加される可能性があるため）
    pendingRaces = [];

    // 各保留レースを処理
    for (const pendingRace of racesToCheck) {
      try {
        // 最新のレース情報を取得（ステータスが変わっている可能性があるため）
        const race = await getRaceById(pendingRace.id);

        // すでに完了している場合はスキップ
        if (!race || race.status === 'completed') {
          continue;
        }

        logger.info(`保留レース ${race.id} (${race.name}) の結果を再取得します。`);

        // レース種別に応じた結果取得
        let resultData = null;
        try {
          if (race.type === 'jra') {
            resultData = await fetchJraRaceResults(race.id);
            if (resultData && (resultData.results.length > 0 || Object.values(resultData.payouts).some(arr => arr.length > 0))) {
              await updateJraRaceResult(race.id, resultData);
              logger.info(`レース ${race.id} のステータスを completed に更新しました。`);

              // 結果通知
              await notifyRaceResult(race);

            } else {
              // 再試行回数をインクリメント
              const retryCount = (pendingRace.retryCount || 0) + 1;

              if (retryCount < MAX_RETRY_COUNT) {
                // 最大試行回数未満なら再度保留リストに追加
                addToPendingRaces({ ...race, retryCount });
                logger.info(`レース ${race.id} の結果をまだ取得できません。再試行回数: ${retryCount}/${MAX_RETRY_COUNT}`);
              } else {
                logger.warn(`レース ${race.id} は最大再試行回数に達しました。処理をスキップします。`);
              }
            }
          } else if (race.type === 'nar') {
            resultData = await fetchNarRaceResults(race.id);
            if (resultData && (resultData.results.length > 0 || Object.values(resultData.payouts).some(arr => arr.length > 0))) {
              await updateNarRaceResult(race.id, resultData);
              logger.info(`レース ${race.id} のステータスを completed に更新しました。`);

              // 結果通知
              await notifyRaceResult(race);

            } else {
              // 再試行回数をインクリメント
              const retryCount = (pendingRace.retryCount || 0) + 1;

              if (retryCount < MAX_RETRY_COUNT) {
                // 最大試行回数未満なら再度保留リストに追加
                addToPendingRaces({ ...race, retryCount });
                logger.info(`レース ${race.id} の結果をまだ取得できません。再試行回数: ${retryCount}/${MAX_RETRY_COUNT}`);
              } else {
                logger.warn(`レース ${race.id} は最大再試行回数に達しました。処理をスキップします。`);
              }
            }
          }
        } catch (resultError) {
          logger.error(`保留レース ${race.id} の結果処理中にエラーが発生しました: ${resultError}`);

          // 再試行回数をインクリメント
          const retryCount = (pendingRace.retryCount || 0) + 1;

          if (retryCount < MAX_RETRY_COUNT) {
            // 最大試行回数未満なら再度保留リストに追加
            addToPendingRaces({ ...race, retryCount });
          } else {
            logger.warn(`レース ${race.id} は最大再試行回数に達しました。処理をスキップします。`);
          }
        }
      } catch (error) {
        logger.error(`保留レース処理中にエラー: ${error}`);
      }
    }

    logger.info(`保留レース再チェック完了。残り保留レース: ${pendingRaces.length}件`);
  } catch (error) {
    logger.error(`保留レース再チェック中にエラー: ${error}`);
  }
}

/**
 * レースを保留リストに追加
 * @param {Object} race - 保留するレース情報
 */
function addToPendingRaces(race) {
  // すでに保留リストにある場合は追加しない
  if (!pendingRaces.some(pendingRace => pendingRace.id === race.id)) {
    pendingRaces.push({
      id: race.id,
      type: race.type,
      venue: race.venue,
      number: race.number,
      name: race.name,
      date: race.date,
      time: race.time,
      retryCount: race.retryCount || 0
    });
  }
}

/**
 * レース結果をDiscordに通知
 * @param {Object} race - レース情報
 */
async function notifyRaceResult(race) {
  if (client) {
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

/**
 * 出走馬情報の更新
 * @param {boolean} forceUpdate - 強制的に全レースを更新するかどうか 
 */
async function updateHorsesInfo(forceUpdate = false) {
  try {
    const today = dayjs().format('YYYYMMDD');
    logger.info(`出走馬情報の更新を開始します (${today}) - 強制更新モード: ${forceUpdate}`);

    // 開催中のレースを取得
    const activeRaces = await getActiveRaces();

    if (activeRaces.length === 0) {
      logger.info('アクティブなレースが見つかりません。今日のレースを直接確認します...');

      // 修正: activeRacesが空の場合でも今日のレースを直接取得して処理
      return await updateTodaysHorsesInfo(today);
    }

    logger.info(`出走馬情報を更新するレース: ${activeRaces.length}件`);

    // 各レースの出走馬情報を更新
    let jraUpdateCount = 0;
    let narUpdateCount = 0;
    let errorCount = 0;
    let retryQueue = [];

    // 最初に全レースのイテレーションを行う
    for (const race of activeRaces) {
      try {
        // レース情報を取得
        const raceData = await getRaceById(race.id);

        // すでに終了したレースはスキップ
        if (raceData && raceData.status === 'completed') {
          continue;
        }

        // 馬情報があり、かつ強制更新モードでない場合はスキップ
        if (!forceUpdate && raceData && raceData.horses && raceData.horses.length > 0) {
          // 馬情報が存在するレースの数をカウント
          if (race.type === 'jra') {
            jraUpdateCount++;
          } else if (race.type === 'nar') {
            narUpdateCount++;
          }
          continue;
        }

        // キューに追加
        retryQueue.push(race);
      } catch (error) {
        logger.error(`レース ${race.id} の情報取得中にエラー: ${error}`);
        errorCount++;
      }
    }

    logger.info(`更新キューに ${retryQueue.length} 件のレースを追加しました（既に馬情報あり: JRA ${jraUpdateCount}件, NAR ${narUpdateCount}件, エラー: ${errorCount}件）`);

    // キューからバッチ処理で取得（サーバー負荷軽減のため）
    const batchSize = 5; // 一度に処理するレース数
    const delay = 3000;  // バッチ間の待機時間(ms)

    for (let i = 0; i < retryQueue.length; i += batchSize) {
      const batch = retryQueue.slice(i, i + batchSize);

      logger.info(`バッチ処理 ${Math.floor(i / batchSize) + 1}/${Math.ceil(retryQueue.length / batchSize)}: ${batch.length}件のレースの馬情報を取得中...`);

      // バッチ内の各レースを並行処理
      await Promise.all(batch.map(async (race) => {
        try {
          // レース種別に応じた出走馬情報の取得
          let horses = [];

          if (race.type === 'jra') {
            horses = await fetchJraHorsesEnhanced(race.id);
            if (horses && horses.length > 0) {
              // レース情報を更新
              await saveJraRace({
                ...race,
                horses
              });
              jraUpdateCount++;
            }
          } else if (race.type === 'nar') {
            horses = await fetchNarHorsesEnhanced(race.id);
            if (horses && horses.length > 0) {
              // レース情報を更新
              await saveNarRace({
                ...race,
                horses
              });
              narUpdateCount++;
            }
          }
        } catch (batchError) {
          logger.error(`バッチ処理中のレース ${race.id} の出走馬情報更新中にエラー: ${batchError}`);
          errorCount++;
        }
      }));

      // 次のバッチ処理前に少し待機（サーバー負荷軽減のため）
      if (i + batchSize < retryQueue.length) {
        logger.info(`次のバッチ処理まで ${delay / 1000} 秒待機...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    logger.info(`出走馬情報の更新が完了しました。JRA: ${jraUpdateCount}件, NAR: ${narUpdateCount}件, エラー: ${errorCount}件`);

    // 更新したレースが少ない場合は今日のレースを直接更新
    if (jraUpdateCount + narUpdateCount < 5) {
      logger.info(`更新されたレース数が少ないため、今日のレースを直接確認します...`);
      await updateTodaysHorsesInfo(today);
    }
  } catch (error) {
    logger.error(`出走馬情報更新中にエラーが発生しました: ${error}`);
    throw error; // 上位関数でのエラーハンドリングのために再スロー
  }
}