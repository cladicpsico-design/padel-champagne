// ============================================================
// supabase-config.js — Shared Supabase client + helpers
// Loaded on matches.html and admin.html
// ============================================================

const SUPABASE_URL = 'https://rmsogdbqlpdepoovnlea.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PsJpFD229yMuUQvW07H38Q_ckrzxeOj';

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: true
  }
});

// ---- Group config (emoji + label + accent colour) ----
const GROUPS = {
  whisky:    { emoji: '🥃', label: 'Whisky',    color: '#C9A84C' },
  champagne: { emoji: '🍾', label: 'Champagne', color: '#D4AF7A' },
  coronita:  { emoji: '🍺', label: 'Coronita',  color: '#6DBF7E' },
  helles:    { emoji: '🍺', label: 'Helles',    color: '#E8C547' },
  weizen:    { emoji: '🌾', label: 'Weizen',    color: '#D4875C' }
};

// ---- Date helpers ----
const DAYS_ES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                   'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatDate(dateStr) {
  // dateStr: 'YYYY-MM-DD'
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DAYS_ES[dt.getDay()]} ${d} ${MONTHS_ES[m - 1]}`;
}

// A match is revealed (opponents shown) 48h before it starts
function isRevealed(dateStr, timeStr) {
  const [y, m, d]   = dateStr.split('-').map(Number);
  const [h, min]    = timeStr.split(':').map(Number);
  const matchTime   = new Date(y, m - 1, d, h, min);
  const revealTime  = new Date(matchTime.getTime() - 48 * 60 * 60 * 1000);
  return Date.now() >= revealTime.getTime();
}

function revealDateLabel(dateStr, timeStr) {
  const [y, m, d]  = dateStr.split('-').map(Number);
  const [h, min]   = timeStr.split(':').map(Number);
  const matchTime  = new Date(y, m - 1, d, h, min);
  const revealTime = new Date(matchTime.getTime() - 48 * 60 * 60 * 1000);
  return revealTime.toLocaleDateString('es-ES', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit'
  });
}
