-- Milestone 3.2 — comportamento na exclusão de conta. Decisão da Sabrina:
-- **apagar o áudio e manter o resultado ANONIMIZADO** (a plataforma não
-- perde o histórico de uso, e o titular deixa de ser identificável).
--
-- Hoje `simulation_attempts.user_id` é `not null ... on delete cascade`:
-- apagar a conta apaga TODAS as tentativas e respostas em cascata, ou seja,
-- não existe "resultado anonimizado" — existe "resultado apagado". Esta
-- migration troca o cascade por `on delete set null`, então a tentativa
-- sobrevive sem dono.
--
-- Consequências verificadas antes de fazer isso:
--
-- 1. RLS: as policies comparam `auth.uid() = user_id`. Com `user_id` nulo a
--    comparação dá NULL (nunca verdadeiro), então a linha anonimizada fica
--    invisível pra QUALQUER usuário autenticado — só `service_role` a
--    enxerga, que é exatamente o desejado pra dado estatístico.
-- 2. Código: as checagens de posse são `attempt.user_id !== user.id`, que
--    rejeitam nulo corretamente; os demais usos são filtros
--    `.eq("user_id", user.id)`, que não casam com nulo. Nenhum caminho
--    passa a aceitar uma tentativa sem dono (conferido por grep em `src/`).
-- 3. O áudio NÃO é apagado por esta migration: a gravação vive no Storage,
--    que não participa de cascade do Postgres. Por isso a exclusão de conta
--    precisa passar por `scripts/delete-user-data.mjs`, que apaga os
--    objetos do Storage e limpa o conteúdo de fala ANTES de remover a
--    conta. Se alguém apagar a conta direto pelo painel do Supabase, as
--    gravações ficariam órfãs — o script existe pra fechar isso, e o
--    processo está documentado em docs/project-status.md.

alter table public.simulation_attempts
  drop constraint if exists simulation_attempts_user_id_fkey;

alter table public.simulation_attempts
  alter column user_id drop not null;

alter table public.simulation_attempts
  add constraint simulation_attempts_user_id_fkey
  foreign key (user_id) references public.users (id) on delete set null;
