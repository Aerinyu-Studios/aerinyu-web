import { json, safeEqual, sign } from '../../lib/friendship-run.js';

function loadUsers() {
  const raw = String(process.env.FRIENDSHIP_RUN_BOOTH_USERS || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((user) => ({
        username: String(user?.username || '').trim(),
        password: String(user?.password || ''),
        name: String(user?.name || user?.display_name || user?.username || '').trim()
      }))
      .filter((user) => user.username && user.password && user.name);
  } catch {
    return [];
  }
}

export default function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

  const users = loadUsers();
  if (!users.length) {
    return json(res, 500, { error: 'FRIENDSHIP_RUN_BOOTH_USERS is not configured correctly.' });
  }

  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = users.find((candidate) => candidate.username.toLowerCase() === username);

  if (!user || !safeEqual(password, user.password)) {
    return json(res, 403, { error: 'Incorrect staff username or password.' });
  }

  return json(res, 200, {
    token: sign({
      type: 'friendship-run-booth',
      operator_username: user.username,
      operator_name: user.name
    }, 60 * 60 * 12),
    operator: { username: user.username, name: user.name }
  });
}
