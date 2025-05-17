import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { config } from 'dotenv';
import logger from '../utils/logger.js';

// 環境変数の読み込み
config();

// Firebase設定オブジェクト
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// アプリとサービスの初期化
let app;
let db;
let auth;
let storage;

/**
 * Firebaseの初期化
 */
export function initializeFirebase() {
  try {
    // Firebase アプリの初期化
    app = initializeApp(firebaseConfig);
    
    // Firestore の初期化
    db = getFirestore(app);
    
    // Authentication の初期化
    auth = getAuth(app);
    
    // Storage の初期化
    storage = getStorage(app);
    
    logger.info('Firebase の初期化が完了しました。');
  } catch (error) {
    logger.error('Firebase の初期化中にエラーが発生しました:', error);
    throw error;
  }
}

/**
 * Firestore インスタンスの取得
 * @returns {Firestore} Firestoreインスタンス
 */
export function getDb() {
  if (!db) {
    throw new Error('Firestore が初期化されていません。先に initializeFirebase() を呼び出してください。');
  }
  return db;
}

/**
 * Firebase Authentication インスタンスの取得
 * @returns {Auth} Firebase Authenticationインスタンス
 */
export function getFirebaseAuth() {
  if (!auth) {
    throw new Error('Firebase Authentication が初期化されていません。先に initializeFirebase() を呼び出してください。');
  }
  return auth;
}

/**
 * Firebase Storage インスタンスの取得
 * @returns {Storage} Firebase Storageインスタンス
 */
export function getFirebaseStorage() {
  if (!storage) {
    throw new Error('Firebase Storage が初期化されていません。先に initializeFirebase() を呼び出してください。');
  }
  return storage;
}