import { createClient } from '@supabase/supabase-js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const BUCKET = 'career-applications';
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_UPLOAD_ATTEMPTS_PER_HOUR = 5;

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server environment variables are missing.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const safeText = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const clientIp = (req) => safeText((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || 'unknown', 100);
const ipHash = (req) => createHash('sha256').update(`${clientIp(req)}:${process.env.RATE_LIMIT_SALT || process.env.ADMIN_KEY || 'aerinyu'}`).digest('hex');

async function verifyTurnstile(token, req) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token, remoteip: clientIp(req) });
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const result = await response.json().catch(() => ({}));
  return result.success === true;
}

function signUploadToken(path, hash) {
  const secret = process.env.UPLOAD_TOKEN_SECRET || process.env.ADMIN_KEY;
  if (!secret) throw new Error('UPLOAD_TOKEN_SECRET or ADMIN_KEY is required.');
  const payload = Buffer.from(JSON.stringify({ path, hash, exp: Date.now() + 15 * 60 * 1000 })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const fileName = safeText(req.body?.file_name, 180);
    const fileType = safeText(req.body?.file_type, 100).toLowerCase();
    const fileSize = Number(req.body?.file_size || 0);
    const turnstileToken = safeText(req.body?.turnstile_token, 3000);

    if (!fileName || fileType !== 'application/pdf' || !fileName.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Résumé must be a PDF file.' });
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'Résumé must be 5 MB or smaller.' });
    }
    if (!(await verifyTurnstile(turnstileToken, req))) {
      return res.status(400).json({ error: 'Security verification failed. Please try again.' });
    }

    const supabase = serverClient();
    const hash = ipHash(req);
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from('career_upload_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', hash)
      .gte('created_at', since);
    if (countError) throw countError;
    if ((count || 0) >= MAX_UPLOAD_ATTEMPTS_PER_HOUR) {
      return res.status(429).json({ error: 'Too many upload attempts. Please try again later.' });
    }

    const random = crypto.randomUUID();
    const date = new Date().toISOString().slice(0, 10);
    const path = `${date}/${random}.pdf`;

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (error) throw error;

    await supabase.from('career_upload_attempts').insert({ ip_hash: hash, resume_path: path });

    return res.status(200).json({
      bucket: BUCKET,
      path,
      upload_token: signUploadToken(path, hash),
      signed_url: data.signedUrl,
      max_file_size: MAX_FILE_SIZE
    });
  } catch (error) {
    console.error('Upload API error:', error);
    return res.status(500).json({ error: error?.message || 'Could not prepare the résumé upload.' });
  }
}
