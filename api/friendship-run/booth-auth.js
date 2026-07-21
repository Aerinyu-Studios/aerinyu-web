import { json, safeEqual, sign } from './_lib.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const supplied = String(req.body?.key || '');
  const expected = String(process.env.FRIENDSHIP_RUN_BOOTH_KEY || '');
  if (!expected) return json(res, 500, { error: 'FRIENDSHIP_RUN_BOOTH_KEY is not configured.' });
  if (!safeEqual(supplied, expected)) return json(res, 403, { error: 'The booth key is incorrect.' });
  return json(res, 200, { token: sign({ type: 'friendship-run-booth' }, 60 * 60 * 12) });
}
