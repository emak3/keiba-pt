// scheduler.js - サーバー上でnode-scheduleを使って定期実行するスクリプト

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
function getLogFileName() {
    const now = new Date();
    const dateStr = now.toISOString().replace(/:/g, '-').replace(/\..+/, '');
    return path.join(logDir, `scraper-${dateStr}.log`);
}

// スクレイピングジョブを実行する関数
function runScraperJob() {
    console.log(`[${new Date().toISOString()}] スクレイピングジョブを開始します...`);
    
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
        const message = `[${new Date().toISOString()}] スクレイピングジョブが終了しました。終了コード: ${code}`;
        logFile.write(message + '\n');
        console.log(message);
        logFile.end();
    });
}

// 30分ごとに実行するスケジュール設定
// cron形式: '秒 分 時 日 月 曜日'
// '0 */30 * * * *' は毎時0分と30分に実行
const job = schedule.scheduleJob('0 */30 * * * *', runScraperJob);

console.log(`[${new Date().toISOString()}] スケジューラが起動しました。30分ごとにスクレイピングを実行します。`);
console.log('次回実行時刻:', job.nextInvocation());

// プロセス終了時にスケジューラも終了させる
process.on('SIGINT', () => {
    console.log('スケジューラを停止します...');
    job.cancel();
    process.exit(0);
});

runScraperJob();