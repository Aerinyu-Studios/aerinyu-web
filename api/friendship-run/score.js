import { access, friendlyDatabaseError, getSupabase, json, verify } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed.' });
  }

  try {
    access(req);
  } catch {
    return json(res, 401, { error: 'Your access session expired.' });
  }

  let attempt;
  try {
    attempt = verify(req.body?.attempt_token);
  } catch {
    return json(res, 401, { error: 'This attempt is no longer valid.' });
  }

  if (attempt.type !== 'friendship-run-attempt') {
    return json(res, 401, { error: 'Invalid attempt.' });
  }

  const score = Number(req.body?.score);
  const duration = Number(req.body?.duration_ms);

  if (
    !Number.isInteger(score) || score < 0 || score > 575 ||
    !Number.isFinite(duration) || duration < 1000
  ) {
    return json(res, 400, { error: 'Invalid score data.' });
  }

  const elapsed = Math.max(duration, Date.now() - attempt.started_at - 5000);
  const theoreticalMax = Math.floor(elapsed / 62) + 3;

  if (score > theoreticalMax) {
    return json(res, 400, { error: 'The score could not be verified.' });
  }

  try {
    const supabase = getSupabase();
    const { data: player, error: readError } = await supabase
      .from('friendship_run_players')
      .select('*')
      .eq('id', attempt.player_id)
      .single();

    if (readError || !player) {
      return json(res, 404, { error: 'Player entry not found.' });
    }

    if (player.attempt_used) {
      return json(res, 409, { error: 'This official attempt has already been submitted.' });
    }

    const update = await supabase
      .from('friendship_run_players')
      .update({
        score,
        best_score: Math.max(score, player.best_score || 0),
        attempt_used: true,
        attempt_finished_at: new Date().toISOString(),
        duration_ms: Math.round(duration)
      })
      .eq('id', player.id)
      .eq('attempt_used', false)
      .select()
      .single();

    if (update.error) throw update.error;

    const { count, error: rankError } = await supabase
      .from('friendship_run_players')
      .select('*', { count: 'exact', head: true })
      .eq('attempt_used', true)
      .gt('best_score', score);

    if (rankError) throw rankError;

    return json(res, 200, { ok: true, rank: (count || 0) + 1 });
  } catch (error) {
    console.error('Friendship Run score error:', error);
    return json(res, 500, { error: friendlyDatabaseError(error) });
  }
}
