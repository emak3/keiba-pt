// scheduler-with-date.js - 日付取得機能追加版スケジューラ

const schedule = require('node-schedule');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ログディレクトリの作成
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// 現在の日時からログファイル名を生成する関数
function getLogFileName(prefix = 'scraper') {
    const now = new Date();
    const dateStr = now.toISOString().replace(/:/g, '-').replace(/\..+/, '');
    return path.join(logDir, `${prefix}-${dateStr}.log`);
}

// スクレイピングジョブを実行する関数
function runScraperJob() {
    console.log(`[${new Date().toISOString()}] 通常スクレイピングジョブを開始します...`);
    
    // ログファイルのストリームを作成
    const logFile = fs.createWriteStream(getLogFileName(), { flags: 'a' });
    
    // server-scraper.jsを子プロセスとして実行
    const scraperProcess = spawn('node', ['server-scraper.js'], {
        stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // 標準出力と標準エラー出力をログファイルとコンソールに記録
    scraperProcess.stdout.pipe(logFile);
    scraperProcess.stderr.pipe(logFile);
    
    scraperProcess.stdout.on('data', (data) => {
        process.stdout.write(data.toString());
    });
    
    scraperProcess.stderr.on('data', (data) => {
        process.stderr.write(data.toString());
    });
    
    // プロセス終了時の処理
    scraperProcess.on('close', (code) => {
        const message = `[${new Date().toISOString()}] 通常スクレイピングジョブが終了しました。終了コード: ${code}`;
        logFile.write(message + '\n');
        console.log(message);
        logFile.end();
    });
}

// 日付別レース情報取得ジョブを実行する関数
function runDateScraperJob() {
    console.log(`[${new Date().toISOString()}] 日付別スクレイピングジョブを開始します...`);
    
    // 今日と明日の日付を取得
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    
    // 日付をYYYYMMDD形式に変換
    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}${month}${day}`;
    };
    
    const todayStr = formatDate(today);
    const tomorrowStr = formatDate(tomorrow);
    
    // 今日と明日の日付のレース情報を取得
    runDateScraper(todayStr, 'today');
    
    // 1秒後に明日の処理を開始
    setTimeout(() => {
        runDateScraper(tomorrowStr, 'tomorrow');
    }, 1000);
}

// 特定の日付のレース情報を取得
function runDateScraper(dateStr, logPrefix) {
    // ログファイルのストリームを作成
    const logFile = fs.createWriteStream(getLogFileName(`date-${logPrefix}`), { flags: 'a' });
    
    // date-scraper.jsを子プロセスとして実行
    const scraperProcess = spawn('node', ['date-scraper.js', dateStr], {
        stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // 標準出力と標準エラー出力をログファイルとコンソールに記録
    scraperProcess.stdout.pipe(logFile);
    scraperProcess.stderr.pipe(logFile);
    
    scraperProcess.stdout.on('data', (data) => {
        process.stdout.write(data.toString());
    });
    
    scraperProcess.stderr.on('data', (data) => {
        process.stderr.write(data.toString());
    });
    
    // プロセス終了時の処理
    scraperProcess.on('close', (code) => {
        const message = `[${new Date().toISOString()}] ${dateStr}の日付別スクレイピングジョブが終了しました。終了コード: ${code}`;
        logFile.write(message + '\n');
        console.log(message);
        logFile.end();
    });
}

// スケジュール設定
// 30分ごとに実行: '0 */30 * * * *'
const scraperJob = schedule.scheduleJob('0 */30 * * * *', runScraperJob);

// 日付別スクレイピングを1時間ごとに実行: '0 0 */1 * * *'
const dateScraperJob = schedule.scheduleJob('0 0 */1 * * *', runDateScraperJob);

// 毎日午前0時に翌日のレース情報を取得: '0 0 0 * * *'
const tomorrowScraperJob = schedule.scheduleJob('0 0 0 * * *', () => {
    // 明後日の日付を取得
    const dayAfterTomorrow = new Date();
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    
    // 日付をYYYYMMDD形式に変換
    const year = dayAfterTomorrow.getFullYear();
    const month = (dayAfterTomorrow.getMonth() + 1).toString().padStart(2, '0');
    const day = dayAfterTomorrow.getDate().toString().padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    
    // 明後日のレース情報を取得
    runDateScraper(dateStr, 'day-after-tomorrow');
});

console.log(`[${new Date().toISOString()}] スケジューラが起動しました。`);
console.log('通常スクレイピング: 30分ごとに実行');
console.log('日付別スクレイピング: 1時間ごとに実行 (今日・明日)');
console.log('翌日レース情報: 毎日午前0時に取得 (明後日)');
console.log('次回通常スクレイピング実行時刻:', scraperJob.nextInvocation());
console.log('次回日付別スクレイピング実行時刻:', dateScraperJob.nextInvocation());

// プロセス終了時にスケジューラも終了させる
process.on('SIGINT', () => {
    console.log('スケジューラを停止します...');
    scraperJob.cancel();
    dateScraperJob.cancel();
    tomorrowScraperJob.cancel();
    process.exit(0);
});

// 初回実行（すぐに一度実行する場合はコメントを外す）
// runScraperJob();
// runDateScraperJob();