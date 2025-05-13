// src/services/betService.js
const { 
  saveBet, 
  getBetById, 
  getUserBets, 
  getRaceBets, 
  closeBetsByRaceId, 
  processBetPayouts 
} = require('../db/betRepository');
const { getRaceById } = require('../db/raceRepository');
const { getUserById } = require('../db/userRepository');
const logger = require('../utils/logger');

/**
 * 馬券処理サービス
 */
class BetService {
  /**
   * 馬券を購入する
   * @param {string} userId - ユーザーID
   * @param {string} raceId - レースID
   * @param {string} type - 馬券タイプ
   * @param {string} method - 購入方法
   * @param {Array<number>} selections - 選択した馬番・枠番
   * @param {number} amount - 購入金額
   * @returns {Promise<Object>} - 購入結果
   */
  async placeBet(userId, raceId, type, method, selections, amount) {
    try {
      // パラメータのバリデーション
      if (!userId || !raceId || !type || !method || !selections || !amount) {
        throw new Error('必須パラメータが不足しています');
      }
      
      if (!Array.isArray(selections) || selections.length === 0) {
        throw new Error('selections は配列で、少なくとも1つの要素が必要です');
      }
      
      // 金額のチェック
      if (amount < 100 || amount % 100 !== 0) {
        throw new Error('購入金額は100pt以上、100pt単位で指定してください');
      }
      
      // 馬券タイプの有効性チェック
      const validTypes = ['tansho', 'fukusho', 'wakuren', 'umaren', 'wide', 'umatan', 'sanrenpuku', 'sanrentan'];
      if (!validTypes.includes(type)) {
        throw new Error(`無効な馬券タイプです: ${type}`);
      }
      
      // 購入方法の有効性チェック
      const validMethods = ['normal', 'box', 'formation'];
      if (!validMethods.includes(method)) {
        throw new Error(`無効な購入方法です: ${method}`);
      }
      
      // 馬券タイプと選択数の整合性チェック
      const typeRequirements = {
        'tansho': { min: 1, max: 1 },
        'fukusho': { min: 1, max: 1 },
        'wakuren': { min: 2, max: 2 },
        'umaren': { min: 2, max: 2 },
        'wide': { min: 2, max: 2 },
        'umatan': { min: 2, max: 2 },
        'sanrenpuku': { min: 3, max: 3 },
        'sanrentan': { min: 3, max: 3 }
      };
      
      const requirement = typeRequirements[type];
      if (method === 'normal' && selections.length !== requirement.max) {
        throw new Error(`${type}の${method}購入では${requirement.max}頭選択する必要があります`);
      }
      
      if ((method === 'box' || method === 'formation') && (selections.length < requirement.min || selections.length > 10)) {
        throw new Error(`${method}購入では${requirement.min}〜10頭選択する必要があります`);
      }
      
      // レース情報の取得と確認
      const race = await getRaceById(raceId);
      if (!race) {
        throw new Error(`レースが存在しません: ${raceId}`);
      }
      
      if (race.status !== 'upcoming') {
        throw new Error('このレースは既に締め切られています');
      }
      
      // 馬番の有効性チェック
      const validHorseNumbers = race.horses.map(horse => horse.number);
      const invalidSelections = selections.filter(number => !validHorseNumbers.includes(number));
      
      if (invalidSelections.length > 0) {
        throw new Error(`無効な馬番が含まれています: ${invalidSelections.join(', ')}`);
      }
      
      // ユーザー情報の確認
      const user = await getUserById(userId);
      if (!user) {
        throw new Error(`ユーザーが存在しません: ${userId}`);
      }
      
      if (user.points < amount) {
        throw new Error('ポイントが足りません');
      }
      
      // 馬券の購入処理
      const betData = {
        userId,
        raceId,
        type,
        method,
        selections,
        amount
      };
      
      const betId = await saveBet(betData);
      
      logger.info(`馬券を購入しました: ${betId}, ユーザー: ${userId}, レース: ${raceId}, タイプ: ${type}`);
      
      return {
        id: betId,
        race: {
          id: race.id,
          name: race.name,
          venue: race.venue,
          number: race.number,
          startTime: race.startTime
        },
        type,
        method,
        selections,
        amount
      };
    } catch (error) {
      logger.error('馬券購入に失敗しました', error);
      throw error;
    }
  }

  /**
   * 馬券情報を取得する
   * @param {string} betId - 馬券ID
   * @returns {Promise<Object|null>} - 馬券情報
   */
  async getBetById(betId) {
    return getBetById(betId);
  }

  /**
   * ユーザーの馬券一覧を取得する
   * @param {string} userId - ユーザーID
   * @param {Object} [options] - 取得オプション
   * @returns {Promise<Array>} - 馬券情報の配列
   */
  async getUserBets(userId, options = {}) {
    return getUserBets(userId, options);
  }

  /**
   * レースの馬券一覧を取得する
   * @param {string} raceId - レースID
   * @param {Object} [options] - 取得オプション
   * @returns {Promise<Array>} - 馬券情報の配列
   */
  async getRaceBets(raceId, options = {}) {
    return getRaceBets(raceId, options);
  }

  /**
   * レースの馬券を締め切る
   * @param {string} raceId - レースID
   * @returns {Promise<number>} - 更新した馬券数
   */
  async closeRaceBets(raceId) {
    return closeBetsByRaceId(raceId);
  }

  /**
   * レース結果に基づいて馬券の払戻処理を行う
   * @param {string} raceId - レースID
   * @returns {Promise<Object>} - 処理結果
   */
  async processRacePayouts(raceId) {
    try {
      // レース情報の取得
      const race = await getRaceById(raceId);
      if (!race) {
        throw new Error(`レースが存在しません: ${raceId}`);
      }
      
      if (race.status !== 'finished') {
        throw new Error(`レース結果が確定していません: ${raceId}`);
      }
      
      if (!race.results || !race.payouts) {
        throw new Error(`レース結果または払戻情報がありません: ${raceId}`);
      }
      
      // 払戻処理
      const result = await processBetPayouts(raceId, { results: race.results, payouts: race.payouts });
      
      logger.info(`レース払戻処理完了: ${raceId}, ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      logger.error(`レース払戻処理に失敗しました: ${raceId}`, error);
      throw error;
    }
  }

  /**
   * 購入した馬券情報をフォーマットしてDiscordに表示しやすい形式に変換
   * @param {Object} bet - 馬券情報
   * @param {Object} [race] - レース情報（オプション）
   * @returns {Object} - フォーマットされた馬券情報
   */
  async formatBetForDisplay(bet, race = null) {
    try {
      if (!bet) return null;
      
      // レース情報が渡されていない場合は取得
      if (!race && bet.raceId) {
        race = await getRaceById(bet.raceId);
      }
      
      // 馬券タイプの日本語表記
      const typeMap = {
        'tansho': '単勝',
        'fukusho': '複勝',
        'wakuren': '枠連',
        'umaren': '馬連',
        'wide': 'ワイド',
        'umatan': '馬単',
        'sanrenpuku': '三連複',
        'sanrentan': '三連単'
      };
      
      // 購入方法の日本語表記
      const methodMap = {
        'normal': '通常',
        'box': 'ボックス',
        'formation': 'フォーメーション'
      };
      
      // ステータスの日本語表記
      const statusMap = {
        'active': '受付',
        'closed': '締切',
        'won': '的中',
        'lost': '不的中'
      };
      
      // フォーマット済みの馬券情報
      const formattedBet = {
        id: bet.id,
        type: typeMap[bet.type] || bet.type,
        method: methodMap[bet.method] || bet.method,
        selections: bet.selections,
        amount: bet.amount,
        status: statusMap[bet.status] || bet.status,
        payout: bet.payout || 0,
        createdAt: bet.createdAt
      };
      
      // レース情報がある場合は追加
      if (race) {
        formattedBet.race = {
          id: race.id,
          name: race.name,
          venue: race.venue,
          number: race.number,
          startTime: race.startTime
        };
        
        // 選択した馬の名前を取得
        if (race.horses && Array.isArray(race.horses)) {
          formattedBet.horseNames = bet.selections.map(number => {
            const horse = race.horses.find(h => h.number === number);
            return horse ? horse.name : `${number}番`;
          });
        }
      }
      
      return formattedBet;
    } catch (error) {
      logger.error('馬券情報のフォーマットに失敗しました', error);
      return bet; // エラー時は元の情報をそのまま返す
    }
  }

  /**
   * 有効な馬券タイプの一覧と説明を取得
   * @returns {Array<Object>} - 馬券タイプ情報
   */
  getBetTypes() {
    return [
      {
        id: 'tansho',
        name: '単勝',
        description: '1着の馬を当てる',
        methods: ['normal'],
        selectionCount: { min: 1, max: 1 }
      },
      {
        id: 'fukusho',
        name: '複勝',
        description: '3着以内に入る馬を当てる',
        methods: ['normal'],
        selectionCount: { min: 1, max: 1 }
      },
      {
        id: 'wakuren',
        name: '枠連',
        description: '1着と2着の枠番の組み合わせを当てる（順不同）',
        methods: ['normal', 'box'],
        selectionCount: { min: 2, max: 2 }
      },
      {
        id: 'umaren',
        name: '馬連',
        description: '1着と2着の馬番の組み合わせを当てる（順不同）',
        methods: ['normal', 'box'],
        selectionCount: { min: 2, max: 2 }
      },
      {
        id: 'wide',
        name: 'ワイド',
        description: '3着以内に入る2頭の組み合わせを当てる（順不同）',
        methods: ['normal', 'box'],
        selectionCount: { min: 2, max: 2 }
      },
      {
        id: 'umatan',
        name: '馬単',
        description: '1着と2着の馬番の組み合わせを当てる（順序通り）',
        methods: ['normal', 'formation'],
        selectionCount: { min: 2, max: 2 }
      },
      {
        id: 'sanrenpuku',
        name: '三連複',
        description: '1着、2着、3着の馬番の組み合わせを当てる（順不同）',
        methods: ['normal', 'box'],
        selectionCount: { min: 3, max: 3 }
      },
      {
        id: 'sanrentan',
        name: '三連単',
        description: '1着、2着、3着の馬番の組み合わせを当てる（順序通り）',
        methods: ['normal', 'formation', 'box'],
        selectionCount: { min: 3, max: 3 }
      }
    ];
  }
}

module.exports = new BetService();