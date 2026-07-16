const authForm = document.querySelector('#auth-form');
const keyInput = document.querySelector('#admin-key');
const panel = document.querySelector('#admin-panel');
const authCard = document.querySelector('#auth-card');
const form = document.querySelector('#job-form');
const list = document.querySelector('#admin-jobs');
const message = document.querySelector('#form-message');
let adminKey = sessionStorage.getItem('aerinyu_admin_key') || '';
let jobs = [];

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const value = (id) => document.querySelector(`#${id}`).value.trim();
const lineList = (id) => value(id).split('\n').map((item) => item.trim()).filter(Boolean);

async function api(path = '', options = {}) {
  const response = await fetch(`/api/jobs${path}`, {
    ...options,
    headers: {'Content-Type': 'application/json', 'x-admin-key': adminKey, ...(options.headers || {})}
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

async function unlock() {
  try {
    await loadJobs();
    sessionStorage.setItem('aerinyu_admin_key', adminKey);
    authCard.hidden = true;
    panel.hidden = false;
  } catch (error) {
    sessionStorage.removeItem('aerinyu_admin_key');
    alert('The admin key was not accepted.');
  }
}

async function loadJobs() {
  jobs = await api('?admin=1');
  list.innerHTML = jobs.length ? jobs.map((job) => `
    <article class="admin-job ${job.is_open ? '' : 'closed'}">
      <div><span>${escapeHtml(job.unit_name || job.department)} · ${escapeHtml(job.engagement_type)}</span><h3>${escapeHtml(job.title)}</h3><p>${job.is_open ? 'Open' : 'Closed'}</p></div>
      <div class="admin-job-actions"><button type="button" data-edit="${job.id}">Edit</button><button type="button" data-toggle="${job.id}">${job.is_open ? 'Close' : 'Reopen'}</button><button type="button" data-delete="${job.id}">Delete</button></div>
    </article>`).join('') : '<p class="empty-state">No postings yet.</p>';

  list.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => editJob(button.dataset.edit)));
  list.querySelectorAll('[data-toggle]').forEach((button) => button.addEventListener('click', () => toggleJob(button.dataset.toggle)));
  list.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', () => deleteJob(button.dataset.delete)));
}

function resetForm() {
  form.reset();
  document.querySelector('#job-id').value = '';
  document.querySelector('#location').value = 'Malaysia / Remote';
  document.querySelector('#schedule_type').value = 'Flexible / self-managed';
  document.querySelector('#hours_description').value = 'Work at your own hours. Team members manage their own schedules as long as agreed deadlines, meetings, communication expectations, and deliverables are completed.';
  document.querySelector('#meeting_requirements').value = 'Occasional scheduled meetings may be required with reasonable prior notice.';
  document.querySelector('#compensation_type').value = 'Task-cycle / commission-based';
  document.querySelector('#is_open').checked = true;
  message.textContent = '';
}

function editJob(id) {
  const job = jobs.find((item) => String(item.id) === String(id));
  if (!job) return;

  const simpleFields = [
    'title','department','unit_name','work_type','engagement_type','location','summary','about_role',
    'schedule_type','hours_description','meeting_requirements','compensation_type',
    'compensation','compensation_currency','application_url'
  ];

  document.querySelector('#job-id').value = job.id;
  simpleFields.forEach((field) => {
    const element = document.querySelector(`#${field}`);
    if (element) element.value = job[field] ?? '';
  });

  ['responsibilities','requirements','preferred_skills','benefits'].forEach((field) => {
    document.querySelector(`#${field}`).value = Array.isArray(job[field]) ? job[field].join('\n') : job[field] || '';
  });

  document.querySelector('#estimated_hours_per_week').value = job.estimated_hours_per_week ?? '';
  document.querySelector('#compensation_min').value = job.compensation_min ?? '';
  document.querySelector('#compensation_max').value = job.compensation_max ?? '';
  document.querySelector('#is_open').checked = Boolean(job.is_open);
  scrollTo({top: 0, behavior: 'smooth'});
}

async function toggleJob(id) {
  const job = jobs.find((item) => String(item.id) === String(id));
  await api(`?id=${id}`, {method:'PATCH', body: JSON.stringify({is_open: !job.is_open})});
  await loadJobs();
}

async function deleteJob(id) {
  if (!confirm('Permanently delete this posting?')) return;
  await api(`?id=${id}`, {method:'DELETE'});
  await loadJobs();
}

authForm.addEventListener('submit', (event) => {
  event.preventDefault();
  adminKey = keyInput.value;
  unlock();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = 'Saving…';
  const id = value('job-id');
  const hours = value('estimated_hours_per_week');

  const payload = {
    title: value('title'),
    department: value('department'),
    unit_name: value('unit_name') || null,
    work_type: value('work_type'),
    engagement_type: value('engagement_type'),
    location: value('location'),
    summary: value('summary'),
    about_role: value('about_role'),
    responsibilities: lineList('responsibilities'),
    requirements: lineList('requirements'),
    preferred_skills: lineList('preferred_skills'),
    benefits: lineList('benefits'),
    schedule_type: value('schedule_type'),
    hours_description: value('hours_description'),
    estimated_hours_per_week: hours === '' ? null : Number(hours),
    meeting_requirements: value('meeting_requirements'),
    compensation_type: value('compensation_type'),
    compensation: value('compensation'),
    compensation_min: value('compensation_min') === '' ? null : Number(value('compensation_min')),
    compensation_max: value('compensation_max') === '' ? null : Number(value('compensation_max')),
    compensation_currency: value('compensation_currency'),
    application_url: '',
    is_open: document.querySelector('#is_open').checked
  };

  try {
    await api(id ? `?id=${id}` : '', {method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload)});
    resetForm();
    message.textContent = 'Posting saved.';
    await loadJobs();
  } catch (error) {
    message.textContent = error.message;
  }
});

document.querySelector('#reset-form').addEventListener('click', resetForm);
document.querySelector('#refresh-jobs').addEventListener('click', loadJobs);
if (adminKey) unlock();
