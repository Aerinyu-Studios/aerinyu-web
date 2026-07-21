const $ = (selector) => document.querySelector(selector);
let adminKey = sessionStorage.getItem('friendship_run_admin_key') || '';
let entries = [];

const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(path = '', options = {}) {
  const response = await fetch(`/api/friendship-run/admin${path}`, {
    ...options,
    headers: {
      ...(options.body ? {'Content-Type':'application/json'} : {}),
      'x-admin-key': adminKey,
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

function render() {
  const query = $('#adminSearch').value.trim().toLowerCase();
  const filtered = entries.filter(e => `${e.name} ${e.student_id}`.toLowerCase().includes(query));
  $('#adminEntries').innerHTML = filtered.length ? filtered.map(entry => `
    <article class="panel fr-admin-entry" data-id="${entry.id}">
      <div class="fr-admin-entry-main">
        ${entry.photo_url ? `<img class="admin-avatar" src="${esc(entry.photo_url)}" alt="">` : `<div class="admin-avatar fallback">${esc(entry.name?.[0] || '?')}</div>`}
        <div><strong>${esc(entry.name)}</strong><span>${esc(entry.student_id)}</span></div>
      </div>
      <div class="fr-admin-meta"><span>Score <b>${entry.best_score ?? 0}</b></span><span>${entry.attempt_used ? 'Submitted' : 'Open attempt'}</span><span>${entry.payment_confirmed ? 'Paid' : 'Unconfirmed'}</span></div>
      <div class="fr-admin-actions">
        <button class="button secondary" data-edit type="button">Edit</button>
        <button class="button secondary" data-reset type="button">Reset attempt</button>
        <button class="button danger" data-delete type="button">Delete</button>
      </div>
    </article>`).join('') : '<p class="empty-copy">No matching entries.</p>';

  document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', editEntry));
  document.querySelectorAll('[data-reset]').forEach(button => button.addEventListener('click', resetEntry));
  document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', deleteEntry));
}

async function loadEntries() {
  const data = await api();
  entries = data.entries || [];
  render();
}

async function editEntry(event) {
  const card = event.target.closest('[data-id]');
  const entry = entries.find(item => String(item.id) === card.dataset.id);
  const name = prompt('Player name', entry.name);
  if (name === null) return;
  const studentId = prompt('Student ID', entry.student_id);
  if (studentId === null) return;
  const scoreText = prompt('Score', String(entry.best_score ?? 0));
  if (scoreText === null) return;
  await api(`?id=${encodeURIComponent(entry.id)}`, {method:'PATCH', body:JSON.stringify({name, student_id:studentId, best_score:Number(scoreText), attempt_used:true})});
  await loadEntries();
}

async function resetEntry(event) {
  const id = event.target.closest('[data-id]').dataset.id;
  if (!confirm('Reset this player\'s attempt and score?')) return;
  await api(`?id=${encodeURIComponent(id)}`, {method:'PATCH', body:JSON.stringify({reset_attempt:true})});
  await loadEntries();
}

async function deleteEntry(event) {
  const id = event.target.closest('[data-id]').dataset.id;
  if (!confirm('Delete this entry permanently?')) return;
  await api(`?id=${encodeURIComponent(id)}`, {method:'DELETE'});
  await loadEntries();
}

$('#adminAuthForm').addEventListener('submit', async event => {
  event.preventDefault();
  adminKey = $('#adminKey').value;
  $('#adminAuthMessage').textContent = 'Checking...';
  try {
    await loadEntries();
    sessionStorage.setItem('friendship_run_admin_key', adminKey);
    $('#adminAuth').hidden = true;
    $('#adminPanel').hidden = false;
  } catch (error) {
    $('#adminAuthMessage').textContent = error.message;
  }
});
$('#adminSearch').addEventListener('input', render);
$('#adminRefresh').addEventListener('click', loadEntries);

if (adminKey) {
  loadEntries().then(() => { $('#adminAuth').hidden = true; $('#adminPanel').hidden = false; }).catch(() => sessionStorage.removeItem('friendship_run_admin_key'));
}
