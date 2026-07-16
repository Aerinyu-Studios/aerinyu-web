import { createClient } from '@supabase/supabase-js';

const BUCKET = 'career-applications';
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server environment variables are missing.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const safeText = (value, max = 200) => String(value ?? '').trim().slice(0, max);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const fileName = safeText(req.body?.file_name, 180);
    const fileType = safeText(req.body?.file_type, 100).toLowerCase();
    const fileSize = Number(req.body?.file_size || 0);

    if (!fileName || fileType !== 'application/pdf') {
      return res.status(400).json({ error: 'Résumé must be a PDF file.' });
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'Résumé must be 5 MB or smaller.' });
    }

    const supabase = serverClient();
    const random = crypto.randomUUID();
    const date = new Date().toISOString().slice(0, 10);
    const path = `${date}/${random}.pdf`;

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: false });

    if (error) throw error;

    return res.status(200).json({
      bucket: BUCKET,
      path,
      token: data.token,
      signed_url: data.signedUrl,
      max_file_size: MAX_FILE_SIZE
    });
  } catch (error) {
    console.error('Upload API error:', error);
    return res.status(500).json({ error: error?.message || 'Could not prepare the résumé upload.' });
  }
}
