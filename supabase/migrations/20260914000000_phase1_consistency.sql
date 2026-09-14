-- M4: consistência e retomada da Fase 1.
-- Aplicar ANTES do código deste milestone: o código grava resposta sem opção
-- quando o tempo official expira e depende das duas constraints abaixo.

-- Uma questão expirada sem seleção continua sendo uma resposta (incorreta),
-- para manter exatamente N itens e N respostas por tentativa.
alter table public.phase1_answers
  alter column selected_option drop not null;

create unique index if not exists phase1_answers_attempt_question_unique
  on public.phase1_answers(simulation_attempt_id, question_id);

-- Duas abas podem tentar iniciar ao mesmo tempo. A constraint é a autoridade;
-- a aplicação trata 23505 retomando a tentativa que venceu a corrida.
create unique index if not exists phase1_one_in_progress_per_mode
  on public.simulation_attempts(user_id, mode)
  where phase = 'phase1' and status = 'in_progress' and user_id is not null;

