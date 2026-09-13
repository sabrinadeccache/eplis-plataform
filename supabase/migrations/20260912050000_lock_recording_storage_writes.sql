-- Milestone 3, correção da revisão (2026-09-12) — achado P0: as policies de
-- storage criadas em 20260912000000 concediam INSERT e SELECT DIRETO ao
-- role `authenticated` nos buckets de gravação, checando só posse da
-- tentativa. Isso permitia ao candidato contornar TODA a API: subir um
-- áudio direto pro bucket (sem passar por consentimento, pelo guard de item
-- do M2, pelo decode real do ffmpeg, ou pelo carimbo de `expires_at`), e
-- LER/baixar objetos direto (sem passar pelo limite de 120s da URL
-- assinada — o titular podia gerar link compartilhável de vida longa
-- sozinho, sem nenhuma das proteções da aplicação). Comportamento documentado
-- do Supabase Storage: RLS em `storage.objects` concede acesso rw direto ao
-- objeto, independente de qualquer regra da aplicação.
--
-- Correção: fecha o storage pro role `authenticated` NOS DOIS BUCKETS DE
-- GRAVAÇÃO igual ao padrão já usado pra nota/estado de tentativa (M1) —
-- toda escrita/leitura passa a ser só por `service_role`, depois de
-- `authorize()` + os guards do M2 (consentimento, item, decode). O client
-- do candidato nunca mais toca o objeto: nem pra subir, nem pra ler.
--
-- ORDEM DE DEPLOY: migration ANTES do código, como o resto do projeto — o
-- código ANTIGO (que ainda chamava `supabase.storage...upload` com o client
-- do usuário) pararia de funcionar assim que esta migration for aplicada.
-- Corrigido no mesmo commit: as rotas passam a subir com `admin.storage`.

drop policy if exists "insert own recordings" on storage.objects;
drop policy if exists "select own recordings" on storage.objects;

-- Sem policy nenhuma pra `authenticated` nos buckets phase2-recordings/
-- pilot-recordings: RLS em `storage.objects` é "deny by default" — service_role
-- ignora RLS e continua funcionando (é o que as rotas e
-- `createRecordingSignedUrl` usam).
