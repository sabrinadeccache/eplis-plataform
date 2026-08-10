-- Restringe o enum operational_profile de 8 pra 5 valores.
-- Decisão da Sabrina (2026-08-10): o produto passa a cobrir só 4 áreas
-- operacionais reais — TWR, APP, ACC, COpM (substitui a ideia inicial de "DA",
-- defesa aérea — no SISCEAB quem faz esse papel é o COpM, Controlador de
-- Operações Militares) — mais 'general' (mantido: marca conteúdo sem
-- restrição de perfil, usado nas Partes 1/3 e como fallback nas Partes 2/4).
-- AFIS, FIS e ab_initio saem do enum: não fazem parte do escopo de conteúdo
-- real desta rodada. Precisa recriar o tipo porque Postgres não permite
-- remover valores de um enum existente (só adicionar).
--
-- Pré-requisito: não pode haver nenhuma linha usando os valores removidos.
-- `scripts/dev-clean-test-data.mjs` já foi rodado antes desta migration
-- pra zerar as tentativas de teste da Sabrina; ainda assim, por segurança,
-- as duas primeiras instruções remapeiam qualquer linha remanescente pra um
-- valor válido antes do ALTER TYPE (evita a migration falhar sem aviso claro
-- se sobrar algum dado inesperado).
update public.users
  set operational_profile = null
  where operational_profile in ('AFIS', 'FIS', 'ab_initio');

update public.phase2_prompts
  set operational_profile = 'general'
  where operational_profile in ('AFIS', 'FIS', 'ab_initio');

create type public.operational_profile_new as enum ('TWR', 'APP', 'ACC', 'COpM', 'general');

alter table public.users
  alter column operational_profile type public.operational_profile_new
  using operational_profile::text::public.operational_profile_new;

alter table public.phase2_prompts
  alter column operational_profile type public.operational_profile_new
  using operational_profile::text::public.operational_profile_new;

drop type public.operational_profile;
alter type public.operational_profile_new rename to operational_profile;
