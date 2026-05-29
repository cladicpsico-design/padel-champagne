// ============================================================
// admin.js — Admin panel
// Slots read from Google Sheet; draws + player mgmt via Supabase
// ============================================================

let adminPlayer = null;

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) { window.location.href = 'matches.html'; return; }

  const { data: player } = await _supabase
    .from('players').select('*').eq('auth_id', session.user.id).maybeSingle();

  if (!player || !player.is_admin) {
    document.getElementById('notAdminSection').style.display = '';
    return;
  }

  adminPlayer = player;
  document.getElementById('adminContent').style.display = '';
  loadAdminSlots();
  loadAdminPlayers();
});

// ---- Load all slots from all groups ----
async function loadAdminSlots() {
  document.getElementById('adminSlotsLoading').style.display = 'flex';
  document.getElementById('adminSlotsList').innerHTML = '';

  // Fetch all groups in parallel
  const groupKeys = Object.keys(GROUPS);
  const results   = await Promise.all(groupKeys.map(g => fetchSlotsFromSheet(g)));

  // Flatten with group info
  let allSlots = [];
  groupKeys.forEach((g, i) => {
    results[i].forEach(slot => allSlots.push({ ...slot, group: g }));
  });
  allSlots.sort((a, b) => a.slotKey.localeCompare(b.slotKey));

  // Fetch all availability at once
  const keys = allSlots.map(s => s.slotKey);
  const availMap = {};
  if (keys.length > 0) {
    const { data: avail } = await _supabase
      .from('availability')
      .select('slot_key, player_id, players(id, name)')
      .in('slot_key', keys);
    (avail || []).forEach(a => {
      if (!availMap[a.slot_key]) availMap[a.slot_key] = [];
      availMap[a.slot_key].push({ id: a.player_id, name: a.players?.name || '?' });
    });
  }

  // Fetch already-drawn matches
  const { data: drawn } = await _supabase.from('matches').select('slot_key').in('slot_key', keys);
  const drawnKeys = new Set((drawn || []).map(m => m.slot_key));

  document.getElementById('adminSlotsLoading').style.display = 'none';
  const container = document.getElementById('adminSlotsList');

  if (allSlots.length === 0) {
    container.innerHTML = '<p class="mc-empty-text">No upcoming slots in any group.</p>'; return;
  }

  allSlots.forEach(slot => {
    const players = availMap[slot.slotKey] || [];
    const isDrawn = drawnKeys.has(slot.slotKey);
    const grp     = GROUPS[slot.group] || { emoji:'🎾', label: slot.group, color:'#C9A84C' };
    const canDraw = players.length >= 4 && !isDrawn;

    // Build 4 spot rows for admin (admin sees names)
    let spotsHTML = '';
    for (let i = 0; i < 4; i++) {
      if (i < players.length) {
        spotsHTML += `<div class="mc-spot mc-spot-taken">🎾 ${players[i].name}</div>`;
      } else {
        spotsHTML += `<div class="mc-spot mc-spot-free">🎾 Spot free</div>`;
      }
    }
    if (players.length > 4) {
      spotsHTML += `<div class="mc-spot mc-spot-extra">+${players.length - 4} extra (won't play)</div>`;
    }

    const row = document.createElement('div');
    row.className = 'admin-slot-row';
    row.innerHTML = `
      <div class="admin-slot-info">
        <div class="admin-slot-header">
          <strong>${formatDate(slot.date)} · ${slot.time}</strong>
          <span class="mc-group-pill" style="--g:${grp.color}">${grp.emoji} ${grp.label}</span>
          ${isDrawn
            ? '<span class="admin-status-badge admin-status-drawn">✓ drawn</span>'
            : players.length < 4
              ? `<span class="admin-status-badge admin-status-open">⚠ ${4-players.length} spot${4-players.length>1?'s':''} left</span>`
              : '<span class="admin-status-badge admin-status-open">ready to draw</span>'}
        </div>
        <div class="admin-slot-meta">📍 ${slot.location}</div>
        <div class="mc-spots mc-spots-admin">${spotsHTML}</div>
      </div>
      <div class="admin-slot-actions">
        ${!isDrawn
          ? `<button class="mc-btn ${canDraw ? 'mc-btn-primary' : 'mc-btn-ghost'} admin-draw-btn"
                     data-slot-key="${slot.slotKey}" data-group="${slot.group}"
                     title="${!canDraw ? 'Need 4 players' : 'Run blind draw'}">
               🎲 Draw
             </button>`
          : ''}
      </div>
    `;

    const drawBtn = row.querySelector('.admin-draw-btn');
    if (drawBtn) drawBtn.addEventListener('click', () => runDraw(slot.slotKey, slot.group, players));
    container.appendChild(row);
  });
}

// ---- Blind Draw ----
async function runDraw(slotKey, groupKey, players) {
  if (players.length < 4) { alert('Need at least 4 players.'); return; }

  const parts = slotKey.split('|');
  const ok = confirm(
    `Run blind draw?\n\n${formatDate(parts[0])} · ${parts[1]} · ${parts[2]}\n\n` +
    `Players signed up: ${players.map(p => p.name).join(', ')}\n\n` +
    `4 will be randomly selected. They see opponents 48h before.\nProceed?`
  );
  if (!ok) return;

  // Fisher-Yates shuffle
  const ids = players.map(p => p.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }

  const { error } = await _supabase.from('matches').insert({
    slot_key:   slotKey,
    group_name: groupKey,
    player1_id: ids[0],
    player2_id: ids[1],
    player3_id: ids[2],
    player4_id: ids[3]
  });

  if (error) { alert('Error: ' + error.message); return; }
  alert('✅ Draw done! Players see opponents 48h before the match.');
  loadAdminSlots();
}

// ---- Players list ----
async function loadAdminPlayers() {
  const { data: players } = await _supabase
    .from('players').select('*').order('group_name').order('name');

  document.getElementById('adminPlayersLoading').style.display = 'none';
  const container = document.getElementById('adminPlayersList');
  container.innerHTML = '';

  if (!players || players.length === 0) {
    container.innerHTML = '<p class="mc-empty-text">No players yet.</p>'; return;
  }

  const byGroup = {};
  players.forEach(p => {
    if (!byGroup[p.group_name]) byGroup[p.group_name] = [];
    byGroup[p.group_name].push(p);
  });

  // Build group-options HTML (reusable)
  const groupOptions = Object.entries(GROUPS)
    .map(([k, v]) => `<option value="${k}">${v.emoji} ${v.label}</option>`)
    .join('');

  Object.entries(byGroup).forEach(([key, grpPlayers]) => {
    const grp = GROUPS[key] || { emoji:'🎾', label: key, color:'#C9A84C' };
    const sec = document.createElement('div');
    sec.className = 'admin-group-section';

    const header = document.createElement('div');
    header.className = 'admin-group-header';
    header.style.setProperty('--g', grp.color);
    header.innerHTML = `${grp.emoji} ${grp.label} <span class="admin-group-count">(${grpPlayers.length})</span>`;
    sec.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'admin-players-grid';

    grpPlayers.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'admin-player-chip' + (p.is_admin ? ' admin-player-chip-admin' : '');
      chip.innerHTML = `
        <span class="admin-player-name">${p.name}${p.is_admin ? ' ⭐' : ''}</span>
        <span class="admin-player-email">${p.email}</span>
        <span class="admin-player-linked">${p.auth_id ? '✅ logged in' : '⏳ not yet'}</span>
        <div class="admin-player-actions">
          <select class="admin-group-select">
            ${Object.entries(GROUPS).map(([k, v]) =>
              `<option value="${k}" ${k === p.group_name ? 'selected' : ''}>${v.emoji} ${v.label}</option>`
            ).join('')}
          </select>
          <button class="mc-btn mc-btn-danger admin-remove-btn" title="Remove player">✕</button>
        </div>`;

      // Change group on select
      chip.querySelector('.admin-group-select').addEventListener('change', async (e) => {
        const newGroup = e.target.value;
        if (newGroup === p.group_name) return;
        const { error } = await _supabase.from('players')
          .update({ group_name: newGroup }).eq('id', p.id);
        if (error) { alert('Error: ' + error.message); e.target.value = p.group_name; return; }
        loadAdminPlayers(); // refresh entire list
      });

      // Remove player
      chip.querySelector('.admin-remove-btn').addEventListener('click', async () => {
        if (!confirm(`Remove ${p.name} from the league?\nThis will delete all their availability data too.`)) return;
        const { error } = await _supabase.from('players').delete().eq('id', p.id);
        if (error) { alert('Error: ' + error.message); return; }
        loadAdminPlayers();
      });

      grid.appendChild(chip);
    });

    sec.appendChild(grid);
    container.appendChild(sec);
  });
}
