import dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import logger from './logger.js';

dotenv.config();

/**
 * Discord APIの認証をチェック
 * @returns {Promise<boolean>} 認証の成否
 */
export async function checkDiscordAuth() {
  try {
    // Discordクライアントの初期化
    const client = new Client({
      intents: [GatewayIntentBits.Guilds]
    });
    
    // ログイン
    await client.login(process.env.BOT_TOKEN);
    
    // 接続できたらログアウト
    client.destroy();
    
    logger.info('Discord認証チェック: 成功');
    return true;
  } catch (error) {
    logger.error(`Discord認証チェック: 失敗 - ${error}`);
    return false;
  }
}

/**
 * Firebase設定をチェック
 * @returns {boolean} 設定の確認結果
 */
export function checkFirebaseConfig() {
  const requiredEnvVars = [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID'
  ];
  
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    logger.error(`Firebase設定チェック: 失敗 - 不足している環境変数: ${missingVars.join(', ')}`);
    return false;
  }
  
  logger.info('Firebase設定チェック: 成功');
  return true;
}

/**
 * 環境変数の設定をチェック
 * @returns {boolean} 設定の確認結果
 */
export function checkEnvConfig() {
  const requiredEnvVars = [
    'BOT_TOKEN',
    'CLIENT_ID'
  ];
  
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    logger.error(`環境変数チェック: 失敗 - 不足している環境変数: ${missingVars.join(', ')}`);
    return false;
  }
  
  logger.info('環境変数チェック: 成功');
  return true;
}

/**
 * すべての認証と設定をチェック
 * @returns {Promise<boolean>} チェックの結果
 */
export async function checkAllAuth() {
  // 環境変数のチェック
  const envCheck = checkEnvConfig();
  if (!envCheck) return false;
  
  // Firebase設定のチェック
  const firebaseCheck = checkFirebaseConfig();
  if (!firebaseCheck) return false;
  
  // Discord認証のチェック
  const discordCheck = await checkDiscordAuth();
  if (!discordCheck) return false;
  
  logger.info('すべての認証チェックが成功しました。');
  return true;
}