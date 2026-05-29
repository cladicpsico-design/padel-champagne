// ============================================================
// matches.js — Player-facing matches page
// ============================================================

let currentPlayer = null;
let myAvailability = new Set(); // slot IDs the player has signed up for

// ---- Bootstrap ----
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await _supabase.auth.getSession();

  if (!session) {
    showSection('login');
    setupLoginForm();
    return;
  }

  await initPlayer(session);
});

// ---- Login ----
function setupLoginForm() {
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const btn   = document.getElementById('loginBtn');

    btn.disabled    = true;
    btn.textContent = 'Sending…';

    const { error } = await _supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: 'https://padelchampagne.com/matches.html' }
    });

    if (error) {
      showMsg('loginMsg', '❌ ' + error.message, 'error');
    } else {
      showMsg('loginMsg',
        '✅ Email sent! Check your inbox and click the link to sign in.',
        'success');
    }

    btn.disabled    = false;
    btn.textContent = 'Send sign-in link';
  });
}

// ---- Player init ----
async function initPlayer(session) {
  // 1. Try to find existing profile linked to this auth account
  let { data: player } = await _supabase
    .from('players')
    .select('*')
    .eq('auth_id', session.user.id)
    .maybeSingle();

  if (!player) {
    // 2. Admin may have pre-created a record by email — try to link it
    const { data: byEmail } = await _supabase
      .from('players')
      .select('*')
      .eq('email', session.user.email)
      .is('auth_id', null)
      .maybeSingle();

    if (byEmail) {
      await _supabase.from('players')
        .update({ auth_id: session.user.id })
        .eq('id', byEmail.id);
      player = { ...byEmail, auth_id: session.user.id };
    } else {
      // 3. Completely new user — ask for name + group
      setupProfileForm(session);
      showSection('profile');
      return;
    }
  }

  currentPlayer = player;
  renderMainSection();
  showSection('main');
}

// ---- Profile setup (first login) ----
function setupProfileForm(session) {
  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name      = document.getElementById('profileName').value.trim();
    const groupName = document.getElementById('profileGroup').value;
    const btn       = document.getElementById('profileBtn');

    if (!name || !groupName) return;
    btn.disabled    = true;
    btn.textContent = 'Saving…';

    const { data: newPlayer, error } = await _supabase
      .from('players')
      .insert({ auth_id: session.user.id, name, email: session.user.email, group_name: groupName })
      .select()
      .single();

    if (error) {
      showMsg('profileMsg', '❌ ' + error.message, 'error');
      btn.disabled    = false;
      btn.textContent = 'Save & continue →';
      return;
    }

    currentPlayer = newPlayer;
    renderMainSection();
    showSection('main');
  });
}

// ---- Main section setup ----
function renderMainSection() {
  const grp = GROUPS[currentPlayer.group_name] || { emoji: '🎾', label: currentPlayer.group_name, color: '#C9A84C' };

  // Update hero subtitle
  document.getElementById('heroSubtitle').textContent = 'Season 2 · Your matches & availability';

  // User bar
  document.getElementById('userGreeting').textContent = 'Hey, ' + currentPlayer.name + '!';
  const badge = document.getElementById('userGroupBadge');
  badge.textContent           = grp.emoji + ' ' + grp.label;
  badge.style.setProperty('--badge-color', grp.color);

  // Show admin button if admin
  if (currentPlayer.is_admin) {
    document.getElementById('adminLink').style.display = 'inline-flex';
  }

  // Sign out
  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await _supabase.auth.signOut();
    window.location.reload();
  });

  // Tab switching
  document.querySelectorAll('.mc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mc-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.mc-tab-panel').forEach(p => { p.style.display = 'none'; });
      tab.classList.add('active');
      const panelId = 'tab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1);
      document.getElementById(panelId).style.display = 'block';
    });
  });

  // Load data
  loadSlots();
  loadMyMatches();
}

// ---- Slots ----
async function loadSlots() {
  document.getElementById('slotsLoading').style.display = 'flex';
  document.getElementById('slotsEmpty').style.display   = 'none';
  document.getElementById('slotsList').innerHTML        = '';

  const today = new Date().toISOString().split('T')[0];

  // Fetch open slots for the player's group
  const { data: slots } = await _supabase
    .from('slots')
    .select('*')
    .eq('group_name', currentPlayer.group_name)
    .eq('status', 'open')
    .gte('date', today)
    .order('date').order('time');

  // Fetch my availability
  const { data: avail } = await _supabase
    .from('availability')
    .select('slot_id')
    .eq('player_id', currentPlayer.id);

  myAvailability = new Set((avail || []).map(a => a.slot_id));

  // Fetch player counts per slot
  const slotIds = (slots || []).map(s => s.id);
  const countMap = {};
  if (slotIds.length > 0) {
    const { data: counts } = await _supabase
      .from('availability')
      .select('slot_id')
      .in('slot_id', slotIds);
    (counts || []).forEach(c => {
      countMap[c.slot_id] = (countMap[c.slot_id] || 0) + 1;
    });
  }

  document.getElementById('slotsLoading').style.display = 'none';

  if (!slots || slots.length === 0) {
    document.getElementById('slotsEmpty').style.display = 'block';
    return;
  }

  const container = document.getElementById('slotsList');
  slots.forEach(slot => {
    const count  = countMap[slot.id] || 0;
    const signed = myAvailability.has(slot.id);
    container.appendChild(buildSlotCard(slot, count, signed));
  });
}

function buildSlotCard(slot, playerCount, isSigned) {
  const grp  = GROUPS[slot.group_name] || { emoji: '🎾', label: slot.group_name, color: '#C9A84C' };
  const spots = Math.max(0, 4 - playerCount);
  const pct   = Math.min(Math.round((playerCount / 4) * 100), 100);
  const full  = spots === 0;

  const card = document.createElement('div');
  card.className = 'mc-slot-card fade-in';

  card.innerHTML = `
    <div class="mc-slot-top">
      <div class="mc-slot-date">${formatDate(slot.date)}</div>
      <span class="mc-group-pill" style="--g:${grp.color}">${grp.emoji} ${grp.label}</span>
    </div>
    <div class="mc-slot-meta">
      <span>⏰ ${slot.time.slice(0,5)}</span>
      <span>📍 ${slot.location}</span>
      ${slot.notes ? `<span>💬 ${slot.notes}</span>` : ''}
    </div>
    <div class="mc-slot-bar-wrap">
      <div class="mc-slot-bar"><div class="mc-slot-bar-fill" style="width:${pct}%"></div></div>
      <span class="mc-slot-count">
        ${playerCount}/4
        ${full
          ? '<strong class="mc-full">· Full!</strong>'
          : `· <strong>${spots} spot${spots > 1 ? 's' : ''} left</strong>`}
      </span>
    </div>
    <button class="mc-btn ${isSigned ? 'mc-btn-signed' : 'mc-btn-primary'} mc-join-btn"
            data-slot-id="${slot.id}" data-signed="${isSigned}">
      ${isSigned ? '✓ You\'re in &nbsp;·&nbsp; Cancel' : 'Join this match'}
    </button>
  `;

  card.querySelector('.mc-join-btn').addEventListener('click', () => toggleAvailability(slot.id));
  return card;
}

// ---- Toggle availability ----
async function toggleAvailability(slotId) {
  const btn    = document.querySelector(`.mc-join-btn[data-slot-id="${slotId}"]`);
  const signed = btn.dataset.signed === 'true';
  btn.disabled = true;

  if (signed) {
    const { error } = await _supabase.from('availability').delete()
      .eq('player_id', currentPlayer.id)
      .eq('slot_id', slotId);
    if (!error) {
      myAvailability.delete(slotId);
    }
  } else {
    const { error } = await _supabase.from('availability').insert({
      player_id: currentPlayer.id,
      slot_id:   slotId
    });
    if (!error) {
      myAvailability.add(slotId);
    }
  }

  btn.disabled = false;
  // Refresh the slot list to show updated count
  loadSlots();
}

// ---- My matches ----
async function loadMyMatches() {
  document.getElementById('matchesLoading').style.display = 'flex';
  document.getElementById('matchesEmpty').style.display   = 'none';
  document.getElementById('matchesList').innerHTML        = '';

  const pid = currentPlayer.id;

  const { data: matches } = await _supabase
    .from('matches')
    .select(`
      id, created_at, slot_id,
      slot:slots(id, date, time, location, group_name, notes),
      p1:players!matches_player1_id_fkey(id, name),
      p2:players!matches_player2_id_fkey(id, name),
      p3:players!matches_player3_id_fkey(id, name),
      p4:players!matches_player4_id_fkey(id, name)
    `)
    .or(`player1_id.eq.${pid},player2_id.eq.${pid},player3_id.eq.${pid},player4_id.eq.${pid}`)
    .order('created_at', { ascending: false });

  document.getElementById('matchesLoading').style.display = 'none';

  if (!matches || matches.length === 0) {
    document.getElementById('matchesEmpty').style.display = 'block';
    return;
  }

  const container = document.getElementById('matchesList');
  matches.forEach(m => container.appendChild(buildMatchCard(m)));
}

function buildMatchCard(match) {
  const slot     = match.slot;
  const grp      = GROUPS[slot.group_name] || { emoji: '🎾', label: slot.group_name, color: '#C9A84C' };
  const revealed = isRevealed(slot.date, slot.time);
  const players  = [match.p1, match.p2, match.p3, match.p4].filter(Boolean);

  let playersHTML;
  if (!revealed) {
    playersHTML = `
      <div class="mc-match-hidden">
        🎭 <strong>Blind draw active</strong>
        <span>Opponents revealed on ${revealDateLabel(slot.date, slot.time)}</span>
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
      <span class="mc-match-date">${formatDate(slot.date)} · ${slot.time.slice(0,5)}</span>
      <span class="mc-group-pill" style="--g:${grp.color}">${grp.emoji} ${grp.label}</span>
    </div>
    <div class="mc-match-location">📍 ${slot.location}</div>
    ${playersHTML}
  `;
  return card;
}

// ---- Utilities ----
function showSection(name) {
  ['login', 'profile', 'main'].forEach(s => {
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
