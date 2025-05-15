// ready.js - Botが準備完了した時のイベント
const { deployCommands } = require('../deploy-commands');
const { Events } = require('discord.js');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`${client.user.tag}として準備完了！`);
    
    // スラッシュコマンドを登録
    await deployCommands();
    
    // ステータスを設定
    client.user.setActivity('競馬情報を取得中', { type: 'WATCHING' });
  }
};