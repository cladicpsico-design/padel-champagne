// ============================================================
// register.js — Season registration with Stripe Checkout
// ============================================================

const BASE_PRICE = 45; // Temporada de verano (6 semanas)
const MIN_PRICE  = 10;

// Season codes → precio final (admin envía por WhatsApp)
const SEASON_CODE_MAP = {
  'T125': { tier: 'founder',  finalPrice: 25, label: '🏆 T1 2025' },
  'T225': { tier: 't2_2025',  finalPrice: 25, label: 'T2 2025' },
  'T325': { tier: 't3_2025',  finalPrice: 30, label: 'T3 2025' },
  'T425': { tier: 't4_2025',  finalPrice: 30, label: 'T4 2025' },
  'T126': { tier: 't1_2026',  finalPrice: 35, label: 'T1 2026' },
  'T226': { tier: 't2_2026',  finalPrice: 35, label: 'T2 2026' },
};

// Precio final por season_start (fallback via email lookup)
const SEASON_PRICES = {
  'founder':  25, 't2_2025': 25, 't3_2025': 30,
  't4_2025':  30, 't1_2026': 35, 't2_2026': 35, 'new': 45,
};
const SEASON_LABELS = {
  'founder':  '🏆 T1 2025',
  't2_2025':  'T2 2025',
  't3_2025':  'T3 2025',
  't4_2025':  'T4 2025',
  't1_2026':  'T1 2026',
  't2_2026':  'T2 2026',
  'new':       null,
};

let seasonCodeInfo = null; // set when valid season code entered

let playerInfo  = { found: false, season_start: 'new', referral_discount_earned: 0, name: '' };
let emailTimer  = null;

// ── Page init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);

  if (params.get('success') === '1') {
    document.getElementById('registerSection').style.display = 'none';
    document.getElementById('successSection').style.display  = '';
    // Clean up URL
    window.history.replaceState({}, '', window.location.pathname);
    return;
  }

  setupForm();
});

// ── Wire up form ───────────────────────────────────────────
function setupForm() {
  document.getElementById('regEmail').addEventListener('input', (e) => {
    clearTimeout(emailTimer);
    emailTimer = setTimeout(() => lookupEmail(e.target.value.trim()), 650);
  });

  // Force uppercase on season code + validate in real time
  document.getElementById('regSeasonCode').addEventListener('input', (e) => {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(pos, pos);
    validateSeasonCode(e.target.value.trim());
  });

  // Force uppercase on referral code
  document.getElementById('regReferral').addEventListener('input', (e) => {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(pos, pos);
  });

  document.getElementById('regForm').addEventListener('submit', handleSubmit);
}

// ── Validate season code ────────────────────────────────────
function validateSeasonCode(code) {
  const msgEl = document.getElementById('seasonCodeMsg');
  if (!code) {
    seasonCodeInfo = null;
    msgEl.style.display = 'none';
    updatePriceDisplay();
    return;
  }
  const match = SEASON_CODE_MAP[code];
  if (match) {
    seasonCodeInfo = match;
    msgEl.style.display = 'block';
    msgEl.className = 'reg-player-found';
    msgEl.textContent = `✅ ${match.label} — precio: €${match.finalPrice}`;
  } else {
    seasonCodeInfo = null;
    msgEl.style.display = 'block';
    msgEl.className = 'mc-msg mc-msg-error';
    msgEl.textContent = '❌ Invalid code';
  }
  updatePriceDisplay();
}

// ── Look up email → loyalty tier ───────────────────────────
async function lookupEmail(email) {
  const foundEl = document.getElementById('playerFoundMsg');
  foundEl.style.display = 'none';

  if (!email || !email.includes('@') || !email.includes('.')) {
    resetPriceDisplay();
    return;
  }

  try {
    const { data, error } = await _supabase
      .rpc('get_registration_info', { p_email: email });

    if (error || !data) { resetPriceDisplay(); return; }

    playerInfo = typeof data === 'string' ? JSON.parse(data) : data;
    updatePriceDisplay();

  } catch (err) {
    console.warn('Email lookup failed:', err);
    resetPriceDisplay();
  }
}

// ── Recalculate & render price ─────────────────────────────
function updatePriceDisplay() {
  // Season code takes priority over email lookup
  const baseForPlayer = seasonCodeInfo
    ? seasonCodeInfo.finalPrice
    : (SEASON_PRICES[playerInfo.season_start] ?? BASE_PRICE);
  const seasonLabel  = seasonCodeInfo
    ? seasonCodeInfo.label
    : (SEASON_LABELS[playerInfo.season_start] || null);

  const referralDisc = Math.max(0, playerInfo.referral_discount_earned || 0);
  const total        = Math.max(MIN_PRICE, baseForPlayer - referralDisc);

  const breakdown = document.getElementById('priceBreakdown');
  breakdown.innerHTML = '';

  if (baseForPlayer < BASE_PRICE && seasonLabel) {
    breakdown.innerHTML += `
      <div class="reg-price-line reg-price-discount">
        <span>${seasonLabel}</span>
        <span>-€${BASE_PRICE - baseForPlayer}</span>
      </div>`;
  }
  if (referralDisc > 0) {
    const count = referralDisc / 10;
    breakdown.innerHTML += `
      <div class="reg-price-line reg-price-discount">
        <span>Referral credit${count > 1 ? 's' : ''} (${count}x)</span>
        <span>-€${referralDisc}</span>
      </div>`;
  }

  document.getElementById('priceTotal').textContent  = `€${total}`;
  document.getElementById('regBtnPrice').textContent = `€${total}`;

  const hint    = document.getElementById('priceHint');
  const foundEl = document.getElementById('playerFoundMsg');

  if (seasonCodeInfo) {
    hint.style.display    = 'none';
    foundEl.style.display = 'none';
  } else if (playerInfo.found) {
    hint.style.display    = 'none';
    foundEl.style.display = 'block';
    foundEl.innerHTML = `✅ Welcome back, <strong>${playerInfo.name}</strong>!`;
  } else {
    hint.style.display    = '';
    hint.textContent      = 'Have a season code? Enter it above to unlock your discount.';
    foundEl.style.display = 'none';
  }
}

function resetPriceDisplay() {
  playerInfo = { found: false, season_start: 'new', referral_discount_earned: 0, name: '' };
  document.getElementById('priceBreakdown').innerHTML = '';
  document.getElementById('priceTotal').textContent   = `€${BASE_PRICE}`;
  document.getElementById('regBtnPrice').textContent  = `€${BASE_PRICE}`;  // 45 si no hay código
  document.getElementById('priceHint').style.display  = '';
  document.getElementById('priceHint').textContent    = 'Enter your email above to check for loyalty discounts.';
  document.getElementById('playerFoundMsg').style.display = 'none';
}

// ── Submit → Stripe Checkout ───────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();

  const name        = document.getElementById('regName').value.trim();
  const email       = document.getElementById('regEmail').value.trim();
  const phone       = document.getElementById('regPhone').value.trim();
  const dob         = document.getElementById('regDob').value || null;
  const group       = document.getElementById('regGroup').value;
  const seasonCode  = document.getElementById('regSeasonCode').value.trim().toUpperCase() || null;
  const referral    = document.getElementById('regReferral').value.trim().toUpperCase() || null;

  // Client-side validation
  if (!name) { showMsg('regMsg', '❌ Please enter your name.', 'error'); return; }
  if (!email || !email.includes('@')) { showMsg('regMsg', '❌ Please enter a valid email.', 'error'); return; }
  if (!group) { showMsg('regMsg', '❌ Please select a preferred group.', 'error'); return; }

  const btn = document.getElementById('regSubmitBtn');
  btn.disabled    = true;
  btn.textContent = 'Redirecting to checkout…';
  hideMsg('regMsg');

  try {
    const { data, error } = await _supabase.functions.invoke('create-checkout', {
      body: {
        name,
        email,
        phone:           phone       || null,
        date_of_birth:   dob,
        preferred_group: group,
        season_code:     seasonCode,
        referral_code:   referral,
        origin:          window.location.origin,
      }
    });

    if (error) throw new Error(error.message || 'Could not start checkout.');
    if (!data?.url) throw new Error('No checkout URL returned from server.');

    // Redirect to Stripe hosted checkout
    window.location.href = data.url;

  } catch (err) {
    showMsg('regMsg', '❌ ' + err.message, 'error');
    btn.disabled = false;
    const price  = document.getElementById('priceTotal').textContent;
    btn.innerHTML = `Register &amp; Pay ${price} →`;
  }
}

// ── Tiny helpers ───────────────────────────────────────────
function showMsg(id, text, type) {
  const el = document.getElementById(id);
  el.style.display = 'block';
  el.textContent   = text;
  el.className     = 'mc-msg mc-msg-' + type;
}
function hideMsg(id) {
  document.getElementById(id).style.display = 'none';
}
