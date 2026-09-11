-- Correções da revisão do Milestone 2 (ver docs/project-status.md).
-- Aditiva/segura em qualquer ordem de deploy (colunas nullable/com default;
-- nenhuma trava nova pra escrita que o código antigo já fazia).

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
