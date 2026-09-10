-- M1.1 — fecha 2 P0 encontrados na revisão do Milestone 1.
-- Depende de 20260910000000_lock_privileged_writes.sql. Aditiva, reversível.
-- ORDEM DE DEPLOY: aplicar DEPOIS do deploy do código deste PR (startAttempt
-- passa a inserir a tentativa via service_role). Código novo + sem esta
-- migration = ok; código antigo + esta migration = startAttempt quebra.

-- ============================================================
-- P0 #1 — cadastro não pode pedir papel administrativo via metadata
-- ============================================================
-- `handle_new_user()` (SECURITY DEFINER) confiava em
-- `raw_user_meta_data ->> 'role'`, que é livre pra quem chama o endpoint de
-- signup do Supabase diretamente — a validação em src/lib/auth/actions.ts é
-- só client-side. O enum `public.role` inclui 'admin'. Resultado: dava pra se
-- cadastrar com `role: "admin"` e, após confirmar o e-mail, ter conta admin.
--
-- Agora o cadastro só aceita 'pilot' | 'air_traffic_controller'; qualquer
-- outro valor (inclusive 'admin' ou lixo) vira 'pilot'. `target_exam` e
-- `operational_profile` passam a ser derivados/validados do papel seguro, não
-- copiados crus do metadata. Papel administrativo é concedido só por SQL/backend.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
  requested_op   text := new.raw_user_meta_data ->> 'operational_profile';
  safe_role public.role;
  safe_exam text;
  safe_op   public.operational_profile;
begin
  safe_role := case
    when requested_role in ('pilot', 'air_traffic_controller')
      then requested_role::public.role
    else 'pilot'
  end;

  safe_exam := case
    when safe_role = 'pilot' then 'Santos Dumont English Assessment'
    else 'EPLIS'
  end;

  safe_op := case
    when safe_role = 'pilot' and requested_op in ('fixed_wing', 'rotary_wing')
      then requested_op::public.operational_profile
    when safe_role = 'air_traffic_controller' and requested_op in ('TWR', 'APP', 'ACC', 'COpM')
      then requested_op::public.operational_profile
    else null
  end;

  insert into public.users (
    id, name, email, role, target_exam, operational_profile,
    work_location, home_state, home_city, phone,
    current_icao_level, icao_level_valid_until, exam_target_date, training_goal
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    safe_role,
    safe_exam,
    safe_op,
    nullif(new.raw_user_meta_data ->> 'work_location', ''),
    nullif(new.raw_user_meta_data ->> 'home_state', ''),
    nullif(new.raw_user_meta_data ->> 'home_city', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'current_icao_level', '')::smallint,
    nullif(new.raw_user_meta_data ->> 'icao_level_valid_until', '')::date,
    nullif(new.raw_user_meta_data ->> 'exam_target_date', '')::date,
    nullif(new.raw_user_meta_data ->> 'training_goal', '')
  );
  return new;
end;
$$;

-- ============================================================
-- P0 #2 — INSERT de tentativa não pode trazer posição/estado do cliente
-- ============================================================
-- O guard de 20260910000000 só zerava status/score/finished_at no INSERT —
-- current_part, current_item_index, current_state e elapsed_seconds passavam
-- direto, então um cliente autenticado criava uma tentativa já na Parte 4 ou
-- com estado arbitrário. Agora TODA escrita de simulation_attempts por
-- `authenticated` é recusada; `startAttempt()` passou a inserir via
-- service_role, com a posição inicial derivada no servidor (igual ao resto do
-- ciclo de vida). A checagem de conta ativa continua no `authorize()` do
-- `startAttempt` (e o titular bloqueado nem chega aqui).
create or replace function public.simulation_attempts_guard()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_writer() then
    return new;
  end if;
  raise exception 'simulation_attempts: criação e alterações são feitas apenas pelo servidor'
    using errcode = '42501';
end;
$$;

drop policy if exists "insert own attempts" on public.simulation_attempts;
revoke insert on public.simulation_attempts from authenticated;

-- ============================================================
-- Reversão:
--   -- handle_new_user: restaurar a versão de 20260907000000
--   create or replace function public.simulation_attempts_guard() ... (versão
--     de 20260910000000, com o ramo tg_op='INSERT' que sanitiza)
--   create policy "insert own attempts" on public.simulation_attempts
--     for insert with check (auth.uid() = user_id);
--   grant insert on public.simulation_attempts to authenticated;
-- ============================================================
