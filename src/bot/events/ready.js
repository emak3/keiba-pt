const { Events } = require('discord.js');
const logger = require('../../utils/logger');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    logger.info(`Botが準備完了しました！ ${client.user.tag} としてログインしました`);
  }
};