// src/db/firebase.js
const admin = require('firebase-admin');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../../config/config');

// ServiceAccountの存在チェック
let serviceAccount;
try {
  serviceAccount = require('../../config/serviceAccountKey.json');
} catch (error) {
  logger.error('Firebase serviceAccountKey.jsonが見つかりません', error);
  process.exit(1);
}

/**
 * Firebase初期化関数
 */
function initializeFirebase() {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    
    logger.info('Firebaseが正常に初期化されました');
  } catch (error) {
    logger.error('Firebase初期化に失敗しました', error);
    process.exit(1);
  }
}

/**
 * Firestoreインスタンスの取得
 * @returns {FirebaseFirestore.Firestore} - Firestoreインスタンス
 */
function getFirestore() {
  return admin.firestore();
}

/**
 * タイムスタンプの作成
 * @returns {FirebaseFirestore.Timestamp} - 現在時刻のタイムスタンプ
 */
function createTimestamp() {
  return admin.firestore.Timestamp.now();
}

/**
 * 日付からタイムスタンプを作成
 * @param {Date} date - 日付オブジェクト
 * @returns {FirebaseFirestore.Timestamp} - 日付に対応するタイムスタンプ
 */
function dateToTimestamp(date) {
  return admin.firestore.Timestamp.fromDate(date);
}

/**
 * タイムスタンプから日付に変換
 * @param {FirebaseFirestore.Timestamp} timestamp - タイムスタンプ
 * @returns {Date} - 日付オブジェクト
 */
function timestampToDate(timestamp) {
  return timestamp.toDate();
}

/**
 * トランザクション実行関数
 * @param {Function} transactionFn - トランザクション内で実行する関数
 * @returns {Promise<any>} - トランザクション結果
 */
async function runTransaction(transactionFn) {
  const db = getFirestore();
  return db.runTransaction(transactionFn);
}

/**
 * バッチ処理取得関数
 * @returns {FirebaseFirestore.WriteBatch} - 書き込みバッチ
 */
function getBatch() {
  const db = getFirestore();
  return db.batch();
}

module.exports = {
  initializeFirebase,
  getFirestore,
  createTimestamp,
  dateToTimestamp,
  timestampToDate,
  runTransaction,
  getBatch
};