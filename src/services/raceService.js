// src/services/raceService.js
const jraScraper = require('../scraper/jraScraper');
const narScraper = require('../scraper/narScraper');
const { 
  saveRaceData, 
  getRaceById, 
  getRacesByDate, 
  getRacesByStatus 
} = require('../db/raceRepository');
const logger = require('../utils/logger');

/**
 * レース情報サービス
 */
class RaceService {
  /**
   * 開催日のレース一覧を取得・更新する
   * @param {Date} [date=new Date()] - 日付
   * @returns {Promise<Object>} - 更新結果
   */
  async updateDailyRaces(date = new Date()) {
    try {
      // JRAレース情報を取得
      const jraRaces = await jraScraper.fetchTodayRaces();
      
      // 地方競馬レース情報を取得
      const narRaces = await narScraper.fetchTodayRaces();
      
      // 全レースの一覧
      const allRaces = [...jraRaces, ...narRaces];
      
      // データベースに保存
      const savedRaces = [];
      for (const race of allRaces) {
        try {
          const raceId = await saveRaceData(race);
          savedRaces.push(raceId);
        } catch (error) {
          logger.error(`レース情報の保存に失敗しました: ${race.id}`, error);
        }
      }
      
      logger.info(`本日のレース情報を更新しました: ${savedRaces.length}件`);
      return {
        total: allRaces.length,
        saved: savedRaces.length,
        jra: jraRaces.length,
        nar: narRaces.length
      };
    } catch (error) {
      logger.error('レース情報の更新に失敗しました', error);
      throw error;
    }
  }

  /**
   * 特定のレース詳細情報を取得・更新する
   * @param {string} raceId - レースID
   * @returns {Promise<Object>} - レース詳細情報
   */
  async updateRaceDetail(raceId) {
    try {
      // レースタイプの判別（JRA/NAR）
      const raceType = raceId.substring(4, 5) === '5' ? 'NAR' : 'JRA';
      
      // タイプに応じたスクレイパーを使用
      const scraper = raceType === 'NAR' ? narScraper : jraScraper;
      
      // レース詳細を取得
      const raceDetail = await scraper.fetchRaceDetail(raceId);
      
      logger.info(`レース詳細を更新しました: ${raceId}`);
      return raceDetail;
    } catch (error) {
      logger.error(`レース詳細の更新に失敗しました: ${raceId}`, error);
      throw error;
    }
  }

  /**
   * レース結果を取得・更新する
   * @param {string} raceId - レースID
   * @returns {Promise<Object>} - レース結果情報
   */
  async updateRaceResult(raceId) {
    try {
      // レースタイプの判別（JRA/NAR）
      const raceType = raceId.substring(4, 5) === '5' ? 'NAR' : 'JRA';
      
      // タイプに応じたスクレイパーを使用
      const scraper = raceType === 'NAR' ? narScraper : jraScraper;
      
      // レース結果を取得
      const raceResult = await scraper.fetchRaceResult(raceId);
      
      logger.info(`レース結果を更新しました: ${raceId}`);
      return raceResult;
    } catch (error) {
      logger.error(`レース結果の更新に失敗しました: ${raceId}`, error);
      throw error;
    }
  }

  /**
   * 日付によるレース一覧取得
   * @param {Date} [date=new Date()] - 日付
   * @param {string} [type] - レースタイプ（JRA/NAR）
   * @returns {Promise<Array>} - レース情報の配列
   */
  async getRacesByDate(date = new Date(), type = null) {
    return getRacesByDate(date, type);
  }

  /**
   * レースIDによるレース情報取得
   * @param {string} raceId - レースID
   * @returns {Promise<Object|null>} - レース情報
   */
  async getRaceById(raceId) {
    return getRaceById(raceId);
  }

  /**
   * ステータスによるレース一覧取得
   * @param {string} status - レースステータス
   * @returns {Promise<Array>} - レース情報の配列
   */
  async getRacesByStatus(status) {
    return getRacesByStatus(status);
  }

  /**
   * 開催予定の全レースを取得する
   * @returns {Promise<Array>} - レース情報の配列
   */
  async getUpcomingRaces() {
    return getRacesByStatus('upcoming');
  }

  /**
   * 発走時刻をチェックし、締切時間を過ぎたレースのステータスを更新
   * @returns {Promise<number>} - 更新したレース数
   */
  async checkRaceStartTimes() {
    try {
      // アクティブなレースを取得
      const activeRaces = await getRacesByStatus('upcoming');
      const now = new Date();
      let updatedCount = 0;
      
      for (const race of activeRaces) {
        try {
          // 発走時刻のパース
          const startTimeStr = race.startTime;
          if (!startTimeStr) continue;
          
          const [hours, minutes] = startTimeStr.split(':').map(Number);
          const startTime = new Date(now);
          startTime.setHours(hours, minutes, 0, 0);
          
          // 発走10分前に締切
          const closeTime = new Date(startTime);
          closeTime.setMinutes(closeTime.getMinutes() - 10);
          
          // 現在時刻が締切時間を過ぎていれば更新
          if (now >= closeTime) {
            await saveRaceData({
              id: race.id,
              status: 'closed'
            });
            
            updatedCount++;
            logger.info(`レースを締め切りました: ${race.id}, ${race.name}`);
          }
        } catch (error) {
          logger.error(`レース締切処理に失敗しました: ${race.id}`, error);
        }
      }
      
      return updatedCount;
    } catch (error) {
      logger.error('レース発走時刻チェックに失敗しました', error);
      throw error;
    }
  }

  /**
   * レース結果を定期的にチェックし、確定したレースの結果を取得・更新
   * @returns {Promise<number>} - 更新したレース数
   */
  async checkRaceResults() {
    try {
      // 締め切られたレースを取得
      const closedRaces = await getRacesByStatus('closed');
      let updatedCount = 0;
      
      for (const race of closedRaces) {
        try {
          // 発走時刻のパース
          const startTimeStr = race.startTime;
          if (!startTimeStr) continue;
          
          const [hours, minutes] = startTimeStr.split(':').map(Number);
          const startTime = new Date();
          startTime.setHours(hours, minutes, 0, 0);
          
          // 発走から30分経過していれば結果を確認
          const resultCheckTime = new Date(startTime);
          resultCheckTime.setMinutes(resultCheckTime.getMinutes() + 30);
          
          const now = new Date();
          if (now >= resultCheckTime) {
            // 結果を取得
            await this.updateRaceResult(race.id);
            updatedCount++;
            logger.info(`レース結果を確認しました: ${race.id}, ${race.name}`);
          }
        } catch (error) {
          logger.error(`レース結果確認に失敗しました: ${race.id}`, error);
        }
      }
      
      return updatedCount;
    } catch (error) {
      logger.error('レース結果チェックに失敗しました', error);
      throw error;
    }
  }

  /**
   * レース情報をフォーマットしてDiscordに表示しやすい形式に変換
   * @param {Object} race - レース情報
   * @returns {Object} - フォーマットされたレース情報
   */
  formatRaceForDisplay(race) {
    if (!race) return null;
    
    // ステータスの日本語表記
    const statusMap = {
      'upcoming': '受付中',
      'closed': '締切',
      'finished': '確定'
    };
    
    // 馬場状態の日本語表記
    const surfaceMap = {
      '芝': '芝',
      'ダート': 'ダ'
    };
    
    // フォーマット済みのレース情報
    const formattedRace = {
      id: race.id,
      name: race.name,
      venue: race.venue,
      number: race.number,
      startTime: race.startTime,
      distance: race.distance,
      surface: surfaceMap[race.surface] || race.surface,
      direction: race.direction,
      status: statusMap[race.status] || race.status,
      horses: []
    };
    
    // 出走馬情報のフォーマット
    if (race.horses && Array.isArray(race.horses)) {
      formattedRace.horses = race.horses.map(horse => ({
        number: horse.number,
        frame: horse.frame,
        name: horse.name,
        jockey: horse.jockey,
        odds: horse.odds,
        popularity: horse.popularity
      }));
    }
    
    // レース結果が存在する場合
    if (race.results && Array.isArray(race.results)) {
      formattedRace.results = race.results;
    }
    
    // 払戻情報が存在する場合
    if (race.payouts) {
      formattedRace.payouts = race.payouts;
    }
    
    return formattedRace;
  }
}

module.exports = new RaceService();