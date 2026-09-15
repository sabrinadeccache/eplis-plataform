-- M5: relógio oficial e repetição autoritativos no servidor. Esta tabela é
-- separada das respostas porque a janela nasce antes de existir um upload.
create table if not exists public.official_response_windows (
  id uuid primary key default gen_random_uuid(),
  simulation_attempt_id uuid not null references public.simulation_attempts(id) on delete cascade,
  prompt_id uuid not null,
  track text not null check (track in ('phase2', 'pilot_interview')),
  item_slot integer not null check (item_slot >= 0),
  response_stage text not null,
  expected_duration_seconds integer not null check (expected_duration_seconds between 1 and 480),
  question_started_at timestamptz not null default now(),
  question_finished_at timestamptz,
  recording_started_at timestamptz,
  recording_finished_at timestamptz,
  client_session_token uuid,
  repetition_count integer not null default 0 check (repetition_count between 0 and 20),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (simulation_attempt_id, prompt_id, item_slot)
);

alter table public.official_response_windows enable row level security;
revoke all on public.official_response_windows from anon, authenticated;
grant all on public.official_response_windows to service_role;

create index if not exists official_response_windows_attempt_idx
  on public.official_response_windows (simulation_attempt_id);

create or replace function public.increment_official_repetition(p_window_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_count integer;
begin
  update public.official_response_windows
     set repetition_count = repetition_count + 1
   where id = p_window_id
     and recording_started_at is null
     and repetition_count < 20
  returning repetition_count into next_count;

  if next_count is null then
    raise exception 'official repetition window closed' using errcode = 'P0001';
  end if;
  return next_count;
end;
$$;

revoke all on function public.increment_official_repetition(uuid) from public, anon, authenticated;
grant execute on function public.increment_official_repetition(uuid) to service_role;
