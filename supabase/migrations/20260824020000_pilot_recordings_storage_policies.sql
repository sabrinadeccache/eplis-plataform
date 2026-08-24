-- Bucket "pilot-recordings" criado via scripts/create-pilot-recordings-bucket.mjs
-- (público para leitura, mesmo padrão de phase2-recordings/phase1-audios).
-- Objetos salvos como "{attemptId}/{promptId}-{stage}-{timestamp}.<ext>"; as
-- policies validam que o attemptId no caminho pertence ao usuário autenticado.
-- INSERT e SELECT já saem juntas de primeira aqui — a Fase 2 descobriu depois
-- de um bug real que a policy de SELECT também é exigida, porque a API de
-- Storage faz um `INSERT ... RETURNING` internamente pra devolver os
-- metadados do objeto recém-criado (ver CLAUDE.md).

create policy "insert own pilot recordings"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'pilot-recordings'
  and exists (
    select 1 from public.simulation_attempts sa
    where sa.id::text = (storage.foldername(name))[1]
      and sa.user_id = auth.uid()
  )
);

create policy "select own pilot recordings"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'pilot-recordings'
  and exists (
    select 1 from public.simulation_attempts sa
    where sa.id::text = (storage.foldername(name))[1]
      and sa.user_id = auth.uid()
  )
);
