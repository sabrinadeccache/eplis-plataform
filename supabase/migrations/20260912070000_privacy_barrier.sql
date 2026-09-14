-- M3 / revisão Codex: aplicar ANTES deste código (RPCs/colunas aditivas).
-- Não iniciar exclusões até TODOS os deployments/workers antigos pararem:
-- eles não registravam uploads. 20260912050000 continua DEPOIS do código.
-- Uma reserva de upload NÃO expira: relógio não prova que I/O terminou.
-- Worker morto deixa exclusão pendente/fail-closed; recuperação operacional
-- exige confirmar que o worker parou (docs/m3-privacy-handoff.md).
create table public.privacy_deletion_requests (
  user_id uuid primary key references public.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);
create table public.privacy_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  response_id uuid not null,
  track text not null check (track in ('phase2', 'pilot')),
  started_at timestamptz not null default now()
);
create index privacy_uploads_user_id_idx on public.privacy_uploads(user_id);
create unique index privacy_uploads_response_idx on public.privacy_uploads(track, response_id);
alter table public.privacy_deletion_requests enable row level security;
alter table public.privacy_uploads enable row level security;
revoke all on public.privacy_deletion_requests, public.privacy_uploads from public, anon, authenticated;
grant all on public.privacy_deletion_requests, public.privacy_uploads to service_role;

create function public.begin_privacy_upload(p_user_id uuid, p_response_id uuid, p_track text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_attempt uuid; v_pending boolean; v_table text;
begin
  if p_track not in ('phase2', 'pilot') then raise exception 'Trilha inválida'; end if;
  v_table := case p_track when 'phase2' then 'phase2_responses' else 'pilot_responses' end;
  execute format('select simulation_attempt_id, recording_cleanup_pending from public.%I where id = $1 for update', v_table)
    into v_attempt, v_pending using p_response_id;
  if v_attempt is null or v_pending or not exists (
    select 1 from public.simulation_attempts where id = v_attempt and user_id = p_user_id
  ) then raise exception 'Gravação indisponível' using errcode = '42501'; end if;
  perform 1 from public.users where id = p_user_id and status = 'active' for update;
  if not found or exists (select 1 from public.privacy_deletion_requests where user_id = p_user_id) then
    raise exception 'Conta em exclusão ou inativa' using errcode = '42501';
  end if;
  insert into public.privacy_uploads(user_id, response_id, track) values (p_user_id, p_response_id, p_track) returning id into v_id;
  return v_id;
end;
$$;

create function public.finish_privacy_upload(p_upload_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.privacy_uploads where id = p_upload_id;
$$;

create function public.request_privacy_deletion(p_user_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  -- Mesmo lock de begin_privacy_upload: ou a reserva entra primeiro e a
  -- exclusão espera, ou a barreira entra primeiro e o upload é recusado.
  perform 1 from public.users where id = p_user_id for update;
  if not found then raise exception 'Conta não encontrada'; end if;
  insert into public.privacy_deletion_requests(user_id) values (p_user_id) on conflict do nothing;
  update public.users set status = 'blocked' where id = p_user_id;
  return not exists (select 1 from public.privacy_uploads where user_id = p_user_id);
end;
$$;
revoke all on function public.begin_privacy_upload(uuid, uuid, text), public.finish_privacy_upload(uuid), public.request_privacy_deletion(uuid) from public, anon, authenticated;
grant execute on function public.begin_privacy_upload(uuid, uuid, text), public.finish_privacy_upload(uuid), public.request_privacy_deletion(uuid) to service_role;

-- A barreira vale inclusive para service_role. Não é um SELECT no código
-- seguido de UPDATE: o lock é mantido até o COMMIT de cada escrita.
create function public.assert_privacy_writable(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.users where id = p_user_id for update;
  if not found or exists (select 1 from public.privacy_deletion_requests where user_id = p_user_id) then
    raise exception 'Conteúdo invalidado por exclusão de conta' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.assert_privacy_writable(uuid) from public, anon, authenticated;

alter table public.phase2_responses add column recording_cleanup_pending boolean not null default false,
  add column recording_purged_at timestamptz;
alter table public.pilot_responses add column recording_cleanup_pending boolean not null default false,
  add column recording_purged_at timestamptz;
create index phase2_orphan_cleanup_idx on public.phase2_responses(id)
  where audio_path is null and recording_purged_at is null and processing_status in ('error', 'transcribing', 'analyzing');
create index pilot_orphan_cleanup_idx on public.pilot_responses(id)
  where audio_path is null and recording_purged_at is null and processing_status in ('error', 'transcribing', 'analyzing');

create function public.guard_privacy_content() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_content boolean;
begin
  select user_id into v_owner from public.simulation_attempts where id = new.simulation_attempt_id;
  if tg_table_name = 'simulation_feedbacks' then
    v_content := case when tg_op = 'INSERT' then new.general_feedback is not null
      else new.general_feedback is distinct from old.general_feedback and new.general_feedback is not null end;
  else
    v_content := case when tg_op = 'INSERT' then
      new.audio_path is not null or new.audio_url is not null
        or new.transcript is not null or new.ai_feedback is not null
      else
        (new.audio_path is distinct from old.audio_path and new.audio_path is not null)
        or (new.audio_url is distinct from old.audio_url and new.audio_url is not null)
        or (new.transcript is distinct from old.transcript and new.transcript is not null)
        or (new.ai_feedback is distinct from old.ai_feedback and new.ai_feedback is not null)
      end;
    if tg_op = 'UPDATE' then
      if old.recording_cleanup_pending and
        (new.processing_status = 'transcribing' or new.started_at is distinct from old.started_at or
         (new.audio_path is distinct from old.audio_path and new.audio_path is not null) or
         (new.audio_url is distinct from old.audio_url and new.audio_url is not null)) then
        raise exception 'Gravação em limpeza' using errcode = '42501';
      end if;
      if new.started_at is distinct from old.started_at then
        new.recording_purged_at := null;
      end if;
    end if;
  end if;
  -- Limpeza para NULL continua permitida após a barreira; repovoar conteúdo
  -- (inclusive relatório/final feedback que saiu tarde da IA) não passa.
  if tg_op = 'INSERT' or v_content then
    perform public.assert_privacy_writable(v_owner);
  end if;
  return new;
end;
$$;
create trigger privacy_content_guard before insert or update on public.phase2_responses
for each row execute function public.guard_privacy_content();
create trigger privacy_content_guard before insert or update on public.pilot_responses
for each row execute function public.guard_privacy_content();
create trigger privacy_content_guard before insert or update on public.simulation_feedbacks
for each row execute function public.guard_privacy_content();

create function public.guard_privacy_attempt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_privacy_writable(new.user_id);
  return new;
end;
$$;
create trigger privacy_attempt_guard before insert on public.simulation_attempts
for each row execute function public.guard_privacy_attempt();

create function public.guard_privacy_user_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.privacy_uploads where user_id = old.id) then
    raise exception 'Upload em andamento: exclusão pendente';
  end if;
  if exists (select 1 from public.simulation_attempts where user_id = old.id)
     and not exists (select 1 from public.privacy_deletion_requests where user_id = old.id) then
    raise exception 'Use o fluxo de exclusão de dados antes de apagar a conta';
  end if;
  return old;
end;
$$;
create trigger privacy_user_delete_guard before delete on public.users
for each row execute function public.guard_privacy_user_delete();

-- Claim terminal: depois do vencimento este slot não aceita novos uploads,
-- nem depois da limpeza. Cron concorrente/repetido pode remover o mesmo
-- caminho com segurança. Não há lease de limpeza cujo timeout reabra retry.
create function public.claim_recording_cleanup(p_track text, p_response_id uuid, p_now timestamptz, p_orphan boolean, p_expected_path text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r record; v_table text;
begin
  if p_track not in ('phase2', 'pilot') then raise exception 'Trilha inválida'; end if;
  v_table := case p_track when 'phase2' then 'phase2_responses' else 'pilot_responses' end;
  execute format('select * from public.%I where id = $1 for update', v_table) into r using p_response_id;
  if r.id is null then return false; end if;
  if r.audio_path is distinct from p_expected_path then return false; end if;
  if exists (select 1 from public.privacy_uploads where response_id = p_response_id and track = p_track) then
    return false;
  end if;
  if p_orphan then
    if r.audio_path is not null or r.recording_purged_at is not null
       or r.processing_status not in ('error', 'transcribing', 'analyzing')
       or coalesce(r.started_at, r.created_at) > p_now - interval '30 days' then return false; end if;
  else
    if r.audio_path is null or r.expires_at is null or r.expires_at > p_now then return false; end if;
    -- Retry pode ter renovado started_at sem ainda ter substituído o prazo
    -- do upload anterior. Não limpar seu objeto no intervalo upload/metadado.
    if r.processing_status in ('transcribing', 'analyzing')
       and coalesce(r.started_at, r.created_at) > p_now - interval '30 days' then return false; end if;
  end if;
  execute format('update public.%I set recording_cleanup_pending = true, processing_status = case when processing_status in (''transcribing'', ''analyzing'') then ''error'' else processing_status end where id = $1', v_table)
    using p_response_id;
  return true;
end;
$$;
revoke all on function public.claim_recording_cleanup(text, uuid, timestamptz, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_recording_cleanup(text, uuid, timestamptz, boolean, text) to service_role;

-- Uma ida ao PostgREST por página, mantendo o claim individual sob lock.
-- Um upload ativo só bloqueia a própria linha; os demais candidatos seguem.
create function public.claim_recording_cleanup_batch(p_track text, p_candidates jsonb, p_now timestamptz, p_orphan boolean)
returns table(response_id uuid, claimed boolean, upload_pending boolean)
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  for c in
    select (value->>'id')::uuid as id, value->>'audio_path' as audio_path
    from jsonb_array_elements(p_candidates)
    order by (value->>'id')::uuid
  loop
    response_id := c.id;
    if exists (select 1 from public.privacy_uploads where privacy_uploads.response_id = c.id and privacy_uploads.track = p_track) then
      claimed := false; upload_pending := true; return next; continue;
    end if;
    claimed := public.claim_recording_cleanup(p_track, c.id, p_now, p_orphan, c.audio_path);
    -- Fecha a corrida entre o precheck acima e o lock interno do claim.
    upload_pending := not claimed and exists (
      select 1 from public.privacy_uploads
      where privacy_uploads.response_id = c.id and privacy_uploads.track = p_track
    );
    return next;
  end loop;
end;
$$;
revoke all on function public.claim_recording_cleanup_batch(text, jsonb, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.claim_recording_cleanup_batch(text, jsonb, timestamptz, boolean) to service_role;
