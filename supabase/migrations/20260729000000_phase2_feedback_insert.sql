-- A migration inicial deu apenas policy/GRANT de `select` em
-- simulation_feedbacks. A geração do relatório final da Fase 2 precisa
-- inserir nessa tabela a partir de uma Server Action autenticada (não da
-- service role), então falta a policy e o GRANT de `insert` — mesma classe de
-- lacuna já documentada para as demais tabelas em
-- 20260728000000_grant_authenticated_privileges.sql.

create policy "insert own feedback" on public.simulation_feedbacks
  for insert with check (
    exists (
      select 1 from public.simulation_attempts sa
      where sa.id = simulation_attempt_id and sa.user_id = auth.uid()
    )
  );

grant insert on public.simulation_feedbacks to authenticated;
