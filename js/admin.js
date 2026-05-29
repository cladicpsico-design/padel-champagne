// ============================================================
// admin.js — Admin panel logic
// ============================================================

let adminPlayer = null;

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) { window.location.href = 'matches.html'; return; }

  const { data: player } = await _supabase
    .from('players').select('*')
    .eq('auth_id', session.user.id)
    .maybeSingle();

  if (!player || !player.is_admin) {
    document.getElementById('notAdminSection').style.display = '';
    return;
  }

  adminPlayer = player;
  document.getElementById('adminContent').style.display = '';
  setupCreateSlot();
  loadAdminSlots();
  loadAdminPlayers();
});

// ---- Create slot ----
function setupCreateSlot() {
  document.getElementById('createSlotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('createSlotBtn');
    btn.disabled = true; btn.textContent = 'Creating…';

    const { error } = await _supabase.from('slots').insert({
      date:       document.getElementById('slotDate').value,
      time:       document.getElementById('slotTime').value,
      location:   document.getElementById('slotLocation').value.trim(),
      group_name: document.getElementById('slotGroup').value,
      notes:      document.getElementById('slotNotes').value.trim() || null
    });

    if (error) {
      showAdminMsg('createSlotMsg', '❌ ' + error.message, 'error');
    } else {
      showAdminMsg('createSlotMsg', '✅ Slot created!', 'success');
      document.getElementById('createSlotForm').reset();
      loadAdminSlots();
    }
    btn.disabled = false; btn.textContent = 'Create slot';
  });
}

// ---- Load all upcoming slots ----
async function loadAdminSlots() {
  document.getElementById('adminSlotsLoading').style.display = 'flex';
  document.getElementById('adminSlotsList').innerHTML = '';

  const today = new Date().toISOString().split('T')[0];
  const { data: slots } = await _supabase
    .from('slots').select('*')
    .gte('date', today)
    .order('date').order('time');

  // Fetch all availability at once
  const slotIds = (slots || []).map(s => s.id);
  let availMap = {};
  if (slotIds.length > 0) {
    const { data: avail } = await _supabase
      .from('availability')
      .select('slot_id, player_id, players(name)')
      .in('slot_id', slotIds);
    (avail || []).forEach(a => {
      if (!availMap[a.slot_id]) availMap[a.slot_id] = [];
      availMap[a.slot_id].push({ id: a.player_id, name: a.players?.name || '?' });
    });
  }

  document.getElementById('adminSlotsLoading').style.display = 'none';
  const container = document.getElementById('adminSlotsList');

  if (!slots || slots.length === 0) {
    container.innerHTML = '<p class="mc-empty-text">No upcoming slots.</p>';
    return;
  }

  slots.forEach(slot => {
    const players = availMap[slot.id] || [];
    const grp     = GROUPS[slot.group_name] || { emoji: '🎾', label: slot.group_name, color: '#C9A84C' };
    const canDraw = players.length >= 4 && slot.status === 'open';
    const isDrawn = slot.status === 'drawn';
    const pct     = Math.min(Math.round((players.length / 4) * 100), 100);

    const row = document.createElement('div');
    row.className = 'admin-slot-row';
    row.innerHTML = `
      <div class="admin-slot-info">
        <div class="admin-slot-header">
          <strong>${formatDate(slot.date)} · ${slot.time.slice(0,5)}</strong>
          <span class="mc-group-pill" style="--g:${grp.color}">${grp.emoji} ${grp.label}</span>
          <span class="admin-status-badge admin-status-${slot.status}">${slot.status}</span>
        </div>
        <div class="admin-slot-meta">
          📍 ${slot.location}${slot.notes ? ' · ' + slot.notes : ''}
        </div>
        <div class="mc-slot-bar-wrap" style="margin-top:8px">
          <div class="mc-slot-bar"><div class="mc-slot-bar-fill" style="width:${pct}%"></div></div>
          <span class="mc-slot-count">
            <strong>${players.length}/4</strong>:
            ${players.length > 0 ? players.map(p => p.name).join(', ') : 'nobody yet'}
            ${players.length < 4 && slot.status === 'open'
              ? `<span class="admin-warn"> ⚠ Need ${4 - players.length} more</span>`
              : ''}
          </span>
        </div>
      </div>
      <div class="admin-slot-actions">
        ${!isDrawn && slot.status === 'open'
          ? `<button class="mc-btn ${canDraw ? 'mc-btn-primary' : 'mc-btn-ghost'} admin-draw-btn"
                    data-slot-id="${slot.id}" title="${!canDraw ? 'Need 4 players to draw' : 'Run blind draw'}">
               🎲 Draw
             </button>` : ''}
        ${isDrawn ? '<span class="mc-btn mc-btn-ghost" style="cursor:default;opacity:.6">✓ Drawn</span>' : ''}
        <button class="mc-btn mc-btn-danger admin-del-btn" data-slot-id="${slot.id}">Delete</button>
      </div>
    `;

    row.querySelector('.admin-del-btn')
       .addEventListener('click', () => deleteSlot(slot.id));
    const drawBtn = row.querySelector('.admin-draw-btn');
    if (drawBtn) drawBtn.addEventListener('click', () => runDraw(slot.id, players));

    container.appendChild(row);
  });
}

// ---- Blind draw ----
async function runDraw(slotId, players) {
  if (players.length < 4) {
    alert('Need at least 4 players to run the draw.');
    return;
  }

  const ok = confirm(
    `Run blind draw for this slot?\n\n` +
    `Players: ${players.map(p => p.name).join(', ')}\n\n` +
    `The first 4 will be randomly assigned. ` +
    `They will see their opponents 48h before the match.\n\nProceed?`
  );
  if (!ok) return;

  // Fisher-Yates shuffle of player IDs
  const ids = players.map(p => p.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const [p1, p2, p3, p4] = ids;

  // Insert match
  const { error: me } = await _supabase.from('matches').insert({
    slot_id: slotId, player1_id: p1, player2_id: p2,
    player3_id: p3, player4_id: p4
  });
  if (me) { alert('Error creating match: ' + me.message); return; }

  // Close slot
  await _supabase.from('slots').update({ status: 'drawn' }).eq('id', slotId);

  alert('✅ Draw complete! Players will see their opponents 48h before the match.');
  loadAdminSlots();
}

// ---- Delete slot ----
async function deleteSlot(slotId) {
  if (!confirm('Delete this slot? This cannot be undone.')) return;
  await _supabase.from('slots').delete().eq('id', slotId);
  loadAdminSlots();
}

// ---- Players list ----
async function loadAdminPlayers() {
  const { data: players } = await _supabase
    .from('players').select('*')
    .order('group_name').order('name');

  document.getElementById('adminPlayersLoading').style.display = 'none';
  const container = document.getElementById('adminPlayersList');

  if (!players || players.length === 0) {
    container.innerHTML = '<p class="mc-empty-text">No players registered yet.</p>';
    return;
  }

  // Group by league group
  const byGroup = {};
  players.forEach(p => {
    if (!byGroup[p.group_name]) byGroup[p.group_name] = [];
    byGroup[p.group_name].push(p);
  });

  Object.entries(byGroup).forEach(([grpKey, grpPlayers]) => {
    const grp = GROUPS[grpKey] || { emoji: '🎾', label: grpKey, color: '#C9A84C' };
    const section = document.createElement('div');
    section.className = 'admin-group-section';
    section.innerHTML = `
      <div class="admin-group-header" style="--g:${grp.color}">
        ${grp.emoji} ${grp.label} <span class="admin-group-count">(${grpPlayers.length})</span>
      </div>
      <div class="admin-players-grid">
        ${grpPlayers.map(p => `
          <div class="admin-player-chip ${p.is_admin ? 'admin-player-chip-admin' : ''}">
            <span class="admin-player-name">${p.name}${p.is_admin ? ' ⭐' : ''}</span>
            <span class="admin-player-email">${p.email}</span>
            <span class="admin-player-linked">${p.auth_id ? '✅ linked' : '⏳ not logged in yet'}</span>
          </div>`).join('')}
      </div>
    `;
    container.appendChild(section);
  });
}

// ---- Util ----
function showAdminMsg(id, text, type) {
  const el = document.getElementById(id);
  el.style.display = 'block';
  el.textContent   = text;
  el.className     = 'mc-msg mc-msg-' + type;
}
