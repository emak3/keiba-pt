// selectors.js - 拡張版（追加セレクタ対応）
module.exports = {
  // JRA関連セレクタ
  jra: {
    raceList: '.RaceList_DataItem',
    raceName: '.RaceName',
    raceData: '.RaceData01',
    raceTime: '.RaceData01',
    horseList: '.HorseList',
    horseName: '.HorseName a',
    jockeyName: '.Jockey a',
    odds: '.Popular span',
    
    // 追加セレクタ（代替取得方法用）
    alternativeTime: '.RaceList_Item01 .RaceData01',
    alternativeRaceName: '.RaceName',
    alternativeHorseName: '.Horse_Name a',
    alternativeJockey: '.Jockey',
    weight: '.Weight',
    popularity: '.Popular_Ninki',
    
    // 払戻金関連
    tansho: {
      number: '.Tansho .Result div span',
      pay: '.Tansho .Payout span',
      popularity: '.Tansho .Ninki span'
    },
    fukusho: {
      number: '.Fukusho .Result div span',
      pay: '.Fukusho .Payout span',
      popularity: '.Fukusho .Ninki span'
    },
    wakuren: {
      number: '.Wakuren .Result ul li span',
      pay: '.Wakuren .Payout span',
      popularity: '.Wakuren .Ninki span'
    },
    umaren: {
      number: '.Umaren .Result ul li span',
      pay: '.Umaren .Payout span',
      popularity: '.Umaren .Ninki span'
    },
    wide: {
      number: '.Wide .Result ul li span',
      pay: '.Wide .Payout span',
      popularity: '.Wide .Ninki span'
    },
    umatan: {
      number: '.Umatan .Result ul li span',
      pay: '.Umatan .Payout span',
      popularity: '.Umatan .Ninki span'
    },
    sanrentan: {
      number: '.Tan3 .Result ul li span',
      pay: '.Tan3 .Payout span',
      popularity: '.Tan3 .Ninki span'
    },
    sanrenpuku: {
      number: '.Fuku3 .Result ul li span',
      pay: '.Fuku3 .Payout span',
      popularity: '.Fuku3 .Ninki span'
    }
  },
  
  // 地方競馬関連セレクタ
  nar: {
    raceList: '.Race_Num',
    raceName: '.RaceName',
    raceData: '.RaceData01',
    raceTime: '.RaceData01',
    horseList: '.HorseList',
    horseName: '.HorseName a',
    jockeyName: '.Jockey a',
    odds: '.Popular',
    
    // 追加セレクタ（代替取得方法用）
    gate: '.Waku, .Waku1, .Waku2',
    number: '.Umaban, .Umaban1, .Umaban2',
    alternativeHorseName: '.Horse_Name a',
    alternativeJockey: '.Jockey, .Jockey a',
    weight: '.Weight',
    popularity: '.Popular.Txt_C, .Popular_Ninki',
    
    // 払戻金関連（JRAとほぼ同じ構造だが念のため分離）
    tansho: {
      number: '.Tansho .Result div span',
      pay: '.Tansho .Payout span',
      popularity: '.Tansho .Ninki span'
    },
    fukusho: {
      number: '.Fukusho .Result div span',
      pay: '.Fukusho .Payout span',
      popularity: '.Fukusho .Ninki span'
    },
    wakuren: {
      number: '.Wakuren .Result ul li span',
      pay: '.Wakuren .Payout span',
      popularity: '.Wakuren .Ninki span'
    },
    umaren: {
      number: '.Umaren .Result ul li span',
      pay: '.Umaren .Payout span',
      popularity: '.Umaren .Ninki span'
    },
    wide: {
      number: '.Wide .Result ul li span',
      pay: '.Wide .Payout span',
      popularity: '.Wide .Ninki span'
    },
    umatan: {
      number: '.Umatan .Result ul li span',
      pay: '.Umatan .Payout span',
      popularity: '.Umatan .Ninki span'
    },
    sanrentan: {
      number: '.Tan3 .Result ul li span',
      pay: '.Tan3 .Payout span',
      popularity: '.Tan3 .Ninki span'
    },
    sanrenpuku: {
      number: '.Fuku3 .Result ul li span',
      pay: '.Fuku3 .Payout span',
      popularity: '.Fuku3 .Ninki span'
    }
  }
};