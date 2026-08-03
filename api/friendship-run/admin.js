import { clean, friendlyDatabaseError, getSupabase, json, safeEqual } from '../../lib/friendship-run.js';

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
    const type = clean(req.query?.type, 30) || 'player';
    const id = clean(req.query?.id, 80);

    if (req.method === 'GET') {
      const [playersResult, paymentsResult, auditResult, settingsResult, announcementsResult] = await Promise.all([
        supabase.from('friendship_run_players').select('*').order('updated_at', { ascending: false }),
        supabase.from('friendship_run_payments').select('*').order('created_at', { ascending: false }).limit(1000),
        supabase.from('friendship_run_audit_log').select('*').order('created_at', { ascending: false }).limit(1000),
        supabase.from('friendship_run_display_settings').select('*').eq('id', 1).maybeSingle(),
        supabase.from('friendship_run_announcements').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true })
      ]);
      for (const result of [playersResult, paymentsResult, auditResult, settingsResult, announcementsResult]) {
        if (result.error) throw result.error;
      }

      const payments = await Promise.all((paymentsResult.data || []).map(async (payment) => {
        if (!payment.proof_path) return { ...payment, proof_url: null };
        const signed = await supabase.storage.from('friendship-run-payment-proofs').createSignedUrl(payment.proof_path, 60 * 10);
        return { ...payment, proof_url: signed.data?.signedUrl || null };
      }));

      const boothPayments = payments.filter(p => p.attempt_type === 'official' && p.eligibility_source === 'booth_payment');
      const sum = rows => rows.reduce((total, row) => total + Number(row.amount_collected || 0), 0);
      const totals = {
        booth_funds: sum(boothPayments),
        cash_funds: sum(boothPayments.filter(p => p.payment_method === 'cash')),
        digital_funds: sum(boothPayments.filter(p => p.payment_method === 'digital')),
        booth_attempts: boothPayments.length,
        run_signup_attempts: payments.filter(p => p.attempt_type === 'official' && p.eligibility_source === 'run_signup').length,
        free_trials: payments.filter(p => p.attempt_type === 'trial').length,
        redeemed_codes: payments.filter(p => p.status === 'redeemed').length,
        unused_codes: payments.filter(p => p.status === 'unused').length,
        total_records: payments.length
      };

      return json(res, 200, {
        entries: playersResult.data || [],
        payments,
        audit: auditResult.data || [],
        totals,
        display_settings: settingsResult.data || null,
        announcements: announcementsResult.data || []
      });
    }

    if (type === 'display-settings') {
      if (req.method !== 'PATCH') return json(res, 405, { error: 'Method not allowed.' });
      const body = req.body || {};
      const allowedModes = ['cycle', 'logo', 'leaderboard', 'map', 'announcement'];
      const update = {
        id: 1,
        display_mode: allowedModes.includes(body.display_mode) ? body.display_mode : 'cycle',
        logo_duration_ms: intInRange(body.logo_duration_ms, 3200),
        leaderboard_duration_ms: intInRange(body.leaderboard_duration_ms, 12000),
        map_duration_ms: intInRange(body.map_duration_ms, 9000),
        announcement_duration_ms: intInRange(body.announcement_duration_ms, 9000),
        updated_at: new Date().toISOString()
      };
      const changed = await supabase.from('friendship_run_display_settings').upsert(update, { onConflict: 'id' }).select().single();
      if (changed.error) throw changed.error;
      await supabase.from('friendship_run_audit_log').insert({ event_type: 'admin_display_settings_updated', metadata: update });
      return json(res, 200, { settings: changed.data });
    }

    if (type === 'announcement') {
      const body = req.body || {};
      if (req.method === 'POST') {
        const title = clean(body.title, 100);
        const announcementBody = clean(body.body, 500);
        if (!title || !announcementBody) return json(res, 400, { error: 'Announcement title and message are required.' });
        const insert = {
          eyebrow: clean(body.eyebrow, 50) || 'EVENT UPDATE',
          title,
          body: announcementBody,
          is_active: body.is_active !== false,
          sort_order: Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0,
          duration_ms: body.duration_ms ? intInRange(body.duration_ms, 9000) : null,
          updated_at: new Date().toISOString()
        };
        const created = await supabase.from('friendship_run_announcements').insert(insert).select().single();
        if (created.error) throw created.error;
        await supabase.from('friendship_run_audit_log').insert({ event_type: 'admin_announcement_created', metadata: { announcement_id: created.data.id, ...insert } });
        return json(res, 201, { announcement: created.data });
      }
      if (!id) return json(res, 400, { error: 'Announcement ID is required.' });
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
        await supabase.from('friendship_run_audit_log').insert({ event_type: 'admin_announcement_updated', metadata: { announcement_id: id, ...update } });
        return json(res, 200, { announcement: changed.data });
      }
      if (req.method === 'DELETE') {
        const removed = await supabase.from('friendship_run_announcements').delete().eq('id', id);
        if (removed.error) throw removed.error;
        await supabase.from('friendship_run_audit_log').insert({ event_type: 'admin_announcement_deleted', metadata: { announcement_id: id } });
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'Method not allowed.' });
    }

    if (!id) return json(res, 400, { error: 'Record ID is required.' });

    if (type === 'payment') {
      if (req.method === 'DELETE') return json(res, 405, { error: 'Payment evidence is retained for audit. Revoke the record instead of deleting it.' });
      if (req.method === 'PATCH') {
        const body = req.body || {};
        const update = { updated_at: new Date().toISOString() };
        if ('status' in body && ['unused','redeemed','expired','revoked'].includes(body.status)) update.status = body.status;
        if ('audit_note' in body) update.audit_note = clean(body.audit_note, 240);
        if ('student_id' in body) {
          update.student_id = clean(body.student_id, 40);
          update.student_id_normalized = update.student_id.toUpperCase().replace(/\s+/g, '');
        }
        if (body.regenerate_code === true) {
          let generated = null;
          for (let i = 0; i < 12; i += 1) {
            const code = String(Math.floor(100000 + Math.random() * 900000));
            const test = await supabase.from('friendship_run_payments').select('id').eq('play_code', code).in('status', ['unused','redeemed']).maybeSingle();
            if (!test.data) { generated = code; break; }
          }
          if (!generated) return json(res, 500, { error: 'Could not generate a unique code.' });
          update.play_code = generated;
          update.status = 'unused';
          update.redeemed_at = null;
          update.player_id = null;
          update.expires_at = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        }
        const changed = await supabase.from('friendship_run_payments').update(update).eq('id', id).select().single();
        if (changed.error) throw changed.error;
        await supabase.from('friendship_run_audit_log').insert({ event_type: 'admin_payment_updated', payment_id: id, metadata: update });
        return json(res, 200, { payment: changed.data });
      }
      return json(res, 405, { error: 'Method not allowed.' });
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
      if ('programme' in body) update.programme = clean(body.programme, 60);
      if ('message' in body) update.message = clean(body.message, 180);
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
      if (body.reset_attempt === true) Object.assign(update, { score: null, best_score: 0, duration_ms: null, attempt_used: false, attempt_started_at: null, attempt_finished_at: null, current_attempt_nonce: null, current_payment_id: null, current_attempt_completed: true });
      const { data, error } = await supabase.from('friendship_run_players').update(update).eq('id', id).select().single();
      if (error) throw error;
      await supabase.from('friendship_run_audit_log').insert({ event_type: 'admin_player_updated', player_id: id, student_id_normalized: data.student_id_normalized, metadata: update });
      return json(res, 200, { entry: data });
    }

    return json(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error('Friendship Run admin error:', error);
    return json(res, 500, { error: friendlyDatabaseError(error) });
  }
}
