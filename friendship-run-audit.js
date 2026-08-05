const $ = (selector) => document.querySelector(selector);
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));

let adminKey = sessionStorage.getItem('friendship_run_admin_key') || '';
let records = [];
let auditEvents = [];
let totals = {};

async function api() {
  const response = await fetch('/api/friendship-run/admin', {
    headers: { 'x-admin-key': adminKey }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not load audit records.');
  return body;
}

const money = (value) => `MYR ${Number(value || 0).toFixed(2)}`;
const typeLabel = (row) => row.attempt_type === 'trial'
  ? 'Free trial'
  : row.eligibility_source === 'run_signup'
    ? 'Run signup entitlement'
    : 'Booth payment';
const methodLabel = (row) => row.payment_method === 'cash'
  ? 'Cash'
  : row.payment_method === 'digital'
    ? 'Digital'
    : row.payment_method === 'run_signup'
      ? 'Run signup'
      : 'None';
const playerName = (row) => row.player_name || 'Name not registered';

function renderStats() {
  const items = [
    ['Funds collected', money(totals.booth_funds), 'Cash + digital booth payments'],
    ['Cash', money(totals.cash_funds), 'Recorded cash collections'],
    ['Digital', money(totals.digital_funds), 'Recorded digital receipts'],
    ['Run signups', totals.run_signup_attempts || 0, 'Official attempts with no booth fee'],
    ['Free trials', totals.free_trials || 0, 'Practice codes issued'],
    ['Redeemed', totals.redeemed_codes || 0, 'Codes used by players'],
    ['Unused', totals.unused_codes || 0, 'Codes still available'],
    ['All records', totals.total_records || 0, 'Retained audit entries']
  ];

  $('#auditStats').innerHTML = items.map(([label, value, help], index) => `
    <article class="audit-stat ${index === 0 ? 'primary' : ''}">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${help}</small>
    </article>
  `).join('');
}

function filteredRecords() {
  const query = $('#auditSearch').value.trim().toLowerCase();
  const booth = $('#auditBooth').value;
  const type = $('#auditType').value;
  const method = $('#auditMethod').value;
  const status = $('#auditStatus').value;

  return records.filter((row) => {
    const haystack = [
      row.student_id,
      row.student_id_normalized,
      row.player_name,
      row.player_programme,
      row.play_code,
      row.operator_name,
      row.operator_username,
      row.audit_note
    ].join(' ').toLowerCase();
    const recordType = row.attempt_type === 'trial' ? 'trial' : row.eligibility_source;

    return (!query || haystack.includes(query))
      && (!booth || String(row.booth_id || 1) === booth)
      && (!type || recordType === type)
      && (!method || row.payment_method === method)
      && (!status || row.status === status);
  });
}

function evidenceCell(row) {
  if (!row.proof_url) {
    return '<span class="audit-no-proof">No image required</span>';
  }

  return `
    <button class="audit-proof-thumb" type="button" data-proof-id="${esc(row.id)}" aria-label="Open evidence for ${esc(playerName(row))}">
      <img src="${esc(row.proof_url)}" alt="Evidence for ${esc(playerName(row))}" loading="lazy" />
      <span>View proof</span>
    </button>
  `;
}

function renderRecords() {
  const rows = filteredRecords();
  $('#auditRecordCount').textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}`;

  if (!rows.length) {
    $('#auditRecords').innerHTML = '<div class="audit-empty">No records match these filters.</div>';
    return;
  }

  $('#auditRecords').innerHTML = `
    <table class="audit-data-table">
      <thead>
        <tr>
          <th>Evidence</th>
          <th>Date & time</th>
          <th>Booth</th>
          <th>Student</th>
          <th>Attempt</th>
          <th>Method</th>
          <th>Amount</th>
          <th>Play code</th>
          <th>Status</th>
          <th>Score</th>
          <th>Recorded by</th>
          <th>Audit note</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td data-label="Evidence">${evidenceCell(row)}</td>
            <td data-label="Date & time"><strong>${new Date(row.created_at).toLocaleDateString()}</strong><small>${new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small></td>
            <td data-label="Booth"><span class="audit-booth-pill">Booth ${Number(row.booth_id || 1)}</span></td>
            <td data-label="Student" class="audit-student-cell"><strong>${esc(playerName(row))}</strong><span>${esc(row.student_id || '—')}</span>${row.player_programme ? `<small>${esc(row.player_programme)}</small>` : ''}</td>
            <td data-label="Attempt"><strong>${esc(typeLabel(row))}</strong></td>
            <td data-label="Method">${esc(methodLabel(row))}</td>
            <td data-label="Amount"><strong>${money(row.amount_collected)}</strong></td>
            <td data-label="Play code" class="audit-code-cell">${esc(row.play_code || '—')}</td>
            <td data-label="Status"><span class="audit-status ${esc(row.status)}">${esc(row.status)}</span></td>
            <td data-label="Score">${row.score == null ? '—' : esc(row.score)}</td>
            <td data-label="Recorded by" class="audit-operator-cell"><strong>${esc(row.operator_name || 'Unknown staff')}</strong><span>${esc(row.operator_username || '—')}</span></td>
            <td data-label="Audit note" class="audit-note-cell">${row.audit_note ? esc(row.audit_note) : '<span class="audit-muted">No note</span>'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.querySelectorAll('[data-proof-id]').forEach((button) => {
    button.addEventListener('click', () => openProof(button.dataset.proofId));
  });
}

function renderBreakdowns() {
  $('#auditBoothBreakdown').innerHTML = [1, 2].map((id) => {
    const row = totals.by_booth?.[id] || totals.by_booth?.[String(id)] || {};
    return `
      <article>
        <div><strong>Booth ${id}</strong><span>${row.records || 0} records</span></div>
        <b>${money(row.funds)}</b>
        <small>${row.free_trials || 0} trials · ${row.run_signups || 0} run signups · ${row.redeemed || 0} redeemed</small>
      </article>
    `;
  }).join('');

  const operators = totals.by_operator || [];
  $('#auditOperatorBreakdown').innerHTML = operators.length
    ? operators.map((row) => `
      <article>
        <div><strong>${esc(row.name)}</strong><span>${esc(row.username)}</span></div>
        <b>${row.records} records</b>
        <small>${money(row.funds)} · ${row.free_trials} trials · ${row.run_signups} signups</small>
      </article>
    `).join('')
    : '<p>No staff activity yet.</p>';

  $('#auditEvents').innerHTML = auditEvents.slice(0, 40).map((event) => `
    <article>
      <strong>${esc(String(event.event_type || '').replaceAll('_', ' '))}</strong>
      <span>${new Date(event.created_at).toLocaleString()}</span>
      <small>${esc(event.operator_name || event.student_id_normalized || 'System')}</small>
    </article>
  `).join('') || '<p>No audit events yet.</p>';
}

function openProof(id) {
  const row = records.find((item) => String(item.id) === String(id));
  if (!row?.proof_url) return;

  $('#auditProofImage').src = row.proof_url;
  $('#auditProofTitle').textContent = `${playerName(row)} · ${row.student_id}`;
  $('#auditProofMeta').innerHTML = `
    <span>Booth ${Number(row.booth_id || 1)}</span>
    <span>${esc(typeLabel(row))}</span>
    <span>${esc(methodLabel(row))}</span>
    <span>${money(row.amount_collected)}</span>
    <span>${esc(row.operator_name || 'Unknown staff')}</span>
    <span>${new Date(row.created_at).toLocaleString()}</span>
  `;
  $('#auditProofDialog').showModal();
}

function closeProof() {
  if ($('#auditProofDialog').open) $('#auditProofDialog').close();
}

async function load() {
  const data = await api();
  records = data.payments || [];
  auditEvents = data.audit || [];
  totals = data.totals || {};
  renderStats();
  renderRecords();
  renderBreakdowns();
  $('#auditExport').hidden = false;
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function exportCsv() {
  const header = [
    'Created', 'Booth', 'Student ID', 'Player name', 'Programme', 'Play code',
    'Attempt type', 'Eligibility', 'Payment method', 'Amount', 'Status',
    'Staff username', 'Staff name', 'Score', 'Evidence kind', 'Proof path', 'Audit note'
  ];
  const lines = [
    header,
    ...filteredRecords().map((row) => [
      row.created_at,
      row.booth_id || 1,
      row.student_id,
      row.player_name,
      row.player_programme,
      row.play_code,
      row.attempt_type,
      row.eligibility_source,
      row.payment_method,
      row.amount_collected,
      row.status,
      row.operator_username,
      row.operator_name,
      row.score,
      row.evidence_kind,
      row.proof_path,
      row.audit_note
    ])
  ].map((row) => row.map(csvCell).join(','));

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `friendship-run-booth-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

$('#auditAuthForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  adminKey = $('#auditKey').value;
  $('#auditAuthMessage').textContent = 'Loading records…';
  try {
    await load();
    sessionStorage.setItem('friendship_run_admin_key', adminKey);
    $('#auditAuth').hidden = true;
    $('#auditPanel').hidden = false;
  } catch (error) {
    $('#auditAuthMessage').textContent = error.message;
  }
});

['auditSearch', 'auditBooth', 'auditType', 'auditMethod', 'auditStatus'].forEach((id) => {
  $('#' + id).addEventListener(id === 'auditSearch' ? 'input' : 'change', renderRecords);
});

$('#auditRefresh').addEventListener('click', load);
$('#auditExport').addEventListener('click', exportCsv);
$('#auditProofClose').addEventListener('click', closeProof);
$('#auditProofDialog').addEventListener('click', (event) => {
  if (event.target === $('#auditProofDialog')) closeProof();
});

if (adminKey) {
  load().then(() => {
    $('#auditAuth').hidden = true;
    $('#auditPanel').hidden = false;
  }).catch(() => sessionStorage.removeItem('friendship_run_admin_key'));
}
