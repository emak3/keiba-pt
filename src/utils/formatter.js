// formatter.js - 表示フォーマットユーティリティ
/**
 * レース情報をフォーマットするユーティリティ
 */
const formatter = {
  /**
   * 馬券タイプを日本語表示に変換
   */
  betTypeName(type) {
    const types = {
      tansho: '単勝',
      fukusho: '複勝',
      wakuren: '枠連',
      umaren: '馬連',
      umatan: '馬単',
      wide: 'ワイド',
      sanrenpuku: '3連複',
      sanrentan: '3連単'
    };
    
    return types[type] || type;
  },
  
  /**
   * 馬券の内容を文字列に変換
   */
  betContent(bet) {
    let content = `${this.betTypeName(bet.type)} `;
    
    switch (bet.type) {
      case 'tansho':
      case 'fukusho':
        content += `${bet.numbers[0]}番`;
        break;
      case 'wakuren':
        content += `${bet.numbers[0]}-${bet.numbers[1]}`;
        break;
      case 'umaren':
      case 'wide':
        content += `${bet.numbers[0]}-${bet.numbers[1]}`;
        break;
      case 'umatan':
        content += `${bet.numbers[0]}→${bet.numbers[1]}`;
        break;
      case 'sanrenpuku':
        content += `${bet.numbers[0]}-${bet.numbers[1]}-${bet.numbers[2]}`;
        break;
      case 'sanrentan':
        content += `${bet.numbers[0]}→${bet.numbers[1]}→${bet.numbers[2]}`;
        break;
    }
    
    content += ` ${bet.amount}pt`;
    
    if (bet.settled) {
      content += ` [${bet.payout > 0 ? '的中' : '不的中'}]`;
      if (bet.payout > 0) {
        content += ` +${bet.payout}pt`;
      }
    }
    
    return content;
  },
  
  /**
   * 日付をフォーマット
   */
  formatDate(dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    return `${year}/${month}/${day} ${hours}:${minutes}`;
  },
  
  /**
   * 払戻金情報をフォーマット
   */
  formatPayout(payoutData) {
    if (!payoutData || payoutData.length === 0) {
      return '情報なし';
    }
    
    return payoutData.map(data => {
      const numbers = data.numbers.join('-');
      return `${numbers} ${data.payout}円 (${data.popularity}人気)`;
    }).join('\n');
  }
};

module.exports = {
  formatter
};