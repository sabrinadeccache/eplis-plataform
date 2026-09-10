-- Fixa o search_path das funções criadas em 20260910000000 / 20260910120000.
-- Sem isso o advisor do Supabase acusa `function_search_path_mutable` (0011):
-- uma função sem search_path fixo resolve identificadores não qualificados pelo
-- search_path de quem chama. Todas já schema-qualificam as referências, então o
-- risco é baixo (e são SECURITY INVOKER, não DEFINER), mas pinar é a prática
-- recomendada e zera o aviso. Aditiva, sem dependência de código.
alter function public.is_privileged_writer()               set search_path = public;
alter function public.simulation_attempts_guard()          set search_path = public;
alter function public.users_block_privileged_columns()     set search_path = public;
alter function public.phase1_answers_block_client_writes() set search_path = public;
alter function public.responses_block_client_writes()      set search_path = public;
