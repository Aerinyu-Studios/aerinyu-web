import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const getSupabaseUrl = () =>
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL || '';

const getServiceKey = () =>
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE || '';

let cachedSupabase;
export function getSupabase() {
  if (cachedSupabase) return cachedSupabase;
  const url = getSupabaseUrl();
  const key = getServiceKey();
  if (!url || !key || /YOUR_EXISTING_/i.test(url) || /YOUR_EXISTING_/i.test(key)) {
    throw new Error('Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.');
  }
  cachedSupabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return cachedSupabase;
}

const secret = () =>
  process.env.FRIENDSHIP_RUN_TOKEN_SECRET ||
  process.env.RATE_LIMIT_SALT ||
  process.env.ADMIN_KEY || '';
const b64 = value => Buffer.from(value).toString('base64url');

export function sign(payload, ttlSeconds = 60 * 60 * 8) {
  if (!secret()) throw new Error('FRIENDSHIP_RUN_TOKEN_SECRET is not configured.');
  const body = b64(JSON.stringify({...payload, exp: Math.floor(Date.now()/1000)+ttlSeconds}));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verify(token) {
  if (!token || !secret()) throw new Error('Unauthorized');
  const [body,sig] = token.split('.');
  if (!body || !sig) throw new Error('Unauthorized');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) throw new Error('Unauthorized');
  const payload = JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Date.now()/1000) throw new Error('Session expired');
  return payload;
}
export function access(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  const payload = verify(token);
  if (payload.type !== 'friendship-run-access') throw new Error('Unauthorized');
  return payload;
}
export function safeEqual(a,b){
  const ah=crypto.createHash('sha256').update(String(a||'')).digest();
  const bh=crypto.createHash('sha256').update(String(b||'')).digest();
  return crypto.timingSafeEqual(ah,bh);
}
export function json(res,status,body){res.status(status).json(body)}
export function clean(value,max=100){return String(value||'').trim().replace(/[<>]/g,'').slice(0,max)}
export function friendlyDatabaseError(error) {
  const message = String(error?.message || error || '');
  if (/friendship_run_players|relation .* does not exist|schema cache/i.test(message)) {
    return 'The Friendship Run database table is missing. Run friendship-run.sql in the Supabase SQL Editor.';
  }
  if (/invalid api key|jwt|unauthorized|permission/i.test(message)) {
    return 'The Supabase service-role key is invalid or missing in Vercel.';
  }
  return 'The Friendship Run database could not be reached.';
}
