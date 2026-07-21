import crypto from 'node:crypto';
import { clean, friendlyDatabaseError, getSupabase, json, verify } from './_lib.js';

function boothAccess(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = verify(token);
  if (payload.type !== 'friendship-run-booth') throw new Error('UNAUTHORIZED');
}

function code6() {
  return String(crypto.randomInt(100000, 1000000));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try { boothAccess(req); } catch { return json(res, 401, { error: 'Your booth session expired.' }); }

  try {
    const supabase = getSupabase();
    const studentId = clean(req.body?.student_id, 40);
    const proof = String(req.body?.proof_data || '');
    if (studentId.length < 3) return json(res, 400, { error: 'Enter a valid student ID.' });

    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(proof);
    if (!match) return json(res, 400, { error: 'Take a payment proof photo first.' });
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 2 * 1024 * 1024) return json(res, 400, { error: 'The payment proof image is too large.' });

    const normalized = studentId.toUpperCase().replace(/\s+/g, '');
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[match[1]];
    const proofPath = `${new Date().toISOString().slice(0,10)}/${normalized}-${crypto.randomUUID()}.${ext}`;
    const upload = await supabase.storage.from('friendship-run-payment-proofs').upload(proofPath, buffer, { contentType: match[1], upsert: false });
    if (upload.error) throw upload.error;

    let payment;
    for (let i = 0; i < 12; i += 1) {
      const playCode = code6();
      const inserted = await supabase.from('friendship_run_payments').insert({
        student_id: studentId,
        student_id_normalized: normalized,
        play_code: playCode,
        proof_path: proofPath,
        status: 'unused',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      }).select().single();
      if (!inserted.error) { payment = inserted.data; break; }
      if (inserted.error.code !== '23505') throw inserted.error;
    }
    if (!payment) throw new Error('Could not generate a unique play code.');

    return json(res, 200, {
      payment: {
        id: payment.id,
        student_id: payment.student_id,
        play_code: payment.play_code,
        expires_at: payment.expires_at
      }
    });
  } catch (error) {
    console.error('Friendship Run payment creation error:', error);
    return json(res, 500, { error: friendlyDatabaseError(error) });
  }
}
