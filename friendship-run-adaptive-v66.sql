-- Friendship Run v66: independently toggle free-trial live TV games.
-- Run once in the same Supabase project used by Vercel.

alter table public.friendship_run_display_settings
  add column if not exists live_trial_booth_1_enabled boolean not null default true,
  add column if not exists live_trial_booth_2_enabled boolean not null default true;

alter table public.friendship_run_live_games
  add column if not exists attempt_type text not null default 'official';

alter table public.friendship_run_live_games
  drop constraint if exists friendship_run_live_games_attempt_type_check;

alter table public.friendship_run_live_games
  add constraint friendship_run_live_games_attempt_type_check
  check (attempt_type in ('trial','official'));
