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
          console.log(`レース${i + 1}: ${race.track} ${race.number}R ${race.name} (${race.time})`);
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

      console.log(`レース詳細取得開始: ${url}`);

      // エンコーディング対応で取得
      const html = await this.axiosGetWithEncoding(url, 'euc-jp');
      const $ = cheerio.load(html);

      // HTML全体をデバッグ（問題診断用）
      console.log(`ページタイトル: ${$('title').text()}`);

      const horses = [];
      let horseCount = 0;

      // 方法1: 通常の馬リスト構造
      if ($('.HorseList').length > 0) {
        console.log('HorseList構造を検出しました');
        $('.HorseList').find('tr').each((index, element) => {
          if (index > 0) { // ヘッダー行をスキップ
            const waku = $(element).find('.Waku').text().trim();
            const umaban = $(element).find('.Umaban').text().trim();

            // 馬名を正確に取得 - span.HorseName内のaタグのテキスト
            const horseName = $(element).find('span.HorseName a').text().trim();
            const jockey = $(element).find('.Jockey a').text().trim();
            const weight = $(element).find('.Weight').text().trim();

            // オッズを正確に取得 - 複数のパターンに対応
            let odds = 999.9;

            // パターン1: span.Odds_Ninki
            const oddsSpan = $(element).find('span.Odds_Ninki');
            if (oddsSpan.length > 0) {
              const oddsText = oddsSpan.text().trim();
              if (oddsText && !isNaN(parseFloat(oddsText))) {
                odds = parseFloat(oddsText);
              }
            }
            // パターン2: td.Popular.Txt_R
            else {
              const popularTd = $(element).find('td.Popular.Txt_R');
              if (popularTd.length > 0) {
                // 最初の数字を取得
                const oddsText = popularTd.text().trim().split(/\s+/)[0];
                if (oddsText && !isNaN(parseFloat(oddsText))) {
                  odds = parseFloat(oddsText);
                }
              }
              // パターン3: 通常のOddsクラス
              else {
                const oddsText = $(element).find('.Odds').text().trim();
                if (oddsText && !isNaN(parseFloat(oddsText))) {
                  odds = parseFloat(oddsText);
                }
              }
            }

            // 有効な馬番と馬名があるエントリーのみ追加
            if (umaban && horseName) {
              horses.push({
                waku: waku || '不明',
                umaban,
                name: horseName,
                jockey: jockey || '不明',
                weight: weight || '不明',
                odds: odds
              });
              horseCount++;
            }
          }
        });
      }

      // 方法2: 代替の馬リスト構造
      if (horses.length === 0 && $('.Shutuba_Table').length > 0) {
        console.log('Shutuba_Table構造を検出しました');
        $('.Shutuba_Table').find('tr').each((index, element) => {
          const waku = $(element).find('.Waku').text().trim() ||
            $(element).find('td:nth-child(1)').text().trim();
          const umaban = $(element).find('.Umaban').text().trim() ||
            $(element).find('td:nth-child(2)').text().trim();

          // 馬名をより正確に取得
          let horseName = '';
          const horseNameSpan = $(element).find('span.HorseName a');
          if (horseNameSpan.length > 0) {
            horseName = horseNameSpan.text().trim();
          } else {
            horseName = $(element).find('td:nth-child(4) a').text().trim();
          }

          const jockey = $(element).find('.Jockey a').text().trim() ||
            $(element).find('td:nth-child(7) a').text().trim();

          // オッズを正確に取得 - 複数のパターンに対応
          let odds = 999.9;

          // パターン1: span.Odds_Ninki
          const oddsSpan = $(element).find('span.Odds_Ninki');
          if (oddsSpan.length > 0) {
            const oddsText = oddsSpan.text().trim();
            if (oddsText && !isNaN(parseFloat(oddsText))) {
              odds = parseFloat(oddsText);
            }
          }
          // パターン2: td.Popular.Txt_R
          else {
            const popularTd = $(element).find('td.Popular.Txt_R');
            if (popularTd.length > 0) {
              // 最初の数字を取得
              const oddsText = popularTd.text().trim().split(/\s+/)[0];
              if (oddsText && !isNaN(parseFloat(oddsText))) {
                odds = parseFloat(oddsText);
              }
            }
            // パターン3: 他のテーブルセル
            else {
              const oddsText = $(element).find('td:nth-child(10)').text().trim();
              if (oddsText && !isNaN(parseFloat(oddsText))) {
                odds = parseFloat(oddsText);
              }
            }
          }

          // 有効な馬番と馬名があるエントリーのみ追加
          if (umaban && horseName) {
            horses.push({
              waku: waku || '不明',
              umaban,
              name: horseName,
              jockey: jockey || '不明',
              weight: '不明',
              odds: odds
            });
            horseCount++;
          }
        });
      }

      // 方法3: 詳細なDOM分析で馬名とオッズを特定
      if (horses.length === 0) {
        console.log('詳細なDOM分析を行っています...');

        // まず馬名を含むすべてのspanを探す
        $('span.HorseName').each((_, element) => {
          const horseLink = $(element).find('a');
          if (horseLink.length > 0) {
            const horseName = horseLink.text().trim();
            if (horseName) {
              // 親要素をたどって行(tr)を見つける
              const parentRow = $(element).closest('tr');
              if (parentRow.length > 0) {
                const umaban = parentRow.find('td').eq(1).text().trim() || '不明';
                const waku = parentRow.find('td').eq(0).text().trim() || '不明';
                let jockey = '不明';

                // 騎手名を探す
                const jockeyLink = parentRow.find('.Jockey a, td:contains("騎手") + td a');
                if (jockeyLink.length > 0) {
                  jockey = jockeyLink.text().trim();
                }

                // オッズを探す - 複数のパターンに対応
                let odds = 999.9;

                // パターン1: span.Odds_Ninki
                const oddsSpan = parentRow.find('span.Odds_Ninki');
                if (oddsSpan.length > 0) {
                  const oddsText = oddsSpan.text().trim();
                  if (oddsText && !isNaN(parseFloat(oddsText))) {
                    odds = parseFloat(oddsText);
                  }
                }
                // パターン2: td.Popular.Txt_R
                else {
                  const popularTd = parentRow.find('td.Popular.Txt_R');
                  if (popularTd.length > 0) {
                    // 最初の数字を取得
                    const oddsText = popularTd.text().trim().split(/\s+/)[0];
                    if (oddsText && !isNaN(parseFloat(oddsText))) {
                      odds = parseFloat(oddsText);
                    }
                  }
                  // パターン3: 数値のみのセルを探す
                  else {
                    parentRow.find('td').each((i, cell) => {
                      const cellText = $(cell).text().trim();
                      // 数字とドットだけで構成されていてオッズっぽい値を探す
                      if (/^[\d.]+$/.test(cellText) && parseFloat(cellText) > 1 && parseFloat(cellText) < 1000) {
                        odds = parseFloat(cellText);
                      }
                    });
                  }
                }

                horses.push({
                  waku: waku,
                  umaban: umaban.replace(/[^\d]/g, ''), // 数字以外を除去
                  name: horseName,
                  jockey: jockey,
                  weight: '不明',
                  odds: odds
                });
                horseCount++;
              }
            }
          }
        });
      }

      // 方法4: ページ内のすべての馬名リンクと近くのオッズを探す
      if (horses.length === 0) {
        console.log('馬名リンクからデータを探します...');

        // すべてのtd.Popular.Txt_Rを見つけてオッズマップを作成
        const oddsMap = new Map();
        $('td.Popular.Txt_R').each((_, element) => {
          const parentRow = $(element).closest('tr');
          if (parentRow.length > 0) {
            const oddsText = $(element).text().trim().split(/\s+/)[0];
            if (oddsText && !isNaN(parseFloat(oddsText))) {
              // 行番号をキーとしてオッズを保存
              const rowIndex = parentRow.index();
              oddsMap.set(rowIndex, parseFloat(oddsText));
            }
          }
        });

        // 馬のリンクを探す
        $('a').each((_, element) => {
          const href = $(element).attr('href');
          // 馬データへのリンクを探す
          if (href && href.includes('/horse/')) {
            const horseName = $(element).text().trim();
            if (horseName && horseName.length > 1) {
              // 親要素から馬番を探す
              const parentRow = $(element).closest('tr');
              let umaban = '不明';
              let waku = '不明';
              let odds = 999.9;

              if (parentRow.length > 0) {
                // 行インデックスからオッズを取得
                const rowIndex = parentRow.index();
                if (oddsMap.has(rowIndex)) {
                  odds = oddsMap.get(rowIndex);
                }

                // 周囲のテキストから馬番を探す
                const fullText = parentRow.text();
                const umabanMatch = fullText.match(/(\d{1,2})\s*番/);
                if (umabanMatch) {
                  umaban = umabanMatch[1];
                } else {
                  // 馬番っぽい数字を探す
                  const cells = parentRow.find('td');
                  if (cells.length > 1) {
                    // 最初または2番目のセルが馬番である可能性が高い
                    const firstCellText = $(cells[0]).text().trim();
                    const secondCellText = $(cells[1]).text().trim();

                    if (/^\d+$/.test(firstCellText) && parseInt(firstCellText) < 30) {
                      umaban = firstCellText;
                    } else if (/^\d+$/.test(secondCellText) && parseInt(secondCellText) < 30) {
                      umaban = secondCellText;
                    }
                  }
                }
              }

              horses.push({
                waku: waku,
                umaban: umaban,
                name: horseName,
                jockey: '不明',
                weight: '不明',
                odds: odds
              });
              horseCount++;
            }
          }
        });
      }

      console.log(`取得した出走馬数: ${horseCount}頭`);
      if (horses.length > 0) {
        horses.forEach((horse, idx) => {
          console.log(`馬${idx + 1}: ${horse.umaban}番 ${horse.name} (オッズ: ${horse.odds})`);
        });
      } else {
        console.log('出走馬データを取得できませんでした');
      }

      // レース基本情報の取得（複数の可能性のある要素をチェック）
      let raceTitle = $('.RaceName').text().trim();
      if (!raceTitle) {
        raceTitle = $('h1').first().text().trim() ||
          $('title').text().trim() ||
          `レース ID: ${raceId}`;
      }

      let courseInfo = $('.RaceData01').text().trim();
      if (!courseInfo) {
        courseInfo = $('.RaceData').first().text().trim() || '情報なし';
      }

      let raceData = $('.RaceData02').text().trim();
      if (!raceData) {
        raceData = $('.RaceData').eq(1).text().trim() || '情報なし';
      }

      // 馬が見つからなかった場合はnullを返す代わりに、空の馬リストを持つレース情報を返す
      if (horses.length === 0) {
        console.log('出走馬データを取得できませんでした。空のリストを返します。');
        return {
          id: raceId,
          title: raceTitle,
          courseInfo,
          raceData,
          horses: [], // 空のリスト
          type: raceType,
          error: '出走馬データを取得できませんでした'
        };
      }

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

      // エラーが発生した場合はダミーデータではなくエラー情報を返す
      return {
        id: raceId,
        title: `レース ID: ${raceId}`,
        courseInfo: '情報取得失敗',
        raceData: '情報取得失敗',
        horses: [], // 空のリスト
        type: raceType,
        error: `データ取得中にエラーが発生しました: ${error.message}`
      };
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