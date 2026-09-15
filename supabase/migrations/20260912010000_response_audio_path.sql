-- Milestone 3.1 — guardar o CAMINHO do objeto no storage, não uma URL
-- pública. Com os buckets privados (20260912000000), `audio_url` não faz
-- mais sentido: não existe URL estável pra uma gravação privada; o acesso
-- passa a ser por URL ASSINADA de vida curta, gerada sob demanda depois de
-- confirmar autorização (src/lib/simulations/recording-access.ts).
--
-- `audio_url` NÃO é removida: as linhas antigas guardam a URL pública que
-- foi gravada quando o bucket era público (e que deixou de funcionar na
-- migration anterior — o que é justamente o desejado). Mantida como
-- histórico até a decisão de retenção (M3.2) dizer o que fazer com as
-- gravações antigas; o código novo para de escrever nela.
--
-- ORDEM DE DEPLOY: migration antes do código (o código novo escreve em
-- `audio_path`; se a coluna não existir, o INSERT/UPDATE falha).

alter table public.phase2_responses add column if not exists audio_path text;
alter table public.pilot_responses add column if not exists audio_path text;

-- Backfill: extrai o caminho do objeto das URLs públicas já gravadas
-- (`.../object/public/<bucket>/<caminho>`), pra que as gravações antigas
-- continuem endereçáveis pelo processo de retenção/administração mesmo sem
-- URL pública. Idempotente: só toca linhas com `audio_path` ainda nulo e
-- `audio_url` no formato esperado.
update public.phase2_responses
set audio_path = split_part(audio_url, '/object/public/phase2-recordings/', 2)
where audio_path is null
  and audio_url like '%/object/public/phase2-recordings/%';

update public.pilot_responses
set audio_path = split_part(audio_url, '/object/public/pilot-recordings/', 2)
where audio_path is null
  and audio_url like '%/object/public/pilot-recordings/%';
