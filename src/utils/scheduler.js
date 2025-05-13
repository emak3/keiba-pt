// src/utils/scheduler.js
const cron = require('node-cron');
const raceService = require('../services/raceService');
const betService = require('../services/betService');
const logger = require('./logger');

/**
 * スケジューラのセットアップ
 */
function setupScheduler() {
  // レース情報の定期更新 (毎日午前9時に実行)
  cron.schedule('0 9 * * *', async () => {
    try {
      logger.info('レース情報の定期更新を開始します');
      const result = await raceService.updateDailyRaces();
      logger.info(`レース情報の定期更新が完了しました: ${JSON.stringify(result)}`);
    } catch (error) {
      logger.error('レース情報の定期更新に失敗しました', error);
    }
  });
  
  // レース締切チェック (10分ごとに実行)
  cron.schedule('*/10 * * * *', async () => {
    try {
      logger.info('レース締切チェックを開始します');
      const updatedRaces = await raceService.checkRaceStartTimes();
      
      if (updatedRaces > 0) {
        logger.info(`${updatedRaces}件のレースを締め切りました`);
        
        // 締め切られたレースの馬券を処理
        const closedRaces = await raceService.getRacesByStatus('closed');
        
        for (const race of closedRaces) {
          try {
            await betService.closeRaceBets(race.id);
            logger.info(`レースID ${race.id} の馬券を締め切りました`);
          } catch (error) {
            logger.error(`レースID ${race.id} の馬券締切処理に失敗しました`, error);
          }
        }
      } else {
        logger.info('締め切るべきレースはありませんでした');
      }
    } catch (error) {
      logger.error('レース締切チェックに失敗しました', error);
    }
  });
  
  // レース結果確認 (10分ごとに実行)
  cron.schedule('*/10 * * * *', async () => {
    try {
      logger.info('レース結果確認を開始します');
      const updatedRaces = await raceService.checkRaceResults();
      
      if (updatedRaces > 0) {
        logger.info(`${updatedRaces}件のレース結果を確認しました`);
        
        // 結果が確定したレースの払戻処理
        const finishedRaces = await raceService.getRacesByStatus('finished');
        
        for (const race of finishedRaces) {
          try {
            // 払戻処理が未完了のレースのみ処理
            if (!race.payoutProcessed) {
              const result = await betService.processRacePayouts(race.id);
              
              if (result && result.processed > 0) {
                // 払戻完了フラグを設定
                await raceService.getRaceById(race.id);
                logger.info(`レースID ${race.id} の払戻処理が完了しました: ${JSON.stringify(result)}`);
              }
            }
          } catch (error) {
            logger.error(`レースID ${race.id} の払戻処理に失敗しました`, error);
          }
        }
      } else {
        logger.info('確認すべきレース結果はありませんでした');
      }
    } catch (error) {
      logger.error('レース結果確認に失敗しました', error);
    }
  });
  
  // 古いデータのクリーンアップ (毎週月曜日の午前3時に実行)
  cron.schedule('0 3 * * 1', async () => {
    try {
      logger.info('古いデータのクリーンアップを開始します');
      
      // 1週間以上前のレースデータを削除
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      
      // クリーンアップ処理（実装は省略）
      // ...
      
      logger.info('古いデータのクリーンアップが完了しました');
    } catch (error) {
      logger.error('古いデータのクリーンアップに失敗しました', error);
    }
  });
  
  // 全レースの取得（開発環境でのデータセットアップ用、本番環境では無効化）
  if (process.env.NODE_ENV === 'development') {
    cron.schedule('0 */1 * * *', async () => {
      try {
        logger.info('開発用: 全レースの取得を開始します');
        const result = await raceService.updateDailyRaces();
        logger.info(`開発用: 全レースの取得が完了しました: ${JSON.stringify(result)}`);
      } catch (error) {
        logger.error('開発用: 全レースの取得に失敗しました', error);
      }
    });
  }
  
  logger.info('スケジューラを初期化しました');
}

module.exports = { setupScheduler };