-- Milestone 2 do plano de correção (guard autoritativo de item + idempotência
-- de resposta, ver docs/project-status.md). Adiciona `item_slot` a
-- `phase2_responses`/`pilot_responses`: a posição (0-based) da resposta
-- dentro da sequência de estágios do item — ver
-- src/services/simulations/phase2/response-stages.ts e .../pilot/response-stages.ts.
-- Necessário porque `response_stage` sozinho NÃO é único dentro de um item em
-- todo lugar: a Parte 4 do SDEA registra "narrative" duas vezes (hipótese de
-- antes / hipótese de depois) para o mesmo prompt. É o `item_slot`, não o
-- nome do estágio, que dá uma chave de posição estável pro guard de item
-- (src/lib/simulations/item-guard.ts) usar como trava de corrida.
--
-- ORDEM DE DEPLOY INVERTIDA em relação à convenção do M1 (ver cabeçalho de
-- 20260910000000_lock_privileged_writes.sql: "código primeiro, migration
-- depois"). Lá a migration adicionava uma trava que rejeitava uma escrita
-- que o código ANTIGO ainda fazia — aplicar antes do deploy quebrava
-- produção. Aqui é o oposto: o código NOVO é quem passa a mandar
-- `item_slot` no INSERT; o código antigo nem conhece essa coluna. Esta
-- migration só ADICIONA uma coluna nullable (sem default, sem NOT NULL) e um
-- índice único que o Postgres não aplica entre linhas com `item_slot` NULL
-- — então é seguro aplicar ANTES do deploy do código novo: o código antigo
-- continua inserindo normalmente (a coluna nova fica NULL nessas linhas) e
-- nenhuma escrita existente passa a ser rejeitada. Só depois que o código
-- novo estiver no ar é que `item_slot` passa a ser preenchido e o índice
-- único passa a valer de verdade.

alter table public.phase2_responses add column if not exists item_slot smallint;
alter table public.pilot_responses add column if not exists item_slot smallint;

-- Backfill das linhas existentes: cada linha recebe a posição cronológica
-- dela dentro do (attempt, prompt) — não tenta recalcular o `item_slot`
-- "correto" pela sequência real de estágios (não vale a pena: tentativas já
-- concluídas não passam pelo guard novo, que só atua em tentativas
-- `in_progress`). Só garante que toda linha antiga tenha um valor, pra não
-- ficar tudo NULL desnecessariamente.
with ranked as (
  select id,
    row_number() over (
      partition by simulation_attempt_id, prompt_id
      order by created_at asc, id asc
    ) - 1 as slot
  from public.phase2_responses
)
update public.phase2_responses r
set item_slot = ranked.slot
from ranked
where ranked.id = r.id
  and r.item_slot is null;

with ranked as (
  select id,
    row_number() over (
      partition by simulation_attempt_id, prompt_id
      order by created_at asc, id asc
    ) - 1 as slot
  from public.pilot_responses
)
update public.pilot_responses r
set item_slot = ranked.slot
from ranked
where ranked.id = r.id
  and r.item_slot is null;

-- Índice único: trava de corrida real do guard de item. NULL nunca conflita
-- com NULL num índice único do Postgres — linhas de tentativas antigas
-- (concluídas antes desta migration, sem passar pelo backfill acima por
-- algum motivo) continuam seguras.
create unique index if not exists phase2_responses_attempt_prompt_slot_uidx
  on public.phase2_responses (simulation_attempt_id, prompt_id, item_slot);

create unique index if not exists pilot_responses_attempt_prompt_slot_uidx
  on public.pilot_responses (simulation_attempt_id, prompt_id, item_slot);
