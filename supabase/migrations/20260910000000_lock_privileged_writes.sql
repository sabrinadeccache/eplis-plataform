-- Milestone 1 (segurança): o candidato não pode alterar papel, status ou
-- resultados. Até aqui a RLS liberava `update` genérico da própria linha em
-- `public.users` (auth.uid() = id, sem WITH CHECK nem restrição de coluna) e
-- da própria tentativa em `public.simulation_attempts` — um cliente PostgREST
-- explorava isso direto pra virar `admin`, mudar o próprio `status`, ou forçar
-- `score`/`status`/`mode` de uma tentativa `official` (reproduzido na branch de
-- teste `m1-auth-rls`). RLS não filtra por coluna, então a trava é por trigger
-- `BEFORE`, mais o corte dos GRANT/policies que davam escrita a mais.
--
-- Toda escrita legítima nesses campos passa a vir do servidor com o
-- `service_role` (src/lib/supabase/admin.ts), sempre depois de `authorize()` +
-- verificação de dono. Migration aditiva e reversível (drops no fim comentados).
--
-- ORDEM DE DEPLOY (importante): esta migration NÃO pode ser aplicada em
-- produção antes do código deste PR estar no ar. Código antigo grava
-- `simulation_attempts`/`*_responses`/`simulation_feedbacks` com o client do
-- usuário — com os triggers ativos isso passa a falhar e quebra Fase 1/2/SDEA.
-- Sequência: 1) merge em `main` -> deploy do código (o código novo funciona
-- sem a migration: escreve via service_role, os triggers só ainda não existem);
-- 2) aplicar esta migration. Código novo + sem migration = ok; código novo +
-- migration = seguro; código antigo + migration = quebrado.

-- ============================================================
-- helper: quem pode escrever campo privilegiado
-- ============================================================
-- PostgREST faz `SET LOCAL ROLE authenticated` (ou `anon`) por request; o
-- `service_role` entra como `current_user = 'service_role'`; triggers/funções
-- SECURITY DEFINER e os scripts de migration rodam como `postgres`/
-- `supabase_admin`. `handle_new_user` (SECURITY DEFINER) cai no ramo liberado.
create or replace function public.is_privileged_writer()
returns boolean
language sql
stable
as $$
  select current_user in (
    'service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin'
  );
$$;

-- ============================================================
-- users — titular só edita campos de perfil; role/status/etc. são do backend
-- ============================================================
create or replace function public.users_block_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_writer() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.operational_profile is distinct from old.operational_profile
     or new.target_exam is distinct from old.target_exam
     or new.created_at is distinct from old.created_at then
    raise exception 'campo administrativo protegido (role/status/operational_profile/target_exam/email) só pode ser alterado pelo backend'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists users_block_privileged_columns on public.users;
create trigger users_block_privileged_columns
  before update on public.users
  for each row execute function public.users_block_privileged_columns();

-- ============================================================
-- simulation_attempts — cliente cria a própria tentativa "limpa" e nada mais;
-- posição, estado, nota e ciclo de vida são derivados no servidor
-- ============================================================
create or replace function public.simulation_attempts_guard()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_writer() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- conta inativa/bloqueada não abre tentativa nem por chamada crua ao
    -- PostgREST (o app já barra em `authorize()`, isto é a rede de baixo).
    if not exists (
      select 1 from public.users u
      where u.id = new.user_id and u.status = 'active'
    ) then
      raise exception 'conta inativa ou bloqueada não pode iniciar simulado'
        using errcode = '42501';
    end if;
    -- ignora qualquer valor "de brinde" que o cliente tente mandar
    new.status := 'in_progress';
    new.score := null;
    new.finished_at := null;
    return new;
  end if;

  -- UPDATE por authenticated: bloqueado por completo. O runner passou a chamar
  -- as Server Actions (advanceState / finishAttempt / recordElapsedSeconds /
  -- abandon...), que escrevem via service_role.
  raise exception 'simulation_attempts: alterações são feitas apenas pelo servidor'
    using errcode = '42501';
end;
$$;

drop trigger if exists simulation_attempts_guard on public.simulation_attempts;
create trigger simulation_attempts_guard
  before insert or update on public.simulation_attempts
  for each row execute function public.simulation_attempts_guard();

-- policy de update deixa de existir pro cliente (o guard já barra, mas sem a
-- policy o erro é o de RLS, mais claro na auditoria). insert/select seguem.
drop policy if exists "update own attempts" on public.simulation_attempts;

-- ============================================================
-- phase1_answers — `is_correct` é derivado no servidor (compara a opção
-- escolhida com `correct_option` da questão). Sem trava, o cliente inseria
-- linhas com `is_correct = true` direto e inflava o `score` da Fase 1, que é
-- contado por `finishAttempt`. Passa a ser inserida só pelo servidor.
-- ============================================================
create or replace function public.phase1_answers_block_client_writes()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_writer() then
    return new;
  end if;
  raise exception 'phase1_answers: respostas são gravadas apenas pelo servidor'
    using errcode = '42501';
end;
$$;

drop trigger if exists phase1_answers_block_client_writes on public.phase1_answers;
create trigger phase1_answers_block_client_writes
  before insert or update on public.phase1_answers
  for each row execute function public.phase1_answers_block_client_writes();

drop policy if exists "insert own answers" on public.phase1_answers;
revoke insert on public.phase1_answers from authenticated;

-- ============================================================
-- simulation_feedbacks — relatório de nota é escrito só pelo servidor
-- ============================================================
drop policy if exists "insert own feedback" on public.simulation_feedbacks;
revoke insert on public.simulation_feedbacks from authenticated;

-- ============================================================
-- phase2_responses / pilot_responses — transcrição, feedback e status de
-- processamento são do servidor. O cliente nunca insere/atualiza direto (o
-- envio vai pela route handler multipart, que agora usa service_role).
-- ============================================================
create or replace function public.responses_block_client_writes()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_writer() then
    return new;
  end if;
  raise exception '%: respostas são gravadas apenas pelo servidor', tg_table_name
    using errcode = '42501';
end;
$$;

drop trigger if exists phase2_responses_block_client_writes on public.phase2_responses;
create trigger phase2_responses_block_client_writes
  before insert or update on public.phase2_responses
  for each row execute function public.responses_block_client_writes();

drop trigger if exists pilot_responses_block_client_writes on public.pilot_responses;
create trigger pilot_responses_block_client_writes
  before insert or update on public.pilot_responses
  for each row execute function public.responses_block_client_writes();

drop policy if exists "insert own responses" on public.phase2_responses;
drop policy if exists "update own responses" on public.phase2_responses;
drop policy if exists "insert own pilot responses" on public.pilot_responses;
drop policy if exists "update own pilot responses" on public.pilot_responses;
revoke insert, update on public.phase2_responses from authenticated;
revoke insert, update on public.pilot_responses from authenticated;

-- ============================================================
-- advisor: SECURITY DEFINER callável por anon/authenticated via /rpc
-- ============================================================
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ============================================================
-- Reversão (se precisar):
--   drop trigger users_block_privileged_columns on public.users;
--   drop trigger simulation_attempts_guard on public.simulation_attempts;
--   drop trigger phase2_responses_block_client_writes on public.phase2_responses;
--   drop trigger pilot_responses_block_client_writes on public.pilot_responses;
--   drop function public.users_block_privileged_columns,
--     public.simulation_attempts_guard, public.responses_block_client_writes,
--     public.is_privileged_writer;
--   create policy "update own attempts" on public.simulation_attempts
--     for update using (auth.uid() = user_id);
--   -- + recriar policies/grants de insert/update das *_responses e feedback
-- ============================================================
