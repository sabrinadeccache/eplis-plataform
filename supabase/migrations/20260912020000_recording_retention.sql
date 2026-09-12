-- Milestone 3.2 do plano de correção — retenção das gravações de voz
-- (ver docs/project-status.md). Prazo definido pela Sabrina:
--
--   practice → 30 dias    |    official → 180 dias
--
-- Racional registrado: o áudio existe pra gerar transcrição e feedback;
-- cumprida essa finalidade, guardar voz deixa de ter propósito ativo
-- (minimização, LGPD art. 6º III). Os 180 dias do `official` são a margem
-- pra contestar/reavaliar um resultado, já que a nota é derivada do áudio.
-- Transcrição, feedback e notas NÃO expiram — só a gravação.
--
-- `expires_at` é gravado explicitamente (não calculado na hora da consulta)
-- pra a retenção ser AUDITÁVEL: dá pra olhar uma linha e saber quando aquele
-- áudio vence, e dá pra um caso específico ter prazo próprio se algum dia
-- precisar. O processo de expiração está em src/lib/simulations/retention.ts
-- (+ scripts/expire-recordings.mjs, que roda em dry-run por padrão — o plano
-- exige que a retenção seja verificável SEM apagar dado de produção).

alter table public.phase2_responses add column if not exists expires_at timestamptz;
alter table public.pilot_responses add column if not exists expires_at timestamptz;

-- Backfill das gravações que já existem, derivando o prazo do modo da
-- tentativa (practice/official) a partir da data de criação da resposta.
update public.phase2_responses r
set expires_at = r.created_at + (case sa.mode when 'official' then interval '180 days' else interval '30 days' end)
from public.simulation_attempts sa
where sa.id = r.simulation_attempt_id
  and r.expires_at is null
  and r.audio_path is not null;

update public.pilot_responses r
set expires_at = r.created_at + (case sa.mode when 'official' then interval '180 days' else interval '30 days' end)
from public.simulation_attempts sa
where sa.id = r.simulation_attempt_id
  and r.expires_at is null
  and r.audio_path is not null;

-- Índice parcial: o processo de expiração procura só linhas que AINDA têm
-- áudio. Depois que a gravação é apagada, `audio_path` fica nulo e a linha
-- sai do índice — o que também é o que torna o processo idempotente.
create index if not exists phase2_responses_pending_expiry_idx
  on public.phase2_responses (expires_at)
  where audio_path is not null;

create index if not exists pilot_responses_pending_expiry_idx
  on public.pilot_responses (expires_at)
  where audio_path is not null;
