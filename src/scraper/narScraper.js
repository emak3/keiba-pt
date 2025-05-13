// src/scraper/narScraper.js
const NetKeibaScraperBase = require('./netkeiba');
const logger = require('../utils/logger');
const { saveRaceData, updateRaceResult } = require('../db/raceRepository');

/**
 * 地方競馬(NAR)情報をスクレイピングするクラス
 */
class NARScraper extends NetKeibaScraperBase {
  constructor() {
    super();
    this.narBaseUrl = 'https://nar.netkeiba.com';
  }

  /**
   * 当日開催の地方競馬レース一覧を取得
   * @returns {Promise<Array>} - レース情報の配列
   */
  async fetchTodayRaces() {
    try {
      // 地方競馬トップページから当日のレース一覧を取得
      const $ = await this.fetchAndParse(`${this.narBaseUrl}/top/race_list.html`);
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
            type: 'NAR',
            venue,
            number: parseInt(raceNumber),
            name: raceName,
            startTime,
            date: new Date(),  // 当日の日付
            status: 'upcoming'
          });
        });
      });

      logger.info(`本日の地方競馬レース ${races.length}件を取得しました`);
      return races;
    } catch (error) {
      logger.error('本日の地方競馬レース一覧の取得に失敗しました', error);
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
      const $ = await this.fetchAndParse(`${this.narBaseUrl}/race/shutuba.html?race_id=${raceId}`);
      
      // レース名と基本情報
      const raceName = $('.RaceName').text().trim();
      const raceData = $('.RaceData01').text().trim();
      
      // 距離と馬場
      const distanceMatch = raceData.match(/(\d+)m/);
      const distance = distanceMatch ? parseInt(distanceMatch[1]) : null;
      
      // 表面（芝/ダート）
      const surface = raceData.includes('芝') ? '芝' : 'ダート';
      
      // 左右回り（括弧内の情報から抽出）
      const direction = raceData.match(/\((.+?)\)/) ? 
        (raceData.match(/\((.+?)\)/)[1].includes('右') ? '右' : '左') : 
        '左';
      
      // レース情報（開催回、日目など）
      const raceInfo = $('.RaceData02').text().trim();
      
      // 出走馬情報の取得
      const horses = [];
      $('.HorseList').each((i, element) => {
        const frameNumber = $(element).find('.Waku').text().trim().replace(/[^\d]/g, '');
        const horseNumber = $(element).find('.Umaban').text().trim();
        const horseName = $(element).find('.HorseName a').text().trim();
        const horseId = $(element).find('.HorseName a').attr('href')?.match(/horse\/(\d+)/)?.[1];
        
        // 騎手
        const jockey = $(element).find('.Jockey a').text().trim();
        
        // 調教師
        const trainerContainer = $(element).find('.Trainer');
        const trainerArea = trainerContainer.find('.LabelGray').text().trim();
        const trainer = trainerContainer.find('a').text().trim();
        
        // 馬体重
        const weightText = $(element).find('.Weight').text().trim();
        const weight = this.extractNumber(weightText);
        const weightDiff = weightText.match(/\(([\+\-]\d+)\)/) ? 
          parseInt(weightText.match(/\(([\+\-]\d+)\)/)[1]) : 
          0;
        
        // オッズと人気
        const odds = this.extractNumber($(element).find('.Popular.Txt_R').text().trim());
        const popularity = this.extractNumber($(element).find('.Popular.Txt_C').text().trim());
        
        // 性齢
        const ageText = $(element).find('.Age').text().trim();
        const gender = ageText.match(/[牡牝セ]/)?.[0] || '';
        const age = this.extractNumber(ageText);
        
        horses.push({
          id: horseId,
          name: horseName,
          number: parseInt(horseNumber),
          frame: parseInt(frameNumber),
          jockey,
          trainer: `${trainerArea} ${trainer}`,
          weight,
          weightDiff,
          odds,
          popularity,
          age,
          gender
        });
      });
      
      const raceDetail = {
        id: raceId,
        type: 'NAR',
        name: raceName,
        distance,
        surface,
        direction,
        horses,
        status: 'upcoming'
      };
      
      // データベースにレース情報を保存
      await saveRaceData(raceDetail);
      
      logger.info(`地方競馬レース詳細を取得しました: ${raceId}`);
      return raceDetail;
    } catch (error) {
      logger.error(`地方競馬レース詳細の取得に失敗しました: ${raceId}`, error);
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
      const $ = await this.fetchAndParse(`${this.narBaseUrl}/race/result.html?race_id=${raceId}`);
      
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
      const fukushoAmountText = $('.Fukusho .Payout span').text().trim();
      fukushoAmountText.split('円').forEach(amount => {
        const num = this.extractNumber(amount);
        if (num) fukushoAmounts.push(num);
      });
      
      // 枠連
      $('.Wakuren .Result ul li span').each((i, element) => {
        const number = $(element).text().trim();
        if (number) payouts.wakuren.push(parseInt(number));
      });
      
      // 枠連払戻金
      const wakurenAmount = this.extractNumber($('.Wakuren .Payout span').text().trim());
      
      // 馬連
      $('.Umaren .Result ul li span').each((i, element) => {
        const number = $(element).text().trim();
        if (number) payouts.umaren.push(parseInt(number));
      });
      
      // 馬連払戻金
      const umarenAmount = this.extractNumber($('.Umaren .Payout span').text().trim());
      
      // ワイド
      $('.Wide .Result ul').each((i, wideElement) => {
        const wideCombo = [];
        $(wideElement).find('li span').each((j, element) => {
          const number = $(element).text().trim();
          if (number) wideCombo.push(parseInt(number));
        });
        
        if (wideCombo.length === 2) {
          payouts.wide.push(wideCombo);
        }
      });
      
      // ワイド払戻金（複数の場合あり）
      const wideAmounts = [];
      $('.Wide .Payout span').text().trim().split('円').forEach(amount => {
        const num = this.extractNumber(amount);
        if (num) wideAmounts.push(num);
      });
      
      // 馬単
      $('.Umatan .Result ul li span').each((i, element) => {
        const number = $(element).text().trim();
        if (number) payouts.umatan.push(parseInt(number));
      });
      
      // 馬単払戻金
      const umatanAmount = this.extractNumber($('.Umatan .Payout span').text().trim());
      
      // 三連複
      $('.Fuku3 .Result ul li span').each((i, element) => {
        const number = $(element).text().trim();
        if (number) payouts.sanrenpuku.push(parseInt(number));
      });
      
      // 三連複払戻金
      const sanrenpukuAmount = this.extractNumber($('.Fuku3 .Payout span').text().trim());
      
      // 三連単
      $('.Tan3 .Result ul li span').each((i, element) => {
        const number = $(element).text().trim();
        if (number) payouts.sanrentan.push(parseInt(number));
      });
      
      // 三連単払戻金
      const sanrentanAmount = this.extractNumber($('.Tan3 .Payout span').text().trim());
      
      // 各払戻タイプの金額を設定
      payouts.tanshoAmount = tanshoAmount;
      payouts.fukushoAmounts = fukushoAmounts;
      payouts.wakurenAmount = wakurenAmount;
      payouts.umarenAmount = umarenAmount;
      payouts.wideAmounts = wideAmounts;
      payouts.umatanAmount = umatanAmount;
      payouts.sanrenpukuAmount = sanrenpukuAmount;
      payouts.sanrentanAmount = sanrentanAmount;
      
      // レース結果をデータベースに保存
      await updateRaceResult(raceId, {
        results,
        payouts,
        status: 'finished'
      });
      
      logger.info(`地方競馬レース結果を取得しました: ${raceId}`);
      return { results, payouts };
    } catch (error) {
      logger.error(`地方競馬レース結果の取得に失敗しました: ${raceId}`, error);
      throw error;
    }
  }
}

module.exports = new NARScraper();