-- Bucket "phase2-recordings" criado via scripts/create-phase2-recordings-bucket.mjs
-- (público para leitura, como phase1-audios). Falta a policy de INSERT: bucket
-- público não implica permissão de escrita — sem isso, o upload feito pela
-- Server Action com o client autenticado do usuário falha com "permission
-- denied" (mesma classe de bug de GRANT/policy ausente já vista no projeto).
-- Objetos são salvos como "{attemptId}/{promptId}-{stage}-{timestamp}.<ext>";
-- a policy valida que o attemptId no caminho pertence ao usuário autenticado.

create policy "insert own phase2 recordings"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'phase2-recordings'
  and exists (
    select 1 from public.simulation_attempts sa
    where sa.id::text = (storage.foldername(name))[1]
      and sa.user_id = auth.uid()
  )
);
