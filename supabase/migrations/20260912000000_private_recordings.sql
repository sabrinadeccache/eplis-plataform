-- Milestone 3.1 do plano de correção — gravações privadas (ver
-- docs/project-status.md). P0 confirmado em produção antes desta migration:
-- os buckets `phase2-recordings` e `pilot-recordings` estavam com
-- `public = true`, e um `HEAD` ANÔNIMO (sem apikey, sem cookie, sem conta)
-- em
--   /storage/v1/object/public/pilot-recordings/<attemptId>/<arquivo>.webm
-- devolvia `HTTP 200` com `content-type: audio/webm;codecs=opus` e o áudio
-- inteiro. Ou seja: a voz do candidato era baixável por qualquer pessoa que
-- tivesse (ou adivinhasse) a URL. As policies de RLS já existiam e já eram
-- por dono (20260729010000/20260729020000/20260824020000), mas bucket
-- público ignora RLS na leitura — o endpoint `/object/public/` não consulta
-- policy nenhuma.
--
-- ORDEM DE DEPLOY: migration ANTES do código, como o resto do projeto —
-- e esta migration foi escrita pra ser segura nessa ordem, em dois pontos:
--
-- 1. Tornar o bucket privado não quebra nenhuma LEITURA existente, porque
--    nada no app lê a gravação de volta: as telas de resultado mostram
--    transcrição/feedback, nunca o áudio (conferido por grep em `src/` —
--    `audio_url` de resposta não é consumido em lugar nenhum). Só invalida
--    as URLs públicas já gravadas, que era exatamente o objetivo.
-- 2. As policies aceitam os DOIS formatos de caminho durante a transição.
--    Sem isso haveria um impasse: o código HOJE em produção grava
--    `{attemptId}/{arquivo}`, então uma policy que exigisse só o formato
--    novo (`{userId}/{attemptId}/{arquivo}`) rejeitaria todo upload até o
--    deploy; e uma policy que exigisse só o formato antigo rejeitaria o
--    código novo. Com as duas formas aceitas, qualquer ordem funciona.
--    Quando não houver mais tentativa `in_progress` gravando no formato
--    antigo, uma migration de fechamento remove a cláusula legada (ver
--    docs/project-status.md).

-- 1. Buckets privados + limites de defesa em profundidade (mesmo teto do
-- M2: MAX_AUDIO_BYTES em src/lib/audio/validate.ts, ~3,75 MB).
update storage.buckets
set public = false,
    file_size_limit = 3932160,
    allowed_mime_types = array['audio/webm', 'audio/mp4']
where id in ('phase2-recordings', 'pilot-recordings');

-- 2. Caminho novo, com o DONO no prefixo: `{userId}/{attemptId}/{arquivo}`.
-- O caminho antigo era `{attemptId}/{arquivo}` — o attemptId é UUID (não
-- enumerável), mas não identificava o proprietário, então a policy precisava
-- de um join pra descobrir de quem era o objeto. Com o userId no 1º
-- segmento, a checagem de dono é direta E o caminho continua não
-- enumerável (UUID do usuário + UUID da tentativa + sufixo aleatório no
-- nome do arquivo, gerado no código).
drop policy if exists "insert own phase2 recordings" on storage.objects;
drop policy if exists "select own phase2 recordings" on storage.objects;
drop policy if exists "insert own pilot recordings" on storage.objects;
drop policy if exists "select own pilot recordings" on storage.objects;

create policy "insert own recordings"
on storage.objects
for insert
to authenticated
with check (
  bucket_id in ('phase2-recordings', 'pilot-recordings')
  and (
    -- Formato NOVO: 1º segmento é o próprio usuário e o 2º é uma tentativa
    -- que pertence a ele.
    (
      (storage.foldername(name))[1] = auth.uid()::text
      and exists (
        select 1 from public.simulation_attempts sa
        where sa.id::text = (storage.foldername(name))[2]
          and sa.user_id = auth.uid()
      )
    )
    -- Formato LEGADO (código anterior ao deploy do M3.1): 1º segmento é a
    -- própria tentativa. Removido na migration de fechamento.
    or exists (
      select 1 from public.simulation_attempts sa
      where sa.id::text = (storage.foldername(name))[1]
        and sa.user_id = auth.uid()
    )
  )
);

-- A API de Storage faz `INSERT ... RETURNING` internamente, então o INSERT
-- só funciona se a linha inserida também for visível por uma policy de
-- SELECT — achado real do projeto, ver o cabeçalho de
-- 20260729020000_phase2_recordings_storage_select_policy.sql e o CLAUDE.md.
create policy "select own recordings"
on storage.objects
for select
to authenticated
using (
  bucket_id in ('phase2-recordings', 'pilot-recordings')
  and (
    (
      (storage.foldername(name))[1] = auth.uid()::text
      and exists (
        select 1 from public.simulation_attempts sa
        where sa.id::text = (storage.foldername(name))[2]
          and sa.user_id = auth.uid()
      )
    )
    or exists (
      select 1 from public.simulation_attempts sa
      where sa.id::text = (storage.foldername(name))[1]
        and sa.user_id = auth.uid()
    )
  )
);

-- 3. DELETE: deliberadamente NÃO concedido ao role `authenticated`.
-- Apagar a própria gravação seria destruir a evidência da prova (a nota do
-- Official é derivada dela), então exclusão acontece só por
-- `service_role`: o processo de retenção (M3.2) e o atendimento a um
-- pedido de exclusão do titular (canal administrativo, M3.3). Mesma lógica
-- do M1, onde nota/estado/ciclo de vida de tentativa também são reservados
-- ao backend. Sem policy de delete pra `authenticated`, qualquer tentativa
-- de apagar pelo client é negada por RLS.
