// utils/safeInteraction.js
// Discord.jsのインタラクション処理を安全に行うためのユーティリティ関数

import { MessageFlags } from 'discord.js';
import logger from './logger.js';

/**
 * インタラクションを安全に処理するためのユーティリティクラス
 */
export default class SafeInteraction {
    /**
     * インタラクションを安全に更新する
     * @param {MessageComponentInteraction} interaction - Discord.jsのインタラクション
     * @param {Function} action - 実行する処理（async関数）
     */
    static async safeProcess(interaction, action) {
        try {
            // インタラクションの状態をチェック
            if (interaction.replied) {
                logger.debug('インタラクションは既に応答済みです。followUpを使用します。');
                await action();
            } else if (interaction.deferred) {
                logger.debug('インタラクションは既にdeferされています。editReplyを使用します。');
                await action();
            } else {
                // まだ応答していない場合はdeferして処理
                try {
                    await interaction.deferUpdate().catch(() => {
                        logger.debug('deferUpdateに失敗しました。deferReplyを試みます。');
                        return interaction.deferReply({ ephemeral: true }).catch(err => {
                            logger.warn(`deferReplyにも失敗しました: ${err}`);
                        });
                    });
                    await action();
                } catch (deferError) {
                    logger.warn(`defer処理中にエラー: ${deferError}`);
                    // 最終手段としてエラーメッセージを表示
                    try {
                        await interaction.reply({
                            content: 'インタラクション処理中にエラーが発生しました。もう一度お試しください。',
                            ephemeral: true
                        });
                    } catch (finalError) {
                        logger.error(`最終エラー応答にも失敗: ${finalError}`);
                    }
                }
            }
        } catch (error) {
            await this.handleError(interaction, error);
        }
    }

    /**
     * エラー処理の共通関数
     * @param {MessageComponentInteraction} interaction - Discord.jsのインタラクション
     * @param {Error} error - 発生したエラー
     */
    static async handleError(interaction, error) {
        const errorMessage = `操作中にエラーが発生しました: ${error.message || 'Unknown error'}`;
        logger.error(`インタラクション処理エラー: ${error.stack || error}`);

        try {
            // インタラクションの状態に応じた適切なエラー応答
            if (interaction.replied) {
                await interaction.followUp({
                    content: errorMessage,
                    ephemeral: true
                }).catch(e => logger.error(`followUpエラー: ${e}`));
            } else if (interaction.deferred) {
                await interaction.editReply({
                    content: errorMessage,
                    components: []
                }).catch(e => logger.error(`editReplyエラー: ${e}`));
            } else {
                try {
                    await interaction.reply({
                        content: errorMessage,
                        ephemeral: true
                    });
                } catch (replyError) {
                    logger.error(`reply失敗: ${replyError}`);
                    // 最終手段
                    try {
                        await interaction.deferUpdate().catch(() => { });
                        await interaction.editReply({
                            content: errorMessage,
                            components: []
                        }).catch(() => { });
                    } catch (finalError) {
                        logger.error(`全てのエラー処理に失敗: ${finalError}`);
                    }
                }
            }
        } catch (handlingError) {
            logger.error(`エラー処理自体が失敗: ${handlingError}`);
        }
    }

    /**
     * インタラクションを安全に更新する
     * @param {MessageComponentInteraction} interaction - インタラクション
     * @param {Object} options - 更新オプション
     */
    static async safeUpdate(interaction, options) {
        await this.safeProcess(interaction, async () => {
            try {
                if (interaction.replied) {
                    await interaction.followUp(options);
                } else {
                    await interaction.editReply(options);
                }
            } catch (error) {
                logger.error(`更新エラー: ${error}`);
                throw error;
            }
        });
    }

    /**
     * モーダルを安全に表示する
     * @param {MessageComponentInteraction} interaction - インタラクション
     * @param {ModalBuilder} modal - 表示するモーダル
     */
    static async safeShowModal(interaction, modal) {
        try {
            // モーダル表示はdeferなしで行う必要がある
            if (!interaction.replied && !interaction.deferred) {
                await interaction.showModal(modal);
            } else {
                logger.warn('既に応答済みのインタラクションにモーダルを表示しようとしました');
                // 既に応答済みの場合はエラーメッセージを表示
                await this.safeUpdate(interaction, {
                    content: 'セッションの有効期限が切れました。もう一度最初からお試しください。',
                    components: []
                });
            }
        } catch (error) {
            await this.handleError(interaction, error);
        }
    }
}