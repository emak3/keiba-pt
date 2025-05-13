// src/scraper/jraScraper.js
const NetKeibaScraperBase = require('./netkeiba');
const logger = require('../utils/logger');
const { saveRaceData, updateRaceResult } = require('../db/raceRepository');

/**
 * JRA情報をスクレイピングするクラス
 */
class JRAScraper extends NetKeibaScraperBase {
  constructor() {
    super();
    this.jraBaseUrl = 'https://race.netkeiba.com';
  }

  /**
   * 当日開催のレース一覧を取得
   * @returns {Promise<Array>} - レース情報の配列
   */
  async fetchTodayRaces() {
    try {
      // 開催日一覧のURLは実際のNetKeibaの構造に合わせて調整する必要あり
      const $ = await this.fetchAndParse(`${this.jraBaseUrl}/top/race_list_sub.html`);
      const races = [];

      // 各開催場所のレースを取得
      $('.RaceList_DataList').each((i, element) => {
        const venue = $(element).find('.RaceList_DataTitle').text().trim();
        
        $(element).find('li').each((j, raceItem) => {
          const link = $(raceItem).find('a').attr('href');
          if (!link) return;
          
          const raceIdMatch = link.match(/race_id=(\d+)/);
          if (!raceIdMatch) return;
          
          const raceId = raceIdMatch[1];
          const raceNumber = $(raceItem).find('.Race_Num').text().trim().replace(/[^\d]/g, '');
          const raceName = $(raceItem).find('.Race_Name').text().trim();
          const startTime = $(raceItem).find('.Race_Time').text().trim();
          
          races.push({
            id: raceId,
            type: 'JRA',
            venue,
            number: parseInt(raceNumber),
            name: raceName,
            startTime,
            date: new Date(),  // 当日の日付
            status: 'upcoming'
          });
        });
      });

      logger.info(`本日のJRAレース ${races.length}件を取得しました`);
      return races;
    } catch (error) {
      logger.error('本日のJRAレース一覧の取得に失敗しました', error);
      return [];
    }
  }

  /**
   * 特定のレースの詳細情報を取得
   * @param {string} raceId - レースID
   * @returns {Promise<Object>} - レース詳細情報
   */
  async fetchRaceDetail(raceId) {
    try {
      const $ = await this.fetchAndParse(`${this.jraBaseUrl}/race/shutuba.html?race_id=${raceId}`);
      
      // レース名と基本情報
      const raceName = $('.RaceData01').find('h1').text().trim();
      const raceInfo = $('.RaceData01').text().trim();
      
      // 距離と馬場
      const distanceMatch = raceInfo.match(/(\d+)m/);
      const distance = distanceMatch ? parseInt(distanceMatch[1]) : null;
      
      // 表面（芝/ダート）
      const surface = raceInfo.includes('芝') ? '芝' : 'ダート';
      
      // 左右回り
      const direction = raceInfo.includes('右') ? '右' : '左';
      
      // 出走馬情報の取得
      const horses = [];
      $('.HorseList').each((i, element) => {
        const frameNumber = $(element).find('.Waku').text().trim();
        const horseNumber = $(element).find('.Umaban').text().trim();
        const horseName = $(element).find('.HorseName a').text().trim();
        const horseId = $(element).find('.HorseName a').attr('href')?.match(/horse\/(\d+)/)?.[1];
        const jockey = $(element).find('.Jockey a').text().trim();
        const trainer = $(element).find('.Trainer a').text().trim();
        const weight = this.extractNumber($(element).find('.Weight').text().trim());
        const odds = this.extractNumber($(element).find('.Popular.Txt_R').text().trim());
        const popularity = this.extractNumber($(element).find('.Popular_Ninki').text().trim());
        
        const ageGenderText = $(element).find('.Barei').text().trim();
        const gender = ageGenderText.match(/[牡牝セ]/)?.[0] || '';
        const age = this.extractNumber(ageGenderText);
        
        horses.push({
          id: horseId,
          name: horseName,
          number: parseInt(horseNumber),
          frame: parseInt(frameNumber),
          jockey,
          trainer,
          weight,
          odds,
          popularity,
          age,
          gender
        });
      });
      
      const raceDetail = {
        id: raceId,
        type: 'JRA',
        name: raceName,
        distance,
        surface,
        direction,
        horses,
        status: 'upcoming'
      };
      
      // データベースにレース情報を保存
      await saveRaceData(raceDetail);
      
      logger.info(`レース詳細を取得しました: ${raceId}`);
      return raceDetail;
    } catch (error) {
      logger.error(`レース詳細の取得に失敗しました: ${raceId}`, error);
      throw error;
    }
  }

  /**
   * レース結果と払戻情報を取得
   * @param {string} raceId - レースID
   * @returns {Promise<Object>} - 結果と払戻情報
   */
  async fetchRaceResult(raceId) {
    try {
      const $ = await this.fetchAndParse(`${this.jraBaseUrl}/race/result.html?race_id=${raceId}`);
      
      // 着順情報の取得
      const results = [];
      $('.ResultTableWrap table tr').each((i, element) => {
        if (i === 0) return; // ヘッダー行をスキップ
        
        const order = $(element).find('td').eq(0).text().trim();
        const horseNumber = $(element).find('td').eq(3).text().trim();
        const horseName = $(element).find('.Horse_Name a').text().trim();
        
        results.push({
          order: parseInt(order),
          horseNumber: parseInt(horseNumber),
          horseName
        });
      });
      
      // 払戻情報の取得
      const payouts = {
        tansho: [],
        fukusho: [],
        wakuren: [],
        umaren: [],
        wide: [],
        umatan: [],
        sanrentan: [],
        sanrenpuku: []
      };
      
      // 単勝
      $('.Tansho .Result span').each((i, element) => {
        const number = $(element).text().trim();
        if (number) payouts.tansho.push(parseInt(number));
      });
      
      // 単勝払戻金
      const tanshoAmount = this.extractNumber($('.Tansho .Payout span').text().trim());
      
      // 複勝
      $('.Fukusho .Result span').each((i, element) => {
        const number = $(element).text().trim();
        if (number) payouts.fukusho.push(parseInt(number));
      });
      
      // 複勝払戻金（複数の場合あり）
      const fukushoAmounts = [];
      $('.Fukusho .Payout span').text().trim().split('円').forEach(amount => {
        const num = this.extractNumber(amount);
        if (num) fukushoAmounts.push(num);
      });
      
      // 各払戻タイプの金額を設定
      payouts.tanshoAmount = tanshoAmount;
      payouts.fukushoAmounts = fukushoAmounts;
      
      // 枠連・馬連・ワイド・馬単・三連複・三連単も同様に取得
      // 省略（同様のパターンで各払戻情報を抽出）
      
      // レース結果をデータベースに保存
      await updateRaceResult(raceId, {
        results,
        payouts,
        status: 'finished'
      });
      
      logger.info(`レース結果を取得しました: ${raceId}`);
      return { results, payouts };
    } catch (error) {
      logger.error(`レース結果の取得に失敗しました: ${raceId}`, error);
      throw error;
    }
  }
}

module.exports = new JRAScraper();