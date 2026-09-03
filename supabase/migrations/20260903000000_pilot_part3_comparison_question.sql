-- Parte 3 do SDEA: pergunta final em que o examinador pede pra comparar as 3
-- situações ouvidas ("How would you compare them?" / "Which one is the most
-- difficult to deal with and why?" / "...in terms of severity, possible
-- solutions or ways of prevention."). Uma ou duas dessas por prova, guardadas
-- por linha de conteúdo (o runner escolhe a do 3º áudio do sorteio).
-- Nullable: linhas de outras partes e conteúdo antigo continuam válidos.
alter table public.pilot_prompts
  add column if not exists comparison_question text;

comment on column public.pilot_prompts.comparison_question is
  'Parte 3: enunciado da comparação final das 3 situações. Null nas outras partes.';
