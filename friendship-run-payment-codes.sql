-- Run once in the same Supabase project used by Vercel.

alter table public.friendship_run_players
  add column if not exists current_payment_id uuid;

create table if not exists public.friendship_run_payments (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  student_id_normalized text not null,
  play_code text not null,
  proof_path text not null,
  status text not null default 'unused' check (status in ('unused','redeemed','expired','revoked')),
  player_id uuid references public.friendship_run_players(id) on delete set null,
  score integer,
  duration_ms integer,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendship_run_play_code_six_digits check (play_code ~ '^[0-9]{6}$')
);

create unique index if not exists friendship_run_active_play_code_unique
  on public.friendship_run_payments(play_code)
  where status in ('unused','redeemed');

create index if not exists friendship_run_payments_student_idx
  on public.friendship_run_payments(student_id_normalized, created_at desc);

create index if not exists friendship_run_payments_status_idx
  on public.friendship_run_payments(status, created_at desc);

alter table public.friendship_run_payments enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'friendship-run-payment-proofs',
  'friendship-run-payment-proofs',
  false,
  2097152,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];
