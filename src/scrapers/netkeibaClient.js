// src/scrapers/netkeibaClient.js
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');

class NetkeibaClient {
  constructor() {
    this.baseUrl = 'https://race.netkeiba.com';
    this.raceResults = new Map(); // レース結果を保存
  }

  // 当日のJRAレース一覧を取得
  async getTodayRaces() {
    try {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const dateString = `${year}${month}${day}`;
      
      const url = `${this.baseUrl}/top/race_list_sub.html?kaisai_date=${dateString}`;
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);
      
      const races = [];
      
      // JRAのレースだけを抽出
      $('.RaceList_DataList').each((_, element) => {
        const track = $(element).find('.RaceList_DataTitle').text().trim();
        if (track.includes('JRA')) {
          $(element).find('li').each((_, raceElement) => {
            const raceLink = $(raceElement).find('a').attr('href');
            if (raceLink) {
              const raceId = raceLink.match(/race_id=([0-9]+)/)?.[1];
              if (raceId) {
                const raceNumber = $(raceElement).find('.RaceList_Itemnum').text().trim();
                const raceName = $(raceElement).find('.RaceList_ItemTitle').text().trim();
                const raceTime = $(raceElement).find('.RaceList_Itemtime').text().trim();
                
                races.push({
                  id: raceId,
                  track: track.replace('JRA ', ''),
                  number: raceNumber.replace('R', ''),
                  name: raceName,
                  time: raceTime,
                  status: '発走前', // 初期ステータス
                  url: `${this.baseUrl}${raceLink}`
                });
              }
            }
          });
        }
      });
      
      return races;
    } catch (error) {
      console.error('レース一覧の取得に失敗しました:', error);
      return [];
    }
  }

  // レース詳細（出走馬情報など）を取得
  async getRaceDetails(raceId) {
    try {
      const url = `${this.baseUrl}/race/shutuba.html?race_id=${raceId}`;
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);
      
      const horses = [];
      
      // 出走馬情報の取得
      $('.HorseList').find('tr').each((index, element) => {
        if (index > 0) { // ヘッダー行をスキップ
          const waku = $(element).find('.Waku').text().trim();
          const umaban = $(element).find('.Umaban').text().trim();
          const horseName = $(element).find('.HorseName a').text().trim();
          const jockey = $(element).find('.Jockey a').text().trim();
          const weight = $(element).find('.Weight').text().trim();
          const odds = $(element).find('.Odds').text().trim();
          
          horses.push({
            waku,
            umaban,
            name: horseName,
            jockey,
            weight,
            odds: parseFloat(odds) || 999.9 // オッズが取得できない場合は高い値をセット
          });
        }
      });

      // レース基本情報の取得
      const raceTitle = $('.RaceName').text().trim();
      const courseInfo = $('.RaceData01').text().trim();
      const raceData = $('.RaceData02').text().trim();
      
      return {
        id: raceId,
        title: raceTitle,
        courseInfo,
        raceData,
        horses
      };
    } catch (error) {
      console.error(`レース詳細の取得に失敗しました (ID: ${raceId}):`, error);
      return null;
    }
  }

  // レース結果と払戻情報を取得
  async getRaceResult(raceId) {
    try {
      // すでに結果を取得済みの場合はキャッシュから返す
      if (this.raceResults.has(raceId)) {
        return this.raceResults.get(raceId);
      }
      
      const url = `${this.baseUrl}/race/result.html?race_id=${raceId}`;
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);
      
      // レース結果が存在するか確認
      if ($('.ResultTableWrap').length === 0) {
        return null; // 結果がまだ出ていない
      }
      
      const results = [];
      
      // 着順情報の取得
      $('.ResultTableWrap table tr').each((index, element) => {
        if (index > 0) { // ヘッダー行をスキップ
          const order = $(element).find('td').eq(0).text().trim();
          const waku = $(element).find('td').eq(1).text().trim();
          const umaban = $(element).find('td').eq(2).text().trim();
          const horseName = $(element).find('td').eq(3).find('a').text().trim();
          
          if (order && !isNaN(parseInt(order))) {
            results.push({
              order: parseInt(order),
              waku,
              umaban,
              name: horseName
            });
          }
        }
      });
      
      // 払戻金情報の取得
      const payouts = {
        tansho: this.extractPayout($, '単勝'),
        fukusho: this.extractPayout($, '複勝'),
        wakuren: this.extractPayout($, '枠連'),
        umaren: this.extractPayout($, '馬連'),
        wide: this.extractPayout($, 'ワイド'),
        umatan: this.extractPayout($, '馬単'),
        sanrentan: this.extractPayout($, '三連単'),
        sanrenpuku: this.extractPayout($, '三連複')
      };
      
      const resultData = { results, payouts };
      this.raceResults.set(raceId, resultData); // キャッシュに保存
      
      return resultData;
    } catch (error) {
      console.error(`レース結果の取得に失敗しました (ID: ${raceId}):`, error);
      return null;
    }
  }

  // 払戻情報を抽出するヘルパーメソッド
  extractPayout($, betType) {
    const payouts = [];
    
    $('.Pay_Block').each((_, element) => {
      const title = $(element).find('.Pay_Item_Title').text().trim();
      if (title.includes(betType)) {
        $(element).find('.Pay_Item_Detail').each((_, detailElement) => {
          const numbers = $(detailElement).find('.Result_Num').text().trim().replace(/\s+/g, '-');
          const amount = $(detailElement).find('.Result_Pay').text().trim().replace(/[^0-9]/g, '');
          
          if (numbers && amount) {
            payouts.push({
              numbers,
              amount: parseInt(amount)
            });
          }
        });
      }
    });
    
    return payouts;
  }

  // 定期的にレース結果をチェックする処理を開始
  startResultsMonitoring(races, callback) {
    // 10分ごとにレース結果をチェック
    cron.schedule('*/10 * * * *', async () => {
      console.log('レース結果を確認しています...');
      
      for (const race of races) {
        if (race.status !== '確定') {
          const result = await this.getRaceResult(race.id);
          if (result && result.results.length > 0) {
            race.status = '確定';
            if (callback) {
              callback(race.id, result);
            }
          }
        }
      }
    });
  }
}

module.exports = NetkeibaClient;