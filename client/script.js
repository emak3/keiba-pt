// Firebaseの設定
// ここに実際のFirebase設定を入力してください
const firebaseConfig = {
    apiKey: "AIzaSyAPmLJGgk7MbNpCrvqfYPYYMUEwB4FL21s",
    authDomain: "keiba-pt.firebaseapp.com",
    projectId: "keiba-pt",
    storageBucket: "keiba-pt.firebasestorage.app",
    messagingSenderId: "109594011528",
    appId: "1:109594011528:web:b480c480cbac7082fa7c3d"
};

// Firebaseの初期化
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// 競馬場コード変換テーブル
const venueCodeMap = {
    // JRA
    '01': '札幌', '02': '函館', '03': '福島', '04': '新潟', 
    '05': '東京', '06': '中山', '07': '中京', '08': '京都', 
    '09': '阪神', '10': '小倉',
    // 地方競馬（NAR）
    '31': '北見', '32': '岩見沢', '33': '帯広', '34': '旭川', 
    '35': '盛岡', '36': '水沢', '37': '上山', '38': '三条', 
    '39': '足利', '40': '宇都宮', '41': '高崎', '42': '浦和', 
    '43': '船橋', '44': '大井', '45': '川崎', '46': '金沢', 
    '47': '笠松', '48': '名古屋', '49': '(未使用)', '50': '園田', 
    '51': '姫路', '52': '益田', '53': '福山', '54': '高知', 
    '55': '佐賀', '56': '荒尾', '57': '中津', '58': '札幌(地方)', 
    '59': '函館(地方)', '60': '新潟(地方)', '61': '中京(地方)', '65': '帯広(ば)'
};

// DOM要素
const lastUpdatedEl = document.getElementById('last-updated');
const venueButtonsEl = document.getElementById('venue-buttons');
const raceButtonsEl = document.getElementById('race-buttons');
const horseTbodyEl = document.querySelector('#horse-table tbody');
const winPlaceTbodyEl = document.querySelector('#win-place-table tbody');
const trioTbodyEl = document.querySelector('#trio-table tbody');

// セクションの表示切り替え用要素
const venueSectionEl = document.getElementById('venue-selection');
const raceSectionEl = document.getElementById('race-selection');
const raceDetailsSectionEl = document.getElementById('race-details');

// タブ関連要素
const tabButtons = document.querySelectorAll('.tabs .tab-button');
const tabContents = document.querySelectorAll('.tab-content');
const raceTypeButtons = document.querySelectorAll('.tab-menu .tab-button');

// 選択状態を保持する変数
let selectedVenue = null;
let selectedRace = null;
let raceData = {};
let raceType = 'central'; // デフォルトは中央競馬

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    // イベントリスナーの設定
    setupEventListeners();
    
    // 会場データの取得
    fetchVenueData(raceType);
});

// イベントリスナーの設定
function setupEventListeners() {
    // JRA・地方競馬切り替えタブ
    raceTypeButtons.forEach(button => {
        button.addEventListener('click', () => {
            raceTypeButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            raceType = button.getAttribute('data-tab');
            fetchVenueData(raceType);
            
            // 会場選択画面に戻る
            showSection('venue');
        });
    });
    
    // 会場選択に戻るボタン
    document.getElementById('back-to-venues').addEventListener('click', () => {
        selectedVenue = null;
        showSection('venue');
    });
    
    // レース選択に戻るボタン
    document.getElementById('back-to-races').addEventListener('click', () => {
        selectedRace = null;
        showSection('race');
    });
    
    // 出馬表・オッズ切り替えタブ
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // アクティブなタブの変更
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // タブコンテンツの表示切り替え
            const tabId = button.getAttribute('data-tab');
            tabContents.forEach(content => {
                if (content.id === tabId) {
                    content.classList.add('active');
                } else {
                    content.classList.remove('active');
                }
            });
        });
    });
}

// 会場データの取得
function fetchVenueData(type) {
    // ローディング表示
    venueButtonsEl.innerHTML = '<p class="loading">データ読み込み中...</p>';
    
    // Firestoreから会場データを取得
    const collection = type === 'central' ? 'jra_venues' : 'nar_venues';
    
    db.collection('racing_data')
        .doc(collection)
        .get()
        .then(doc => {
            if (doc.exists) {
                const data = doc.data();
                renderVenueButtons(data.venues);
                updateLastUpdatedTime(data.lastUpdated);
            } else {
                showError('会場データが見つかりませんでした');
            }
        })
        .catch(error => {
            console.error('会場データの取得エラー:', error);
            showError('データの取得中にエラーが発生しました');
        });
}

// 会場ボタンのレンダリング
function renderVenueButtons(venues) {
    if (!venues || venues.length === 0) {
        venueButtonsEl.innerHTML = '<p>現在開催中の会場はありません</p>';
        return;
    }
    
    let buttonsHtml = '';
    venues.forEach(venue => {
        const venueName = venueCodeMap[venue.code] || venue.name;
        
        buttonsHtml += `
            <button class="venue-button" data-venue-id="${venue.code}" data-venue-type="${raceType}">
                ${venueName}
            </button>
        `;
    });
    
    venueButtonsEl.innerHTML = buttonsHtml;
    
    // 会場ボタンにイベントリスナーを追加
    document.querySelectorAll('.venue-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const venueId = e.target.getAttribute('data-venue-id');
            const venueType = e.target.getAttribute('data-venue-type');
            const venueName = e.target.textContent.trim();
            selectVenue(venueId, venueName, venueType);
        });
    });
}

// 会場選択時の処理
function selectVenue(venueId, venueName, venueType) {
    selectedVenue = { id: venueId, name: venueName, type: venueType };
    document.getElementById('selected-venue-name').textContent = venueName;
    
    // レースデータの取得
    fetchRaceData(venueId, venueType);
    
    // レース選択画面に切り替え
    showSection('race');
}

// レースデータの取得
function fetchRaceData(venueId, venueType) {
    // ローディング表示
    raceButtonsEl.innerHTML = '<p class="loading">データ読み込み中...</p>';
    
    // コレクションパスの決定
    const collection = venueType === 'central' ? 'jra_races' : 'nar_races';
    
    // Firestoreからレースデータを取得
    db.collection('racing_data')
        .doc(`${collection}_${venueId}`)
        .get()
        .then(doc => {
            if (doc.exists) {
                const data = doc.data();
                renderRaceButtons(data.races);
            } else {
                showError('レースデータが見つかりませんでした');
            }
        })
        .catch(error => {
            console.error('レースデータの取得エラー:', error);
            showError('データの取得中にエラーが発生しました');
        });
}

// レースボタンのレンダリング
function renderRaceButtons(races) {
    if (!races || races.length === 0) {
        raceButtonsEl.innerHTML = '<p>レースデータがありません</p>';
        return;
    }
    
    let buttonsHtml = '';
    races.forEach(race => {
        buttonsHtml += `
            <button class="race-button" data-race-id="${race.id}">
                ${race.number}R: ${race.name}
            </button>
        `;
    });
    
    raceButtonsEl.innerHTML = buttonsHtml;
    
    // レースボタンにイベントリスナーを追加
    document.querySelectorAll('.race-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const raceId = e.target.getAttribute('data-race-id');
            const raceText = e.target.textContent.trim();
            selectRace(raceId, raceText);
        });
    });
}

// レース選択時の処理
function selectRace(raceId, raceText) {
    selectedRace = { id: raceId, text: raceText };
    document.getElementById('race-title').textContent = raceText;
    
    // レース詳細データの取得
    fetchRaceDetails(selectedVenue.id, raceId, selectedVenue.type);
    
    // レース詳細画面に切り替え
    showSection('raceDetails');
}

// レース詳細データの取得
function fetchRaceDetails(venueId, raceId, venueType) {
    // ローディング表示
    horseTbodyEl.innerHTML = '<tr><td colspan="10" class="loading">データ読み込み中...</td></tr>';
    winPlaceTbodyEl.innerHTML = '<tr><td colspan="4" class="loading">データ読み込み中...</td></tr>';
    trioTbodyEl.innerHTML = '<tr><td colspan="3" class="loading">データ読み込み中...</td></tr>';
    
    // コレクションパスの決定
    const collection = venueType === 'central' ? 'jra_race_details' : 'nar_race_details';
    
    // Firestoreからレース詳細データを取得
    db.collection('racing_data')
        .doc(`${collection}_${venueId}_${raceId}`)
        .get()
        .then(doc => {
            if (doc.exists) {
                const data = doc.data();
                raceData = data; // データをグローバル変数に保存
                
                renderRaceInfo(data);
                renderEntryTable(data);
                renderOddsTable(data);
            } else {
                showError('レース詳細データが見つかりませんでした');
            }
        })
        .catch(error => {
            console.error('レース詳細の取得エラー:', error);
            showError('データの取得中にエラーが発生しました');
        });
}

// レース情報のレンダリング
function renderRaceInfo(data) {
    // レース情報テキストの更新
    const raceInfoEl = document.getElementById('race-info-text');
    
    const raceInfo = `
        ${data.raceInfo.distance}m ${data.raceInfo.courseType} | 
        ${data.raceInfo.condition} | 
        ${data.raceInfo.raceClass} | 
        発走: ${data.raceInfo.startTime} | 
        出走: ${data.horses.length}頭
    `;
    
    raceInfoEl.textContent = raceInfo;
}

// 出馬表のレンダリング
function renderEntryTable(data) {
    if (!data.horses || data.horses.length === 0) {
        horseTbodyEl.innerHTML = '<tr><td colspan="10">出馬表データがありません</td></tr>';
        return;
    }
    
    let tbodyHtml = '';
    data.horses.forEach(horse => {
        // 取消馬の処理
        const isCanceled = horse.status === 'cancel';
        const cancelClass = isCanceled ? 'Cancel' : '';
        const cancelTd = isCanceled ? `<td class="Cancel_Txt">取消</td>` : `<td class="CheckMark"></td>`;
        
        // 枠と馬番のスタイル
        const wakuClass = `Waku${horse.frameNumber}`;
        const umabanClass = `Umaban${horse.frameNumber}`;
        
        // 人気のスタイル
        let popularityClass = '';
        if (horse.odds && horse.odds.popularity === 1) {
            popularityClass = 'BgYellow';
        } else if (horse.odds && horse.odds.popularity === 2) {
            popularityClass = 'BgBlue02';
        } else if (horse.odds && horse.odds.popularity === 3) {
            popularityClass = 'BgOrange';
        }
        
        tbodyHtml += `
            <tr class="HorseList ${cancelClass}">
                <td class="${wakuClass} Txt_C"><span>${horse.frameNumber}</span></td>
                <td class="${umabanClass} Txt_C">${horse.number}</td>
                ${cancelTd}
                <td class="HorseInfo">
                    <span class="HorseName">${horse.name}</span>
                </td>
                <td class="Barei Txt_C">${horse.gender}${horse.age}</td>
                <td class="Txt_C">${horse.weight}</td>
                <td class="Jockey">${horse.jockey}</td>
                <td class="Trainer"><span class="${horse.stable === '美浦' ? 'Label1' : 'Label2'}">${horse.stable}</span>${horse.trainer}</td>
                <td class="Weight">
                    ${horse.bodyWeight}${horse.weightDiff ? `<small>(${horse.weightDiff})</small>` : ''}
                </td>
                <td class="Txt_R Popular">
                    ${isCanceled ? '--' : (horse.odds ? `<span style="font-weight: bold">${horse.odds.win}</span>` : '--')}
                </td>
                <td class="Popular Popular_Ninki Txt_C ${popularityClass}">
                    ${isCanceled ? '--' : (horse.odds ? `<span>${horse.odds.popularity}</span>` : '--')}
                </td>
            </tr>
        `;
    });
    
    horseTbodyEl.innerHTML = tbodyHtml;
}

// オッズ表のレンダリング
function renderOddsTable(data) {
    // 単勝・複勝オッズ
    if (!data.horses || data.horses.length === 0) {
        winPlaceTbodyEl.innerHTML = '<tr><td colspan="4">オッズデータがありません</td></tr>';
        trioTbodyEl.innerHTML = '<tr><td colspan="3">オッズデータがありません</td></tr>';
        return;
    }
    
    let winPlaceHtml = '';
    data.horses
        .filter(horse => horse.status !== 'cancel') // 取消馬を除外
        .forEach(horse => {
            winPlaceHtml += `
                <tr>
                    <td>${horse.number}</td>
                    <td>${horse.name}</td>
                    <td>${horse.odds ? horse.odds.win : '--'}</td>
                    <td>${horse.odds ? horse.odds.place : '--'}</td>
                </tr>
            `;
        });
    
    winPlaceTbodyEl.innerHTML = winPlaceHtml;
    
    // 三連複オッズ
    if (!data.oddsInfo || !data.oddsInfo.trio || data.oddsInfo.trio.length === 0) {
        trioTbodyEl.innerHTML = '<tr><td colspan="3">三連複オッズデータがありません</td></tr>';
        return;
    }
    
    // 人気順にソート
    const sortedTrio = [...data.oddsInfo.trio].sort((a, b) => a.popularity - b.popularity);
    
    // 上位10件を表示
    const top10Trio = sortedTrio.slice(0, 10);
    
    let trioHtml = '';
    top10Trio.forEach(trio => {
        trioHtml += `
            <tr>
                <td>${trio.combination}</td>
                <td>${trio.odds}</td>
                <td>${trio.popularity}</td>
            </tr>
        `;
    });
    
    trioTbodyEl.innerHTML = trioHtml;
}

// 最終更新時間の表示
function updateLastUpdatedTime(timestamp) {
    if (!timestamp) {
        lastUpdatedEl.textContent = '最終更新: 不明';
        return;
    }
    
    // Firestoreのタイムスタンプを日付に変換
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const formattedDate = new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
    
    lastUpdatedEl.textContent = `最終更新: ${formattedDate}`;
}

// セクションの表示切り替え
function showSection(section) {
    // すべてのセクションを非表示
    venueSectionEl.classList.add('hidden');
    raceSectionEl.classList.add('hidden');
    raceDetailsSectionEl.classList.add('hidden');
    
    // 指定されたセクションのみ表示
    switch (section) {
        case 'venue':
            venueSectionEl.classList.remove('hidden');
            break;
        case 'race':
            raceSectionEl.classList.remove('hidden');
            break;
        case 'raceDetails':
            raceDetailsSectionEl.classList.remove('hidden');
            break;
    }
}

// エラー表示
function showError(message) {
    alert(message);
}