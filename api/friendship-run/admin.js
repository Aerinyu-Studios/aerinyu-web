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
      const [playersResult, paymentsResult] = await Promise.all([
        supabase.from('friendship_run_players').select('*').order('updated_at', { ascending: false }),
        supabase.from('friendship_run_payments').select('*').order('created_at', { ascending: false }).limit(500)
      ]);
      if (playersResult.error) throw playersResult.error;
      if (paymentsResult.error) throw paymentsResult.error;

      const payments = await Promise.all((paymentsResult.data || []).map(async payment => {
        const signed = await supabase.storage.from('friendship-run-payment-proofs').createSignedUrl(payment.proof_path, 60 * 10);
        return { ...payment, proof_url: signed.data?.signedUrl || null };
      }));
      return json(res, 200, { entries: playersResult.data || [], payments });
    }

    const type = clean(req.query?.type, 20) || 'player';
    const id = clean(req.query?.id, 80);
    if (!id) return json(res, 400, { error: 'Record ID is required.' });

    if (type === 'payment') {
      if (req.method === 'DELETE') {
        const found = await supabase.from('friendship_run_payments').select('proof_path').eq('id', id).single();
        if (found.error) throw found.error;
        const deleted = await supabase.from('friendship_run_payments').delete().eq('id', id);
        if (deleted.error) throw deleted.error;
        if (found.data?.proof_path) await supabase.storage.from('friendship-run-payment-proofs').remove([found.data.proof_path]);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'PATCH') {
        const body = req.body || {};
        const update = { updated_at: new Date().toISOString() };
        if ('status' in body && ['unused','redeemed','expired','revoked'].includes(body.status)) update.status = body.status;
        if ('student_id' in body) {
          update.student_id = clean(body.student_id, 40);
          update.student_id_normalized = update.student_id.toUpperCase().replace(/\s+/g, '');
        }
        if (body.regenerate_code === true) {
          let generated = null;
          for (let i=0;i<12;i+=1) {
            const code=String(Math.floor(100000+Math.random()*900000));
            const test=await supabase.from('friendship_run_payments').select('id').eq('play_code',code).in('status',['unused','redeemed']).maybeSingle();
            if (!test.data) { generated=code; break; }
          }
          if (!generated) return json(res,500,{error:'Could not generate a unique code.'});
          update.play_code=generated; update.status='unused'; update.redeemed_at=null; update.player_id=null;
          update.expires_at=new Date(Date.now()+30*60*1000).toISOString();
        }
        const changed=await supabase.from('friendship_run_payments').update(update).eq('id',id).select().single();
        if (changed.error) throw changed.error;
        return json(res,200,{payment:changed.data});
      }
      return json(res,405,{error:'Method not allowed.'});
    }

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
        update.best_score = score; update.score = score;
      }
      if ('attempt_used' in body) update.attempt_used = Boolean(body.attempt_used);
      if (body.reset_attempt === true) {
        Object.assign(update,{score:null,best_score:0,duration_ms:null,attempt_used:false,attempt_started_at:null,attempt_finished_at:null,current_attempt_nonce:null,current_payment_id:null});
      }
      const { data, error } = await supabase.from('friendship_run_players').update(update).eq('id', id).select().single();
      if (error) throw error;
      return json(res, 200, { entry: data });
    }

    return json(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error('Friendship Run admin error:', error);
    return json(res, 500, { error: friendlyDatabaseError(error) });
  }
}
