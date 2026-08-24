-- Trilha do piloto (SDEA — Santos Dumont English Assessment). Espelha o
-- padrão de phase2_prompts/phase2_responses, mas com um estágio de
-- sub-resposta próprio (Parte 2 é um role-play com 4 sub-turnos: readback,
-- reação a um imprevisto, confirmação/negação, e relato em discurso
-- indireto — bem diferente da mecânica situation_check/suggestion do
-- controlador) e uma tabela de conteúdo mais larga (a Parte 2 real usa dois
-- áudios do controlador + referências de resposta esperada só pra IA, nunca
-- mostradas ao candidato). `simulation_attempts` e `simulation_feedbacks` já
-- são genéricas por `phase` (ver migration anterior) e não precisam de
-- nenhuma alteração.

create type public.pilot_response_stage as enum (
  'main',
  'readback', 'reaction', 'confirmation', 'report_back',
  'report', 'question', 'comparison',
  'picture_description', 'narrative', 'discussion_1', 'discussion_2', 'agree_disagree'
);

create table public.pilot_prompts (
  id uuid primary key default gen_random_uuid(),
  part public.part not null,
  -- fixed_wing | rotary_wing | general (só a Parte 1, perguntas de carreira
  -- agnósticas ao tipo de aeronave, usa "general").
  aircraft_type public.operational_profile,
  -- Parte1: a pergunta. Parte2: frase de contexto do examinador antes do
  -- áudio 1. Parte3: transcrição do diálogo piloto/controlador narrado.
  -- Parte4: enunciado da tarefa da foto.
  prompt_text text not null,
  -- Parte2: instrução do controlador (áudio 1) que o candidato transforma em
  -- readback.
  atc_audio_text text,
  -- Parte2: referência de readback esperado — só pra dar contexto à IA na
  -- correção, nunca mostrado ao candidato.
  expected_readback text,
  -- Parte2: narração do examinador sobre o imprevisto que motiva a reação do
  -- candidato.
  complication_text text,
  -- Parte2: foto do imprevisto, quando a complicação é introduzida por
  -- imagem em vez de só texto (2 das 5 situações reais).
  complication_image_url text,
  -- Parte2: referência da reação esperada — só pra IA.
  expected_reaction text,
  -- Parte2: resposta do controlador (áudio 2), geralmente pedindo
  -- confirmação/negação de algum detalhe.
  atc_followup_audio_text text,
  -- Parte2: referência da confirmação esperada — só pra IA.
  expected_confirmation text,
  -- Parte3: pergunta técnica/de opinião feita após o relato da situação.
  -- Parte4: 1ª pergunta de discussão sobre o tema da foto.
  discussion_question text,
  -- Parte4: 2ª pergunta de discussão.
  discussion_question_2 text,
  -- Parte4: foto principal do item.
  image_url text,
  -- Parte4: afirmação pra o candidato concordar/discordar com justificativa.
  agree_disagree_statement text,
  -- Sequência dentro da parte (Parte2: 1-N; Parte3: 1-N) — só pra manter
  -- pares de uma mesma prova agrupados no sorteio, sem regra de ordenação
  -- por dificuldade (diferente da Parte 2/3 do controlador).
  order_index int,
  expected_duration_seconds int not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.pilot_responses (
  id uuid primary key default gen_random_uuid(),
  simulation_attempt_id uuid not null references public.simulation_attempts (id) on delete cascade,
  prompt_id uuid not null references public.pilot_prompts (id),
  response_stage public.pilot_response_stage not null,
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

alter table public.pilot_prompts enable row level security;
create policy "read active pilot prompts" on public.pilot_prompts
  for select to authenticated using (is_active = true);

alter table public.pilot_responses enable row level security;
create policy "select own pilot responses" on public.pilot_responses
  for select using (
    exists (
      select 1 from public.simulation_attempts sa
      where sa.id = simulation_attempt_id and sa.user_id = auth.uid()
    )
  );
create policy "insert own pilot responses" on public.pilot_responses
  for insert with check (
    exists (
      select 1 from public.simulation_attempts sa
      where sa.id = simulation_attempt_id and sa.user_id = auth.uid()
    )
  );
create policy "update own pilot responses" on public.pilot_responses
  for update using (
    exists (
      select 1 from public.simulation_attempts sa
      where sa.id = simulation_attempt_id and sa.user_id = auth.uid()
    )
  );

-- GRANT de tabela pros dois roles já no mesmo arquivo que cria a tabela — a
-- Fase 2 aprendeu essa lição em duas rodadas separadas (migration inicial
-- esqueceu `authenticated`, depois faltou `service_role`); ver CLAUDE.md.
grant select on public.pilot_prompts to authenticated;
grant select, insert, update on public.pilot_responses to authenticated;
grant select, insert, update, delete on public.pilot_prompts, public.pilot_responses to service_role;
