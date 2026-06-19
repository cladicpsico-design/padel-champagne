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
  setupCsvImport();
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
        <div class="admin-slot-meta">📍 ${slot.location}${slot.time === 'TBD' ? ' &nbsp;·&nbsp; ⏳ Time TBD' : ''}</div>
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

// ── Season label helper (for player chips) ──────────────────
const SEASON_LABELS_ADMIN = {
  'founder':  '🏆 Founder',
  't2_2025':  'T2 2025',
  't3_2025':  'T3 2025',
  't4_2025':  'T4 2025',
  't1_2026':  'T1 2026',
  't2_2026':  'T2 2026',
  'new':      'New',
};

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
      const seasonLabel  = SEASON_LABELS_ADMIN[p.season_start] || '';
      const payClass     = p.payment_status === 'paid'   ? 'admin-payment-paid'
                         : p.payment_status === 'exempt' ? 'admin-payment-exempt'
                         : 'admin-payment-pending';
      const payLabel     = p.payment_status === 'paid'   ? '💳 Paid'
                         : p.payment_status === 'exempt' ? '✓ Exempt'
                         : '⏳ Pending';

      chip.innerHTML = `
        <span class="admin-player-name">${p.name}${p.is_admin ? ' ⭐' : ''}</span>
        <span class="admin-player-email">${p.email || '<em style="opacity:.5">no email</em>'}</span>
        <span class="admin-player-linked">${p.auth_id ? '✅ logged in' : '⏳ not yet'}</span>
        ${seasonLabel ? `<span class="admin-season-badge">${seasonLabel}</span>` : ''}
        <span class="admin-player-linked ${payClass}" style="margin-top:2px;">${payLabel}${p.referral_discount_earned > 0 ? ` · 🎁 +€${p.referral_discount_earned} credits` : ''}</span>
        <div class="admin-player-actions">
          <select class="admin-group-select">
            ${Object.entries(GROUPS).map(([k, v]) =>
              `<option value="${k}" ${k === p.group_name ? 'selected' : ''}>${v.emoji} ${v.label}</option>`
            ).join('')}
          </select>
          <select class="admin-group-select admin-season-select">
            <option value="">— season —</option>
            ${Object.entries(SEASON_LABELS_ADMIN).map(([k, v]) =>
              `<option value="${k}" ${k === p.season_start ? 'selected' : ''}>${v}</option>`
            ).join('')}
          </select>
          <button class="mc-btn mc-btn-danger admin-remove-btn" title="Remove player">✕</button>
        </div>
        <div class="admin-email-row">
          <input type="email" class="mc-input admin-email-input" placeholder="Add email…" value="${p.email || ''}" style="font-size:.78rem;padding:5px 8px;">
          <button class="mc-btn mc-btn-ghost admin-email-save" style="padding:5px 10px;font-size:.78rem;">Save</button>
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

      // Change season
      chip.querySelector('.admin-season-select').addEventListener('change', async (e) => {
        const newSeason = e.target.value;
        const { error } = await _supabase.from('players').update({ season_start: newSeason || null }).eq('id', p.id);
        if (error) { alert('Error: ' + error.message); e.target.value = p.season_start || ''; return; }
        loadAdminPlayers();
      });

      // Save email
      chip.querySelector('.admin-email-save').addEventListener('click', async () => {
        const newEmail = chip.querySelector('.admin-email-input').value.trim().toLowerCase();
        if (!newEmail || !newEmail.includes('@')) { alert('Enter a valid email.'); return; }
        const { error } = await _supabase.from('players').update({ email: newEmail }).eq('id', p.id);
        if (error) { alert('Error: ' + error.message); return; }
        loadAdminPlayers();
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

// ── CSV Import: set season_start for historical players ─────
const VALID_SEASONS = new Set(['founder','t2_2025','t3_2025','t4_2025','t1_2026','t2_2026','new']);
let csvRows = []; // { email, season_start, matchedId, error }

function setupCsvImport() {
  const fileInput  = document.getElementById('csvFileInput');
  const dropZone   = document.getElementById('csvDropZone');
  const cancelBtn  = document.getElementById('csvCancelBtn');
  const importBtn  = document.getElementById('csvImportBtn');

  // Click on zone opens file picker
  dropZone.addEventListener('click', () => fileInput.click());

  // Drag & drop
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--gold)'; });
  dropZone.addEventListener('dragleave', ()  => { dropZone.style.borderColor = ''; });
  dropZone.addEventListener('drop',  (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file) processCsvFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) processCsvFile(fileInput.files[0]);
    fileInput.value = ''; // reset so same file can be re-selected
  });

  cancelBtn.addEventListener('click', () => {
    csvRows = [];
    document.getElementById('csvPreviewWrap').style.display = 'none';
    document.getElementById('csvPreviewBody').innerHTML = '';
  });

  importBtn.addEventListener('click', runCsvImport);
}

async function processCsvFile(file) {
  const text = await file.text();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  if (lines.length < 2) {
    alert('CSV must have a header row and at least one data row.'); return;
  }

  // Parse header
  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g,''));
  const emailIdx  = header.indexOf('email');
  const seasonIdx = header.indexOf('season_start');

  if (emailIdx === -1 || seasonIdx === -1) {
    alert('CSV must have columns: email, season_start'); return;
  }

  // Parse rows
  const parsed = [];
  for (let i = 1; i < lines.length; i++) {
    const cols    = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g,''));
    const email   = (cols[emailIdx]  || '').toLowerCase().trim();
    const season  = (cols[seasonIdx] || '').toLowerCase().trim();
    if (!email) continue;

    const rowErr = !VALID_SEASONS.has(season)
      ? `Invalid season: "${season}"`
      : null;

    parsed.push({ email, season_start: season, matchedId: null, playerName: null, error: rowErr });
  }

  // Match emails against DB
  if (parsed.filter(r => !r.error).length > 0) {
    const emails = parsed.filter(r => !r.error).map(r => r.email);
    const { data: players } = await _supabase
      .from('players').select('id, name, email').in('email', emails);

    const byEmail = {};
    (players || []).forEach(p => { byEmail[p.email.toLowerCase()] = p; });

    parsed.forEach(row => {
      if (row.error) return;
      const match = byEmail[row.email];
      if (match) {
        row.matchedId   = match.id;
        row.playerName  = match.name;
      } else {
        row.error = 'Not found in DB';
      }
    });
  }

  csvRows = parsed;
  renderCsvPreview();
}

function renderCsvPreview() {
  const body    = document.getElementById('csvPreviewBody');
  const validN  = csvRows.filter(r => r.matchedId).length;

  body.innerHTML = csvRows.map(row => {
    const statusClass = row.matchedId ? 'reg-csv-match'   : 'reg-csv-nomatch';
    const statusText  = row.matchedId ? `✅ ${row.playerName}` : `❌ ${row.error}`;
    return `<tr>
      <td>${row.email}</td>
      <td>${row.season_start}</td>
      <td class="${statusClass}">${statusText}</td>
    </tr>`;
  }).join('');

  document.getElementById('csvImportCount').textContent = validN;
  document.getElementById('csvImportBtn').disabled = validN === 0;
  document.getElementById('csvPreviewWrap').style.display = 'block';
  document.getElementById('csvMsg').style.display = 'none';
}

async function runCsvImport() {
  const validRows = csvRows.filter(r => r.matchedId);
  if (!validRows.length) return;

  const btn = document.getElementById('csvImportBtn');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  let ok = 0, fail = 0;
  for (const row of validRows) {
    const { error } = await _supabase
      .from('players')
      .update({ season_start: row.season_start })
      .eq('id', row.matchedId);
    if (error) { fail++; console.error('Import error:', row.email, error.message); }
    else         ok++;
  }

  const msg = document.getElementById('csvMsg');
  msg.style.display = 'block';
  if (fail === 0) {
    msg.className   = 'mc-msg mc-msg-success';
    msg.textContent = `✅ Updated ${ok} player${ok !== 1 ? 's' : ''} successfully!`;
    setTimeout(() => {
      document.getElementById('csvPreviewWrap').style.display = 'none';
      csvRows = [];
      loadAdminPlayers(); // refresh player list to show new season badges
    }, 1800);
  } else {
    msg.className   = 'mc-msg mc-msg-error';
    msg.textContent = `⚠️ ${ok} updated, ${fail} failed. Check console for details.`;
  }

  btn.disabled    = false;
  btn.textContent = `✅ Import ${validRows.length} players`;
}
