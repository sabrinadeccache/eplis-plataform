-- Milestone 1 (+ M1.1) — sondas de segurança.
-- Roda como candidato autenticado (SET LOCAL ROLE authenticated + claims
-- falsos) e confere que nenhuma mutação proibida tem efeito, e que o caminho
-- legítimo (backend / service_role) continua funcionando. Cada caso "BLOQUEADO"
-- falhava antes de 20260910000000 / 20260910120000 e passa depois.
--
-- Uso: aplicar TODAS as migrations num Postgres/branch de teste, e rodar este
-- arquivo (ex.: via mcp execute_sql numa branch Supabase). Não roda contra
-- produção. Validado nas branches `m1-auth-rls` e `m1-1-verify`.
--
-- Estrutura: toda a preparação de dados/estado roda como o dono da conexão
-- (postgres). Só os blocos "ATAQUE" trocam pra role `authenticated`. Cada
-- ataque fica num sub-bloco com EXCEPTION próprio, então um erro de trigger
-- não aborta o resto.

create temp table probe(seq serial, teste text, esperado text, obtido text);
grant insert on probe to authenticated;
grant usage, select on sequence probe_seq_seq to authenticated;

-- ---- fixtures (como postgres) ----
insert into public.phase1_audios (id, title, audio_url, difficulty, category, duration_seconds)
  values ('dddd0000-0000-0000-0000-00000000dddd','t','u','easy','c',10) on conflict do nothing;
insert into public.phase1_questions (id, audio_id, prompt, option_a, option_b, option_c, correct_option)
  values ('eeee0000-0000-0000-0000-00000000eeee','dddd0000-0000-0000-0000-00000000dddd','p','a','b','c','a') on conflict do nothing;
insert into public.simulation_attempts (id, user_id, phase, mode, status)
  values ('aaaa1111-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','phase1','official','in_progress')
  on conflict (id) do update set status='in_progress', score=null, finished_at=null,
    current_part=null, current_item_index=null, mode='official';
insert into public.simulation_attempts (id, user_id, phase, mode, status)
  values ('bbbb2222-0000-0000-0000-0000000000b2','22222222-2222-2222-2222-222222222222','phase1','official','in_progress')
  on conflict (id) do nothing;
update public.users set role='air_traffic_controller', status='active', name='User A'
  where id='11111111-1111-1111-1111-111111111111';

-- =========================================================
-- ATAQUES como candidato A (user ativo, air_traffic_controller)
-- =========================================================
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

  begin
    insert into public.simulation_attempts (user_id, phase, mode, current_part, current_item_index, current_state)
      values ('11111111-1111-1111-1111-111111111111','phase2','practice','part4',7,'PART_4_STORY'); v := 'INSERIU';
  exception when others then v := 'BLOQUEADO'; end;
  insert into probe(teste,esperado,obtido) values ('candidato cria tentativa ja posicionada na Parte 4','BLOQUEADO',v);

  select count(*)::text into v from public.simulation_attempts where user_id='22222222-2222-2222-2222-222222222222';
  insert into probe(teste,esperado,obtido) values ('candidato le tentativas de outro usuario','0',v);

  begin update public.simulation_attempts set score=6 where id='bbbb2222-0000-0000-0000-0000000000b2'; exception when others then null; end;
  select coalesce(score::text,'null') into v from public.simulation_attempts where id='bbbb2222-0000-0000-0000-0000000000b2';
  insert into probe(teste,esperado,obtido) values ('candidato altera tentativa de outro usuario','null',v);

  begin
    insert into public.phase1_answers(simulation_attempt_id,question_id,selected_option,is_correct)
      values ('aaaa1111-0000-0000-0000-0000000000a1','eeee0000-0000-0000-0000-00000000eeee','a',true); v := 'INSERIU';
  exception when others then v := 'BLOQUEADO'; end;
  insert into probe(teste,esperado,obtido) values ('candidato insere phase1_answers com is_correct forjado','BLOQUEADO',v);

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
  begin update public.users set name='Nome Novo', phone='11999' where id='11111111-1111-1111-1111-111111111111'; v:='OK';
  exception when others then v:='FALHOU'; end;
  select v || ' (' || name || ')' into v from public.users where id='11111111-1111-1111-1111-111111111111';
  insert into probe(teste,esperado,obtido) values ('candidato edita nome/telefone (perfil)','OK (Nome Novo)',v);

  reset role;
  perform set_config('request.jwt.claims', null, true);
end $$;

-- =========================================================
-- Conta BLOQUEADA (status trocado como postgres, ataque como authenticated)
-- =========================================================
update public.users set status='blocked' where id='11111111-1111-1111-1111-111111111111';
do $$
declare v text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub','11111111-1111-1111-1111-111111111111','role','authenticated')::text, true);

  begin
    insert into public.simulation_attempts(user_id,phase,mode)
      values ('11111111-1111-1111-1111-111111111111','phase1','practice'); v:='CRIOU';
  exception when others then v:='BLOQUEADO'; end;
  insert into probe(teste,esperado,obtido) values ('conta bloqueada abre tentativa via PostgREST','BLOQUEADO',v);

  begin update public.users set status='active' where id='11111111-1111-1111-1111-111111111111'; exception when others then null; end;
  select status into v from public.users where id='11111111-1111-1111-1111-111111111111';
  insert into probe(teste,esperado,obtido) values ('conta bloqueada se reativa','blocked',v);

  reset role;
  perform set_config('request.jwt.claims', null, true);
end $$;
update public.users set status='active' where id='11111111-1111-1111-1111-111111111111';

-- =========================================================
-- Cadastro malicioso: handle_new_user não pode aceitar role='admin'
-- (simula o trigger de auth.users com raw_user_meta_data controlado)
-- =========================================================
do $$
declare v text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('99999999-9999-9999-9999-999999999999','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','evil@test.local', crypt('x', gen_salt('bf')), now(),
    '{"provider":"email"}',
    '{"name":"Evil","role":"admin","operational_profile":"TWR","target_exam":"whatever"}',
    now(), now());
  select role::text into v from public.users where id='99999999-9999-9999-9999-999999999999';
  insert into probe(teste,esperado,obtido) values ('cadastro pedindo role=admin','pilot',v);
  delete from auth.users where id='99999999-9999-9999-9999-999999999999';
end $$;

-- =========================================================
-- Ação administrativa POSITIVA: backend (postgres/service_role) promove alguém
-- =========================================================
do $$
declare v text;
begin
  update public.users set role='admin' where id='11111111-1111-1111-1111-111111111111';
  select role::text into v from public.users where id='11111111-1111-1111-1111-111111111111';
  insert into probe(teste,esperado,obtido) values ('backend promove usuario a admin','admin',v);
  update public.users set role='air_traffic_controller' where id='11111111-1111-1111-1111-111111111111';
end $$;

select teste, esperado, obtido,
  case when obtido = esperado then 'PASS' else 'FAIL' end as veredito
from probe order by seq;
