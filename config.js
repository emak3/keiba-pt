// config.js - 設定ファイル
module.exports = {
  // Discord Bot設定
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID, // 開発用サーバーID
  
  // スクレイピング設定
  scrapeInterval: 10 * 60 * 1000, // 10分ごと
  resultCheckInterval: 5 * 60 * 1000, // 5分ごと
  
  // 馬券設定
  betTypes: {
    tansho: { name: '単勝', description: '1着の馬を当てる' },
    fukusho: { name: '複勝', description: '3着以内に入る馬を当てる' },
    wakuren: { name: '枠連', description: '1着と2着の枠番号の組み合わせを当てる（順不同）' },
    umaren: { name: '馬連', description: '1着と2着の馬番号の組み合わせを当てる（順不同）' },
    umatan: { name: '馬単', description: '1着と2着の馬番号の組み合わせを当てる（順序あり）' },
    wide: { name: 'ワイド', description: '2頭の馬が3着以内に入ることを当てる（順不同）' },
    sanrenpuku: { name: '3連複', description: '1着、2着、3着の馬番号の組み合わせを当てる（順不同）' },
    sanrentan: { name: '3連単', description: '1着、2着、3着の馬番号の組み合わせを当てる（順序あり）' }
  },
  
  betMethods: {
    normal: { name: '通常', description: '指定した馬番で購入' },
    box: { name: 'BOX', description: '選択した馬番の組み合わせをすべて購入' },
    formation: { name: 'フォーメーション', description: '軸馬と相手馬を選んで組み合わせを購入' }
  },
  
  // 初期ポイント
  initialPoints: 1000
};