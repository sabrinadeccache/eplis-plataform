-- Bucket "avatars" criado via scripts/create-avatars-bucket.mjs (público
-- para leitura, mesmo padrão de phase1-audios/phase2-images). Objetos são
-- salvos como "{userId}/avatar.<ext>" (upsert — sempre sobrescreve o mesmo
-- caminho, sem acumular fotos antigas) — as policies abaixo validam que o
-- userId no caminho é o do usuário autenticado.
-- Policy de SELECT necessária mesmo o bucket sendo público: a API de Storage
-- faz um INSERT/UPDATE ... RETURNING internamente, e o Postgres exige que a
-- linha seja visível por uma policy de SELECT (mesmo achado já documentado
-- em 20260729020000_phase2_recordings_storage_select_policy.sql).

create policy "insert own avatar"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "update own avatar"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "select own avatar"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
