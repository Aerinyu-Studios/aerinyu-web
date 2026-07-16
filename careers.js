const jobsGrid = document.querySelector('#jobs-grid');
const statusBox = document.querySelector('#jobs-status');
const filter = document.querySelector('#department-filter');
const dialog = document.querySelector('#job-dialog');
const detail = document.querySelector('#job-detail');
let jobs = [];

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const listItems = (value) => Array.isArray(value) ? value : String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);
const renderList = (items) => listItems(items).map((item) => `<li>${escapeHtml(item)}</li>`).join('');

function renderJobs() {
  const selected = filter.value;
  const visible = selected ? jobs.filter((job) => job.department === selected) : jobs;
  statusBox.hidden = visible.length > 0;
  statusBox.textContent = visible.length ? '' : 'There are currently no open roles in this department.';
  jobsGrid.innerHTML = visible.map((job) => `
    <article class="job-card">
      <div class="job-card-top"><span>${escapeHtml(job.department)}</span><span>${escapeHtml(job.work_type)}</span></div>
      <h3>${escapeHtml(job.title)}</h3>
      <p>${escapeHtml(job.summary)}</p>
      <div class="job-meta"><span>${escapeHtml(job.engagement_type)}</span><span>${escapeHtml(job.location)}</span></div>
      <button class="job-open" type="button" data-id="${job.id}">View position <span>↗</span></button>
    </article>`).join('');

  document.querySelectorAll('.job-open').forEach((button) => button.addEventListener('click', () => openJob(button.dataset.id)));
}

function openJob(id) {
  const job = jobs.find((item) => String(item.id) === String(id));
  if (!job) return;

  const preferred = listItems(job.preferred_skills);
  const benefits = listItems(job.benefits);

  detail.innerHTML = `
    <p class="section-kicker">${escapeHtml(job.department)}</p>
    <h2>${escapeHtml(job.title)}</h2>
    <div class="dialog-meta">
      <span>${escapeHtml(job.engagement_type)}</span>
      <span>${escapeHtml(job.work_type)}</span>
      <span>${escapeHtml(job.location)}</span>
    </div>
    <p class="job-summary">${escapeHtml(job.summary)}</p>

    <section>
      <h3>About the role</h3>
      <p>${escapeHtml(job.about_role)}</p>
    </section>

    <section>
      <h3>What you’ll do</h3>
      <ul>${renderList(job.responsibilities)}</ul>
    </section>

    <section>
      <h3>Required qualifications</h3>
      <ul>${renderList(job.requirements)}</ul>
    </section>

    ${preferred.length ? `<section><h3>Preferred qualifications</h3><ul>${renderList(preferred)}</ul></section>` : ''}

    <section>
      <h3>Working arrangement</h3>
      <p><strong>${escapeHtml(job.schedule_type)}</strong></p>
      <p>${escapeHtml(job.hours_description)}</p>
      ${job.estimated_hours_per_week !== null && job.estimated_hours_per_week !== undefined ? `<p>Estimated commitment: approximately ${escapeHtml(job.estimated_hours_per_week)} hours per week.</p>` : ''}
      ${job.meeting_requirements ? `<p>${escapeHtml(job.meeting_requirements)}</p>` : ''}
    </section>

    <section>
      <h3>Compensation</h3>
      <p><strong>${escapeHtml(job.compensation_type)}</strong></p>
      ${job.compensation ? `<p>${escapeHtml(job.compensation)}</p>` : ''}
    </section>

    ${benefits.length ? `<section><h3>Benefits</h3><ul>${renderList(benefits)}</ul></section>` : ''}

    <a class="button button-light apply-button" href="${escapeHtml(job.application_url)}" target="_blank" rel="noopener">Apply for this role</a>`;

  dialog.showModal();
}

async function loadJobs() {
  try {
    const response = await fetch('/api/jobs');
    if (!response.ok) throw new Error('Unable to load jobs');
    jobs = await response.json();
    const departments = [...new Set(jobs.map((job) => job.department))].sort();
    filter.innerHTML = '<option value="">All departments</option>' + departments.map((department) => `<option>${escapeHtml(department)}</option>`).join('');
    const requested = new URLSearchParams(location.search).get('department');
    if (requested && departments.includes(requested)) filter.value = requested;
    renderJobs();
  } catch (error) {
    statusBox.hidden = false;
    statusBox.textContent = 'Open roles could not be loaded. Please email careers@aerinyustudios.com.';
  }
}

filter.addEventListener('change', renderJobs);
dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

const menuButton = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('.mobile-menu');
menuButton.addEventListener('click', () => {
  const open = menuButton.classList.toggle('active');
  mobileMenu.classList.toggle('open', open);
  menuButton.setAttribute('aria-expanded', String(open));
});

loadJobs();
