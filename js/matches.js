// ============================================================
// matches.js — Player-facing matches page
// Slots come from Google Sheet; signups stored in Supabase
// ============================================================

let currentPlayer = null;
let myAvailability = new Set(); // slot keys the player has signed up for

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) { showSection('login'); setupLoginForm(); return; }
  await initPlayer(session);
});

// ---- Login ----
function setupLoginForm() {
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const btn   = document.getElementById('loginBtn');
    btn.disabled = true; btn.textContent = 'Sending…';

    const { error } = await _supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + '/matches.html' }
    });

    if (error) showMsg('loginMsg', '❌ ' + error.message, 'error');
    else       showMsg('loginMsg', '✅ Check your email — link sent!', 'success');

    btn.disabled = false; btn.textContent = 'Send sign-in link';
  });
}

// ---- Player init ----
async function initPlayer(session) {
  let { data: player } = await _supabase
    .from('players').select('*').eq('auth_id', session.user.id).maybeSingle();

  if (!player) {
    const { data: byEmail } = await _supabase
      .from('players').select('*').eq('email', session.user.email).is('auth_id', null).maybeSingle();
    if (byEmail) {
      await _supabase.from('players').update({ auth_id: session.user.id }).eq('id', byEmail.id);
      player = { ...byEmail, auth_id: session.user.id };
    } else {
      setupProfileForm(session); showSection('profile'); return;
    }
  }

  currentPlayer = player;
  renderMainSection();
  showSection('main');
}

// ---- Profile setup ----
function setupProfileForm(session) {
  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name  = document.getElementById('profileName').value.trim();
    const group = document.getElementById('profileGroup').value;
    const btn   = document.getElementById('profileBtn');
    if (!name || !group) return;
    btn.disabled = true; btn.textContent = 'Saving…';

    const { data: newPlayer, error } = await _supabase.from('players')
      .insert({ auth_id: session.user.id, name, email: session.user.email, group_name: group })
      .select().single();

    if (error) {
      showMsg('profileMsg', '❌ ' + error.message, 'error');
      btn.disabled = false; btn.textContent = 'Save & continue →';
      return;
    }
    currentPlayer = newPlayer;
    renderMainSection();
    showSection('main');
  });
}

// ---- Main section ----
function renderMainSection() {
  const grp = GROUPS[currentPlayer.group_name] || { emoji:'🎾', label: currentPlayer.group_name, color:'#C9A84C' };

  document.getElementById('heroSubtitle').textContent = 'Season 2 · Your matches & availability';
  document.getElementById('userGreeting').textContent = 'Hey, ' + currentPlayer.name + '!';

  const badge = document.getElementById('userGroupBadge');
  badge.textContent = grp.emoji + ' ' + grp.label;
  badge.style.setProperty('--badge-color', grp.color);

  if (currentPlayer.is_admin) document.getElementById('adminLink').style.display = 'inline-flex';

  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await _supabase.auth.signOut(); window.location.reload();
  });

  document.querySelectorAll('.mc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mc-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.mc-tab-panel').forEach(p => { p.style.display = 'none'; });
      tab.classList.add('active');
      document.getElementById('tab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1)).style.display = 'block';
    });
  });

  loadSlots();
  loadMyMatches();
}

// ---- Load slots from Google Sheet ----
async function loadSlots() {
  document.getElementById('slotsLoading').style.display = 'flex';
  document.getElementById('slotsEmpty').style.display   = 'none';
  document.getElementById('slotsList').innerHTML        = '';

  const group  = currentPlayer.group_name;
  const slots  = await fetchSlotsFromSheet(group);

  // Fetch my availability
  const { data: avail } = await _supabase
    .from('availability').select('slot_key').eq('player_id', currentPlayer.id);
  myAvailability = new Set((avail || []).map(a => a.slot_key));

  // Fetch signup counts for all slots at once
  const keys = slots.map(s => s.slotKey);
  const countMap = {};
  if (keys.length > 0) {
    const { data: counts } = await _supabase
      .from('availability').select('slot_key').in('slot_key', keys);
    (counts || []).forEach(c => { countMap[c.slot_key] = (countMap[c.slot_key] || 0) + 1; });
  }

  document.getElementById('slotsLoading').style.display = 'none';

  if (slots.length === 0) {
    document.getElementById('slotsEmpty').style.display = 'block'; return;
  }

  const grp       = GROUPS[group] || { emoji:'🎾', label: group, color:'#C9A84C' };
  const container = document.getElementById('slotsList');
  slots.forEach(slot => {
    const count  = countMap[slot.slotKey] || 0;
    const signed = myAvailability.has(slot.slotKey);
    container.appendChild(buildSlotCard(slot, count, signed, grp));
  });
}

function buildSlotCard(slot, signedCount, isSigned, grp) {
  const card = document.createElement('div');
  card.className = 'mc-slot-card fade-in';

  // Build 4 spots
  let spotsHTML = '';
  for (let i = 0; i < 4; i++) {
    if (i < signedCount) {
      spotsHTML += `<div class="mc-spot mc-spot-taken">🎾 Taken</div>`;
    } else {
      spotsHTML += `<div class="mc-spot mc-spot-free">🎾 Spot free</div>`;
    }
  }

  card.innerHTML = `
    <div class="mc-slot-top">
      <span class="mc-slot-date">${formatDate(slot.date)}</span>
      <span class="mc-group-pill" style="--g:${grp.color}">${grp.emoji} ${grp.label}</span>
    </div>
    <div class="mc-slot-time-loc">
      ⏰ <strong>${slot.time}</strong> &nbsp;·&nbsp; 📍 ${slot.location}
    </div>
    <div class="mc-spots">${spotsHTML}</div>
    <button class="mc-btn ${isSigned ? 'mc-btn-signed' : 'mc-btn-primary'} mc-join-btn"
            data-slot-key="${slot.slotKey}" data-signed="${isSigned}">
      ${isSigned ? '✓ You\'re in &nbsp;·&nbsp; Cancel' : 'Join this match'}
    </button>
  `;

  card.querySelector('.mc-join-btn').addEventListener('click', () => toggleAvailability(slot.slotKey));
  return card;
}

// ---- Toggle availability ----
async function toggleAvailability(slotKey) {
  const btn    = document.querySelector(`.mc-join-btn[data-slot-key="${CSS.escape(slotKey)}"]`);
  const signed = btn.dataset.signed === 'true';
  btn.disabled = true;

  if (signed) {
    await _supabase.from('availability').delete()
      .eq('player_id', currentPlayer.id).eq('slot_key', slotKey);
  } else {
    await _supabase.from('availability').insert({ player_id: currentPlayer.id, slot_key: slotKey });
  }

  btn.disabled = false;
  loadSlots(); // refresh
}

// ---- My Matches ----
async function loadMyMatches() {
  document.getElementById('matchesLoading').style.display = 'flex';
  document.getElementById('matchesEmpty').style.display   = 'none';
  document.getElementById('matchesList').innerHTML        = '';

  const pid = currentPlayer.id;
  const { data: matches } = await _supabase.from('matches')
    .select(`*, p1:players!matches_player1_id_fkey(id,name), p2:players!matches_player2_id_fkey(id,name),
             p3:players!matches_player3_id_fkey(id,name), p4:players!matches_player4_id_fkey(id,name)`)
    .or(`player1_id.eq.${pid},player2_id.eq.${pid},player3_id.eq.${pid},player4_id.eq.${pid}`)
    .order('created_at', { ascending: false });

  document.getElementById('matchesLoading').style.display = 'none';

  if (!matches || matches.length === 0) {
    document.getElementById('matchesEmpty').style.display = 'block'; return;
  }

  const container = document.getElementById('matchesList');
  matches.forEach(m => container.appendChild(buildMatchCard(m)));
}

function buildMatchCard(match) {
  // slot_key = "YYYY-MM-DD|HH:MM|Location"
  const parts    = match.slot_key.split('|');
  const date     = parts[0] || '';
  const time     = parts[1] || '';
  const location = parts[2] || '';
  const grp      = GROUPS[match.group_name] || { emoji:'🎾', label: match.group_name, color:'#C9A84C' };
  const revealed = isRevealed(date, time);
  const players  = [match.p1, match.p2, match.p3, match.p4].filter(Boolean);

  let playersHTML;
  if (!revealed) {
    playersHTML = `
      <div class="mc-match-hidden">
        🎭 <strong>Blind draw active</strong>
        <span>Opponents revealed on ${revealDateLabel(date, time)}</span>
      </div>`;
  } else {
    const team1 = players.slice(0, 2);
    const team2 = players.slice(2, 4);
    playersHTML = `
      <div class="mc-match-teams">
        <div class="mc-team">
          ${team1.map(p => `<span class="mc-player ${p.id === currentPlayer.id ? 'mc-player-me' : ''}">${p.name}</span>`).join('')}
        </div>
        <span class="mc-vs">VS</span>
        <div class="mc-team">
          ${team2.map(p => `<span class="mc-player ${p.id === currentPlayer.id ? 'mc-player-me' : ''}">${p.name}</span>`).join('')}
        </div>
      </div>`;
  }

  const card = document.createElement('div');
  card.className = 'mc-match-card fade-in';
  card.innerHTML = `
    <div class="mc-match-header">
      <span class="mc-match-date">${formatDate(date)} · ${time}</span>
      <span class="mc-group-pill" style="--g:${grp.color}">${grp.emoji} ${grp.label}</span>
    </div>
    <div class="mc-match-location">📍 ${location}</div>
    ${playersHTML}
  `;
  return card;
}

// ---- Utilities ----
function showSection(name) {
  ['login','profile','main'].forEach(s => {
    const el = document.getElementById(s + 'Section');
    if (el) el.style.display = (s === name) ? '' : 'none';
  });
}
function showMsg(id, text, type) {
  const el = document.getElementById(id);
  el.style.display = 'block';
  el.textContent   = text;
  el.className     = 'mc-msg mc-msg-' + type;
}
