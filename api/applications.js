import { createClient } from '@supabase/supabase-js';

const BUCKET = 'career-applications';
const authorised = (req) => Boolean(process.env.ADMIN_KEY) && req.headers['x-admin-key'] === process.env.ADMIN_KEY;
const text = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const html = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server environment variables are missing.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function sendEmail(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is missing.');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.message || 'Email could not be sent.');
  return result;
}

export default async function handler(req, res) {
  try {
    const supabase = serverClient();

    if (req.method === 'GET') {
      if (!authorised(req)) return res.status(401).json({ error: 'Unauthorised' });
      const { data, error } = await supabase
        .from('applications')
        .select('*, jobs(title, unit_name, department)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (text(req.body?.website, 200)) return res.status(200).json({ ok: true });

    const payload = {
      job_id: text(req.body?.job_id, 60),
      full_name: text(req.body?.full_name, 120),
      email: text(req.body?.email, 254).toLowerCase(),
      phone_country_code: text(req.body?.phone_country_code, 10),
      phone_number: text(req.body?.phone_number, 30),
      discord_username: text(req.body?.discord_username, 100) || null,
      country_timezone: text(req.body?.country_timezone, 150) || null,
      portfolio_url: text(req.body?.portfolio_url, 500) || null,
      resume_path: text(req.body?.resume_path, 500),
      resume_original_name: text(req.body?.resume_original_name, 180),
      message: text(req.body?.message, 4000) || null,
      consent: req.body?.consent === true
    };

    if (
      !payload.job_id ||
      payload.full_name.length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
      !payload.phone_country_code ||
      payload.phone_number.length < 5 ||
      !payload.resume_path ||
      !payload.resume_original_name ||
      !payload.consent
    ) {
      return res.status(400).json({ error: 'Please complete all required fields correctly.' });
    }

    if (!/^\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.pdf$/i.test(payload.resume_path)) {
      return res.status(400).json({ error: 'The résumé upload reference is invalid.' });
    }

    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('id,title,department,unit_name,is_open,show_application_message')
      .eq('id', payload.job_id)
      .single();

    if (jobError || !job?.is_open) {
      return res.status(400).json({ error: 'This role is not currently accepting applications.' });
    }
    if (job.show_application_message !== false && !payload.message) {
      return res.status(400).json({ error: 'Please complete the application question.' });
    }

    const { data: inserted, error: insertError } = await supabase
      .from('applications')
      .insert(payload)
      .select('id,created_at')
      .single();
    if (insertError) throw insertError;

    let signedResumeUrl = null;
    const { data: signedData } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(payload.resume_path, 60 * 60 * 24);
    signedResumeUrl = signedData?.signedUrl || null;

    const from = process.env.APPLICATION_FROM_EMAIL || 'Aerinyu Careers <applications@aerinyustudios.com>';
    const notificationTo = process.env.APPLICATION_NOTIFICATION_EMAIL || 'careers@aerinyustudios.com';
    const phone = `${payload.phone_country_code} ${payload.phone_number}`;
    const roleLabel = job.unit_name ? `${job.title} — ${job.unit_name}` : job.title;
    let notificationSent = false;
    let confirmationSent = false;
    const emailErrors = [];

    try {
      await sendEmail({
        from,
        to: [notificationTo],
        reply_to: payload.email,
        subject: `New application: ${job.title} — ${payload.full_name}`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6;color:#151515">
            <h2>New careers application</h2>
            <p><strong>Position:</strong> ${html(roleLabel)}</p>
            <p><strong>Name:</strong> ${html(payload.full_name)}</p>
            <p><strong>Email:</strong> ${html(payload.email)}</p>
            <p><strong>Phone:</strong> ${html(phone)}</p>
            <p><strong>Country / timezone:</strong> ${html(payload.country_timezone || 'Not provided')}</p>
            <p><strong>Discord:</strong> ${html(payload.discord_username || 'Not provided')}</p>
            <p><strong>Portfolio:</strong> ${payload.portfolio_url ? `<a href="${html(payload.portfolio_url)}">Open portfolio</a>` : 'Not provided'}</p>
            <p><strong>Applicant response:</strong></p>
            <p>${html(payload.message || 'Not requested for this posting.').replace(/\n/g, '<br>')}</p>
            <p><strong>Résumé:</strong> ${signedResumeUrl ? `<a href="${html(signedResumeUrl)}">Open résumé (link expires in 24 hours)</a>` : 'Available in Supabase Storage'}</p>
            <p><small>Application ID: ${html(inserted.id)}</small></p>
          </div>`
      });
      notificationSent = true;
    } catch (error) {
      emailErrors.push(`Staff notification: ${error.message}`);
    }

    try {
      await sendEmail({
        from,
        to: [payload.email],
        reply_to: notificationTo,
        subject: `We received your application — ${job.title}`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.7;color:#151515;max-width:620px">
            <p>Hi ${html(payload.full_name)},</p>
            <p>Thank you for applying for the <strong>${html(job.title)}</strong> position at Aerinyu Studios.</p>
            <p>Your application has been received successfully and is now in our recruitment records. Our team will review your information and contact you using the details you provided if we would like to proceed.</p>
            <p>Please note that this email confirms receipt of your application; it is not an employment offer or confirmation that you have been selected.</p>
            <p>Regards,<br><strong>Aerinyu Studios Careers</strong></p>
          </div>`
      });
      confirmationSent = true;
    } catch (error) {
      emailErrors.push(`Applicant confirmation: ${error.message}`);
    }

    await supabase
      .from('applications')
      .update({
        notification_sent: notificationSent,
        confirmation_sent: confirmationSent,
        notified_at: notificationSent ? new Date().toISOString() : null,
        confirmation_sent_at: confirmationSent ? new Date().toISOString() : null,
        notification_error: emailErrors.length ? emailErrors.join(' | ').slice(0, 2000) : null
      })
      .eq('id', inserted.id);

    return res.status(201).json({
      ok: true,
      confirmation_email_sent: confirmationSent
    });
  } catch (error) {
    console.error('Applications API error:', error);
    return res.status(500).json({ error: error?.message || 'Application could not be submitted.' });
  }
}
