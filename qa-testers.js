const form = document.querySelector('#qa-application-form');
const submitButton = document.querySelector('#submit-button');
const message = document.querySelector('#application-message');
const roleStatus = document.querySelector('#role-status');
const jobIdInput = document.querySelector('#job-id');
const menuButton = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('.mobile-menu');

let turnstileSiteKey = '';
let qaJob = null;

menuButton?.addEventListener('click', () => {
  const open = menuButton.classList.toggle('active');
  mobileMenu.classList.toggle('open', open);
  menuButton.setAttribute('aria-expanded', String(open));
});

mobileMenu?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuButton.classList.remove('active');
    mobileMenu.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
  });
});

function findQaJob(jobs) {
  const titleMatch = jobs.find((job) =>
    /(^|\b)(qa|quality assurance)(\b|$)/i.test(job.title || '')
  );

  if (titleMatch) return titleMatch;

  return jobs.find((job) =>
    /quality assurance|qa testing|testing/i.test(
      `${job.department || ''} ${job.unit_name || ''} ${job.summary || ''}`
    )
  );
}

async function loadQaOpening() {
  try {
    const response = await fetch('/api/jobs');
    if (!response.ok) throw new Error('Could not load current openings.');

    const jobs = await response.json();
    qaJob = findQaJob(jobs);

    if (!qaJob) {
      roleStatus.className = 'role-status closed';
      roleStatus.textContent = 'Applications are not currently open. Create an open job posting with “QA” or “Quality Assurance” in its title through the Careers Admin panel.';
      submitButton.textContent = 'Applications currently closed';
      submitButton.disabled = true;
      return;
    }

    jobIdInput.value = qaJob.id;
    roleStatus.className = 'role-status open';
    roleStatus.textContent = `${qaJob.title} is currently open • ${qaJob.engagement_type || 'Role'} • ${qaJob.work_type || 'Remote'} • ${qaJob.location || 'Malaysia / Remote'}`;
    submitButton.textContent = 'Submit QA application';
    submitButton.disabled = false;
  } catch (error) {
    roleStatus.className = 'role-status closed';
    roleStatus.textContent = 'The opening could not be loaded. Please try again later or contact careers@aerinyustudios.com.';
    submitButton.textContent = 'Opening unavailable';
    submitButton.disabled = true;
  }
}

async function loadSecurity() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    turnstileSiteKey = config.turnstile_site_key || '';

    if (turnstileSiteKey && !document.querySelector('script[src*="turnstile"]')) {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    renderTurnstile();
  } catch {
    turnstileSiteKey = '';
  }
}

function renderTurnstile() {
  const wrap = document.querySelector('#turnstile-wrap');
  const widget = document.querySelector('#turnstile-widget');

  if (!wrap || !widget || !turnstileSiteKey) return;

  wrap.hidden = false;

  const wait = () => {
    if (!window.turnstile) {
      setTimeout(wait, 100);
      return;
    }

    widget.innerHTML = '';
    window.turnstile.render(widget, {
      sitekey: turnstileSiteKey,
      theme: 'dark',
      size: 'flexible',
      appearance: 'always',
      retry: 'auto',
      'expired-callback': () => window.turnstile.reset(),
      'timeout-callback': () => window.turnstile.reset(),
      'error-callback': () => {
        message.textContent = 'The security check could not load. Please refresh and try again.';
        return true;
      }
    });
  };

  wait();
}

function buildApplicationMessage() {
  const robloxUsername = document.querySelector('#roblox-username').value.trim();
  const testingDevice = document.querySelector('#testing-device').value.trim();
  const experience = document.querySelector('#experience').value.trim();
  const bugReport = document.querySelector('#bug-report').value.trim();
  const motivation = document.querySelector('#motivation').value.trim();

  return [
    'QA TESTER APPLICATION DETAILS',
    '',
    `Roblox username: ${robloxUsername}`,
    `Primary testing device: ${testingDevice}`,
    '',
    'Relevant QA, development, or Roblox experience:',
    experience,
    '',
    'Example bug report:',
    bugReport,
    '',
    'Why they are interested and what they can contribute:',
    motivation
  ].join('\n');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!qaJob || !jobIdInput.value) {
    message.textContent = 'This QA opening is not currently available.';
    return;
  }

  const file = form.elements.resume_file.files[0];

  if (!file || file.type !== 'application/pdf') {
    message.textContent = 'Please select a PDF résumé.';
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    message.textContent = 'Your résumé must be 5 MB or smaller.';
    return;
  }

  submitButton.disabled = true;
  message.textContent = 'Uploading résumé…';

  try {
    const turnstileToken = window.turnstile ? window.turnstile.getResponse() : '';

    if (turnstileSiteKey && !turnstileToken) {
      throw new Error('Please complete the security check.');
    }

    const prepareResponse = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        turnstile_token: turnstileToken
      })
    });

    const upload = await prepareResponse.json();

    if (!prepareResponse.ok) {
      throw new Error(upload.error || 'Could not prepare the résumé upload.');
    }

    const uploadResponse = await fetch(upload.signed_url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf',
        'x-upsert': 'false'
      },
      body: file
    });

    if (!uploadResponse.ok) {
      throw new Error('Résumé upload failed. Please try again.');
    }

    message.textContent = 'Submitting application…';

    const formData = new FormData(form);
    const body = Object.fromEntries(formData.entries());

    delete body.resume_file;
    body.message = buildApplicationMessage();
    body.resume_path = upload.path;
    body.resume_original_name = file.name;
    body.upload_token = upload.upload_token;
    body.consent = formData.get('consent') === 'on';

    const response = await fetch('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Application submission failed.');
    }

    form.reset();
    jobIdInput.value = qaJob.id;

    if (window.turnstile && turnstileSiteKey) {
      window.turnstile.reset();
    }

    message.textContent = data.confirmation_email_sent
      ? 'Application submitted. A confirmation email has been sent to you.'
      : 'Application submitted successfully. Thank you.';
  } catch (error) {
    message.textContent = error.message;

    if (window.turnstile && turnstileSiteKey) {
      try { window.turnstile.reset(); } catch {}
    }
  } finally {
    submitButton.disabled = !qaJob;
  }
});

loadQaOpening();
loadSecurity();
