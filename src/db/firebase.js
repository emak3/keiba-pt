// firebase.js - Firebase接続と初期化
const admin = require('firebase-admin');
const serviceAccount = require('../../serviceAccountKey.json');

let db;

/**
 * Firebaseを初期化する
 */
function initializeFirebase() {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    db = admin.firestore();
    console.log('Firebaseの初期化に成功しました');
    return db;
  } catch (error) {
    console.error('Firebaseの初期化に失敗しました:', error);
    throw error;
  }
}

/**
 * Firestoreインスタンスを取得する
 */
function getDb() {
  if (!db) {
    throw new Error('Firebaseが初期化されていません。先にinitializeFirebase()を呼び出してください。');
  }
  return db;
}

module.exports = {
  initializeFirebase,
  getDb
};