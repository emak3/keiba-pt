// config/config.js
require('dotenv').config();

const config = {
  // Discord Bot設定
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID: process.env.GUILD_ID,
  
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // 馬券関連設定
  DEFAULT_POINTS: 100, // 新規ユーザーのデフォルトポイント
  MIN_BET_AMOUNT: 100, // 最低馬券購入金額
  BET_UNIT: 100, // 馬券金額単位
  
  // レース情報取得設定
  RACE_CHECK_INTERVAL: 10 * 60 * 1000, // レース状態確認間隔（ミリ秒、10分）
  RESULT_CHECK_DELAY: 30 * 60 * 1000, // 発走後の結果確認遅延（ミリ秒、30分）
  RACE_CLOSE_TIME: 10 * 60 * 1000, // 発走前の締切時間（ミリ秒、10分）
  
  // スクレイピング設定
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  REQUEST_TIMEOUT: 30000, // リクエストタイムアウト（ミリ秒、30秒）
  REQUEST_RETRY: 3, // リクエストリトライ回数
  
  // 各種URL設定
  JRA_BASE_URL: 'https://race.netkeiba.com',
  NAR_BASE_URL: 'https://nar.netkeiba.com'
};

module.exports = config;