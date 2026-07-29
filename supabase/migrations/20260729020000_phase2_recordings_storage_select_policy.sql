-- A policy de INSERT em storage.objects (20260729010000) não bastou: a API de
-- Storage faz um `INSERT ... RETURNING` internamente para devolver os metadados
-- do objeto recém-criado, e o Postgres exige que a linha inserida também seja
-- visível por uma policy de SELECT — sem ela, o RETURNING falha com "new row
-- violates row-level security policy", mesmo com a policy de INSERT correta e
-- satisfeita (confirmado isolando o problema via testes diretos em SQL: um
-- INSERT sem RETURNING passa, o mesmo INSERT com RETURNING falha até esta
-- policy existir).

create policy "select own phase2 recordings"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'phase2-recordings'
  and exists (
    select 1 from public.simulation_attempts sa
    where sa.id::text = (storage.foldername(name))[1]
      and sa.user_id = auth.uid()
  )
);
