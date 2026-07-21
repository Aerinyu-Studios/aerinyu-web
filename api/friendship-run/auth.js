import { json, safeEqual, sign } from './_lib.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed.' });
  }

  try {
    const configuredPassword = String(
      process.env.FRIENDSHIP_RUN_PASSWORD || ''
    ).trim();

    if (!configuredPassword) {
      return json(res, 500, {
        error: 'FRIENDSHIP_RUN_PASSWORD is not configured in Vercel.'
      });
    }

    const submittedPassword = String(req.body?.password || '').trim();

    if (!submittedPassword || !safeEqual(submittedPassword, configuredPassword)) {
      return json(res, 403, { error: 'Incorrect access password.' });
    }

    const token = sign(
      { type: 'friendship-run-access' },
      60 * 60 * 8
    );

    return json(res, 200, { token });
  } catch (error) {
    console.error('Friendship Run auth error:', error);
    return json(res, 500, {
      error: error?.message || 'The access check failed.'
    });
  }
}
