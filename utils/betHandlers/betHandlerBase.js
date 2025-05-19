// utils/betHandlers/betHandlerBase.js
// 馬券購入処理の基底ハンドラークラス - 安全なインタラクション処理を実装

import { MessageFlags } from 'discord.js';
import { getRaceById } from '../../services/database/raceService.js';
import { getUser } from '../../services/database/userService.js';
import logger from '../../utils/logger.js';
import SafeInteraction from '../safeInteraction.js';

// UI関連モジュールをインポート
import * as betMenuBuilder from '../betUI/betMenuBuilder.js';
import * as betUtils from '../betUI/betUtils.js';

/**
 * 馬券処理の基底クラス - 共通の機能と安全なインタラクション処理を提供
 */
export default class BetHandlerBase {
    /**
     * レース情報を取得
     * @param {string} raceId - レースID
     * @param {MessageComponentInteraction} interaction - インタラクション
     * @returns {Promise<Object|null>} レース情報またはnull
     */
    static async getRaceInfo(raceId, interaction) {
        try {
            const race = await getRaceById(raceId);
            if (!race) {
                await betUtils.safeUpdateInteraction(interaction, {
                    content: `レースID ${raceId} の情報が見つかりませんでした。`,
                    embeds: [],
                    components: []
                });
                return null;
            }
            return race;
        } catch (error) {
            logger.error(`レース情報取得エラー: ${error}`);
            await betUtils.handleError(interaction, error);
            return null;
        }
    }

    /**
     * ユーザー情報を取得
     * @param {string} userId - ユーザーID
     * @param {MessageComponentInteraction} interaction - インタラクション
     * @returns {Promise<Object|null>} ユーザー情報またはnull
     */
    static async getUserInfo(userId, interaction) {
        try {
            const user = await getUser(userId);
            if (!user) {
                await betUtils.safeUpdateInteraction(interaction, {
                    content: 'ユーザー情報の取得に失敗しました。',
                    embeds: [],
                    components: []
                });
                return null;
            }
            return user;
        } catch (error) {
            logger.error(`ユーザー情報取得エラー: ${error}`);
            await betUtils.handleError(interaction, error);
            return null;
        }
    }

    /**
     * セッション情報を確認
     * @param {string} userId - ユーザーID
     * @param {string} raceId - レースID
     * @param {MessageComponentInteraction} interaction - インタラクション
     * @returns {Promise<Object|null>} セッション情報またはnull
     */
    static async checkSession(userId, raceId, interaction) {
        const session = betUtils.getSession(userId, raceId);
        if (!session) {
            await betUtils.safeUpdateInteraction(interaction, {
                content: 'セッションの有効期限が切れました。最初からやり直してください。',
                embeds: [],
                components: []
            });
            return null;
        }
        return session;
    }

    /**
     * 選択した馬の情報を取得
     * @param {Array<number>} selectedHorses - 選択した馬番
     * @param {Object} race - レース情報
     * @returns {Array<string>} 馬情報の配列
     */
    static getHorseInfos(selectedHorses, race) {
        return selectedHorses.map(horseNumber => {
            const horse = race.horses?.find(h => h.horseNumber === horseNumber);
            return horse ?
                `${horseNumber}番: ${horse.horseName} (騎手: ${horse.jockey})` :
                `${horseNumber}番`;
        });
    }

    /**
     * 取消馬のチェック
     * @param {Array<number>} selectedHorses - 選択した馬番
     * @param {Object} race - レース情報
     * @param {MessageComponentInteraction} interaction - インタラクション
     * @returns {Promise<boolean>} 取消馬がない場合はtrue
     */
    static async checkCanceledHorses(selectedHorses, race, interaction) {
        // 配列の平坦化 (二次元配列対応)
        const flatHorses = Array.isArray(selectedHorses[0]) ? 
            selectedHorses.flat() : selectedHorses;
            
        const canceledHorses = race.horses.filter(h => 
            h.isCanceled && flatHorses.includes(h.horseNumber)
        );
        
        if (canceledHorses.length > 0) {
            const canceledNames = canceledHorses.map(h => 
                `${h.horseNumber}番: ${h.horseName}`
            ).join('\n');
            
            await betUtils.safeUpdateInteraction(interaction, {
                content: `選択した馬に出走取消馬が含まれています。\n${canceledNames}`,
                embeds: [],
                components: []
            });
            return false;
        }
        
        return true;
    }

    /**
     * ポイント残高チェック
     * @param {number} points - 現在のポイント
     * @param {number} cost - 必要なコスト
     * @param {MessageComponentInteraction} interaction - インタラクション
     * @returns {Promise<boolean>} 残高が足りる場合はtrue
     */
    static async checkPoints(points, cost, interaction) {
        if (points < cost) {
            await betUtils.safeUpdateInteraction(interaction, {
                content: `ポイントが不足しています。(現在: ${points}pt、必要: ${cost}pt)`,
                embeds: [],
                components: []
            });
            return false;
        }
        return true;
    }

    /**
     * 発走時間チェック
     * @param {Object} race - レース情報
     * @param {MessageComponentInteraction} interaction - インタラクション
     * @returns {Promise<boolean>} 発走2分前を過ぎていなければtrue
     */
    static async checkRaceTime(race, interaction) {
        // レース発走時間の2分前かどうかをチェック
        const now = new Date();
        const raceTime = new Date(
            race.date.slice(0, 4),
            parseInt(race.date.slice(4, 6)) - 1,
            race.date.slice(6, 8),
            race.time.split(':')[0],
            race.time.split(':')[1]
        );
        
        const twoMinutesBefore = new Date(raceTime.getTime() - 2 * 60 * 1000);
        
        if (now > twoMinutesBefore) {
            await betUtils.safeUpdateInteraction(interaction, {
                content: 'このレースは発走2分前を過ぎているため、馬券を購入できません。',
                embeds: [],
                components: []
            });
            return false;
        }
        
        return true;
    }
}