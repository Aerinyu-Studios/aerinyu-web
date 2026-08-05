import { friendlyDatabaseError, getSupabase, json, verify } from '../../lib/friendship-run.js';

function boothAccess(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = verify(token);
  if (payload.type !== 'friendship-run-booth') throw new Error('UNAUTHORIZED');
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  let operator;
  try { operator = boothAccess(req); } catch { return json(res, 401, { error: 'Your booth session expired.' }); }
  try {
    const supabase = getSupabase();
    const boothId = [1,2].includes(Number(req.query?.booth)) ? Number(req.query.booth) : 1;
    const { data, error } = await supabase.from('friendship_run_payments')
      .select('id,student_id,play_code,status,attempt_type,eligibility_source,payment_method,amount_collected,operator_name,operator_username,booth_id,created_at,redeemed_at,completed_at')
      .eq('booth_id', boothId).order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    const rows = data || [];
    const total = predicate => rows.filter(predicate).reduce((sum,row)=>sum+Number(row.amount_collected||0),0);
    const count = predicate => rows.filter(predicate).length;
    return json(res, 200, {
      booth_id: boothId,
      operator: { username: operator.operator_username, name: operator.operator_name },
      totals: {
        funds_collected: total(r=>r.attempt_type==='official'&&r.eligibility_source==='booth_payment'),
        cash_collected: total(r=>r.payment_method==='cash'), digital_collected: total(r=>r.payment_method==='digital'),
        free_trials: count(r=>r.attempt_type==='trial'), run_signup_attempts: count(r=>r.eligibility_source==='run_signup'),
        paid_booth_attempts: count(r=>r.eligibility_source==='booth_payment')
      },
      recent: rows.slice(0,40)
    });
  } catch (error) {
    console.error('Friendship Run booth summary error:', error);
    return json(res, 500, { error: friendlyDatabaseError(error) });
  }
}
