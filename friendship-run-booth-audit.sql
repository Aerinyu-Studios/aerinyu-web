-- Run once in the SAME Supabase project used by Vercel.

alter table public.friendship_run_players
  add column if not exists current_attempt_kind text,
  add column if not exists current_attempt_completed boolean not null default true;

alter table public.friendship_run_payments
  alter column proof_path drop not null,
  add column if not exists attempt_type text not null default 'official',
  add column if not exists eligibility_source text not null default 'booth_payment',
  add column if not exists payment_method text not null default 'digital',
  add column if not exists amount_collected numeric(10,2) not null default 3.00,
  add column if not exists evidence_kind text,
  add column if not exists operator_username text,
  add column if not exists operator_name text,
  add column if not exists audit_note text;

alter table public.friendship_run_payments drop constraint if exists friendship_run_attempt_type_check;
alter table public.friendship_run_payments add constraint friendship_run_attempt_type_check check (attempt_type in ('trial','official'));
alter table public.friendship_run_payments drop constraint if exists friendship_run_eligibility_source_check;
alter table public.friendship_run_payments add constraint friendship_run_eligibility_source_check check (eligibility_source in ('free_trial','booth_payment','run_signup'));
alter table public.friendship_run_payments drop constraint if exists friendship_run_payment_method_check;
alter table public.friendship_run_payments add constraint friendship_run_payment_method_check check (payment_method in ('none','cash','digital','run_signup'));
alter table public.friendship_run_payments drop constraint if exists friendship_run_amount_nonnegative;
alter table public.friendship_run_payments add constraint friendship_run_amount_nonnegative check (amount_collected >= 0);

create index if not exists friendship_run_payments_operator_idx on public.friendship_run_payments(operator_username, created_at desc);
create index if not exists friendship_run_payments_attempt_type_idx on public.friendship_run_payments(attempt_type, eligibility_source, created_at desc);

create table if not exists public.friendship_run_audit_log (
  id bigserial primary key,
  event_type text not null,
  payment_id uuid references public.friendship_run_payments(id) on delete set null,
  player_id uuid references public.friendship_run_players(id) on delete set null,
  student_id_normalized text,
  operator_username text,
  operator_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists friendship_run_audit_created_idx on public.friendship_run_audit_log(created_at desc);
create index if not exists friendship_run_audit_payment_idx on public.friendship_run_audit_log(payment_id, created_at desc);
alter table public.friendship_run_audit_log enable row level security;

-- Old payment records remain valid. New records use the richer audit fields above.
