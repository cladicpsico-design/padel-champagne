// ============================================================
// profile.js — Página de perfil de usuario
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await _supabase.auth.getSession();

  if (!session) {
    document.getElementById('profileHeroSub').textContent = '';
    document.getElementById('notLoggedSection').style.display = '';
    return;
  }

  // Buscar jugador por auth_id
  let { data: player } = await _supabase
    .from('players').select('*').eq('auth_id', session.user.id).maybeSingle();

  if (!player) {
    // Fallback por email
    const { data: byEmail } = await _supabase
      .from('players').select('*').eq('email', session.user.email).maybeSingle();
    player = byEmail;
  }

  if (!player) {
    document.getElementById('profileHeroSub').textContent = '';
    document.getElementById('notLoggedSection').style.display = '';
    return;
  }

  renderProfile(player);
});

function renderProfile(player) {
  const grp = {
    whisky:    { emoji: '🥃', label: 'Whisky',    color: '#C9A84C' },
    champagne: { emoji: '🍾', label: 'Champagne', color: '#D4AF7A' },
    coronita:  { emoji: '🍺', label: 'Coronita',  color: '#6DBF7E' },
    helles:    { emoji: '🍺', label: 'Helles',    color: '#E8C547' },
    weizen:    { emoji: '🌾', label: 'Weizen',    color: '#D4875C' },
  }[player.group_name] || { emoji: '🎾', label: player.group_name, color: '#C9A84C' };

  // Hero
  document.getElementById('profileHeroSub').textContent =
    `${grp.emoji} ${grp.label} · ${player.email || ''}`;

  // Avatar
  const initials = player.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const circle   = document.getElementById('profileAvatarCircle');
  circle.textContent        = initials;
  circle.style.background   = grp.color + '22';
  circle.style.borderColor  = grp.color;
  circle.style.color        = grp.color;

  document.getElementById('profileAvatarName').textContent  = player.name;
  document.getElementById('profileAvatarGroup').innerHTML   =
    `<span style="color:${grp.color}">${grp.emoji} ${grp.label}</span>`;

  // Form values
  document.getElementById('pfName').value  = player.name  || '';
  document.getElementById('pfEmail').value = player.email || '';
  document.getElementById('pfDob').value   = player.date_of_birth || '';

  // Cerrar sesión
  document.getElementById('profileSignOutBtn').addEventListener('click', async () => {
    await _supabase.auth.signOut();
    window.location.href = 'matches.html';
  });

  // Guardar cambios
  document.getElementById('profileEditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName  = document.getElementById('pfName').value.trim();
    const newEmail = document.getElementById('pfEmail').value.trim().toLowerCase();
    const newDob   = document.getElementById('pfDob').value || null;
    const btn      = document.getElementById('profileSaveBtn');
    const msg      = document.getElementById('profileSaveMsg');

    if (!newName || !newEmail) return;
    btn.disabled = true; btn.textContent = 'Guardando…';

    const { error } = await _supabase.from('players')
      .update({ name: newName, email: newEmail, date_of_birth: newDob })
      .eq('id', player.id);

    if (error) {
      msg.textContent = '❌ Error al guardar. Inténtalo de nuevo.';
      msg.className   = 'mc-msg mc-msg-error';
    } else {
      player.name          = newName;
      player.email         = newEmail;
      player.date_of_birth = newDob;
      // Actualizar avatar y nombre
      document.getElementById('profileAvatarName').textContent = newName;
      circle.textContent = newName.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      document.getElementById('profileHeroSub').textContent =
        `${grp.emoji} ${grp.label} · ${newEmail}`;
      msg.textContent = '✅ Cambios guardados correctamente.';
      msg.className   = 'mc-msg mc-msg-success';
    }
    msg.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Guardar cambios';
    setTimeout(() => { msg.style.display = 'none'; }, 4000);
  });

  document.getElementById('profileSection').style.display = '';
}
