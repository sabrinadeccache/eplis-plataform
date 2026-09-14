-- M6 (alternativa provisória): o pipeline atual avalia transcrições, não o
-- sinal acústico. Remove pseudo-notas históricas e recalcula o overall apenas
-- com critérios para os quais há evidência disponível.
update public.simulation_feedbacks
set pronunciation_score = null,
    fluency_score = null,
    overall_score = least(
      structure_score,
      vocabulary_score,
      comprehension_score,
      interaction_score
    )::text
where phase in ('phase2', 'pilot_interview');

comment on column public.simulation_feedbacks.pronunciation_score is
  'Null até existir avaliação acústica validada; não inferir da transcrição.';
comment on column public.simulation_feedbacks.fluency_score is
  'Null até existir avaliação acústica validada; não inferir da transcrição.';
