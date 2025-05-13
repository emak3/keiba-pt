// src/scraper/netkeiba.js
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

/**
 * NetKeibaスクレイパーの基本クラス
 */
class NetKeibaScraperBase {
  constructor() {
    this.baseUrl = 'https://race.netkeiba.com';
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };
  }

  /**
   * HTMLを取得してパースする
   * @param {string} url - 対象URL
   * @returns {Promise<CheerioStatic>} - パース結果
   */
  async fetchAndParse(url) {
    try {
      logger.info(`スクレイピング開始: ${url}`);
      const response = await axios.get(url, { headers: this.headers });
      return cheerio.load(response.data);
    } catch (error) {
      logger.error(`スクレイピング失敗: ${url}`, error);
      throw new Error(`スクレイピングに失敗しました: ${error.message}`);
    }
  }

  /**
   * テキストから数値を抽出する
   * @param {string} text - 対象テキスト
   * @returns {number|null} - 抽出した数値またはnull
   */
  extractNumber(text) {
    if (!text) return null;
    const match = text.replace(/,/g, '').match(/\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
  }

  /**
   * 日付文字列をDateオブジェクトに変換
   * @param {string} dateStr - 日付文字列 (例: '2025年5月13日')
   * @returns {Date} - Dateオブジェクト
   */
  parseDate(dateStr) {
    const match = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (!match) return null;
    
    const [_, year, month, day] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  /**
   * レースIDからレースタイプを判別
   * @param {string} raceId - レースID
   * @returns {string} - 'JRA' または 'NAR'
   */
  getRaceTypeFromId(raceId) {
    // JRA: 2025xxxxxx, NAR: 20253xxxxx のようなフォーマット
    return raceId.substring(4, 5) === '5' ? 'NAR' : 'JRA';
  }

  /**
   * HTMLエンティティをデコード
   * @param {string} html - HTMLエンティティを含む文字列
   * @returns {string} - デコードした文字列
   */
  decodeHtmlEntities(html) {
    const entities = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'"
    };
    
    return html.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, match => entities[match]);
  }
}

module.exports = NetKeibaScraperBase;