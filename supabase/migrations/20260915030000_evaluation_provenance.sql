-- M6: torna cada relatório final auditável pela versão da régua, do prompt e
-- do pipeline que o produziu. Registros antigos permanecem identificados como
-- legado; relatórios novos recebem versões explícitas pela aplicação.

alter table public.simulation_feedbacks
  add column if not exists rubric_version text,
  add column if not exists prompt_version text,
  add column if not exists pipeline_version text;

update public.simulation_feedbacks
set
  rubric_version = coalesce(rubric_version, 'legacy-unversioned'),
  prompt_version = coalesce(prompt_version, 'legacy-unversioned'),
  pipeline_version = coalesce(pipeline_version, 'legacy-unversioned');

comment on column public.simulation_feedbacks.rubric_version is
  'Versão da régua de avaliação usada no relatório.';
comment on column public.simulation_feedbacks.prompt_version is
  'Versão do prompt de relatório final usado na avaliação.';
comment on column public.simulation_feedbacks.pipeline_version is
  'Versão do pipeline de evidência usado na avaliação.';
