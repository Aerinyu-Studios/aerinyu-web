import { access, friendlyDatabaseError, getSupabase, json } from '../../lib/friendship-run.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed.' });
  }

  try {
    access(req);
  } catch {
    return json(res, 401, { error: 'Your access session expired.' });
  }

  try {
    const supabase = getSupabase();

    if (String(req.query?.display || '') === '1') {
      const [settingsResult, announcementsResult] = await Promise.all([
        supabase.from('friendship_run_display_settings').select('*').eq('id', 1).maybeSingle(),
        supabase.from('friendship_run_announcements').select('*').eq('is_active', true).order('sort_order', { ascending: true }).order('created_at', { ascending: true })
      ]);

      if (settingsResult.error) throw settingsResult.error;
      if (announcementsResult.error) throw announcementsResult.error;

      return json(res, 200, {
        settings: settingsResult.data || {
          id: 1,
          display_mode: 'cycle',
          logo_duration_ms: 3200,
          leaderboard_duration_ms: 12000,
          map_duration_ms: 9000,
          announcement_duration_ms: 9000
        },
        announcements: announcementsResult.data || []
      });
    }

    const { data, error } = await supabase
      .from('friendship_run_players')
      .select('name,programme,message,photo_url,best_score,attempt_finished_at')
      .eq('attempt_used', true)
      .order('best_score', { ascending: false })
      .order('attempt_finished_at', { ascending: true })
      .limit(50);

    if (error) throw error;

    return json(res, 200, {
      entries: (data || []).map((row) => ({
        name: row.name,
        programme: row.programme || '',
        message: row.message || '',
        photo_url: row.photo_url,
        score: row.best_score || 0
      }))
    });
  } catch (error) {
    console.error('Friendship Run leaderboard error:', error);
    return json(res, 500, { error: friendlyDatabaseError(error) });
  }
}
