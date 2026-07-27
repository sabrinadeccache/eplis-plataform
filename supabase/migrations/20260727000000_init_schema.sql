-- EPLIS Trainer — schema inicial
-- Espelha docs/database-schema.md. Rodar uma única vez no projeto Supabase.

-- ============================================================
-- ENUMS
-- ============================================================
create type public.role as enum ('admin', 'pilot', 'air_traffic_controller');
create type public.user_status as enum ('active', 'inactive', 'blocked');
create type public.operational_profile as enum
  ('TWR', 'APP', 'ACC', 'AFIS', 'FIS', 'COpM', 'ab_initio', 'general');
create type public.phase as enum ('phase1', 'phase2');
create type public.simulation_mode as enum ('practice', 'official');
create type public.attempt_status as enum ('in_progress', 'completed', 'abandoned');
create type public.part as enum ('part1', 'part2', 'part3', 'part4');
create type public.response_stage as enum (
  'main', 'situation_intro', 'situation_check', 'suggestion',
  'image_observation', 'image_description', 'story_preparation', 'story_telling'
);
create type public.processing_status as enum
  ('queued', 'transcribing', 'analyzing', 'done', 'error');
create type public.proficiency_level as enum ('weak', 'moderate', 'good');
create type public.difficulty as enum ('easy', 'medium', 'hard');
create type public.mcq_option as enum ('a', 'b', 'c');

-- ============================================================
-- TABELAS
-- ============================================================

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  email text not null unique,
  role public.role not null default 'pilot',
  status public.user_status not null default 'active',
  target_exam text,
  operational_profile public.operational_profile,
  created_at timestamptz not null default now()
);

create table public.simulation_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  phase public.phase not null,
  mode public.simulation_mode not null,
  status public.attempt_status not null default 'in_progress',
  score numeric,
  current_state text,
  current_part public.part,
  current_item_index int,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.phase1_audios (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  audio_url text not null,
  transcript text,
  difficulty public.difficulty not null,
  category text not null,
  accent text,
  duration_seconds int not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.phase1_questions (
  id uuid primary key default gen_random_uuid(),
  audio_id uuid not null references public.phase1_audios (id) on delete cascade,
  prompt text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  correct_option public.mcq_option not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.phase1_answers (
  id uuid primary key default gen_random_uuid(),
  simulation_attempt_id uuid not null references public.simulation_attempts (id) on delete cascade,
  question_id uuid not null references public.phase1_questions (id),
  selected_option public.mcq_option not null,
  is_correct boolean not null,
  created_at timestamptz not null default now()
);

create table public.phase2_prompts (
  id uuid primary key default gen_random_uuid(),
  part public.part not null,
  operational_profile public.operational_profile,
  prompt_text text not null,
  image_url text,
  expected_duration_seconds int not null,
  order_index int,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.phase2_responses (
  id uuid primary key default gen_random_uuid(),
  simulation_attempt_id uuid not null references public.simulation_attempts (id) on delete cascade,
  prompt_id uuid not null references public.phase2_prompts (id),
  response_stage public.response_stage not null,
  audio_url text,
  transcript text,
  ai_feedback text,
  ai_provider text,
  model_version text,
  processing_status public.processing_status not null default 'queued',
  repetition_count int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.simulation_feedbacks (
  id uuid primary key default gen_random_uuid(),
  simulation_attempt_id uuid not null references public.simulation_attempts (id) on delete cascade,
  phase public.phase not null,
  overall_score text,
  pronunciation_score public.proficiency_level,
  structure_score public.proficiency_level,
  vocabulary_score public.proficiency_level,
  fluency_score public.proficiency_level,
  comprehension_score public.proficiency_level,
  interaction_score public.proficiency_level,
  general_feedback text,
  ai_provider text,
  model_version text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- users criado automaticamente quando alguém se cadastra via Supabase Auth
-- ============================================================
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- RLS — cada candidato só acessa os próprios dados;
-- conteúdo (áudios/questões/prompts) é somente leitura para usuários autenticados
-- e só escrito pelo painel admin via service_role (que ignora RLS).
-- ============================================================

alter table public.users enable row level security;
create policy "users select own row" on public.users
  for select using (auth.uid() = id);
create policy "users update own row" on public.users
  for update using (auth.uid() = id);

alter table public.simulation_attempts enable row level security;
create policy "select own attempts" on public.simulation_attempts
  for select using (auth.uid() = user_id);
create policy "insert own attempts" on public.simulation_attempts
  for insert with check (auth.uid() = user_id);
create policy "update own attempts" on public.simulation_attempts
  for update using (auth.uid() = user_id);

alter table public.phase1_audios enable row level security;
create policy "read active audios" on public.phase1_audios
  for select to authenticated using (is_active = true);

alter table public.phase1_questions enable row level security;
create policy "read active questions" on public.phase1_questions
  for select to authenticated using (is_active = true);

alter table public.phase2_prompts enable row level security;
create policy "read active prompts" on public.phase2_prompts
  for select to authenticated using (is_active = true);

alter table public.phase1_answers enable row level security;
create policy "select own answers" on public.phase1_answers
  for select using (
    exists (
      select 1 from public.simulation_attempts sa
      where sa.id = simulation_attempt_id and sa.user_id = auth.uid()
    )
  );
create policy "insert own answers" on public.phase1_answers
  for insert with check (
    exists (
      select 1 from public.simulation_attempts sa
      where sa.id = simulation_attempt_id and sa.user_id = auth.uid()
    )
  );

alter table public.phase2_responses enable row level security;
create policy "select own responses" on public.phase2_responses
  for select using (
    exists (
      select 1 from public.simulation_attempts sa
      where sa.id = simulation_attempt_id and sa.user_id = auth.uid()
    )
  );
create policy "insert own responses" on public.phase2_responses
  for insert with check (
    exists (
      select 1 from public.simulation_attempts sa
      where sa.id = simulation_attempt_id and sa.user_id = auth.uid()
    )
  );
create policy "update own responses" on public.phase2_responses
  for update using (
    exists (
      select 1 from public.simulation_attempts sa
      where sa.id = simulation_attempt_id and sa.user_id = auth.uid()
    )
  );

alter table public.simulation_feedbacks enable row level security;
create policy "select own feedback" on public.simulation_feedbacks
  for select using (
    exists (
      select 1 from public.simulation_attempts sa
      where sa.id = simulation_attempt_id and sa.user_id = auth.uid()
    )
  );
