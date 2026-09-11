-- Correções da revisão do Milestone 2 (ver docs/project-status.md).
--
-- ORDEM DE DEPLOY: esta migration precisa ir ANTES do deploy do código desta
-- branch — é a ordem padrão do resto do projeto (ver
-- 20260910000000_lock_privileged_writes.sql), NÃO a ordem invertida usada em
-- 20260911000000_response_item_slot.sql. Motivo: o código novo
-- (assertSubmissionCooldown, src/lib/simulations/rate-limit.ts) faz
-- `UPDATE simulation_attempts SET last_submission_at = ...` em TODA
-- submissão de resposta, incondicionalmente — se a coluna não existir ainda,
-- esse UPDATE falha (PostgREST não conhece a coluna), e o código trata
-- qualquer erro nessa consulta como falha FECHADA (retorna 503, nunca
-- libera sem checar) — ou seja, toda submissão de resposta quebraria até a
-- migration ser aplicada. As outras duas mudanças aqui (`item_sequence`,
-- `retry_count`) são, em si, aditivas e seguras em qualquer ordem, mas por
-- estarem no mesmo arquivo que `last_submission_at`, a migration inteira
-- segue a ordem mais restritiva: migration primeiro, deploy depois.
-- (Achado da revisão: a versão anterior deste comentário dizia "segura em
-- qualquer ordem" pra este arquivo inteiro — a Sabrina apontou que isso
-- estava errado especificamente por causa do item 3 abaixo.)

-- 1. Sequência da tentativa persistida no momento da criação — antes,
-- `getSequenceForAttempt` recalculava a sequência a cada chamada a partir do
-- pool ATIVO no momento e do perfil ATUAL do usuário; se o conteúdo fosse
-- desativado/editado ou o perfil operacional mudasse no meio de uma
-- tentativa em andamento, o item "esperado" podia mudar sob os pés do guard.
-- Ver src/services/simulations/phase2/queries.ts e .../pilot/queries.ts.
alter table public.simulation_attempts add column if not exists item_sequence jsonb;

-- 2. Contador de retry por resposta — o guard de item (item-guard.ts) reusa
-- a mesma linha num retry (mesmo item_slot), então o número de LINHAS por
-- tentativa não cresce com retries; sem um contador próprio, retries com
-- falha (Whisper indisponível etc.) não tinham teto nenhum.
alter table public.phase2_responses add column if not exists retry_count smallint not null default 0;
alter table public.pilot_responses add column if not exists retry_count smallint not null default 0;

-- 3. Timestamp de cooldown por tentativa — a janela curta de rate limit
-- (src/lib/simulations/rate-limit.ts) tentou primeiro contar LINHAS de
-- resposta por `created_at`/`started_at`, mas um retry reusa a mesma linha
-- (item 2 acima), então nenhuma contagem de linhas reflete quantas vezes a
-- rota foi de fato chamada. `last_submission_at` é atualizado (via
-- compare-and-swap) em TODA submissão, inclusive retries — é a única forma
-- de medir taxa de envio independente de quantas linhas de resposta existem.
alter table public.simulation_attempts add column if not exists last_submission_at timestamptz;
