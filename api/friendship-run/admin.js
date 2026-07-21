import { clean, friendlyDatabaseError, getSupabase, json, safeEqual } from './_lib.js';

function adminAccess(req) {
  const key = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || !safeEqual(key, process.env.ADMIN_KEY)) throw new Error('UNAUTHORIZED');
}

export default async function handler(req, res) {
  try { adminAccess(req); } catch { return json(res, 401, { error: 'The admin key is incorrect.' }); }

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('friendship_run_players')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return json(res, 200, { entries: data || [] });
    }

    const id = clean(req.query?.id, 80);
    if (!id) return json(res, 400, { error: 'Entry ID is required.' });

    if (req.method === 'DELETE') {
      const { error } = await supabase.from('friendship_run_players').delete().eq('id', id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const update = { updated_at: new Date().toISOString() };

      if ('name' in body) update.name = clean(body.name, 70);
      if ('student_id' in body) {
        update.student_id = clean(body.student_id, 40);
        update.student_id_normalized = update.student_id.toUpperCase().replace(/\s+/g, '');
      }
      if ('best_score' in body) {
        const score = Number(body.best_score);
        if (!Number.isInteger(score) || score < 0 || score > 9999) return json(res, 400, { error: 'Enter a valid score.' });
        update.best_score = score;
        update.score = score;
      }
      if ('attempt_used' in body) update.attempt_used = Boolean(body.attempt_used);
      if ('payment_confirmed' in body) update.payment_confirmed = Boolean(body.payment_confirmed);
      if (body.reset_attempt === true) {
        update.score = null;
        update.best_score = 0;
        update.duration_ms = null;
        update.attempt_used = false;
        update.attempt_started_at = null;
        update.attempt_finished_at = null;
        update.current_attempt_nonce = null;
      }

      const { data, error } = await supabase
        .from('friendship_run_players')
        .update(update)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return json(res, 200, { entry: data });
    }

    return json(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error('Friendship Run admin error:', error);
    return json(res, 500, { error: friendlyDatabaseError(error) });
  }
}
