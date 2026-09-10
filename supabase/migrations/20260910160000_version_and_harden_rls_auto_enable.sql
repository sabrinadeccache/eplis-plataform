-- `public.rls_auto_enable()` + event trigger `ensure_rls` (ddl_command_end):
-- rede de segurança que habilita RLS em toda tabela nova do schema public.
-- Foi aplicada fora das migrations versionadas — este arquivo passa a ser a
-- fonte canônica da FUNÇÃO. O EVENT TRIGGER em si já existe em produção e não é
-- recriado aqui: `create event trigger` exige superusuário e o role das
-- migrations (`postgres`) não tem — num rebuild do zero (ex.: branch Supabase)
-- é preciso rodar, como superusuário:
--   create event trigger ensure_rls on ddl_command_end
--     execute function public.rls_auto_enable();
--
-- Correção de segurança: o advisor 0028/0029 acusava `anon`/`authenticated`
-- podendo chamar a função via `/rest/v1/rpc/rls_auto_enable`. Chamada direta é
-- inofensiva (fora de um event trigger, `pg_event_trigger_ddl_commands()` já
-- falha), mas o GRANT não faz sentido — event trigger dispara independente de
-- EXECUTE. Revogado.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null
       and cmd.schema_name in ('public')
       and cmd.schema_name not in ('pg_catalog', 'information_schema')
       and cmd.schema_name not like 'pg_toast%'
       and cmd.schema_name not like 'pg_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (system schema ou fora da lista: %.)', cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$$;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
