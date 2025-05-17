/**
 * シンプルなロギングユーティリティ
 */
class Logger {
  constructor() {
    this.colors = {
      info: '\x1b[36m', // シアン
      warn: '\x1b[33m', // 黄色
      error: '\x1b[31m', // 赤
      debug: '\x1b[35m', // マゼンタ
      reset: '\x1b[0m' // リセット
    };
  }

  /**
   * タイムスタンプを生成
   * @returns {string} 現在時刻のフォーマット済み文字列
   */
  getTimestamp() {
    const now = new Date();
    return now.toISOString();
  }

  /**
   * 情報レベルのログを出力
   * @param {string} message - ログメッセージ
   * @param  {...any} args - 追加の引数
   */
  info(message, ...args) {
    console.log(
      `${this.colors.info}[INFO]${this.colors.reset} [${this.getTimestamp()}] ${message}`,
      ...args
    );
  }

  /**
   * 警告レベルのログを出力
   * @param {string} message - 警告メッセージ
   * @param  {...any} args - 追加の引数
   */
  warn(message, ...args) {
    console.warn(
      `${this.colors.warn}[WARN]${this.colors.reset} [${this.getTimestamp()}] ${message}`,
      ...args
    );
  }

  /**
   * エラーレベルのログを出力
   * @param {string} message - エラーメッセージ
   * @param  {...any} args - 追加の引数
   */
  error(message, ...args) {
    console.error(
      `${this.colors.error}[ERROR]${this.colors.reset} [${this.getTimestamp()}] ${message}`,
      ...args
    );
  }

  /**
   * デバッグレベルのログを出力（開発環境のみ）
   * @param {string} message - デバッグメッセージ
   * @param  {...any} args - 追加の引数
   */
  debug(message, ...args) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(
        `${this.colors.debug}[DEBUG]${this.colors.reset} [${this.getTimestamp()}] ${message}`,
        ...args
      );
    }
  }
}

// シングルトンインスタンスをエクスポート
export default new Logger();