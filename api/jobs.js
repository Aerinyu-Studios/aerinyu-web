import { createClient } from '@supabase/supabase-js';

const allowedFields = [
  'title',
  'department',
  'work_type',
  'engagement_type',
  'location',
  'summary',
  'about_role',
  'responsibilities',
  'requirements',
  'preferred_skills',
  'benefits',
  'schedule_type',
  'hours_description',
  'estimated_hours_per_week',
  'meeting_requirements',
  'compensation_type',
  'compensation',
  'application_url',
  'is_open',
  'featured',
  'display_order'
];

const cleanPayload = (body = {}) =>
  Object.fromEntries(
    allowedFields
      .filter((key) => key in body)
      .map((key) => [key, body[key]])
  );

const authorised = (req) =>
  Boolean(process.env.ADMIN_KEY) &&
  req.headers['x-admin-key'] === process.env.ADMIN_KEY;

export default async function handler(req, res) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL is missing from the Vercel environment.');
    }

    if (!supabaseKey) {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY is missing from the Vercel environment.'
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    if (req.method === 'GET') {
      const adminView = req.query.admin === '1';

      if (adminView && !authorised(req)) {
        return res.status(401).json({ error: 'Unauthorised' });
      }

      let query = supabase
        .from('jobs')
        .select('*')
        .order('featured', { ascending: false })
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (!adminView) {
        query = query.eq('is_open', true);
      }

      const { data, error } = await query;

      if (error) throw error;

      return res.status(200).json(data);
    }

    if (!authorised(req)) {
      return res.status(401).json({ error: 'Unauthorised' });
    }

    if (req.method === 'POST') {
      const payload = cleanPayload(req.body);

      const { data, error } = await supabase
        .from('jobs')
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json(data);
    }

    const id = req.query.id;

    if (!id) {
      return res.status(400).json({ error: 'Missing job id' });
    }

    if (req.method === 'PATCH') {
      const payload = cleanPayload(req.body);

      const { data, error } = await supabase
        .from('jobs')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const { error } = await supabase
        .from('jobs')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Jobs API error:', error);

    return res.status(500).json({
      error: error?.message || 'Unknown server error',
      code: error?.code || null,
      details: error?.details || null,
      hint: error?.hint || null
    });
  }
}