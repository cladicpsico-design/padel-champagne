// ============================================================
// matches.js — Player-facing matches page
// Slots come from Google Sheet; signups stored in Supabase
// ============================================================

let currentPlayer  = null;
let myAvailability = new Set();
let loadedMatches  = [];       // guardado globalmente para el modal de resultados

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) { showSection('login'); setupLoginForm(); return; }
  await initPlayer(session);
});

// ── Login ──────────────────────────────────────────────────────
function setupLoginForm() {
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const btn   = document.getElementById('loginBtn');
    btn.disabled = true; btn.textContent = 'Enviando…';

    const { error } = await _supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + '/matches.html' }
    });

    if (error) showMsg('loginMsg', '❌ ' + error.message, 'error');
    else       showMsg('loginMsg', '✅ Revisa tu email — ¡enlace enviado!', 'success');

    btn.disabled = false; btn.textContent = 'Send sign-in link';
  });
}

// ── Player init ────────────────────────────────────────────────
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

// ── Profile setup ──────────────────────────────────────────────
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

// ── Main section ───────────────────────────────────────────────
function renderMainSection() {
  const grp = GROUPS[currentPlayer.group_name] || { emoji:'🎾', label: currentPlayer.group_name, color:'#C9A84C' };

  document.getElementById('heroSubtitle').textContent = 'Temporada Verano 2026 · Tus partidos y disponibilidad';
  document.getElementById('userGreeting').textContent = '¡Hola, ' + currentPlayer.name + '!';

  const badge = document.getElementById('userGroupBadge');
  badge.textContent = grp.emoji + ' ' + grp.label;
  badge.style.setProperty('--badge-color', grp.color);

  if (currentPlayer.is_admin) document.getElementById('adminLink').style.display = 'inline-flex';

  // Iniciales en el botón de avatar
  const initials = currentPlayer.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const avatarBtn = document.getElementById('profileToggleBtn');
  avatarBtn.textContent = initials;
  avatarBtn.style.borderColor = grp.color;
  avatarBtn.style.color       = grp.color;

  // Banner de código de referido
  if (currentPlayer.referral_code) {
    const refBar = document.getElementById('referralBar');
    if (refBar) {
      document.getElementById('referralCode').textContent = currentPlayer.referral_code;
      const discount = currentPlayer.referral_discount_earned || 0;
      document.getElementById('referralEarned').textContent =
        discount > 0
          ? `Has ganado €${discount} en créditos 🎁`
          : 'Comparte tu código — ganas €10 por cada amigo que se apunte';
      refBar.style.display = 'flex';
    }
  }

  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await _supabase.auth.signOut(); window.location.reload();
  });

  document.querySelectorAll('.mc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mc-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.mc-tab-panel').forEach(p => { p.style.display = 'none'; });
      tab.classList.add('active');
      const panelId = 'tab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1);
      document.getElementById(panelId).style.display = 'block';
      if (tab.dataset.tab === 'mymatch') loadMyMatches();
      if (tab.dataset.tab === 'slots')   loadSlots();
    });
  });

  // Avatar button → toggle profile panel
  document.getElementById('profileToggleBtn').addEventListener('click', toggleProfilePanel);

  loadSlots();
  loadMyMatches();
}

// ── Load slots ─────────────────────────────────────────────────
async function loadSlots() {
  document.getElementById('slotsLoading').style.display = 'flex';
  document.getElementById('slotsEmpty').style.display   = 'none';
  document.getElementById('slotsList').innerHTML        = '';

  const groupKeys = Object.keys(GROUPS);
  const results   = await Promise.all(groupKeys.map(g => fetchSlotsFromSheet(g)));

  let allSlots = [];
  groupKeys.forEach((g, i) => {
    results[i].forEach(slot => allSlots.push({ ...slot, group: g }));
  });
  allSlots.sort((a, b) => a.slotKey.localeCompare(b.slotKey));

  const myGroup    = (currentPlayer.group_name || '').toLowerCase();
  const mySlots    = allSlots.filter(s => s.group.toLowerCase() === myGroup);
  const otherSlots = allSlots.filter(s => s.group.toLowerCase() !== myGroup);

  const { data: avail } = await _supabase
    .from('availability').select('slot_key').eq('player_id', currentPlayer.id);
  myAvailability = new Set((avail || []).map(a => a.slot_key));

  const countMap = {};
  const openKeys = mySlots.filter(s => s.sheetPlayerCount < 4).map(s => s.slotKey);
  if (openKeys.length > 0) {
    const { data: counts } = await _supabase
      .from('availability').select('slot_key').in('slot_key', openKeys);
    (counts || []).forEach(c => { countMap[c.slot_key] = (countMap[c.slot_key] || 0) + 1; });
  }

  document.getElementById('slotsLoading').style.display = 'none';

  if (allSlots.length === 0) {
    document.getElementById('slotsEmpty').style.display = 'block'; return;
  }

  const container = document.getElementById('slotsList');
  const myGrp = GROUPS[currentPlayer.group_name] || { emoji:'🎾', label: currentPlayer.group_name, color:'#C9A84C' };

  if (mySlots.length > 0) {
    const sec = document.createElement('div');
    sec.className = 'mc-section-header';
    sec.innerHTML = `<span style="color:${myGrp.color}">${myGrp.emoji} ${myGrp.label}</span> — Tu grupo`;
    container.appendChild(sec);

    mySlots.forEach(slot => {
      const signupCount = countMap[slot.slotKey] || 0;
      const taken  = (slot.sheetPlayerCount || 0) > 0 ? (slot.sheetPlayerCount || 0) : signupCount;
      const signed = myAvailability.has(slot.slotKey);
      const isOpen = (slot.sheetPlayerCount || 0) < 4;
      container.appendChild(buildSlotCard(slot, taken, signed, myGrp, isOpen));
    });
  }

  if (otherSlots.length > 0) {
    const sec = document.createElement('div');
    sec.className = 'mc-section-header mc-section-league';
    sec.innerHTML = `🗓️ Otros partidos`;
    container.appendChild(sec);

    const byDate = {};
    otherSlots.forEach(s => {
      if (!byDate[s.date]) byDate[s.date] = [];
      byDate[s.date].push(s);
    });

    Object.entries(byDate).forEach(([date, slots]) => {
      const dayWrap = document.createElement('div');
      dayWrap.className = 'mc-day-group';

      const dayHdr = document.createElement('div');
      dayHdr.className = 'mc-day-header';
      dayHdr.textContent = formatDate(date);
      dayWrap.appendChild(dayHdr);

      slots.forEach(slot => {
        const grp = GROUPS[slot.group] || { emoji:'🎾', label: slot.group, color:'#C9A84C' };
        dayWrap.appendChild(buildCompactRow(slot, grp));
      });

      container.appendChild(dayWrap);
    });
  }
}

// ── Full card — own group ──────────────────────────────────────
function buildSlotCard(slot, takenCount, isSigned, grp, isOpen) {
  const card = document.createElement('div');
  card.className = 'mc-slot-card';

  let spotsHTML = '';
  for (let i = 0; i < 4; i++) {
    spotsHTML += i < takenCount
      ? `<div class="mc-spot mc-spot-taken">🎾 Taken</div>`
      : `<div class="mc-spot mc-spot-free">🎾 Spot free</div>`;
  }

  let actionHTML = '';
  if (isOpen) {
    actionHTML = `<button class="mc-btn ${isSigned ? 'mc-btn-signed' : 'mc-btn-primary'} mc-join-btn"
      data-slot-key="${slot.slotKey}" data-signed="${isSigned}">
      ${isSigned ? '✓ You\'re in &nbsp;·&nbsp; Cancel' : 'Join this match'}
    </button>`;
  } else {
    actionHTML = `<div class="mc-slot-assigned">✅ Match assigned</div>`;
  }

  const timeStr = slot.time === 'TBD'
    ? '<span class="mc-time-tbd">⏳ Time TBD</span>'
    : `<strong>${slot.time}</strong>`;

  card.innerHTML = `
    <div class="mc-slot-top">
      <span class="mc-slot-date">${formatDate(slot.date)}</span>
      <span class="mc-group-pill" style="--g:${grp.color}">${grp.emoji} ${grp.label}</span>
    </div>
    <div class="mc-slot-time-loc">⏰ ${timeStr} &nbsp;·&nbsp; 📍 ${slot.location}</div>
    <div class="mc-spots">${spotsHTML}</div>
    ${actionHTML}
  `;

  if (isOpen) {
    card.querySelector('.mc-join-btn').addEventListener('click', () => toggleAvailability(slot.slotKey));
  }
  return card;
}

// ── Compact row — other groups ─────────────────────────────────
function buildCompactRow(slot, grp) {
  const row = document.createElement('div');
  row.className = 'mc-compact-row';

  const free = 4 - slot.sheetPlayerCount;
  const statusClass = free === 0 ? 'mc-compact-full' : free === 4 ? 'mc-compact-open' : 'mc-compact-partial';
  const statusText  = free === 0 ? 'Full' : free === 4 ? '4 free' : `${free} free`;
  const timeLabel   = slot.time === 'TBD' ? '⏳' : slot.time;

  row.innerHTML = `
    <span class="mc-group-pill mc-group-pill-sm" style="--g:${grp.color}">${grp.emoji} ${grp.label}</span>
    <span class="mc-compact-loc">📍 ${slot.location}</span>
    <span class="mc-compact-time">${timeLabel}</span>
    <span class="mc-compact-status ${statusClass}">${statusText}</span>
  `;
  return row;
}

// ── Toggle availability ────────────────────────────────────────
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
  loadSlots();
  loadMyMatches();
}

// ── My Matches ─────────────────────────────────────────────────
async function loadMyMatches() {
  document.getElementById('matchesLoading').style.display = 'flex';
  document.getElementById('matchesEmpty').style.display   = 'none';
  document.getElementById('matchesList').innerHTML        = '';

  const pid = currentPlayer.id;

  const [{ data: matches }, { data: signups }] = await Promise.all([
    _supabase.from('matches')
      .select(`*, p1:players!matches_player1_id_fkey(id,name), p2:players!matches_player2_id_fkey(id,name),
               p3:players!matches_player3_id_fkey(id,name), p4:players!matches_player4_id_fkey(id,name)`)
      .or(`player1_id.eq.${pid},player2_id.eq.${pid},player3_id.eq.${pid},player4_id.eq.${pid}`)
      .order('created_at', { ascending: false }),
    _supabase.from('availability')
      .select('slot_key')
      .eq('player_id', pid)
      .order('slot_key')
  ]);

  loadedMatches = matches || [];

  // Fetch results for all matches in one query
  let resultMap = {};
  if (loadedMatches.length > 0) {
    const { data: results } = await _supabase
      .from('match_results')
      .select('*')
      .in('match_id', loadedMatches.map(m => m.id));
    (results || []).forEach(r => { resultMap[r.match_id] = r; });
  }

  document.getElementById('matchesLoading').style.display = 'none';

  const drawnKeys   = new Set(loadedMatches.map(m => m.slot_key));
  const pendingList = (signups || []).filter(s => !drawnKeys.has(s.slot_key));
  const hasContent  = loadedMatches.length > 0 || pendingList.length > 0;

  if (!hasContent) {
    document.getElementById('matchesEmpty').style.display = 'block'; return;
  }

  const container = document.getElementById('matchesList');

  if (loadedMatches.length > 0) {
    const hdr = document.createElement('div');
    hdr.className = 'mc-section-header';
    hdr.textContent = '✅ Partidos confirmados';
    container.appendChild(hdr);
    loadedMatches.forEach(m => container.appendChild(buildMatchCard(m, resultMap[m.id] || null)));
  }

  if (pendingList.length > 0) {
    const hdr = document.createElement('div');
    hdr.className = 'mc-section-header';
    hdr.textContent = '⏳ Apuntado — esperando sorteo';
    container.appendChild(hdr);
    pendingList.forEach(s => container.appendChild(buildPendingCard(s.slot_key)));
  }
}

// ── Pending card ───────────────────────────────────────────────
function buildPendingCard(slotKey) {
  const parts    = slotKey.split('|');
  const date     = parts[0] || '';
  const time     = parts[1] || '';
  const location = parts[2] || '';

  const card = document.createElement('div');
  card.className = 'mc-match-card';
  card.innerHTML = `
    <div class="mc-match-header">
      <span class="mc-match-date">${formatDate(date)} · ${time === 'TBD' ? '⏳ TBD' : time}</span>
    </div>
    <div class="mc-match-location">📍 ${location}</div>
    <div class="mc-match-hidden">
      🎲 <strong>Sorteo pendiente</strong>
      <span>Estás apuntado — los rivales se asignan cuando corra el sorteo</span>
    </div>
  `;
  return card;
}

// ── Match card ─────────────────────────────────────────────────
function buildMatchCard(match, result) {
  const parts    = match.slot_key.split('|');
  const date     = parts[0] || '';
  const time     = parts[1] || '';
  const location = parts[2] || '';
  const grp      = GROUPS[match.group_name] || { emoji:'🎾', label: match.group_name, color:'#C9A84C' };
  const revealed = isRevealed(date, time);
  const players  = [match.p1, match.p2, match.p3, match.p4].filter(Boolean);

  // Is the match date/time already past?
  const matchDateTime = new Date(date + 'T' + (time !== 'TBD' ? time : '23:59') + ':00');
  const isPast = matchDateTime < new Date();

  // Teams display
  let playersHTML;
  if (!revealed) {
    playersHTML = `
      <div class="mc-match-hidden">
        🎭 <strong>Sorteo activo</strong>
        <span>Rivales revelados el ${revealDateLabel(date, time)}</span>
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

  // Result section — only if match has been revealed AND is in the past
  let resultHTML = '';
  if (revealed && isPast) {
    const playerIds = [match.player1_id, match.player2_id, match.player3_id, match.player4_id];
    const imInMatch = playerIds.includes(currentPlayer.id);

    if (!result) {
      // No result yet — show entry button only if I'm in the match
      if (imInMatch) {
        resultHTML = `
          <div class="mc-result-section">
            <button class="mc-btn mc-btn-ghost mc-result-enter-btn"
                    data-match-id="${match.id}">
              🎾 Introduce el resultado
            </button>
          </div>`;
      }
    } else if (result.status === 'pending') {
      const scoreStr = formatScore(result);
      const winnerName = result.winner_team === 1
        ? `${match.p1?.name} / ${match.p2?.name}`
        : `${match.p3?.name} / ${match.p4?.name}`;
      const isSubmitter = result.submitted_by === currentPlayer.id;
      const canConfirm  = imInMatch && !isSubmitter;

      if (isSubmitter) {
        resultHTML = `
          <div class="mc-result-section mc-result-pending">
            <span class="mc-result-score">${scoreStr}</span>
            <span class="mc-result-status-tag">⏳ Esperando confirmación</span>
          </div>`;
      } else if (canConfirm) {
        resultHTML = `
          <div class="mc-result-section mc-result-confirm">
            <div class="mc-result-score">${scoreStr} · 🏆 ${winnerName}</div>
            <button class="mc-btn mc-btn-primary mc-result-confirm-btn"
                    data-result-id="${result.id}" style="margin-top:8px;">
              ✅ Confirmar resultado
            </button>
          </div>`;
      } else {
        resultHTML = `
          <div class="mc-result-section mc-result-pending">
            <span class="mc-result-score">${scoreStr}</span>
            <span class="mc-result-status-tag">⏳ Pendiente confirmación</span>
          </div>`;
      }
    } else if (result.status === 'confirmed') {
      const scoreStr = formatScore(result);
      const winnerName = result.winner_team === 1
        ? `${match.p1?.name} / ${match.p2?.name}`
        : `${match.p3?.name} / ${match.p4?.name}`;
      resultHTML = `
        <div class="mc-result-section mc-result-final">
          <span class="mc-result-score">${scoreStr}</span>
          <span class="mc-result-winner">🏆 ${winnerName}</span>
        </div>`;
    }
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
    ${resultHTML}
  `;

  // Wire up buttons after DOM insert
  const enterBtn = card.querySelector('.mc-result-enter-btn');
  if (enterBtn) enterBtn.addEventListener('click', () => openResultModal(match.id));

  const confirmBtn = card.querySelector('.mc-result-confirm-btn');
  if (confirmBtn) confirmBtn.addEventListener('click', () => confirmResult(result.id));

  return card;
}

// ── Score formatter ────────────────────────────────────────────
function formatScore(result) {
  const sets = [`${result.set1_team1}–${result.set1_team2}`];
  if (result.set2_team1 != null) sets.push(`${result.set2_team1}–${result.set2_team2}`);
  if (result.set3_team1 != null) sets.push(`${result.set3_team1}–${result.set3_team2}`);
  return sets.join(' · ');
}

// ── Result modal ───────────────────────────────────────────────

let currentResultMatchId = null;

function openResultModal(matchId) {
  const match = loadedMatches.find(m => m.id === matchId);
  if (!match) return;

  currentResultMatchId = matchId;

  document.getElementById('resultTeam1Names').textContent =
    `${match.p1?.name || '?'} + ${match.p2?.name || '?'}`;
  document.getElementById('resultTeam2Names').textContent =
    `${match.p3?.name || '?'} + ${match.p4?.name || '?'}`;

  // Reset inputs
  ['res_s1t1','res_s1t2','res_s2t1','res_s2t2','res_s3t1','res_s3t2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('res_set3row').style.display    = 'none';
  document.getElementById('resultWinnerPreview').style.display = 'none';
  document.getElementById('resultWinnerPreview').textContent   = '';
  document.getElementById('resultModalMsg').style.display = 'none';

  const btn = document.getElementById('resultSubmitBtn');
  btn.disabled = false;
  btn.textContent = '✅ Guardar resultado';

  document.getElementById('resultModal').style.display = 'flex';
}

function closeResultModal(e) {
  // If called from overlay click, only close when clicking the overlay itself
  if (e && e.target !== document.getElementById('resultModal')) return;
  document.getElementById('resultModal').style.display = 'none';
  currentResultMatchId = null;
}

function closeResultModalDirect() {
  document.getElementById('resultModal').style.display = 'none';
  currentResultMatchId = null;
}

function onScoreInput() {
  const s1t1 = parseInt(document.getElementById('res_s1t1').value);
  const s1t2 = parseInt(document.getElementById('res_s1t2').value);
  const s2t1 = parseInt(document.getElementById('res_s2t1').value);
  const s2t2 = parseInt(document.getElementById('res_s2t2').value);

  const set1ok = !isNaN(s1t1) && !isNaN(s1t2) && s1t1 !== s1t2;
  const set2ok = !isNaN(s2t1) && !isNaN(s2t2) && s2t1 !== s2t2;

  const winnerEl = document.getElementById('resultWinnerPreview');
  winnerEl.style.display = 'none';

  if (set1ok && set2ok) {
    const w1 = s1t1 > s1t2 ? 1 : 2;
    const w2 = s2t1 > s2t2 ? 1 : 2;

    if (w1 === w2) {
      // Winner determined after 2 sets
      document.getElementById('res_set3row').style.display = 'none';
      showWinnerPreview(w1);
    } else {
      // Split — need set 3
      document.getElementById('res_set3row').style.display = 'grid';
    }
  }

  // Check set 3
  const s3t1 = parseInt(document.getElementById('res_s3t1').value);
  const s3t2 = parseInt(document.getElementById('res_s3t2').value);
  if (!isNaN(s3t1) && !isNaN(s3t2) && s3t1 !== s3t2) {
    showWinnerPreview(s3t1 > s3t2 ? 1 : 2);
  }
}

function showWinnerPreview(team) {
  const match = loadedMatches.find(m => m.id === currentResultMatchId);
  if (!match) return;
  const name = team === 1
    ? `${match.p1?.name} / ${match.p2?.name}`
    : `${match.p3?.name} / ${match.p4?.name}`;
  const el = document.getElementById('resultWinnerPreview');
  el.textContent = `🏆 Ganador: ${name}`;
  el.style.display = 'block';
}

async function submitResult() {
  if (!currentResultMatchId) return;

  const s1t1 = parseInt(document.getElementById('res_s1t1').value);
  const s1t2 = parseInt(document.getElementById('res_s1t2').value);
  const s2t1 = parseInt(document.getElementById('res_s2t1').value);
  const s2t2 = parseInt(document.getElementById('res_s2t2').value);
  const s3t1 = parseInt(document.getElementById('res_s3t1').value);
  const s3t2 = parseInt(document.getElementById('res_s3t2').value);

  // Validaciones
  if (isNaN(s1t1) || isNaN(s1t2)) {
    showModalMsg('❌ Introduce el marcador del set 1.', 'error'); return;
  }
  if (s1t1 === s1t2) {
    showModalMsg('❌ El set 1 no puede empatar.', 'error'); return;
  }
  if (isNaN(s2t1) || isNaN(s2t2)) {
    showModalMsg('❌ Introduce el marcador del set 2.', 'error'); return;
  }
  if (s2t1 === s2t2) {
    showModalMsg('❌ El set 2 no puede empatar.', 'error'); return;
  }

  const w1 = s1t1 > s1t2 ? 1 : 2;
  const w2 = s2t1 > s2t2 ? 1 : 2;
  let winner_team;

  if (w1 === w2) {
    winner_team = w1;
  } else {
    // Necesita set 3
    if (isNaN(s3t1) || isNaN(s3t2)) {
      showModalMsg('❌ Introduce el marcador del set 3 (sets empatados a 1).', 'error'); return;
    }
    if (s3t1 === s3t2) {
      showModalMsg('❌ El set 3 no puede empatar.', 'error'); return;
    }
    winner_team = s3t1 > s3t2 ? 1 : 2;
  }

  const btn = document.getElementById('resultSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  const payload = {
    match_id:     currentResultMatchId,
    set1_team1:   s1t1,
    set1_team2:   s1t2,
    set2_team1:   s2t1,
    set2_team2:   s2t2,
    winner_team,
    submitted_by: currentPlayer.id,
    status:       'pending',
  };
  if (!isNaN(s3t1) && !isNaN(s3t2)) {
    payload.set3_team1 = s3t1;
    payload.set3_team2 = s3t2;
  }

  const { error } = await _supabase.from('match_results').insert(payload);

  if (error) {
    showModalMsg('❌ Error: ' + error.message, 'error');
    btn.disabled = false;
    btn.textContent = '✅ Guardar resultado';
    return;
  }

  closeResultModalDirect();
  loadMyMatches();
}

async function confirmResult(resultId) {
  const { error } = await _supabase
    .from('match_results')
    .update({
      status:       'confirmed',
      confirmed_by: currentPlayer.id,
      confirmed_at: new Date().toISOString()
    })
    .eq('id', resultId);

  if (error) { alert('Error al confirmar: ' + error.message); return; }
  loadMyMatches();
}

function showModalMsg(text, type) {
  const el = document.getElementById('resultModalMsg');
  el.textContent = text;
  el.className   = 'mc-msg mc-msg-' + type;
  el.style.display = 'block';
}

// ── Profile panel ──────────────────────────────────────────────

const SEASON_LABELS_PROFILE = {
  'founder':  'T1 2025 · Founder',
  't2_2025':  'T2 2025',
  't3_2025':  'T3 2025',
  't4_2025':  'T4 2025',
  't1_2026':  'T1 2026',
  't2_2026':  'T2 2026',
  'new':      'Nuevo jugador',
};

let profileLoaded = false;

function toggleProfilePanel() {
  const panel = document.getElementById('profilePanel');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen && !profileLoaded) renderProfilePanel();
}

async function renderProfilePanel() {
  const p   = currentPlayer;
  const grp = GROUPS[p.group_name] || { emoji: '🎾', label: p.group_name, color: '#C9A84C' };

  // Avatar iniciales
  const initials = p.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const avatarEl = document.getElementById('mcpAvatar');
  avatarEl.textContent = initials;
  avatarEl.style.background = grp.color + '22';
  avatarEl.style.borderColor = grp.color;
  avatarEl.style.color = grp.color;

  document.getElementById('mcpName').textContent  = p.name;
  document.getElementById('mcpGroup').innerHTML   = `${grp.emoji} ${grp.label}`;
  document.getElementById('mcpGroup').style.color = grp.color;

  // Datos de cuenta
  document.getElementById('mcpEmail').textContent  = p.email || '—';
  document.getElementById('mcpPhone').textContent  = p.phone || '—';
  document.getElementById('mcpSeason').textContent = SEASON_LABELS_PROFILE[p.season_start] || '—';
  document.getElementById('mcpStatus').textContent =
    p.payment_status === 'paid'   ? '✅ Pagado'  :
    p.payment_status === 'exempt' ? '✅ Exento'  : '⏳ Pendiente';

  // Código de referido
  if (p.referral_code) {
    document.getElementById('mcpRefSection').style.display = '';
    document.getElementById('mcpRefCode').textContent = p.referral_code;
    document.getElementById('mcpRefEarned').textContent =
      `€${p.referral_discount_earned || 0}`;
    document.getElementById('mcpRefCopyBtn').onclick = () => {
      navigator.clipboard.writeText(p.referral_code).then(() => {
        const btn = document.getElementById('mcpRefCopyBtn');
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
      });
    };
  }

  // Stats desde Supabase
  try {
    const { data } = await _supabase.rpc('get_group_standings', { p_group: p.group_name });
    const s = (data || []).find(r => r.player_id === p.id);
    document.getElementById('mcpPJ').textContent  = s ? s.pj      : '0';
    document.getElementById('mcpW').textContent   = s ? s.ganados  : '0';
    document.getElementById('mcpL').textContent   = s ? s.perdidos : '0';
    document.getElementById('mcpPts').textContent = s ? s.pts      : '0';
  } catch (_) {}

  profileLoaded = true;
}

// ── Referral code copy ─────────────────────────────────────────
function copyReferralCode() {
  const code = document.getElementById('referralCode').textContent;
  const btn  = document.getElementById('referralCopyBtn');
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
}

// ── Utilities ──────────────────────────────────────────────────
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
