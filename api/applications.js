import { createClient } from '@supabase/supabase-js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const BUCKET = 'career-applications';
const authorised = (req) => Boolean(process.env.ADMIN_KEY) && req.headers['x-admin-key'] === process.env.ADMIN_KEY;
const text = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const html = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const clientIp = (req) => text((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || 'unknown', 100);
const ipHash = (req) => createHash('sha256').update(`${clientIp(req)}:${process.env.RATE_LIMIT_SALT || process.env.ADMIN_KEY || 'aerinyu'}`).digest('hex');

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server environment variables are missing.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function verifyUploadToken(token, expectedPath, expectedHash) {
  const secret = process.env.UPLOAD_TOKEN_SECRET || process.env.ADMIN_KEY;
  if (!secret || !token || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed.path === expectedPath && parsed.hash === expectedHash && Number(parsed.exp) > Date.now();
  } catch { return false; }
}

async function sendEmail(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is missing.');
  const response = await fetch('https://api.resend.com/emails', { method:'POST', headers:{ Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json' }, body:JSON.stringify(payload) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.message || 'Email could not be sent.');
  return result;
}

const emailShell = (content, preheader='') => `<!doctype html><html><body style="margin:0;background:#080808;font-family:Arial,sans-serif;color:#f3f1ed"><div style="display:none;max-height:0;overflow:hidden">${html(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:32px 14px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#111;border:1px solid #292929;border-radius:20px;overflow:hidden"><tr><td style="padding:30px 34px;border-bottom:1px solid #292929"><div style="font-size:12px;letter-spacing:3px;color:#bcb7ae;font-weight:700">AERINYU STUDIOS</div><div style="font-size:13px;color:#777;margin-top:7px">Where gaming meets discovery.</div></td></tr><tr><td style="padding:36px 34px;line-height:1.7;color:#d9d5ce">${content}</td></tr><tr><td style="padding:22px 34px;border-top:1px solid #292929;color:#777;font-size:12px">Aerinyu Studios Careers · careers@aerinyustudios.com</td></tr></table></td></tr></table></body></html>`;

export default async function handler(req, res) {
  try {
    const supabase = serverClient();

    if (req.method === 'GET') {
      if (!authorised(req)) return res.status(401).json({ error: 'Unauthorised' });
      if (req.query.action === 'resume') {
        const id = text(req.query.id, 60);
        const { data: application, error } = await supabase.from('applications').select('resume_path,resume_original_name').eq('id', id).single();
        if (error || !application?.resume_path) return res.status(404).json({ error: 'Résumé not found.' });
        const { data, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(application.resume_path, 15 * 60, { download: application.resume_original_name || 'resume.pdf' });
        if (signedError) throw signedError;
        return res.status(200).json({ url: data.signedUrl, expires_in: 900 });
      }
      const { data, error } = await supabase.from('applications').select('*, jobs(title, unit_name, department)').order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (text(req.body?.website, 200)) return res.status(200).json({ ok: true });

    const hash = ipHash(req);
    const payload = {
      job_id: text(req.body?.job_id, 60), full_name: text(req.body?.full_name, 120), email: text(req.body?.email, 254).toLowerCase(),
      phone_country_code: text(req.body?.phone_country_code, 10), phone_number: text(req.body?.phone_number, 30), discord_username: text(req.body?.discord_username, 100) || null,
      country_timezone: text(req.body?.country_timezone, 150) || null, portfolio_url: text(req.body?.portfolio_url, 500) || null,
      resume_path: text(req.body?.resume_path, 500), resume_original_name: text(req.body?.resume_original_name, 180), message: text(req.body?.message, 4000) || null,
      consent: req.body?.consent === true, ip_hash: hash
    };

    if (!payload.job_id || payload.full_name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) || !payload.phone_country_code || payload.phone_number.length < 5 || !payload.resume_path || !payload.resume_original_name || !payload.consent) {
      return res.status(400).json({ error: 'Please complete all required fields correctly.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.pdf$/i.test(payload.resume_path)) return res.status(400).json({ error: 'The résumé upload reference is invalid.' });
    if (!verifyUploadToken(text(req.body?.upload_token, 4000), payload.resume_path, hash)) return res.status(400).json({ error: 'The upload session expired or is invalid. Please upload the résumé again.' });

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase.from('applications').select('id', { count:'exact', head:true }).eq('ip_hash', hash).gte('created_at', since);
    if ((count || 0) >= 3) return res.status(429).json({ error: 'Too many applications were submitted from this connection. Please try again later.' });

    const { data: job, error: jobError } = await supabase.from('jobs').select('id,title,department,unit_name,is_open,show_application_message').eq('id', payload.job_id).single();
    if (jobError || !job?.is_open) return res.status(400).json({ error: 'This role is not currently accepting applications.' });
    if (job.show_application_message !== false && !payload.message) return res.status(400).json({ error: 'Please complete the application question.' });

    const { data: inserted, error: insertError } = await supabase.from('applications').insert(payload).select('id,created_at').single();
    if (insertError) throw insertError;

    const from = process.env.APPLICATION_FROM_EMAIL || 'Aerinyu Careers <applications@aerinyustudios.com>';
    const notificationTo = process.env.APPLICATION_NOTIFICATION_EMAIL || 'careers@aerinyustudios.com';
    const phone = `${payload.phone_country_code} ${payload.phone_number}`;
    const roleLabel = job.unit_name ? `${job.title} — ${job.unit_name}` : job.title;
    const adminUrl = `${process.env.PUBLIC_SITE_URL || 'https://www.aerinyustudios.com'}/admin.html`;
    let notificationSent = false, confirmationSent = false; const emailErrors = [];

    try {
      await sendEmail({ from, to:[notificationTo], reply_to:payload.email, subject:`New application: ${job.title} — ${payload.full_name}`,
        html: emailShell(`<div style="font-size:12px;letter-spacing:2px;color:#a8a39a;font-weight:700">NEW CAREERS APPLICATION</div><h1 style="margin:12px 0 22px;color:#fff;font-size:28px">${html(payload.full_name)}</h1><div style="background:#181818;border:1px solid #2a2a2a;border-radius:14px;padding:20px"><p><strong style="color:#fff">Position:</strong> ${html(roleLabel)}</p><p><strong style="color:#fff">Email:</strong> ${html(payload.email)}</p><p><strong style="color:#fff">Phone:</strong> ${html(phone)}</p><p><strong style="color:#fff">Country / timezone:</strong> ${html(payload.country_timezone || 'Not provided')}</p><p><strong style="color:#fff">Discord:</strong> ${html(payload.discord_username || 'Not provided')}</p><p><strong style="color:#fff">Portfolio:</strong> ${payload.portfolio_url ? `<a style="color:#fff" href="${html(payload.portfolio_url)}">Open portfolio</a>` : 'Not provided'}</p></div>${payload.message ? `<h2 style="color:#fff;font-size:18px;margin-top:28px">Applicant response</h2><p>${html(payload.message).replace(/\n/g,'<br>')}</p>` : ''}<p style="margin-top:30px"><a href="${html(adminUrl)}" style="display:inline-block;background:#f0eee9;color:#080808;text-decoration:none;padding:13px 20px;border-radius:999px;font-weight:700">Review application and résumé</a></p><p style="font-size:12px;color:#777">Application ID: ${html(inserted.id)}</p>`, `New application from ${payload.full_name}`) }); notificationSent = true;
    } catch (error) { emailErrors.push(`Staff notification: ${error.message}`); }

    try {
      await sendEmail({ from, to:[payload.email], reply_to:notificationTo, subject:`Application received — ${job.title}`,
        html: emailShell(`<div style="font-size:12px;letter-spacing:2px;color:#a8a39a;font-weight:700">APPLICATION RECEIVED</div><h1 style="margin:12px 0 22px;color:#fff;font-size:28px">Thank you, ${html(payload.full_name)}.</h1><p>We have received your application for the <strong style="color:#fff">${html(job.title)}</strong> position at Aerinyu Studios.</p><p>Your details and résumé are now securely recorded for review. Our team will contact you using the information you provided if we would like to proceed.</p><div style="margin:28px 0;padding:18px 20px;background:#181818;border:1px solid #2a2a2a;border-radius:14px"><strong style="color:#fff">Please note:</strong> this email confirms receipt only. It is not an employment offer or confirmation of selection.</div><p>Regards,<br><strong style="color:#fff">Aerinyu Studios Careers</strong></p>`, `We received your application for ${job.title}`) }); confirmationSent = true;
    } catch (error) { emailErrors.push(`Applicant confirmation: ${error.message}`); }

    await supabase.from('applications').update({ notification_sent:notificationSent, confirmation_sent:confirmationSent, notified_at:notificationSent?new Date().toISOString():null, confirmation_sent_at:confirmationSent?new Date().toISOString():null, notification_error:emailErrors.length?emailErrors.join(' | ').slice(0,2000):null }).eq('id', inserted.id);
    return res.status(201).json({ ok:true, confirmation_email_sent:confirmationSent });
  } catch (error) {
    console.error('Applications API error:', error);
    return res.status(500).json({ error:error?.message || 'Application could not be submitted.' });
  }
}
