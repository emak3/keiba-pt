// test-race-result.js
const { initializeFirebase } = require('./db/firebase');
const { getRaceById, testRaceResultProcessing } = require('./db/races');
const { getRaceResult: getJRAResult } = require('./scraping/jra');
const { getRaceResult: getNARResult } = require('./scraping/nar');

// コマンドライン引数を取得
const args = process.argv.slice(2);
const raceId = args[0] || '202535051311'; // デフォルト値
const isForced = args.includes('--force');

// Firebaseを初期化
initializeFirebase();

async function main() {
  try {
    console.log(`レースID: ${raceId} のテストを開始します`);
    
    // レース情報を取得
    const race = await getRaceById(raceId);
    
    if (!race) {
      console.error('レース情報が見つかりません');
      return;
    }
    
    console.log(`レース情報:`, race);
    
    // レース結果を取得
    console.log('レース結果を取得します...');
    let result;
    
    if (race.type === 'jra') {
      result = await getJRAResult(raceId);
    } else {
      result = await getNARResult(raceId);
    }
    
    console.log('取得結果:', result);
    
    // 強制実行フラグがある場合は払戻処理を強制実行
    if (isForced) {
      console.log('払戻処理を強制実行します...');
      await testRaceResultProcessing(raceId);
    }
    
    console.log('テスト完了');
  } catch (error) {
    console.error('テスト実行中にエラーが発生しました:', error);
  } finally {
    process.exit(0);
  }
}

main();