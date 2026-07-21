import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const secret = () => process.env.FRIENDSHIP_RUN_TOKEN_SECRET || process.env.RATE_LIMIT_SALT || process.env.ADMIN_KEY;
const b64 = value => Buffer.from(value).toString('base64url');

export function sign(payload, ttlSeconds = 60 * 60 * 8) {
  const body = b64(JSON.stringify({...payload, exp: Math.floor(Date.now()/1000)+ttlSeconds}));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verify(token) {
  if (!token || !secret()) throw new Error('Unauthorized');
  const [body,sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) throw new Error('Unauthorized');
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
