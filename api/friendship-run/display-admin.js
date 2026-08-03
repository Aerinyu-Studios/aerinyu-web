import { clean, friendlyDatabaseError, getSupabase, json, safeEqual } from './_lib.js';

function adminAccess(req) {
  const key = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || !safeEqual(key, process.env.ADMIN_KEY)) throw new Error('UNAUTHORIZED');
}

const intInRange = (value, fallback, min = 1000, max = 120000) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

export default async function handler(req, res) {
  try { adminAccess(req); } catch { return json(res, 401, { error: 'The admin key is incorrect.' }); }

  try {
    const supabase = getSupabase();
    const type = clean(req.query?.type, 30);
    const id = clean(req.query?.id, 80);

    if (req.method === 'GET') {
      const [settings, announcements] = await Promise.all([
        supabase.from('friendship_run_display_settings').select('*').eq('id', 1).maybeSingle(),
        supabase.from('friendship_run_announcements').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true })
      ]);
      if (settings.error) throw settings.error;
      if (announcements.error) throw announcements.error;
      return json(res, 200, { display_settings: settings.data || null, announcements: announcements.data || [] });
    }

    if (type === 'display-settings') {
      if (req.method !== 'PATCH') return json(res, 405, { error: `Method ${req.method} not allowed.` });
      const body = req.body || {};
      const modes = ['cycle', 'logo', 'leaderboard', 'map', 'announcement'];
      const update = {
        id: 1,
        display_mode: modes.includes(body.display_mode) ? body.display_mode : 'cycle',
        logo_duration_ms: intInRange(body.logo_duration_ms, 3200),
        leaderboard_duration_ms: intInRange(body.leaderboard_duration_ms, 12000),
        map_duration_ms: intInRange(body.map_duration_ms, 9000),
        announcement_duration_ms: intInRange(body.announcement_duration_ms, 9000),
        updated_at: new Date().toISOString()
      };
      const changed = await supabase.from('friendship_run_display_settings').upsert(update, { onConflict: 'id' }).select().single();
      if (changed.error) throw changed.error;
      return json(res, 200, { settings: changed.data });
    }

    if (type !== 'announcement') return json(res, 400, { error: 'Unknown display-control request.' });
    const body = req.body || {};

    if (req.method === 'POST') {
      const title = clean(body.title, 100);
      const message = clean(body.body, 500);
      if (!title || !message) return json(res, 400, { error: 'Announcement title and message are required.' });
      const insert = {
        eyebrow: clean(body.eyebrow, 50) || 'EVENT UPDATE', title, body: message,
        is_active: body.is_active !== false,
        sort_order: Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0,
        duration_ms: body.duration_ms ? intInRange(body.duration_ms, 9000) : null,
        updated_at: new Date().toISOString()
      };
      const created = await supabase.from('friendship_run_announcements').insert(insert).select().single();
      if (created.error) throw created.error;
      return json(res, 201, { announcement: created.data });
    }

    if (!id) return json(res, 400, { error: 'Announcement ID is required for editing or deleting.' });

    if (req.method === 'PATCH') {
      const update = { updated_at: new Date().toISOString() };
      if ('eyebrow' in body) update.eyebrow = clean(body.eyebrow, 50) || 'EVENT UPDATE';
      if ('title' in body) update.title = clean(body.title, 100);
      if ('body' in body) update.body = clean(body.body, 500);
      if ('is_active' in body) update.is_active = Boolean(body.is_active);
      if ('sort_order' in body) update.sort_order = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0;
      if ('duration_ms' in body) update.duration_ms = body.duration_ms ? intInRange(body.duration_ms, 9000) : null;
      const changed = await supabase.from('friendship_run_announcements').update(update).eq('id', id).select().single();
      if (changed.error) throw changed.error;
      return json(res, 200, { announcement: changed.data });
    }

    if (req.method === 'DELETE') {
      const removed = await supabase.from('friendship_run_announcements').delete().eq('id', id);
      if (removed.error) throw removed.error;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: `Method ${req.method} not allowed.` });
  } catch (error) {
    console.error('Friendship Run display admin error:', error);
    return json(res, 500, { error: friendlyDatabaseError(error) });
  }
}
