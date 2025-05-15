// scheduler.js - スクレイピングを定期的に実行するスケジューラ
const cron = require('node-cron');
const { getTodayRaces: getJRARaces, getRaceDetails: getJRARaceDetails, getRaceResult: getJRAResult } = require('./jra');
const { getTodayRaces: getNARRaces, getRaceDetails: getNARRaceDetails, getRaceResult: getNARResult } = require('./nar');
const { getTodayRaces, updateRaceStatus, getAllActiveRaces } = require('../db/races');

/**
 * 10分ごとにレース情報を更新するスケジューラを開始
 */
function startScrapingSchedule() {
  // 初回実行
  fetchAllRaceData();
  
  // 10分ごとに実行 (cron形式: 分 時 日 月 曜日)
  cron.schedule('*/10 * * * *', async () => {
    console.log('レース情報の定期更新を開始します...');
    await fetchAllRaceData();
  });
  
  // 1分ごとに結果をチェック (レース終了後すぐに結果を取得するため)
  cron.schedule('*/1 * * * *', async () => {
    await checkRaceResults();
  });
}

/**
 * すべてのレース情報を取得・更新する
 */
async function fetchAllRaceData() {
  try {
    // JRAのレース一覧を取得
    const jraRaces = await getJRARaces();
    
    // 地方競馬のレース一覧を取得
    const narRaces = await getNARRaces();
    
    // すべてのレースを結合
    const allRaces = [...jraRaces, ...narRaces];
    
    // データベースにレース一覧を保存
    await updateRaceList(allRaces);
    
    // 各レースの詳細情報を取得
    for (const race of allRaces) {
      if (race.type === 'jra') {
        await getJRARaceDetails(race.id);
      } else {
        await getNARRaceDetails(race.id);
      }
      
      // レート制限を回避するために少し待機
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`${allRaces.length}件のレース情報を更新しました`);
  } catch (error) {
    console.error('レース情報の更新中にエラーが発生しました:', error);
  }
}

/**
 * レース一覧をデータベースに保存
 */
async function updateRaceList(races) {
  try {
    // 既存のレース一覧を取得
    const existingRaces = await getTodayRaces();
    
    // 新しいレースのみを追加
    for (const race of races) {
      const exists = existingRaces.some(r => r.id === race.id);
      
      if (!exists) {
        await updateRaceStatus(race);
      }
    }
  } catch (error) {
    console.error('レース一覧の更新中にエラーが発生しました:', error);
  }
}

/**
 * レース結果をチェック
 */
async function checkRaceResults() {
  try {
    // アクティブな（未完了の）レース一覧を取得
    const activeRaces = await getAllActiveRaces();
    
    // 現在時刻
    const now = new Date();
    
    for (const race of activeRaces) {
      // レース時刻を解析
      const [hours, minutes] = race.time.split(':').map(Number);
      const raceTime = new Date();
      raceTime.setHours(hours, minutes, 0, 0);
      
      // レース終了から10分以上経過しているか（レース時間 + 5分（レース時間） + 10分（確定までの時間））
      const raceEndTime = new Date(raceTime.getTime() + 15 * 60000);
      
      if (now >= raceEndTime) {
        console.log(`レース結果をチェック: ${race.track} ${race.number}R ${race.name}`);
        
        // レース結果を取得
        if (race.type === 'jra') {
          await getJRAResult(race.id);
        } else {
          await getNARResult(race.id);
        }
        
        // レース状態を完了に更新
        await updateRaceStatus({
          ...race,
          isCompleted: true
        });
      }
    }
  } catch (error) {
    console.error('レース結果のチェック中にエラーが発生しました:', error);
  }
}

module.exports = {
  startScrapingSchedule
};