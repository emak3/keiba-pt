const cron = require('node-cron');
const { getTodayRaces: getJRARaces, getRaceDetails: getJRARaceDetails, getRaceResult: getJRAResult } = require('./jra');
const { getTodayRaces: getNARRaces, getRaceDetails: getNARRaceDetails, getRaceResult: getNARResult } = require('./nar');
const { updateRaceList, updateRaceStatus, getAllActiveRaces, processBetPayouts } = require('../db/races');
const { getDb } = require('../db/firebase');

/**
 * スケジューラを開始
 */
function startScrapingSchedule() {
  // 初回実行
  fetchAllRaceData();
  
  // 10分ごとに実行 (レース情報更新)
  cron.schedule('*/10 * * * *', async () => {
    console.log('レース情報の定期更新を開始します...');
    await fetchAllRaceData();
  });
  
  // 3分ごとに結果をチェック (より頻繁に結果を確認)
  cron.schedule('*/3 * * * *', async () => {
    await checkRaceResults();
  });

  // 15分ごとに完了していないレースの払い戻し処理を再実行 (念のため)
  cron.schedule('*/15 * * * *', async () => {
    await recheckUnsettledBets();
  });
}

/**
 * すべてのレース情報を取得・更新する
 */
async function fetchAllRaceData() {
  try {
    // JRAのレース一覧を取得
    console.log('JRAレース一覧を取得しています...');
    const jraRaces = await getJRARaces();
    
    // 地方競馬のレース一覧を取得
    console.log('地方競馬レース一覧を取得しています...');
    const narRaces = await getNARRaces();
    
    // すべてのレースを結合
    const allRaces = [...jraRaces, ...narRaces];
    
    console.log(`合計 ${allRaces.length}件のレースを取得しました`);
    
    // データベースにレース一覧を保存
    await updateRaceList(allRaces);
    
    // 各レースの詳細情報を取得
    for (const race of allRaces) {
      try {
        if (race.type === 'jra') {
          await getJRARaceDetails(race.id);
        } else {
          await getNARRaceDetails(race.id);
        }
        
        // レート制限を回避するために少し待機
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (raceError) {
        console.error(`レース詳細(${race.id})の取得中にエラーが発生しました:`, raceError);
        // 1つのレースでエラーが発生しても続行
      }
    }
    
    console.log(`${allRaces.length}件のレース情報を更新しました`);
  } catch (error) {
    console.error('レース情報の更新中にエラーが発生しました:', error);
  }
}

/**
 * レース結果をチェック
 */
async function checkRaceResults() {
  try {
    // アクティブな（未完了の）レース一覧を取得
    const activeRaces = await getAllActiveRaces();
    
    if (activeRaces.length === 0) {
      return;  // アクティブなレースがなければ終了
    }
    
    console.log(`未完了レース数: ${activeRaces.length}件`);
    
    // 現在時刻
    const now = new Date();
    
    for (const race of activeRaces) {
      try {
        // レース時刻を解析
        const [hours, minutes] = race.time.split(':').map(Number);
        const raceTime = new Date();
        raceTime.setHours(hours, minutes, 0, 0);
        
        // レース終了から5分以上経過しているか（レース時間 + 5分（確定までの時間））
        const raceEndTime = new Date(raceTime.getTime() + 5 * 60000);
        
        if (now >= raceEndTime) {
          console.log(`レース結果をチェック: ${race.track} ${race.number}R ${race.name}`);
          
          // レース結果を取得
          let resultData;
          if (race.type === 'jra') {
            resultData = await getJRAResult(race.id);
          } else {
            resultData = await getNARResult(race.id);
          }
          
          // レース結果が正しく取得できたか確認
          if (resultData && resultData.payouts && Object.keys(resultData.payouts).some(type => 
              resultData.payouts[type] && resultData.payouts[type].length > 0)) {
            
            console.log(`レース ${race.id} の払戻情報を取得しました`);
            
            // レース状態を完了に更新
            await updateRaceStatus({
              id: race.id,
              isCompleted: true
            });
            
            // 馬券の払い戻し処理を明示的に実行
            await processBetPayouts(race.id);
          } else {
            console.log(`レース ${race.id} の払戻情報がまだありません。後で再試行します。`);
          }
        }
      } catch (raceError) {
        console.error(`レース結果のチェック中にエラーが発生しました (${race.id}):`, raceError);
        // 1つのレースでエラーが発生しても続行
      }
    }
  } catch (error) {
    console.error('レース結果のチェック中にエラーが発生しました:', error);
  }
}

/**
 * 未精算の馬券を再確認して処理する
 */
async function recheckUnsettledBets() {
  try {
    console.log('未精算の馬券を確認しています...');
    const db = getDb();
    
    // 完了済みのレースを取得
    const completedRacesSnapshot = await db.collection('races')
      .where('isCompleted', '==', true)
      .get();
    
    if (completedRacesSnapshot.empty) {
      console.log('完了済みのレースが見つかりません');
      return;
    }
    
    const completedRaceIds = [];
    completedRacesSnapshot.forEach(doc => {
      completedRaceIds.push(doc.id);
    });
    
    console.log(`完了済みレース数: ${completedRaceIds.length}件`);
    
    // 各レースの未精算馬券を処理
    for (const raceId of completedRaceIds) {
      try {
        // このレースの未精算馬券を取得
        const unsettledBetsSnapshot = await db.collection('bets')
          .where('raceId', '==', raceId)
          .where('settled', '==', false)
          .limit(100) // 一度に処理する件数を制限
          .get();
        
        if (!unsettledBetsSnapshot.empty) {
          console.log(`レース ${raceId} の未精算馬券: ${unsettledBetsSnapshot.size}件`);
          
          // レース結果データがあるか確認
          const resultDoc = await db.collection('raceResults').doc(raceId).get();
          
          if (resultDoc.exists) {
            console.log(`レース ${raceId} の結果データが存在します。払戻処理を実行します。`);
            await processBetPayouts(raceId);
          } else {
            console.log(`レース ${raceId} の結果データがありません。再取得を試みます。`);
            
            // レース情報を取得
            const raceDoc = await db.collection('races').doc(raceId).get();
            
            if (raceDoc.exists) {
              const raceData = raceDoc.data();
              
              // レース結果を再取得
              if (raceData.type === 'jra') {
                await getJRAResult(raceId);
              } else {
                await getNARResult(raceId);
              }
              
              // 払い戻し処理
              await processBetPayouts(raceId);
            }
          }
        }
      } catch (error) {
        console.error(`レース ${raceId} の未精算馬券処理中にエラーが発生しました:`, error);
      }
    }
    
    console.log('未精算馬券の処理が完了しました');
  } catch (error) {
    console.error('未精算馬券の再確認中にエラーが発生しました:', error);
  }
}

module.exports = {
  startScrapingSchedule
};