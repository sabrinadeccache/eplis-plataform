-- Milestone 1 — sondas de RLS / elevação de privilégio.
-- Roda como candidato autenticado (SET LOCAL ROLE authenticated + claims
-- falsos) e confere que nenhuma das mutações proibidas tem efeito. Cada caso
-- FALHAVA (mutação aplicada) no schema anterior a
-- 20260910000000_lock_privileged_writes.sql e PASSA depois dela.
--
-- Uso: aplicar todas as migrations num Postgres/branch de teste, criar dois
-- usuários (user A = air_traffic_controller, user B = pilot), e rodar este
-- arquivo. Não roda contra produção. Foi validado na branch Supabase
-- `m1-auth-rls` (ver docs/project-status.md).

\set uid_a '11111111-1111-1111-1111-111111111111'
\set uid_b '22222222-2222-2222-2222-222222222222'

begin;

create temp table probe(seq serial, teste text, esperado text, obtido text);
grant insert on probe to authenticated;
grant usage, select on sequence probe_seq_seq to authenticated;

-- fixtures
insert into public.simulation_attempts (id, user_id, phase, mode, status)
values ('aaaa1111-0000-0000-0000-0000000000a1', :'uid_a', 'phase1', 'official', 'in_progress')
on conflict (id) do update set status='in_progress', score=null, finished_at=null,
  current_part=null, current_item_index=null, mode='official';
insert into public.simulation_attempts (id, user_id, phase, mode, status)
values ('bbbb2222-0000-0000-0000-0000000000b2', :'uid_b', 'phase1', 'official', 'in_progress')
on conflict (id) do nothing;
update public.users set role='air_traffic_controller', status='active' where id = :'uid_a';

do $$
declare v text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub','11111111-1111-1111-1111-111111111111','role','authenticated')::text, true);

  begin update public.users set role='admin' where id='11111111-1111-1111-1111-111111111111'; exception when others then null; end;
  select role into v from public.users where id='11111111-1111-1111-1111-111111111111';
  insert into probe(teste,esperado,obtido) values ('candidato promove o proprio role','air_traffic_controller',v);

  begin update public.simulation_attempts set score=6,status='completed',mode='practice',finished_at=now()
    where id='aaaa1111-0000-0000-0000-0000000000a1'; exception when others then null; end;
  select coalesce(score::text,'null')||'/'||status||'/'||mode into v
    from public.simulation_attempts where id='aaaa1111-0000-0000-0000-0000000000a1';
  insert into probe(teste,esperado,obtido) values ('candidato forja score/status/mode da propria tentativa','null/in_progress/official',v);

  begin update public.simulation_attempts set current_part='part3',current_item_index=9
    where id='aaaa1111-0000-0000-0000-0000000000a1'; exception when others then null; end;
  select coalesce(current_part::text,'null')||'/'||coalesce(current_item_index::text,'null') into v
    from public.simulation_attempts where id='aaaa1111-0000-0000-0000-0000000000a1';
  insert into probe(teste,esperado,obtido) values ('candidato forca a posicao da tentativa','null/null',v);

  select count(*)::text into v from public.simulation_attempts where user_id='22222222-2222-2222-2222-222222222222';
  insert into probe(teste,esperado,obtido) values ('candidato le tentativas de outro usuario','0',v);

  begin
    insert into public.simulation_feedbacks(simulation_attempt_id,phase,overall_score)
      values ('aaaa1111-0000-0000-0000-0000000000a1','phase1','excellent'); v := 'INSERIU';
  exception when others then v := 'BLOQUEADO'; end;
  insert into probe(teste,esperado,obtido) values ('candidato insere relatorio de feedback','BLOQUEADO',v);

  begin
    insert into public.phase2_responses(simulation_attempt_id,prompt_id,response_stage)
      values ('aaaa1111-0000-0000-0000-0000000000a1', gen_random_uuid(), 'main'); v := 'INSERIU';
  exception when others then v := 'BLOQUEADO'; end;
  insert into probe(teste,esperado,obtido) values ('candidato escreve em phase2_responses','BLOQUEADO',v);

  -- positivos: o que o candidato PODE fazer continua funcionando
  begin update public.users set name='Nome Novo' where id='11111111-1111-1111-1111-111111111111'; v:='OK';
  exception when others then v:='FALHOU'; end;
  insert into probe(teste,esperado,obtido) values ('candidato edita o proprio nome','OK',v);

  begin insert into public.simulation_attempts(user_id,phase,mode)
    values ('11111111-1111-1111-1111-111111111111','phase1','practice'); v:='OK';
  exception when others then v:='FALHOU'; end;
  insert into probe(teste,esperado,obtido) values ('candidato ativo abre a propria tentativa','OK',v);

  -- conta bloqueada nao abre tentativa nem por PostgREST cru
  update public.users set status='blocked' where id='11111111-1111-1111-1111-111111111111';
  begin insert into public.simulation_attempts(user_id,phase,mode)
    values ('11111111-1111-1111-1111-111111111111','phase1','practice'); v:='CRIOU';
  exception when others then v:='BLOQUEADO'; end;
  insert into probe(teste,esperado,obtido) values ('conta bloqueada abre tentativa via PostgREST','BLOQUEADO',v);

  reset role;
  perform set_config('request.jwt.claims', null, true);
end $$;

select teste, esperado, obtido,
  case when obtido = esperado then 'PASS' else 'FAIL' end as veredito
from probe order by seq;

rollback;
