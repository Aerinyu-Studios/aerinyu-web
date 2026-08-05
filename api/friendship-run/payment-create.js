import crypto from 'node:crypto';
import { clean, friendlyDatabaseError, getSupabase, json, verify } from '../../lib/friendship-run.js';

function boothAccess(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = verify(token);
  if (payload.type !== 'friendship-run-booth') throw new Error('UNAUTHORIZED');
  return payload;
}

function code6() { return String(crypto.randomInt(100000, 1000000)); }

async function uploadEvidence(supabase, dataUrl, normalized, kind) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('EVIDENCE_REQUIRED');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 2 * 1024 * 1024) throw new Error('EVIDENCE_TOO_LARGE');
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[match[1]];
  const path = `${new Date().toISOString().slice(0,10)}/${normalized}-${kind}-${crypto.randomUUID()}.${ext}`;
  const upload = await supabase.storage.from('friendship-run-payment-proofs').upload(path, buffer, { contentType: match[1], upsert: false });
  if (upload.error) throw upload.error;
  return path;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  let operator;
  try { operator = boothAccess(req); } catch { return json(res, 401, { error: 'Your booth session expired.' }); }

  try {
    const supabase = getSupabase();
    const studentId = clean(req.body?.student_id, 40);
    const attemptType = clean(req.body?.attempt_type, 20);
    const eligibilitySource = clean(req.body?.eligibility_source, 30);
    const paymentMethod = clean(req.body?.payment_method, 20) || 'none';
    const note = clean(req.body?.note, 240);
    const boothId = Number(req.body?.booth_id);

    if (studentId.length < 3) return json(res, 400, { error: 'Enter a valid student ID.' });
    if (![1,2].includes(boothId)) return json(res, 400, { error: 'Choose Booth 1 or Booth 2.' });
    if (!['trial','official'].includes(attemptType)) return json(res, 400, { error: 'Choose free trial or official attempt.' });

    const normalized = studentId.toUpperCase().replace(/\s+/g, '');
    let source = eligibilitySource;
    let method = paymentMethod;
    let amount = 0;
    let evidenceKind = null;
    let proofPath = null;

    if (attemptType === 'trial') {
      source = 'free_trial'; method = 'none';
      const existingTrial = await supabase.from('friendship_run_payments').select('id').eq('student_id_normalized', normalized).eq('attempt_type', 'trial').limit(1);
      if (existingTrial.error) throw existingTrial.error;
      if (existingTrial.data?.length) return json(res, 409, { error: 'A free trial has already been issued for this student ID.' });
    } else {
      if (!['booth_payment','run_signup'].includes(source)) return json(res, 400, { error: 'Choose how the official attempt is covered.' });
      if (source === 'run_signup') {
        method = 'run_signup'; amount = 0; evidenceKind = 'run_registration_receipt';
        const existing = await supabase.from('friendship_run_payments').select('id').eq('student_id_normalized', normalized).eq('eligibility_source','run_signup').limit(1);
        if (existing.error) throw existing.error;
        if (existing.data?.length) return json(res, 409, { error: 'This student ID has already used the Friendship Run signup entitlement.' });
      } else {
        amount = 3;
        if (!['cash','digital'].includes(method)) return json(res, 400, { error: 'Choose cash or digital payment.' });
        evidenceKind = method === 'cash' ? 'cash_handover_photo' : 'digital_payment_receipt';
      }
      try { proofPath = await uploadEvidence(supabase, req.body?.proof_data, normalized, evidenceKind); }
      catch (error) {
        if (error.message === 'EVIDENCE_REQUIRED') return json(res, 400, { error: source === 'run_signup' ? 'Take a photo of the Friendship Run registration receipt.' : method === 'cash' ? 'Take a cash handover photo first.' : 'Take a payment receipt photo first.' });
        if (error.message === 'EVIDENCE_TOO_LARGE') return json(res, 400, { error: 'The evidence photo is too large.' });
        throw error;
      }
    }

    let record;
    for (let i = 0; i < 12; i += 1) {
      const inserted = await supabase.from('friendship_run_payments').insert({
        student_id: studentId, student_id_normalized: normalized, play_code: code6(), proof_path: proofPath,
        status: 'unused', attempt_type: attemptType, eligibility_source: source, payment_method: method,
        amount_collected: amount, evidence_kind: evidenceKind, booth_id: boothId,
        operator_username: operator.operator_username, operator_name: operator.operator_name,
        audit_note: note || null, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      }).select().single();
      if (!inserted.error) { record = inserted.data; break; }
      if (inserted.error.code !== '23505') throw inserted.error;
    }
    if (!record) throw new Error('Could not generate a unique play code.');

    await supabase.from('friendship_run_audit_log').insert({
      event_type: 'code_issued', payment_id: record.id, student_id_normalized: normalized,
      operator_username: operator.operator_username, operator_name: operator.operator_name,
      metadata: { booth_id: boothId, attempt_type: attemptType, eligibility_source: source, payment_method: method, amount_collected: amount, evidence_kind: evidenceKind, audit_note: note || null }
    });

    return json(res, 201, { payment: { id: record.id, student_id: record.student_id, play_code: record.play_code, status: record.status, attempt_type: record.attempt_type, eligibility_source: record.eligibility_source, payment_method: record.payment_method, amount_collected: record.amount_collected, booth_id: record.booth_id, expires_at: record.expires_at } });
  } catch (error) {
    console.error('Friendship Run payment-create error:', error);
    return json(res, 500, { error: friendlyDatabaseError(error) });
  }
}
