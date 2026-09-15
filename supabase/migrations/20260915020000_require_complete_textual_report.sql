-- M6: um relatório incompleto não pode publicar uma nota geral por fallback.
-- A migration anterior remove pseudo-notas acústicas; esta deixa explícito
-- que os quatro critérios sustentados pela transcrição precisam existir para
-- que overall_score seja apresentado.
update public.simulation_feedbacks
set overall_score = null
where phase in ('phase2', 'pilot_interview')
  and (
    structure_score is null
    or vocabulary_score is null
    or comprehension_score is null
    or interaction_score is null
  );
