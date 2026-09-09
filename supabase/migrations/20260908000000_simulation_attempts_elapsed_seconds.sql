-- Tempo decorrido acumulado do simulado (Fase 2 e SDEA), em segundos.
-- Antes o cronômetro da IHM era só um contador local que reiniciava do zero
-- toda vez que a tela abria — ao pausar e retomar um simulado practice, o
-- aluno perdia a noção do tempo total gasto. Agora o valor é persistido ao
-- pausar / concluir e restaurado ao reabrir, então "pausa" de verdade.
alter table public.simulation_attempts
  add column if not exists elapsed_seconds integer not null default 0;

-- Tabela já existente: o role `authenticated` já tem GRANT de update e a RLS
-- de posse já cobre a coluna nova (é update da própria linha). Sem policy nova.
