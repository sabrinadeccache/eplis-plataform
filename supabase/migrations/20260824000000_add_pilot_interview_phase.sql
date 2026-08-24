-- Trilha do piloto (SDEA): novo valor de enum pra `phase`, usado por
-- `simulation_attempts.phase` e `simulation_feedbacks.phase` (as duas
-- já são genéricas por phase, sem coluna nenhuma específica de controlador —
-- não precisam de nenhuma outra alteração de schema). Precisa estar num
-- arquivo/transação próprio: um valor de enum novo precisa estar comitado
-- antes de ser referenciado por DDL subsequente (a migration seguinte já cria
-- tabelas que vão receber linhas com esse `phase`).
alter type public.phase add value 'pilot_interview';
