-- Mesma lacuna documentada em 20260728000000: a migration inicial nunca deu GRANT
-- de tabela para o role `service_role`. Não bloqueia o app hoje (que só usa
-- `authenticated` via PostgREST; os scripts administrativos usam conexão Postgres
-- direta, que ignora GRANT), mas vai travar qualquer ferramenta futura (painel
-- admin da Fase 6/7) que use a service key via API REST. `service_role` já
-- ignora RLS por padrão no Supabase — aqui só falta o GRANT de tabela.

grant select, insert, update, delete on
  public.users,
  public.simulation_attempts,
  public.phase1_audios,
  public.phase1_questions,
  public.phase1_answers,
  public.phase2_prompts,
  public.phase2_responses,
  public.simulation_feedbacks
to service_role;
