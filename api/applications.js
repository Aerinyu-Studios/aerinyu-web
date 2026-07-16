import { createClient } from '@supabase/supabase-js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const BUCKET = 'career-applications';
const authorised = (req) => Boolean(process.env.ADMIN_KEY) && req.headers['x-admin-key'] === process.env.ADMIN_KEY;
const text = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
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

    // Download the privately stored résumé on the server so it can be attached
    // to the internal careers notification. The applicant never receives a
    // public storage URL or Supabase secret.
    let resumeAttachment = null;
    try {
      const { data: resumeFile, error: resumeError } = await supabase.storage
        .from(BUCKET)
        .download(payload.resume_path);
      if (resumeError) throw resumeError;
      const resumeBuffer = Buffer.from(await resumeFile.arrayBuffer());
      resumeAttachment = {
        filename: (payload.resume_original_name || 'resume.pdf').replace(/[\\/:*?"<>|\r\n]/g, '_'),
        content: resumeBuffer.toString('base64')
      };
    } catch (error) {
      emailErrors.push(`Résumé attachment: ${error.message}`);
    }

    const staffText = [
      'Hello Careers Team,',
      '',
      'A new application has been submitted through the Aerinyu Studios careers website.',
      '',
      `Position: ${roleLabel}`,
      `Department: ${job.department || 'Not specified'}`,
      `Applicant: ${payload.full_name}`,
      `Email: ${payload.email}`,
      `Phone: ${phone}`,
      `Country / timezone: ${payload.country_timezone || 'Not provided'}`,
      `Discord: ${payload.discord_username || 'Not provided'}`,
      `Portfolio: ${payload.portfolio_url || 'Not provided'}`,
      '',
      ...(payload.message ? ['Applicant response:', payload.message, ''] : []),
      resumeAttachment
        ? 'The applicant’s résumé is attached to this email.'
        : 'The résumé could not be attached. It remains available securely through the admin page.',
      '',
      `Review application: ${adminUrl}`,
      `Application ID: ${inserted.id}`,
      '',
      'Regards,',
      'Aerinyu Careers System'
    ].join('\n');

    const applicantText = [
      `Dear ${payload.full_name},`,
      '',
      `Thank you for applying for the ${job.title} position at Aerinyu Studios.`,
      '',
      'This email confirms that we have received your application and résumé. Our team will review the information you submitted and will contact you if your application is shortlisted or if we require any additional information.',
      '',
      'Please note that this acknowledgement is not an offer of employment or confirmation of selection.',
      '',
      'Regards,',
      'Aerinyu Studios Careers',
      'careers@aerinyustudios.com'
    ].join('\n');

    try {
      await sendEmail({
        from,
        to: [notificationTo],
        reply_to: payload.email,
        subject: `New careers application — ${job.title} — ${payload.full_name}`,
        text: staffText,
        ...(resumeAttachment ? { attachments: [resumeAttachment] } : {})
      });
      notificationSent = true;
    } catch (error) { emailErrors.push(`Staff notification: ${error.message}`); }

    try {
      await sendEmail({
        from,
        to: [payload.email],
        reply_to: notificationTo,
        subject: `Application received — ${job.title}`,
        text: applicantText
      });
      confirmationSent = true;
    } catch (error) { emailErrors.push(`Applicant confirmation: ${error.message}`); }

    await supabase.from('applications').update({ notification_sent:notificationSent, confirmation_sent:confirmationSent, notified_at:notificationSent?new Date().toISOString():null, confirmation_sent_at:confirmationSent?new Date().toISOString():null, notification_error:emailErrors.length?emailErrors.join(' | ').slice(0,2000):null }).eq('id', inserted.id);
    return res.status(201).json({ ok:true, confirmation_email_sent:confirmationSent });
  } catch (error) {
    console.error('Applications API error:', error);
    return res.status(500).json({ error:error?.message || 'Application could not be submitted.' });
  }
}
