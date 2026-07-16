import { createClient } from "@supabase/supabase-js";
const authorised = (req) =>
  Boolean(process.env.ADMIN_KEY) &&
  req.headers["x-admin-key"] === process.env.ADMIN_KEY;
const text = (v, max = 1000) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
export default async function handler(req, res) {
  try {
    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key =
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      throw new Error("Supabase server environment variables are missing.");
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (req.method === "GET") {
      if (!authorised(req))
        return res.status(401).json({ error: "Unauthorised" });
      const { data, error } = await supabase
        .from("applications")
        .select("*, jobs(title, unit_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json(data);
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (text(req.body?.website, 200)) return res.status(200).json({ ok: true });
    const payload = {
      job_id: text(req.body?.job_id, 60),
      full_name: text(req.body?.full_name, 120),
      email: text(req.body?.email, 254).toLowerCase(),
      discord_username: text(req.body?.discord_username, 100) || null,
      country_timezone: text(req.body?.country_timezone, 150) || null,
      availability: text(req.body?.availability, 500) || null,
      portfolio_url: text(req.body?.portfolio_url, 500) || null,
      resume_url: text(req.body?.resume_url, 500) || null,
      message: text(req.body?.message, 4000),
      consent: req.body?.consent === true,
    };
    if (
      !payload.job_id ||
      payload.full_name.length < 2 ||
      !/^\S+@\S+\.\S+$/.test(payload.email) ||
      payload.message.length < 20 ||
      !payload.consent
    )
      return res
        .status(400)
        .json({ error: "Please complete all required fields correctly." });
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id,is_open")
      .eq("id", payload.job_id)
      .single();
    if (jobError || !job?.is_open)
      return res
        .status(400)
        .json({ error: "This role is not currently accepting applications." });
    const { error } = await supabase.from("applications").insert(payload);
    if (error) throw error;
    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error("Applications API error:", error);
    return res
      .status(500)
      .json({ error: error?.message || "Application could not be submitted." });
  }
}
