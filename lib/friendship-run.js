import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const getSupabaseUrl = () =>
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL || '';

const getServiceKey = () =>
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE || '';

let cachedSupabase;
export function getSupabase() {
  if (cachedSupabase) return cachedSupabase;

  const url = getSupabaseUrl().trim();
  const key = getServiceKey().trim();

  if (!url || !key || /YOUR_EXISTING_/i.test(url) || /YOUR_EXISTING_/i.test(key)) {
    throw new Error('SUPABASE_CONFIG_MISSING');
  }

  cachedSupabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'friendship-run-server' } }
  });

  return cachedSupabase;
}

const tokenSecret = () =>
  process.env.FRIENDSHIP_RUN_TOKEN_SECRET ||
  process.env.RATE_LIMIT_SALT ||
  process.env.ADMIN_KEY || '';

const b64 = (value) => Buffer.from(value).toString('base64url');

export function sign(payload, ttlSeconds = 60 * 60 * 8) {
  const secret = tokenSecret();
  if (!secret) throw new Error('TOKEN_SECRET_MISSING');

  const body = b64(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  }));

  const signature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url');

  return `${body}.${signature}`;
}

export function verify(token) {
  const secret = tokenSecret();
  if (!token || !secret) throw new Error('UNAUTHORIZED');

  const [body, signature] = token.split('.');
  if (!body || !signature) throw new Error('UNAUTHORIZED');

  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url');

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error('UNAUTHORIZED');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Date.now() / 1000) throw new Error('SESSION_EXPIRED');

  return payload;
}

export function access(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = verify(token);
  if (payload.type !== 'friendship-run-access') throw new Error('UNAUTHORIZED');
  return payload;
}

export function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a || '')).digest();
  const right = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(left, right);
}

export function json(res, status, body) {
  res.status(status).json(body);
}

export function clean(value, max = 100) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, max);
}

export function friendlyDatabaseError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');
  const details = String(error?.details || '');
  const combined = `${code} ${message} ${details}`;

  if (/SUPABASE_CONFIG_MISSING/i.test(combined)) {
    return 'Supabase is not configured for this deployment. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then redeploy.';
  }

  if (/42P01|PGRST205|friendship_run_players|relation .* does not exist|schema cache/i.test(combined)) {
    return 'The friendship_run_players table is unavailable in the Supabase project connected to Vercel. Run friendship-run.sql in that same project.';
  }

  if (/invalid api key|invalid jwt|jwt malformed|unauthorized|permission denied|42501/i.test(combined)) {
    return 'The Supabase server key was rejected. Use the service-role key for the same project as SUPABASE_URL.';
  }

  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(combined)) {
    return 'The server could not connect to Supabase. Check SUPABASE_URL and redeploy.';
  }

  console.error('Unmapped Friendship Run database error:', { code, message, details });
  return `Supabase request failed${code ? ` (${code})` : ''}. Check the Vercel function log for the full error.`;
}
