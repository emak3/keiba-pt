// src/scrapers/netkeibaClient.js
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const iconv = require('iconv-lite');

class NetkeibaClient {
  constructor() {
    this.baseUrl = 'https://race.netkeiba.com';
    this.localBaseUrl = 'https://nar.netkeiba.com';
    this.raceResults = new Map(); // レース結果をキャッシュ
  }

  // エンコード対応のAxiosリクエスト
  async axiosGetWithEncoding(url, encoding = 'utf-8') {
    try {
      // responseTypeをarraybufferに設定してバイナリデータを取得
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      
      // 文字エンコーディングを指定して変換
      const data = iconv.decode(Buffer.from(response.data), encoding);
      return data;
    } catch (error) {
      console.error(`リクエストエラー (${url}):`, error);
      throw error;
    }
  }

  // 当日のレース一覧を取得（JRA + 地方競馬）
  async getTodayRaces() {
    try {
      // JRAレースを取得
      const jraRaces = await this.getTodayJraRaces();
      
      // 地方競馬のレースを取得
      let localRaces = [];
      try {
        localRaces = await this.getTodayLocalRaces();
      } catch (error) {
        console.warn('地方競馬レース一覧の取得に失敗しました。JRAレースのみ表示します。', error);
      }
      
      // 結合して返す
      return [...jraRaces, ...localRaces];
    } catch (error) {
      console.error('レース一覧の取得に失敗しました:', error);
      return [];
    }
  }

  // 当日のJRAレース一覧を取得
  async getTodayJraRaces() {
    try {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const dateString = `${year}${month}${day}`;
      
      const url = `${this.baseUrl}/top/race_list_sub.html?kaisai_date=${dateString}`;
      
      // エンコーディング対応で取得
      const html = await this.axiosGetWithEncoding(url, 'euc-jp');
      const $ = cheerio.load(html);
      
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
                  url: `${this.baseUrl}${raceLink}`,
                  type: 'jra' // JRAレースを識別
                });
              }
            }
          });
        }
      });
      
      return races;
    } catch (error) {
      console.error('JRAレース一覧の取得に失敗しました:', error);
      return [];
    }
  }

// 当日の地方競馬レース一覧を取得
  async getTodayLocalRaces() {
    try {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const dateString = `${year}${month}${day}`;
      
      // 地方競馬のレース一覧URL - 複数の候補を試してみる
      const urls = [
        `${this.localBaseUrl}/race_list/result/?kaisai_date=${dateString}`,
        `${this.localBaseUrl}/top/race_list_sub.html?kaisai_date=${dateString}`,
        `${this.localBaseUrl}/race/calendar.html?kaisai_date=${dateString}`,
        `${this.localBaseUrl}/race/kaisai_info.html?kaisai_date=${dateString}`
      ];
      
      let html = '';
      let successUrl = '';
      
      // いずれかのURLで成功するまで試行
      for (const url of urls) {
        try {
          // まずShift_JISで試す
          html = await this.axiosGetWithEncoding(url, 'shift_jis');
          successUrl = url;
          console.log(`地方競馬情報取得成功(Shift_JIS): ${url}`);
          
          // エンコードのテスト（文字化けの確認）
          const testStr = html.slice(0, 200);
          console.log(`Shift_JISで取得した内容のサンプル: ${testStr}`);
          
          // 日本語らしき文字が含まれているか確認
          if (!/[一-龠々〆〤]/.test(testStr)) {
            console.log('日本語が検出されませんでした。EUC-JPで再試行します...');
            html = await this.axiosGetWithEncoding(url, 'euc-jp');
            const eucjpTest = html.slice(0, 200);
            console.log(`EUC-JPで取得した内容のサンプル: ${eucjpTest}`);
            
            // さらにUTF-8でも試す
            if (!/[一-龠々〆〤]/.test(eucjpTest)) {
              console.log('EUC-JPでも日本語が検出されませんでした。UTF-8で再試行します...');
              html = await this.axiosGetWithEncoding(url, 'utf-8');
              const utf8Test = html.slice(0, 200);
              console.log(`UTF-8で取得した内容のサンプル: ${utf8Test}`);
            }
          }
          
          break; // 成功したらループを抜ける
        } catch (error) {
          console.warn(`地方競馬URL ${url} での取得に失敗: ${error.message}`);
        }
      }
      
      if (!html) {
        console.error('すべての地方競馬URLでの取得に失敗しました');
        return [];
      }
      
      const $ = cheerio.load(html);
      const races = [];
      
      // HTML全体を出力（デバッグ用）
      console.log('取得したHTML全体を検査します...');
      const bodyText = $('body').text().slice(0, 500);
      console.log(`ページ内容のサンプル: ${bodyText}`);
      
      // 地方競馬レースの抽出 - 複数のセレクタを試す
      console.log('地方競馬レースの抽出を開始します...');
      
      // パターン1: 特定のHTML構造を探す
      $('.race_kaisai').each((_, element) => {
        const kaisiaiInfo = $(element).find('.race_kaisai_info').text().trim();
        console.log(`競馬場情報: ${kaisiaiInfo}`);
        
        $(element).find('.race_top_hold_list li').each((_, raceElement) => {
          const raceNum = $(raceElement).find('.race_num').text().trim();
          const raceName = $(raceElement).find('.race_name').text().trim();
          const raceTime = $(raceElement).find('.race_time').text().trim();
          
          console.log(`レース情報: ${raceNum} ${raceName} ${raceTime}`);
          
          const raceLink = $(raceElement).find('a').attr('href');
          if (raceLink) {
            const raceId = raceLink.match(/race_id=([0-9]+)/)?.[1] || 
                          `local-${Date.now()}-${races.length}`;
            
            races.push({
              id: raceId,
              track: kaisiaiInfo || '地方競馬場',
              number: raceNum.replace(/R.*$/, ''),
              name: raceName || '地方競馬レース',
              time: raceTime || '---',
              status: '発走前',
              url: (raceLink.startsWith('http') ? raceLink : `${successUrl.split('/').slice(0, 3).join('/')}${raceLink}`),
              type: 'local'
            });
          }
        });
      });
      
      // パターン2: 別のセレクタ構造を試す
      if (races.length === 0) {
        console.log('パターン1で取得できませんでした。パターン2を試します...');
        $('.RaceList_DataList').each((_, element) => {
          const track = $(element).find('.RaceList_DataTitle').text().trim();
          console.log(`検出された競馬場: ${track}`);
          
          if (!track.includes('JRA')) {
            $(element).find('li').each((_, raceElement) => {
              const raceNum = $(raceElement).find('.RaceList_Itemnum').text().trim();
              const raceName = $(raceElement).find('.RaceList_ItemTitle').text().trim();
              const raceTime = $(raceElement).find('.RaceList_Itemtime').text().trim();
              
              console.log(`レース情報: ${raceNum} ${raceName} ${raceTime}`);
              
              const raceLink = $(raceElement).find('a').attr('href');
              if (raceLink) {
                const raceId = raceLink.match(/race_id=([0-9]+)/)?.[1];
                if (raceId) {
                  races.push({
                    id: raceId,
                    track: track,
                    number: raceNum.replace('R', ''),
                    name: raceName,
                    time: raceTime,
                    status: '発走前',
                    url: (raceLink.startsWith('http') ? raceLink : `${this.localBaseUrl}${raceLink}`),
                    type: 'local'
                  });
                }
              }
            });
          }
        });
      }
      
      // 直接開催情報を取得する方法
      if (races.length === 0) {
        console.log('パターン2でも取得できませんでした。直接検索します...');
        
        // すべてのa要素のhrefを調査
        $('a').each((_, element) => {
          const href = $(element).attr('href');
          if (href && href.includes('race_id=')) {
            const raceId = href.match(/race_id=([0-9]+)/)?.[1];
            const text = $(element).text().trim();
            console.log(`レースリンク発見: ${text} (ID: ${raceId})`);
            
            if (raceId && !races.some(r => r.id === raceId)) {
              // テキストからレース情報を抽出
              const raceNumMatch = text.match(/(\d+)R/);
              const raceTimeMatch = text.match(/(\d+):(\d+)/);
              
              races.push({
                id: raceId,
                track: '地方競馬場',
                number: raceNumMatch ? raceNumMatch[1] : '?',
                name: text.replace(/\d+R/, '').trim() || '地方競馬レース',
                time: raceTimeMatch ? `${raceTimeMatch[1]}:${raceTimeMatch[2]}` : '---',
                status: '発走前',
                url: href.startsWith('http') ? href : `${successUrl.split('/').slice(0, 3).join('/')}${href}`,
                type: 'local'
              });
            }
          }
        });
      }
      
      // デバッグ情報
      console.log(`地方競馬レース取得結果: ${races.length}件`);
      if (races.length > 0) {
        races.forEach((race, i) => {
          console.log(`レース${i+1}: ${race.track} ${race.number}R ${race.name} (${race.time})`);
        });
      } else {
        console.log('地方競馬レースは見つかりませんでした');
      }
      
      return races;
    } catch (error) {
      console.error('地方競馬レース一覧の取得に失敗しました:', error);
      throw error; // エラーを再スローして、呼び出し元で処理できるようにする
    }
  }

  // レース詳細（出走馬情報など）を取得
  async getRaceDetails(raceId, raceType = 'jra') {
    try {
      // レースタイプによってURLを切り替え
      const baseUrl = raceType === 'jra' ? this.baseUrl : this.localBaseUrl;
      const url = `${baseUrl}/race/shutuba.html?race_id=${raceId}`;
      
      // エンコーディング対応で取得
      const html = await this.axiosGetWithEncoding(url, 'euc-jp');
      const $ = cheerio.load(html);
      
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
        horses,
        type: raceType
      };
    } catch (error) {
      console.error(`レース詳細の取得に失敗しました (ID: ${raceId}):`, error);
      return null;
    }
  }

  // レース結果と払戻情報を取得
  async getRaceResult(raceId, raceType = 'jra') {
    try {
      // すでに結果を取得済みの場合はキャッシュから返す
      if (this.raceResults.has(raceId)) {
        return this.raceResults.get(raceId);
      }
      
      // レースタイプによってURLを切り替え
      const baseUrl = raceType === 'jra' ? this.baseUrl : this.localBaseUrl;
      const url = `${baseUrl}/race/result.html?race_id=${raceId}`;
      
      // エンコーディング対応で取得
      const html = await this.axiosGetWithEncoding(url, 'euc-jp');
      const $ = cheerio.load(html);
      
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
      
      const resultData = { 
        results, 
        payouts,
        type: raceType,
        confirmedAt: new Date()
      };
      
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
    // 5分ごとにレース結果をチェック（地方競馬も含む）
    cron.schedule('*/5 * * * *', async () => {
      console.log('レース結果を確認しています...');
      
      for (const race of races) {
        if (race.status !== '確定') {
          // レースタイプに応じた結果取得
          const result = await this.getRaceResult(race.id, race.type);
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

  // 指定したレースのオッズ情報を最新化
  async refreshRaceOdds(raceId, raceType = 'jra') {
    try {
      const details = await this.getRaceDetails(raceId, raceType);
      if (details && details.horses) {
        return details.horses.map(horse => ({
          umaban: horse.umaban,
          name: horse.name,
          odds: horse.odds
        }));
      }
      return null;
    } catch (error) {
      console.error(`オッズ情報の更新に失敗しました (ID: ${raceId}):`, error);
      return null;
    }
  }

  // 指定した日付のレース一覧を取得
  async getRacesByDate(date) {
    try {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateString = `${year}${month}${day}`;
      
      // JRAレースを取得
      let jraRaces = [];
      try {
        const jraUrl = `${this.baseUrl}/top/race_list_sub.html?kaisai_date=${dateString}`;
        const html = await this.axiosGetWithEncoding(jraUrl, 'euc-jp');
        const $jra = cheerio.load(html);
        
        // JRAレースの抽出
        $jra('.RaceList_DataList').each((_, element) => {
          const track = $jra(element).find('.RaceList_DataTitle').text().trim();
          if (track.includes('JRA')) {
            $jra(element).find('li').each((_, raceElement) => {
              const raceLink = $jra(raceElement).find('a').attr('href');
              if (raceLink) {
                const raceId = raceLink.match(/race_id=([0-9]+)/)?.[1];
                if (raceId) {
                  const raceNumber = $jra(raceElement).find('.RaceList_Itemnum').text().trim();
                  const raceName = $jra(raceElement).find('.RaceList_ItemTitle').text().trim();
                  const raceTime = $jra(raceElement).find('.RaceList_Itemtime').text().trim();
                  
                  jraRaces.push({
                    id: raceId,
                    track: track.replace('JRA ', ''),
                    number: raceNumber.replace('R', ''),
                    name: raceName,
                    time: raceTime,
                    status: '終了', // 過去のレースは終了扱い
                    url: `${this.baseUrl}${raceLink}`,
                    type: 'jra'
                  });
                }
              }
            });
          }
        });
      } catch (error) {
        console.warn(`JRAレース取得エラー (${date.toISOString()}):`, error);
      }
      
      // 地方競馬レースを取得 - 同じ実装を使って地方競馬も試してみる
      let localRaces = [];
      try {
        const localUrl = `${this.localBaseUrl}/top/race_list_sub.html?kaisai_date=${dateString}`;
        const html = await this.axiosGetWithEncoding(localUrl, 'euc-jp');
        const $local = cheerio.load(html);
        
        // 地方競馬レースの抽出
        $local('.RaceList_DataList').each((_, element) => {
          const track = $local(element).find('.RaceList_DataTitle').text().trim();
          if (!track.includes('JRA')) {
            $local(element).find('li').each((_, raceElement) => {
              const raceLink = $local(raceElement).find('a').attr('href');
              if (raceLink) {
                const raceId = raceLink.match(/race_id=([0-9]+)/)?.[1];
                if (raceId) {
                  const raceNumber = $local(raceElement).find('.RaceList_Itemnum').text().trim();
                  const raceName = $local(raceElement).find('.RaceList_ItemTitle').text().trim();
                  const raceTime = $local(raceElement).find('.RaceList_Itemtime').text().trim();
                  
                  localRaces.push({
                    id: raceId,
                    track: track,
                    number: raceNumber.replace('R', ''),
                    name: raceName,
                    time: raceTime,
                    status: '終了',
                    url: raceLink.startsWith('http') ? raceLink : `${this.localBaseUrl}${raceLink}`,
                    type: 'local'
                  });
                }
              }
            });
          }
        });
      } catch (error) {
        console.warn(`地方競馬レース取得エラー (${date.toISOString()}):`, error);
      }
      
      return [...jraRaces, ...localRaces];
    } catch (error) {
      console.error(`指定日のレース一覧取得に失敗しました (${date.toISOString()}):`, error);
      return [];
    }
  }
}

module.exports = NetkeibaClient;