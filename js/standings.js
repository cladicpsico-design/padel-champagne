// ============================================================
// standings.js — Clasificación desde Supabase (auto-calculada)
// Los resultados se actualizan cada vez que un jugador introduce
// y confirma el marcador desde la página de partidos.
// ============================================================

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutos

let currentGroup = 'whisky';
let refreshTimer  = null;

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  setupTabs();
  loadStandings(currentGroup);
  startAutoRefresh();
});

// ── Tabs ───────────────────────────────────────────────────────
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

// ── Load standings from Supabase ───────────────────────────────
async function loadStandings(group) {
  var loading = document.getElementById('standingsLoading');
  var empty   = document.getElementById('standingsEmpty');
  var table   = document.getElementById('standingsTable');

  if (loading) loading.style.display = 'block';
  if (table)   table.style.display   = 'none';
  if (empty)   empty.style.display   = 'none';

  try {
    const { data, error } = await _supabase
      .rpc('get_group_standings', { p_group: group });

    if (error) throw error;

    if (!data || data.length === 0) {
      if (loading) loading.style.display = 'none';
      if (empty)   empty.style.display   = 'block';
      return;
    }

    renderTable(data);
  } catch (err) {
    console.error('Standings error:', err);
    if (loading) loading.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      empty.innerHTML = '<p>⚠ No se pudo cargar la clasificación. Inténtalo de nuevo.</p>';
    }
  }
}

// ── Render table ───────────────────────────────────────────────
// data: array of { player_id, jugador, pj, ganados, perdidos, pts, rating }
var RATING_THRESHOLD = 5; // partidos para ser "clasificado oficial"

function renderTable(data) {
  var loading = document.getElementById('standingsLoading');
  var table   = document.getElementById('standingsTable');
  var tbody   = document.getElementById('standingsBody');
  var empty   = document.getElementById('standingsEmpty');

  if (!tbody || !table) return;
  tbody.innerHTML = '';

  // Convertir a números (llegan como strings en algunos casos)
  var rows = data.map(function (d) {
    return {
      jugador  : d.jugador  || '',
      pj       : Number(d.pj)       || 0,
      ganados  : Number(d.ganados)  || 0,
      perdidos : Number(d.perdidos) || 0,
      pts      : Number(d.pts)      || 0,
      rating   : Number(d.rating)   || 0,
    };
  });

  if (rows.length === 0) {
    if (loading) loading.style.display = 'none';
    if (empty)   empty.style.display   = 'block';
    return;
  }

  // Ordenar: clasificados (PJ ≥ 5) primero, luego por Rating desc, Pts desc
  rows.sort(function (a, b) {
    var aRated = a.pj >= RATING_THRESHOLD;
    var bRated = b.pj >= RATING_THRESHOLD;
    if (aRated && !bRated) return -1;
    if (!aRated && bRated) return 1;
    if (b.rating !== a.rating) return b.rating - a.rating;
    return b.pts - a.pts;
  });

  // Asignar posiciones (empates comparten rango)
  for (var k = 0; k < rows.length; k++) {
    var kRated = rows[k].pj >= RATING_THRESHOLD;
    if (k === 0) {
      rows[k].pos = 1;
    } else {
      var prevRated = rows[k - 1].pj >= RATING_THRESHOLD;
      var tied = false;
      if (kRated === prevRated) {
        tied = rows[k].rating === rows[k - 1].rating && rows[k].pts === rows[k - 1].pts;
      }
      rows[k].pos = tied ? rows[k - 1].pos : k + 1;
    }
    rows[k].rated = kRated;
  }

  var seasonStarted = rows.some(function (r) { return r.pj > 0; });

  for (var m = 0; m < rows.length; m++) {
    var d  = rows[m];
    var tr = document.createElement('tr');

    if (seasonStarted && d.rated) {
      if (d.pos === 1) tr.classList.add('rank-1');
      if (d.pos === 2) tr.classList.add('rank-2');
      if (d.pos === 3) tr.classList.add('rank-3');
    }

    // Posición
    var tdPos = document.createElement('td');
    if (seasonStarted && d.rated && d.pos === 1)      tdPos.innerHTML  = '🥇';
    else if (seasonStarted && d.rated && d.pos === 2) tdPos.innerHTML  = '🥈';
    else if (seasonStarted && d.rated && d.pos === 3) tdPos.innerHTML  = '🥉';
    else                                              tdPos.textContent = m + 1;
    tr.appendChild(tdPos);

    // Jugador
    var tdPlayer = document.createElement('td');
    tdPlayer.textContent = d.jugador;
    tr.appendChild(tdPlayer);

    // PJ
    var tdMP = document.createElement('td');
    tdMP.textContent = d.pj;
    tr.appendChild(tdMP);

    // Ganados
    var tdW = document.createElement('td');
    tdW.textContent = d.ganados;
    tdW.classList.add('col-wins');
    tr.appendChild(tdW);

    // Perdidos
    var tdL = document.createElement('td');
    tdL.textContent = d.perdidos;
    tdL.classList.add('col-losses');
    tr.appendChild(tdL);

    // Pts
    var tdPts = document.createElement('td');
    tdPts.textContent = d.pts;
    tr.appendChild(tdPts);

    // Rating
    var tdRating = document.createElement('td');
    tdRating.textContent = d.rating.toFixed(2);
    tdRating.classList.add('col-rating');
    tr.appendChild(tdRating);

    tbody.appendChild(tr);
  }

  if (loading) loading.style.display = 'none';
  if (empty)   empty.style.display   = 'none';
  table.style.display = 'table';
}

// ── Auto-refresh ───────────────────────────────────────────────
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(function () {
    loadStandings(currentGroup);
  }, REFRESH_INTERVAL);
}
