-- Campos adicionais de perfil coletados no cadastro (Fase de identidade visual /
-- expansão do perfil, 2026-09-07). Todos nullable — o cadastro não trava se
-- ficarem em branco.
--
--   work_location         texto livre — órgão/base onde trabalha (ex.: "TWR-SBGL", "LATAM")
--   home_state            UF de residência (2 letras)
--   home_city             município de residência (nome IBGE)
--   phone                 telefone/WhatsApp de contato
--   current_icao_level    nível OACI atual (1..6)
--   icao_level_valid_until validade do nível OACI atual
--   exam_target_date      data prevista para fazer o exame
--   training_goal         objetivo no treinamento (texto curto, valores da UI)
--
-- Sem GRANT novo: `grant select, update on public.users to authenticated` (migration
-- 20260728000000) é a nível de tabela e já cobre colunas futuras. A policy
-- "users update own row" (auth.uid() = id) também já cobre.

alter table public.users
  add column if not exists work_location text,
  add column if not exists home_state text,
  add column if not exists home_city text,
  add column if not exists phone text,
  add column if not exists current_icao_level smallint,
  add column if not exists icao_level_valid_until date,
  add column if not exists exam_target_date date,
  add column if not exists training_goal text;

alter table public.users
  drop constraint if exists users_current_icao_level_range;
alter table public.users
  add constraint users_current_icao_level_range
  check (current_icao_level is null or current_icao_level between 1 and 6);

-- Trigger de cadastro passa a ler os novos campos do raw_user_meta_data enviado
-- pelo signUp. String vazia vira null; o nível é casteado com nullif pra não
-- quebrar quando não informado.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (
    id, name, email, role, target_exam, operational_profile,
    work_location, home_state, home_city, phone,
    current_icao_level, icao_level_valid_until, exam_target_date, training_goal
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    coalesce((new.raw_user_meta_data ->> 'role')::public.role, 'pilot'),
    coalesce(new.raw_user_meta_data ->> 'target_exam', 'EPLIS'),
    (new.raw_user_meta_data ->> 'operational_profile')::public.operational_profile,
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
