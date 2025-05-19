// script.js - クライアント側のJavaScript（日付機能追加版）

// Firebaseの設定
// ここに実際のFirebase設定を入力してください
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
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
const dateVenuesContainerEl = document.getElementById('date-venues-container');
const calendarContainerEl = document.getElementById('calendar-container');

// セクションの表示切り替え用要素
const dateSectionEl = document.getElementById('date-selection');
const dateRacesSectionEl = document.getElementById('date-races');
const venueSectionEl = document.getElementById('venue-selection');
const raceSectionEl = document.getElementById('race-selection');
const raceDetailsSectionEl = document.getElementById('race-details');

// 日付選択関連要素
const dateInputEl = document.getElementById('date-input');
const prevDateBtn = document.getElementById('prev-date');
const nextDateBtn = document.getElementById('next-date');
const todayBtn = document.getElementById('today-button');
const backToDatesBtn = document.getElementById('back-to-dates');
const dateRacesTitleEl = document.getElementById('date-races-title');

// タブ関連要素
const tabButtons = document.querySelectorAll('.tabs .tab-button');
const tabContents = document.querySelectorAll('.tab-content');
const raceTypeButtons = document.querySelectorAll('.tab-menu .tab-button');

// 選択状態を保持する変数
let selectedVenue = null;
let selectedRace = null;
let raceData = {};
let raceType = 'central'; // デフォルトは中央競馬
let selectedDate = null;  // 選択された日付
let monthRaceDates = {}; // 当月のレース日データ（カレンダー用）

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    // 今日の日付を取得してデフォルト値にする
    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');
    
    // 日付入力フィールドの初期値を設定
    dateInputEl.value = `${year}-${month}-${day}`;
    selectedDate = `${year}${month}${day}`;
    
    // イベントリスナーの設定
    setupEventListeners();
    
    // カレンダーを生成
    generateCalendar(year, parseInt(month));
    
    // レース開催日を取得してカレンダーに表示
    fetchRaceDates(year, parseInt(month));
});

// イベントリスナーの設定
function setupEventListeners() {
    // JRA・地方競馬切り替えタブ
    raceTypeButtons.forEach(button => {
        button.addEventListener('click', () => {
            raceTypeButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            raceType = button.getAttribute('data-tab');
            
            // カレンダー上の開催日を更新
            const [year, month] = dateInputEl.value.split('-').map(num => parseInt(num));
            fetchRaceDates(year, month);
        });
    });
    
    // 日付選択イベント
    dateInputEl.addEventListener('change', () => {
        const [year, month, day] = dateInputEl.value.split('-');
        selectedDate = `${year}${month}${day}`;
        
        // カレンダーを更新（月が変わった場合）
        const currentMonth = parseInt(month);
        const [calYear, calMonth] = getCurrentCalendarMonth();
        
        if (currentMonth !== calMonth) {
            generateCalendar(parseInt(year), currentMonth);
            fetchRaceDates(parseInt(year), currentMonth);
        }
        
        // 選択された日付のレース情報を取得
        fetchDateRaces(selectedDate);
    });
    
    // 前日ボタン
    prevDateBtn.addEventListener('click', () => {
        const date = new Date(dateInputEl.value);
        date.setDate(date.getDate() - 1);
        
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        
        dateInputEl.value = `${year}-${month}-${day}`;
        selectedDate = `${year}${month}${day}`;
        
        // 月が変わった場合はカレンダーを更新
        const currentMonth = date.getMonth() + 1;
        const [calYear, calMonth] = getCurrentCalendarMonth();
        
        if (currentMonth !== calMonth) {
            generateCalendar(year, currentMonth);
            fetchRaceDates(year, currentMonth);
        }
        
        // 選択された日付のレース情報を取得
        fetchDateRaces(selectedDate);
    });
    
    // 翌日ボタン
    nextDateBtn.addEventListener('click', () => {
        const date = new Date(dateInputEl.value);
        date.setDate(date.getDate() + 1);
        
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        
        dateInputEl.value = `${year}-${month}-${day}`;
        selectedDate = `${year}${month}${day}`;
        
        // 月が変わった場合はカレンダーを更新
        const currentMonth = date.getMonth() + 1;
        const [calYear, calMonth] = getCurrentCalendarMonth();
        
        if (currentMonth !== calMonth) {
            generateCalendar(year, currentMonth);
            fetchRaceDates(year, currentMonth);
        }
        
        // 選択された日付のレース情報を取得
        fetchDateRaces(selectedDate);
    });
    
    // 今日ボタン
    todayBtn.addEventListener('click', () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');
        
        dateInputEl.value = `${year}-${month}-${day}`;
        selectedDate = `${year}${month}${day}`;
        
        // カレンダーを今月に更新
        generateCalendar(year, parseInt(month));
        fetchRaceDates(year, parseInt(month));
        
        // 今日のレース情報を取得
        fetchDateRaces(selectedDate);
    });
    
    // 日付選択に戻るボタン
    backToDatesBtn.addEventListener('click', () => {
        showSection('date');
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

// 日付別レース情報を取得
function fetchDateRaces(date) {
    // 日付別レース表示用タイトルを更新
    const formattedDate = formatDateDisplay(date);
    dateRacesTitleEl.textContent = `${formattedDate}のレース一覧`;
    
    // ローディング表示
    dateVenuesContainerEl.innerHTML = '<p class="loading">データ読み込み中...</p>';
    
    // コレクションパスの決定
    const collection = raceType === 'central' ? 'jra_date' : 'nar_date';
    
    // Firestoreから日付別レースデータを取得
    db.collection('racing_data').doc(`${collection}_${date}`)
        .get()
        .then(doc => {
            if (doc.exists) {
                const data = doc.data();
                renderDateRaces(data);
                showSection('dateRaces');
            } else {
                dateVenuesContainerEl.innerHTML = `<p>この日のレース情報はありません</p>`;
                showSection('dateRaces');
            }
        })
        .catch(error => {
            console.error('日付別レースデータの取得エラー:', error);
            dateVenuesContainerEl.innerHTML = `<p>データの取得中にエラーが発生しました</p>`;
            showSection('dateRaces');
        });
}

// 日付別レース情報のレンダリング
function renderDateRaces(data) {
    if (!data.venues || data.venues.length === 0) {
        dateVenuesContainerEl.innerHTML = '<p>この日の開催情報はありません</p>';
        return;
    }
    
    let html = '';
    
    // 会場ごとにレース情報を表示
    data.venues.forEach(venue => {
        const venueName = venueCodeMap[venue.code] || venue.name;
        
        html += `
            <div class="venue-races-container">
                <div class="venue-races-header" data-venue-code="${venue.code}">
                    <span>${venueName}</span>
                    <span class="venue-races-toggle">▼</span>
                </div>
                <div class="venue-races-list">
        `;
        
        // レース番号順にソート
        const sortedRaces = [...venue.races].sort((a, b) => a.number - b.number);
        
        sortedRaces.forEach(race => {
            html += `
                <div class="venue-race-item" data-venue-code="${venue.code}" data-venue-type="${raceType}" data-race-id="${race.id}">
                    <span class="race-number">${race.number}R</span>
                    <span class="race-name">${race.name}</span>
                    <span class="race-time">${race.startTime}</span>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    dateVenuesContainerEl.innerHTML = html;
    
    // 会場ヘッダーのクリックイベント（開閉処理）
    document.querySelectorAll('.venue-races-header').forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const toggle = header.querySelector('.venue-races-toggle');
            
            if (content.style.display === 'none') {
                content.style.display = 'block';
                toggle.textContent = '▼';
            } else {
                content.style.display = 'none';
                toggle.textContent = '▶';
            }
        });
    });
    
    // レース項目のクリックイベント
    document.querySelectorAll('.venue-race-item').forEach(item => {
        item.addEventListener('click', () => {
            const venueCode = item.getAttribute('data-venue-code');
            const venueType = item.getAttribute('data-venue-type');
            const raceId = item.getAttribute('data-race-id');
            const venueName = venueCodeMap[venueCode] || '会場';
            const raceName = item.querySelector('.race-name').textContent;
            const raceNumber = item.querySelector('.race-number').textContent;
            
            // レース詳細情報を取得
            fetchRaceDetails(venueCode, raceId, venueType, `${raceNumber}: ${raceName} (${venueName})`);
        });
    });
    
    // 最終更新時間の表示
    updateLastUpdatedTime(data.lastUpdated);
}

// レース開催日を取得（カレンダー表示用）
function fetchRaceDates(year, month) {
    // 当月の開始日と終了日
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    
    const startDateStr = formatDateForAPI(startDate);
    const endDateStr = formatDateForAPI(endDate);
    
    // 選択されたレースタイプ（JRA/NAR）
    const collection = raceType === 'central' ? 'jra_date' : 'nar_date';
    
    // この月のレース開催日データをリセット
    monthRaceDates = {};
    
    // Firestoreからこの月のレース日を検索
    db.collection('racing_data')
        .where('date', '>=', startDateStr)
        .where('date', '<=', endDateStr)
        .where('__name__', '>=', `${collection}_${startDateStr}`)
        .where('__name__', '<=', `${collection}_${endDateStr}`)
        .get()
        .then(snapshot => {
            snapshot.forEach(doc => {
                const data = doc.data();
                const date = data.date;
                
                // 日付をキーとして各日の会場数を保存
                if (data.venues && data.venues.length > 0) {
                    monthRaceDates[date] = data.venues.length;
                }
            });
            
            // カレンダーに開催日を反映
            updateCalendarWithRaceDates();
        })
        .catch(error => {
            console.error('レース開催日の取得エラー:', error);
        });
}

// カレンダーに開催日情報を反映
function updateCalendarWithRaceDates() {
    // カレンダー上の各日に対応
    document.querySelectorAll('.calendar-day').forEach(dayEl => {
        const dateValue = dayEl.getAttribute('data-date');
        
        if (dateValue && monthRaceDates[dateValue]) {
            // レース開催日の場合、クラスとテキストを追加
            const venueCount = monthRaceDates[dateValue];
            dayEl.classList.add('has-races');
            
            const racesInfoEl = document.createElement('div');
            racesInfoEl.className = 'calendar-day-races';
            racesInfoEl.textContent = `${venueCount}会場`;
            
            // 既存の開催情報を削除して追加
            const existingInfo = dayEl.querySelector('.calendar-day-races');
            if (existingInfo) {
                existingInfo.remove();
            }
            
            dayEl.appendChild(racesInfoEl);
            
            // クリックイベントの追加
            dayEl.addEventListener('click', () => {
                // 日付選択を更新
                const date = new Date(dateValue.substring(0, 4), 
                                      parseInt(dateValue.substring(4, 6)) - 1, 
                                      parseInt(dateValue.substring(6, 8)));
                
                const year = date.getFullYear();
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                const day = date.getDate().toString().padStart(2, '0');
                
                dateInputEl.value = `${year}-${month}-${day}`;
                selectedDate = dateValue;
                
                // レース情報を取得
                fetchDateRaces(selectedDate);
            });
        }
    });
}

// カレンダー生成
function generateCalendar(year, month) {
    // カレンダーコンテナをクリア
    calendarContainerEl.innerHTML = '';
    
    // 曜日ヘッダーを追加
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    
    weekdays.forEach(day => {
        const headerEl = document.createElement('div');
        headerEl.className = 'calendar-header';
        headerEl.textContent = day;
        calendarContainerEl.appendChild(headerEl);
    });
    
    // 月の最初の日と最後の日
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    
    // 月の最初の日の曜日（0=日曜、6=土曜）
    const firstDayOfWeek = firstDay.getDay();
    
    // 前月の日を追加
    for (let i = 0; i < firstDayOfWeek; i++) {
        const prevDate = new Date(year, month - 1, -i);
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day inactive';
        
        const dayNumberEl = document.createElement('div');
        dayNumberEl.className = 'calendar-day-number';
        dayNumberEl.textContent = prevDate.getDate();
        
        dayEl.appendChild(dayNumberEl);
        calendarContainerEl.appendChild(dayEl);
    }
    
    // 当月の日を追加
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
    
    for (let i = 1; i <= lastDay.getDate(); i++) {
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        
        // 今日の日付には特別なクラスを追加
        if (isCurrentMonth && today.getDate() === i) {
            dayEl.classList.add('today');
        }
        
        // 日付値を属性として設定（YYYYMMDD形式）
        const dateValue = `${year}${month.toString().padStart(2, '0')}${i.toString().padStart(2, '0')}`;
        dayEl.setAttribute('data-date', dateValue);
        
        const dayNumberEl = document.createElement('div');
        dayNumberEl.className = 'calendar-day-number';
        dayNumberEl.textContent = i;
        
        dayEl.appendChild(dayNumberEl);
        calendarContainerEl.appendChild(dayEl);
    }
    
    // 空きマスを追加して7の倍数になるようにする
    const totalDays = firstDayOfWeek + lastDay.getDate();
    const remainingDays = 7 - (totalDays % 7);
    
    if (remainingDays < 7) {
        for (let i = 1; i <= remainingDays; i++) {
            const dayEl = document.createElement('div');
            dayEl.className = 'calendar-day inactive';
            
            const dayNumberEl = document.createElement('div');
            dayNumberEl.className = 'calendar-day-number';
            dayNumberEl.textContent = i;
            
            dayEl.appendChild(dayNumberEl);
            calendarContainerEl.appendChild(dayEl);
        }
    }
}

// 現在のカレンダー月を取得
function getCurrentCalendarMonth() {
    // カレンダーの最初の日付要素から年月を取得
    const firstDayEl = document.querySelector('.calendar-day:not(.inactive)');
    if (!firstDayEl) return [0, 0];
    
    const dateValue = firstDayEl.getAttribute('data-date');
    if (!dateValue) return [0, 0];
    
    const year = parseInt(dateValue.substring(0, 4));
    const month = parseInt(dateValue.substring(4, 6));
    
    return [year, month];
}

// 日付をAPI用フォーマットに変換（YYYYMMDD形式）
function formatDateForAPI(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    
    return `${year}${month}${day}`;
}

// 日付を表示用フォーマットに変換（2025年5月20日形式）
function formatDateDisplay(dateStr) {
    if (!dateStr || dateStr.length !== 8) return '';
    
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6).replace(/^0+/, '');
    const day = dateStr.substring(6, 8).replace(/^0+/, '');
    
    return `${year}年${month}月${day}日`;
}

// 会場データの取得
function fetchVenueData(type) {
    // ローディング表示
    venueButtonsEl.innerHTML = '<p class="loading">データ読み込み中...</p>';
    
    // Firestoreから会場データを取得
    const collection = type === 'central' ? 'jra_venues' : 'nar_venues';
    
    db.collection('racing_data').doc(collection)
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
    db.collection('racing_data').doc(`${collection}_${venueId}`)
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
    
    // レース番号でソート
    const sortedRaces = [...races].sort((a, b) => a.number - b.number);
    
    let buttonsHtml = '';
    sortedRaces.forEach(race => {
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
}

// レース詳細データの取得
function fetchRaceDetails(venueId, raceId, venueType, fullRaceName = null) {
    // ローディング表示
    horseTbodyEl.innerHTML = '<tr><td colspan="10" class="loading">データ読み込み中...</td></tr>';
    winPlaceTbodyEl.innerHTML = '<tr><td colspan="4" class="loading">データ読み込み中...</td></tr>';
    trioTbodyEl.innerHTML = '<tr><td colspan="3" class="loading">データ読み込み中...</td></tr>';
    
    // レースタイトルを設定
    if (fullRaceName) {
        document.getElementById('race-title').textContent = fullRaceName;
    }
    
    // コレクションパスの決定
    const collection = venueType === 'central' ? 'jra_race_details' : 'nar_race_details';
    
    // Firestoreからレース詳細データを取得
    db.collection('racing_data').doc(`${collection}_${venueId}_${raceId}`)
        .get()
        .then(doc => {
            if (doc.exists) {
                const data = doc.data();
                raceData = data; // データをグローバル変数に保存
                
                renderRaceInfo(data);
                renderEntryTable(data);
                renderOddsTable(data);
                
                // レース詳細画面に切り替え
                showSection('raceDetails');
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
    
    // 馬番順にソート
    const sortedHorses = [...data.horses].sort((a, b) => a.number - b.number);
    
    let tbodyHtml = '';
    sortedHorses.forEach(horse => {
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
    
    // 人気順にソート
    const sortedHorses = [...data.horses]
        .filter(horse => horse.status !== 'cancel') // 取消馬を除外
        .sort((a, b) => {
            if (a.odds && b.odds) {
                return a.odds.popularity - b.odds.popularity;
            }
            return 0;
        });
    
    let winPlaceHtml = '';
    sortedHorses.forEach(horse => {
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
    dateSectionEl.classList.add('hidden');
    dateRacesSectionEl.classList.add('hidden');
    venueSectionEl.classList.add('hidden');
    raceSectionEl.classList.add('hidden');
    raceDetailsSectionEl.classList.add('hidden');
    
    // 指定されたセクションのみ表示
    switch (section) {
        case 'date':
            dateSectionEl.classList.remove('hidden');
            break;
        case 'dateRaces':
            dateRacesSectionEl.classList.remove('hidden');
            break;
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