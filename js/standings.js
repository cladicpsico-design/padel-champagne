/* ============================================
   PADEL CHAMPAGNE — Standings (Google Sheets)

   ONE spreadsheet, five tabs — one per group.

   SHEET ID: the long code in your Google Sheet URL
   https://docs.google.com/spreadsheets/d/[SHEET_ID]/edit

   TAB NAMES must be exactly:
     Whisky · Champagne · Coronita · Helles · Weizen

   COLUMN ORDER (row 1 = headers, row 2 onwards = data):
   A: Jugador          — Player name
   B: PJ               — Matches played
   C: Ganados          — Wins
   D: Perdidos         — Losses
   E: Pts              — Total points
   F: Rating           — Formula: =E2/B2

   RANKING: sorted by Rating descending.
   Ties on Rating are broken by Pts.
   Positions assigned automatically.
   ============================================ */

// ← One Sheet ID per group
// Replace each value with the ID from that group's Google Sheet URL:
// https://docs.google.com/spreadsheets/d/[THIS_PART]/edit
const SHEET_IDS = {
  whisky:    '15mVjkQSJ_36i4FGxVycr49sg4bPdKqHds-s8PrqCRUE',
  champagne: '16FI0-8EtmHBCrq8gJfBvyhC019Y0lrgQYIArHa2pTeU',
  coronita:  '1BjfWwPZwOnpC-5rsobZh1NBR-YR7Q-DShiSrD8NoN_M',
  helles:    '1OReyyBCwvrLCw36q1WI6CakYrsFa3TeQ23tYBZK7_5I',
  weizen:    '1pCd3u9ongvEZh1lS-_CnffMHTD4AaBJBJuCYBjpQHII'
};

// The tab name inside each Sheet that holds the standings
// Must be exactly: Clasificacion (no accent)
const SHEET_TAB = 'Clasificacion';

// Auto-refresh every 5 minutes (in milliseconds)
const REFRESH_INTERVAL = 5 * 60 * 1000;

// ---------- State ----------
let currentGroup = 'whisky';
let refreshTimer = null;

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', function () {
  setupTabs();
  loadStandings(currentGroup);
  startAutoRefresh();
});

// ---------- Tabs ----------
function setupTabs() {
  var tabs = document.querySelectorAll('.standings-tab');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      currentGroup = tab.getAttribute('data-group');
      loadStandings(currentGroup);
    });
  });
}

// ---------- Load data from Google Sheets ----------
function loadStandings(group) {
  var sheetId = SHEET_IDS[group];
  var loading = document.getElementById('standingsLoading');
  var empty   = document.getElementById('standingsEmpty');
  var table   = document.getElementById('standingsTable');

  // If this group's Sheet ID hasn't been set yet, show empty state
  if (!sheetId || sheetId.indexOf('SHEET_ID_') === 0) {
    if (loading) loading.style.display = 'none';
    if (table)   table.style.display   = 'none';
    if (empty)   empty.style.display   = 'block';
    return;
  }

  // Show loading skeleton
  if (loading) loading.style.display = 'block';
  if (table)   table.style.display   = 'none';
  if (empty)   empty.style.display   = 'none';

  var url = 'https://docs.google.com/spreadsheets/d/' + sheetId +
            '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(SHEET_TAB);

  fetch(url)
    .then(function (response) {
      if (!response.ok) throw new Error('Network error');
      return response.text();
    })
    .then(function (csv) {
      var rows = parseCSV(csv);

      // Only header row or completely empty → show empty state
      if (rows.length <= 1) {
        if (loading) loading.style.display = 'none';
        if (table)   table.style.display   = 'none';
        if (empty)   empty.style.display   = 'block';
        return;
      }

      renderTable(rows);
    })
    .catch(function () {
      if (loading) loading.style.display = 'none';
      if (table)   table.style.display   = 'none';
      if (empty) {
        empty.style.display = 'block';
        empty.innerHTML = '<p>&#9888; Could not load standings. Please try again later.</p>';
      }
    });
}

// ---------- Parse CSV ----------
function parseCSV(text) {
  var rows  = [];
  var lines = text.split('\n');

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    var cells    = [];
    var current  = '';
    var inQuotes = false;

    for (var j = 0; j < line.length; j++) {
      var ch = line[j];
      if (ch === '"') {
        if (inQuotes && j + 1 < line.length && line[j + 1] === '"') {
          current += '"';
          j++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    rows.push(cells);
  }

  return rows;
}

// ---------- Helper: parse number with comma OR dot as decimal ----------
function toNum(val) {
  if (val === undefined || val === null || val === '') return 0;
  return parseFloat(String(val).replace(',', '.')) || 0;
}

// Matches needed before Rating takes over as the ranking criterion
var RATING_THRESHOLD = 5;

// ---------- Render table ----------
// Sheet columns:
//   A=Jugador  B=PJ  C=Ganados  D=Perdidos  E=Pts  F=Rating
//
// Ranking rules:
//   · PJ < 5  → sorted by Pts descending (preliminary, shown below rated players)
//   · PJ ≥ 5  → sorted by Rating descending (official), Pts as tiebreaker
//                These players always appear above PJ < 5 players.
// Position numbers assigned automatically; ties share the same rank.
function renderTable(rows) {
  var loading = document.getElementById('standingsLoading');
  var table   = document.getElementById('standingsTable');
  var tbody   = document.getElementById('standingsBody');
  var empty   = document.getElementById('standingsEmpty');

  if (!tbody || !table) return;

  tbody.innerHTML = '';

  // Build data array — skip header row (index 0)
  var data = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    // Need at least Jugador(A), PJ(B), Ganados(C), Perdidos(D), Pts(E)
    if (row.length < 5) continue;
    var jugador  = row[0] || '';
    var pj       = row[1] || '0';
    var ganados  = row[2] || '0';
    var perdidos = row[3] || '0';
    var pts      = toNum(row[4]);
    var pjNum    = toNum(pj);

    // Rating: use sheet value if provided (col F), otherwise calculate
    var ratingRaw = row[5] !== undefined ? row[5] : '';
    var rating    = toNum(ratingRaw);
    if (isNaN(rating) || ratingRaw === '') {
      rating = pjNum > 0 ? pts / pjNum : 0;
    }

    if (!jugador) continue; // skip empty rows

    data.push({
      jugador  : jugador,
      pj       : pj,
      ganados  : ganados,
      perdidos : perdidos,
      pts      : pts,
      rating   : rating
    });
  }

  if (data.length === 0) {
    if (loading) loading.style.display = 'none';
    if (table)   table.style.display   = 'none';
    if (empty)   empty.style.display   = 'block';
    return;
  }

  // Sort: rated players (PJ ≥ 5) always above unrated (PJ < 5)
  // Within rated   → Rating desc, then Pts desc
  // Within unrated → Pts desc
  data.sort(function (a, b) {
    var aRated = toNum(a.pj) >= RATING_THRESHOLD;
    var bRated = toNum(b.pj) >= RATING_THRESHOLD;
    if (aRated && !bRated) return -1;
    if (!aRated && bRated) return 1;
    if (aRated && bRated) {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return b.pts - a.pts;
    }
    // both unrated → by Pts
    return b.pts - a.pts;
  });

  // Assign positions — ties share the same rank
  for (var k = 0; k < data.length; k++) {
    var kRated = toNum(data[k].pj) >= RATING_THRESHOLD;
    if (k === 0) {
      data[k].pos = 1;
    } else {
      var prevRated = toNum(data[k - 1].pj) >= RATING_THRESHOLD;
      var tied = false;
      if (kRated && prevRated) {
        tied = data[k].rating === data[k - 1].rating && data[k].pts === data[k - 1].pts;
      } else if (!kRated && !prevRated) {
        tied = data[k].pts === data[k - 1].pts;
      }
      data[k].pos = tied ? data[k - 1].pos : k + 1;
    }
    data[k].rated = kRated;
  }

  // Check if any matches have been played yet
  var seasonStarted = data.some(function (p) { return toNum(p.pj) > 0; });

  // Build table rows
  for (var m = 0; m < data.length; m++) {
    var d  = data[m];

    var tr = document.createElement('tr');

    // Highlight top 3 only for rated players once season has started
    if (seasonStarted && d.rated) {
      if (d.pos === 1) tr.classList.add('rank-1');
      if (d.pos === 2) tr.classList.add('rank-2');
      if (d.pos === 3) tr.classList.add('rank-3');
    }

    // # Position — medals for top 3 rated players only
    var tdPos = document.createElement('td');
    if (seasonStarted && d.rated && d.pos === 1)      tdPos.innerHTML  = '&#129351;'; // 🥇
    else if (seasonStarted && d.rated && d.pos === 2) tdPos.innerHTML  = '&#129352;'; // 🥈
    else if (seasonStarted && d.rated && d.pos === 3) tdPos.innerHTML  = '&#129353;'; // 🥉
    else                                              tdPos.textContent = m + 1;
    tr.appendChild(tdPos);

    // Player
    var tdPlayer = document.createElement('td');
    tdPlayer.textContent = d.jugador;
    tr.appendChild(tdPlayer);

    // MP — Matches Played
    var tdMP = document.createElement('td');
    tdMP.textContent = d.pj;
    tr.appendChild(tdMP);

    // W — Wins
    var tdW = document.createElement('td');
    tdW.textContent = d.ganados;
    tdW.classList.add('col-wins');
    tr.appendChild(tdW);

    // L — Losses
    var tdL = document.createElement('td');
    tdL.textContent = d.perdidos;
    tdL.classList.add('col-losses');
    tr.appendChild(tdL);

    // Pts
    var tdPts = document.createElement('td');
    tdPts.textContent = d.pts;
    tr.appendChild(tdPts);

    // Rating (2 decimals)
    var tdRating = document.createElement('td');
    tdRating.textContent = d.rating.toFixed(2);
    tdRating.classList.add('col-rating');
    tr.appendChild(tdRating);

    tbody.appendChild(tr);
  }

  // Show table
  if (loading) loading.style.display = 'none';
  if (empty)   empty.style.display   = 'none';
  table.style.display = 'table';
}

// ---------- Auto refresh ----------
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(function () {
    loadStandings(currentGroup);
  }, REFRESH_INTERVAL);
}
