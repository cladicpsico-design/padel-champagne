// ============================================================
// supabase-config.js — Shared Supabase client + Sheet helpers
// ============================================================

const SUPABASE_URL = 'https://rmsogdbqlpdepoovnlea.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PsJpFD229yMuUQvW07H38Q_ckrzxeOj';

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
});

// ---- Google Sheet IDs (same sheets as standings) ----
const SHEET_IDS = {
  whisky:    '15mVjkQSJ_36i4FGxVycr49sg4bPdKqHds-s8PrqCRUE',
  champagne: '16FI0-8EtmHBCrq8gJfBvyhC019Y0lrgQYIArHa2pTeU',
  coronita:  '1BjfWwPZwOnpC-5rsobZh1NBR-YR7Q-DShiSrD8NoN_M',
  helles:    '1OReyyBCwvrLCw36q1WI6CakYrsFa3TeQ23tYBZK7_5I',
  weizen:    '1pCd3u9ongvEZh1lS-_CnffMHTD4AaBJBJuCYBjpQHII'
};
const PARTIDOS_TAB = 'Partidos';

// ---- Group config ----
const GROUPS = {
  whisky:    { emoji: '🥃', label: 'Whisky',    color: '#C9A84C' },
  champagne: { emoji: '🍾', label: 'Champagne', color: '#D4AF7A' },
  coronita:  { emoji: '🍺', label: 'Coronita',  color: '#6DBF7E' },
  helles:    { emoji: '🍺', label: 'Helles',    color: '#E8C547' },
  weizen:    { emoji: '🌾', label: 'Weizen',    color: '#D4875C' }
};

// ---- Date helpers ----
const DAYS_ES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// Parse date string from Google Sheet → "YYYY-MM-DD"
function parseSheetDate(str) {
  if (!str) return null;
  str = str.trim();
  // DD/MM/YYYY or DD.MM.YYYY
  const dmy = str.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // M/D/YYYY (US format fallback)
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  return null;
}

// Parse time → "HH:MM"
function parseSheetTime(str) {
  if (!str) return null;
  const t = str.trim().match(/^(\d{1,2}):(\d{2})/);
  return t ? `${t[1].padStart(2,'0')}:${t[2]}` : null;
}

// "YYYY-MM-DD" → "Lun 1 Jun"
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DAYS_ES[dt.getDay()]} ${d} ${MONTHS_ES[m - 1]}`;
}

// Slot key — stable identifier for a match slot
function makeSlotKey(date, time, location) {
  return `${date}|${time}|${location.trim()}`;
}

// Is this slot revealed? (48h before match time)
function isRevealed(dateStr, timeStr) {
  if (!timeStr || timeStr === 'TBD') return false; // unknown time → keep hidden
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min]  = timeStr.split(':').map(Number);
  const matchDt   = new Date(y, m - 1, d, h, min);
  return Date.now() >= matchDt.getTime() - 48 * 60 * 60 * 1000;
}

function revealDateLabel(dateStr, timeStr) {
  if (!timeStr || timeStr === 'TBD') return 'time confirmed';
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min]  = timeStr.split(':').map(Number);
  const reveal    = new Date(new Date(y, m-1, d, h, min).getTime() - 48*60*60*1000);
  return reveal.toLocaleDateString('es-ES', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

// ---- Fetch Partidos tab from a Google Sheet ----
// Returns array of { date, time, location, slotKey } for future slots only
async function fetchSlotsFromSheet(groupKey) {
  const sheetId = SHEET_IDS[groupKey];
  if (!sheetId) return [];

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(PARTIDOS_TAB)}`;

  try {
    const res  = await fetch(url);
    const text = await res.text();
    const rows = parseCSV(text);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const slots = [];
    // Skip header row (row 0)
    for (let i = 1; i < rows.length; i++) {
      const row      = rows[i];
      const dateRaw  = row[0] || '';
      const timeRaw  = row[1] || '';
      const locRaw   = row[2] || '';

      const date     = parseSheetDate(dateRaw);
      const time     = parseSheetTime(timeRaw) || 'TBD';
      const location = locRaw.trim();

      if (!date || !location) continue;

      // Only future matches
      const [y, mo, d] = date.split('-').map(Number);
      const slotDate = new Date(y, mo - 1, d);
      if (slotDate < today) continue;

      // Count pre-assigned players from sheet (Jugador 1–4 = cols 3–6)
      const sheetPlayerCount = [row[3], row[4], row[5], row[6]]
        .filter(v => v && v.trim() !== '').length;

      slots.push({ date, time, location, slotKey: makeSlotKey(date, time, location), sheetPlayerCount });
    }

    // Sort by date then time
    slots.sort((a, b) => a.slotKey.localeCompare(b.slotKey));
    return slots;
  } catch (e) {
    console.error('Sheet fetch error:', e);
    return [];
  }
}

// ---- CSV parser (reused from standings.js) ----
function parseCSV(text) {
  const rows = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = [];
    let current = '', inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        if (inQuotes && line[j+1] === '"') { current += '"'; j++; }
        else inQuotes = !inQuotes;
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
