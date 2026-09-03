# EPLIS Trainer — Modelo de Dados (atualizado)

> Consolida a ESTRUTURA TÉCNICA DO BANCO DE DADOS original + os acréscimos do SPD/SRS
> + as correções extraídas das especificações oficiais do EPLIS (Fase 1, Fase 2, Manual do Examinando).
> Cada campo novo/alterado em relação ao documento original está marcado com **[NOVO]** ou **[ALTERADO]**.

## Visão geral

```
users
 └─ simulation_attempts
     ├─ phase1_answers ──► phase1_questions ──► phase1_audios
     ├─ phase2_responses ──► phase2_prompts
     ├─ pilot_responses ──► pilot_prompts
     └─ simulation_feedbacks
```

`simulation_attempts` e `simulation_feedbacks` são compartilhadas pelas duas trilhas
(controlador e piloto), distinguidas só pelo valor de `phase` — nenhuma coluna nova foi
precisa nelas pra trilha do piloto (SDEA). `phase1_*` e `phase2_*` seguem exclusivas do
controlador (EPLIS); `pilot_*` são exclusivas do piloto (SDEA) — ver seção 9.

---

## 1. `users`

| Campo | Tipo | Observações |
|---|---|---|
| id | uuid | vindo do Supabase Auth |
| name | text | |
| email | text | único |
| role | enum | `admin`, `pilot`, `air_traffic_controller` |
| status | enum | `active`, `inactive`, `blocked` |
| target_exam | text | derivado do `role` no cadastro, não escolhido pelo usuário: `air_traffic_controller` → `EPLIS`; `pilot` → `Santos Dumont English Assessment` (ver `src/lib/auth/actions.ts`, `targetExamForRole`) |
| operational_profile | enum, nullable | `TWR`, `APP`, `ACC`, `COpM` (controladores) — confirmado pelo Manual do Examinando (item 1.2.2) como o critério real de versionamento da Fase 2. **[2026-08-19]** `fixed_wing`, `rotary_wing` (pilotos) adicionados ao mesmo enum — migration `20260819000000_pilot_operational_profiles_and_avatar.sql`. **[2026-08-24]** trilha do piloto (SDEA) implementada — esses dois valores agora também filtram o conteúdo de `pilot_prompts` (ver seção 9), reaproveitando o mesmo enum/coluna que já existia pro cadastro. Nullable porque `admin` não precisa e o candidato pode se cadastrar sem saber ainda ("Ainda não sei") — nesse caso a tela `/sdea` pede pra completar o perfil antes de liberar o simulado. **[2026-08-10]** Enum restrito de 8 pra 5 valores nessa data — `AFIS`, `FIS` e `ab_initio` saíram por não fazerem parte do escopo real de conteúdo daquela rodada; ver migration `20260810000000_narrow_operational_profile.sql`. |
| avatar_url | text, nullable | **[NOVO, 2026-08-19]** foto de perfil, bucket de Storage `avatars` (público, path `{userId}/avatar.<ext>`, upsert) — ver `src/app/api/profile/avatar/route.ts` |
| created_at | timestamp | |

Senha **não** é armazenada aqui — delegada ao Supabase Auth.

---

## 2. `simulation_attempts`

| Campo | Tipo | Observações |
|---|---|---|
| id | uuid | |
| user_id | uuid → users | |
| phase | enum | `phase1`, `phase2` (controlador/EPLIS), `pilot_interview` (piloto/SDEA — **[NOVO, 2026-08-24]**; a trilha do piloto não tem um equivalente de "Fase 1" — o SDEA é uma única entrevista oral de 4 partes, sem prova de compreensão auditiva separada) |
| mode | enum | `practice`, `official` |
| status | enum | `in_progress`, `completed`, `abandoned` |
| score | numeric, nullable | Fase 1: nº de acertos. Fase 2: nulo no MVP ou estimativa |
| current_state | enum, nullable | **[NOVO]** espelha os estados da state machine (ver seção "Estados da Fase 2" abaixo). Permite retomar uma tentativa `official` interrompida sem reconstruir a posição a partir das respostas já gravadas |
| current_part | enum, nullable | **[NOVO]** `part1`..`part4` — parte atual da entrevista |
| current_item_index | int, nullable | **[NOVO]** índice do item dentro da parte atual (ex: 3ª de 10 situações da Parte 2) |
| started_at | timestamp | |
| finished_at | timestamp, nullable | |

---

## 3. `phase1_audios`

| Campo | Tipo | Observações |
|---|---|---|
| id | uuid | |
| title | text | nome interno |
| audio_url | text | |
| transcript | text | uso interno (QA, painel admin) |
| difficulty | enum | `easy`, `medium`, `hard` — equivalente simplificado do índice de facilidade real do EPLIS |
| category | text | domínio/evento (ver lista de Eventos e Domínios do Doc 9835, Apêndice B) |
| accent | text | ex: `american`, `mixed` |
| duration_seconds | int | especificação oficial: 10–45s |
| is_active | boolean | |
| created_at | timestamp | |

---

## 4. `phase1_questions`

| Campo | Tipo | Observações |
|---|---|---|
| id | uuid | |
| audio_id | uuid → phase1_audios | |
| prompt | text | em português, direto e conciso (conforme especificação — reduz interferência de leitura) |
| option_a / option_b / option_c | text | 3 alternativas |
| correct_option | enum | `a`, `b`, `c` |
| is_active | boolean | |
| created_at | timestamp | |

---

## 5. `phase1_answers`

| Campo | Tipo | Observações |
|---|---|---|
| id | uuid | |
| simulation_attempt_id | uuid → simulation_attempts | |
| question_id | uuid → phase1_questions | |
| selected_option | enum | `a`, `b`, `c` |
| is_correct | boolean | calculado no momento da resposta |
| created_at | timestamp | |

**Regra de tempo (confirmada pelo Manual do Examinando, item 1.2.1):** 30s de leitura (pode iniciar o áudio antes) → até 45s de áudio → 1 minuto para responder, **incluindo** a reescuta opcional dentro dessa mesma janela (não é tempo adicional). Ao fim de 1 min, avança automaticamente.

---

## 6. `phase2_prompts`

| Campo | Tipo | Observações |
|---|---|---|
| id | uuid | |
| part | enum | `part1`, `part2`, `part3`, `part4` |
| operational_profile | enum, nullable | mesmo enum de `users.operational_profile`, mais `general` (item sem restrição de perfil, usado nas Partes 1/3 e como fallback nas Partes 2/4). Confirma o RF-49 original mas agora com o campo que faltava no SPD (Tabela 5). **[2026-08-10]** Conteúdo real da Parte 2 (40 situações, 10 por perfil: TWR/APP/ACC/COpM — `scripts/seed-phase2-part2-profiles.mjs`) e da Parte 4 (1 imagem real por perfil — `scripts/seed-phase2-part4-profile-images.mjs`) substituiu o placeholder `general` único que existia antes. |
| prompt_text | text | |
| image_url | text, nullable | só Parte 4 |
| expected_duration_seconds | int | |
| order_index | int, nullable | **[NOVO]** posição sugerida dentro do sorteio da parte (permite montar sequência de dificuldade crescente na Parte 2, como no exame real) |
| is_active | boolean | |
| created_at | timestamp | |

**Composição por tentativa (confirmada pelas especificações oficiais — mesma lógica de banco de itens da Fase 1):**
- Parte 1: 4 perguntas sorteadas do pool `part1` do perfil do usuário
- Parte 2: 10 situações sorteadas do pool `part2` do perfil, em ordem crescente de complexidade
- Parte 3: 4 perguntas sorteadas do pool `part3` do perfil (2 concretas + 2 abstratas)
- Parte 4: 1 imagem sorteada do pool `part4` do perfil

---

## 7. `phase2_responses`

| Campo | Tipo | Observações |
|---|---|---|
| id | uuid | |
| simulation_attempt_id | uuid → simulation_attempts | |
| prompt_id | uuid → phase2_prompts | |
| response_stage | enum | **[ALTERADO]** agora cobre todos os sub-estágios da state machine: `main`, `situation_intro`, `situation_check`, `suggestion` (Parte 2), `image_observation`, `image_description`, `story_preparation`, `story_telling` (Parte 4) |
| audio_url | text, nullable | |
| transcript | text, nullable | |
| ai_feedback | text, nullable | feedback curto em inglês por resposta. `practice`: preenchido em tempo real (mostrado ao candidato após cada resposta). `official`: **[2026-08-27]** preenchido só na finalização (`advanceState`, em lote), para o demonstrativo por parte da tela de resultado — nunca mostrado durante a prova |
| ai_provider | text, nullable | ex: `anthropic` |
| model_version | text, nullable | ex: `claude-sonnet-5` |
| processing_status | enum | `queued`, `transcribing`, `analyzing`, `done`, `error` — controla a UI, não implica necessariamente fila assíncrona real (ver nota de arquitetura no SPD) |
| repetition_count | int, default 0 | quantas vezes o candidato pediu repetição da pergunta neste item. **[2026-08-27]** passou a ser lido pelo relatório final (`generateFinalReport`/`generatePilotFinalReport`): no `practice` qualquer repetição pesa no critério Compreensão; no `official` só a partir da 2ª. Ver "Regra de repetição" abaixo e a regra do botão no `docs/project-status.md` (2026-08-27). |
| started_at | timestamp, nullable | |
| finished_at | timestamp, nullable | |
| created_at | timestamp | |

**Regra de repetição (confirmada pelo Manual do Examinando, item 1.2.3 — mais restrita do que o SRS original previa):**
- Partes 1 e 3: candidato pode pedir repetição da pergunta OU esclarecimento de vocabulário, 1 vez por item; se pediu esclarecimento, pode pedir mais 1 repetição após a explicação.
- **Parte 2: só repetição da frase é aceita — esclarecimento de vocabulário NÃO é permitido nessa parte**, porque o item avalia justamente se o candidato entendeu o vocabulário/estrutura sem ajuda.
- Uso excessivo dessas estratégias não é esperado para candidatos em nível 5/6 — é sinal para a IA considerar na avaliação de "Interações", não motivo de bloqueio técnico.

**Timeout de início de resposta [ALTERADO 2026-08-11]:** no modo `official`, não existe botão manual para começar a falar — 5s depois da pergunta ser apresentada, a gravação começa sozinha (fidelidade ao exame real, decisão da Sabrina). Isso é um timer diferente do timer de duração da resposta (ainda não implementado) e é controlado separadamente na state machine (ver `docs/state-machine.md`).

---

## 8. `simulation_feedbacks`

| Campo | Tipo | Observações |
|---|---|---|
| id | uuid | |
| simulation_attempt_id | uuid → simulation_attempts | |
| phase | enum | `phase1`, `phase2`, `pilot_interview` |
| overall_score | text/numeric | Fase 1: percentual. Fase 2/SDEA: estimativa geral (menor dos 6 critérios) |
| pronunciation_score / structure_score / vocabulary_score / fluency_score / comprehension_score / interaction_score | enum `public.proficiency_level` | 4 faixas (**[2026-08-27]**, migration `20260827000000_add_excellent_proficiency_level.sql`): `weak` = Fraco (N1–N3), `moderate` = Moderado (N4), `good` = Ótimo (N5), `excellent` = Excelente (N6). Antes eram 3 (`good` rotulado "Bom"); linhas históricas com `good` passam a ser exibidas como "Ótimo", sem migração de dados. Evolução futura: escala numérica OACI 1–6 |
| general_feedback | text | |
| ai_provider | text, nullable | |
| model_version | text, nullable | |
| created_at | timestamp | |

**Regra de nota final (Doc 9835 / Manual do Examinando item 5.2):** por segurança operacional, o nível final é sempre o **menor** valor obtido entre os 6 critérios — não uma média. Essa regra deve estar no prompt de correção da IA como instrução explícita, não como algo inferido. Vale igualmente pro SDEA (ver seção 9) — é uma regra da Escala OACI, não específica do exame do controlador.

---

## 9. `pilot_prompts` e `pilot_responses` **[NOVO, 2026-08-24 — trilha do piloto/SDEA]**

Espelham `phase2_prompts`/`phase2_responses`, mas pro Santos Dumont English Assessment
(exame da ANAC pra pilotos) em vez do EPLIS. Estrutura levantada a partir de documentos
oficiais da ANAC (escala OACI — as mesmas 6 áreas do EPLIS) e de 5 provas reais completas
(1 prova-modelo oficial de avião + 4 provas reais de helicóptero). Ver `docs/state-machine.md`
pro detalhamento dos 4 estágios da Parte 2.

**[2026-09-03]** Pool de conteúdo ampliado a partir do Material Didático reescrito pela
Sabrina (só texto no banco nesta rodada — áudios/imagens pendentes): Parte 1 = 30
`general`; Parte 2 = 43 `fixed_wing` + 44 `rotary_wing` (por perfil: `order_index` 1-30 sem
imagem + 31+ com imagem, `complication_image_url` ainda null); Parte 3 = 38 `general` (as
antigas por perfil desativadas); Parte 4 = 13+10 (inalterado). Gerado de
`scripts/pilot-content-part234.mjs`. Ver `docs/project-status.md` (2026-09-03).

**`pilot_prompts`** — uma tabela larga (mesma convenção de `phase2_prompts`: colunas
nullable reaproveitadas por parte, documentadas aqui em vez de normalizadas em tabelas
separadas):

| Campo | Tipo | Observações |
|---|---|---|
| id | uuid | |
| part | enum | `part1`..`part4` (mesmo enum `public.part` do controlador) |
| aircraft_type | enum, nullable | mesmo enum `operational_profile` — `fixed_wing`, `rotary_wing`, ou `general` (só a Parte 1, perguntas de carreira agnósticas ao tipo de aeronave, usa `general`) |
| prompt_text | text | Parte1: a pergunta. Parte2: frase de contexto do examinador antes do 1º áudio. Parte3: transcrição do diálogo piloto/controlador narrado. Parte4: enunciado da tarefa da foto |
| atc_audio_text | text, nullable | Parte2: instrução do controlador (1º áudio) que o candidato transforma em readback |
| atc_audio_url | text, nullable | Parte2: mp3 do 1º áudio do controlador, bucket público `pilot-prompt-audio` (`<prompt_id>/atc.mp3`). `null` → runner cai no TTS em runtime. **[2026-09-03]** gravações reais da Sabrina (efeito de rádio VHF por `scripts/radioize-part2-audio.mjs`), subidas por `scripts/upload-pilot-part2-audio.mjs` casando por `order_index`; gerador sintético `generate-pilot-prompt-audio.mjs` removido |
| expected_readback | text, nullable | Parte2: referência de readback esperado — só contexto pra IA, nunca mostrado ao candidato |
| complication_text | text, nullable | Parte2: narração do examinador sobre o imprevisto que motiva a reação do candidato |
| complication_image_url | text, nullable | Parte2: foto do imprevisto (situações `order_index` 31+ = slots 4-5 da prova). **[2026-09-03]** 13 `fixed_wing` + 14 `rotary_wing` no bucket `pilot-images/<slug>/part2/<order_index>.jpg`, subidas por `scripts/upload-pilot-part2-images.mjs` (mapa nome→situação nas abas `*_IMAGE` de `Part 2/questions-map.xlsx`) |
| expected_reaction | text, nullable | Parte2: referência da reação esperada — só pra IA |
| atc_followup_audio_text | text, nullable | Parte2: resposta do controlador (2º áudio), geralmente pedindo confirmação/negação de um detalhe |
| atc_followup_audio_url | text, nullable | Parte2: mp3 do 2º áudio do controlador (`<prompt_id>/followup.mp3`, mesma origem/fluxo de `atc_audio_url`) |
| expected_confirmation | text, nullable | Parte2: referência da confirmação esperada — só pra IA |
| dialogue_audio_url | text, nullable | Parte3: mp3 do diálogo piloto/controlador (`prompt_text` com rótulos `Pilot:`/`ATC:`). O runner toca **duas vezes** (fidelidade ao exame real). `null` → TTS em runtime. **[2026-09-03]** gravação real subida manualmente pela Sabrina (fonte em `Material Didático/.../Part 3/Audios/`); gerador sintético removido |
| discussion_question | text, nullable | Parte3: pergunta técnica/de opinião feita após o relato da situação. **[2026-08-28] Parte4: não usada** — os itens 4 e 5 da Parte 4 passaram a ser fixos no runner (`PART4_DISCUSSION_1/2` em `pilot-interview-runner.tsx`), conforme o "Modelo SDEA com anotações" |
| discussion_question_2 | text, nullable | Parte3: não usada. **[2026-08-28] Parte4: não usada** (ver acima) |
| comparison_question | text, nullable | **[2026-09-03]** Parte3: enunciado da comparação final das 3 situações ("How would you compare them?" / "Which one is the most difficult…" / "…in terms of severity, possible solutions or ways of prevention" — uma ou duas por linha de conteúdo). Migration `20260903000000_pilot_part3_comparison_question.sql`. Null nas outras partes |
| image_url | text, nullable | Parte4: foto principal do item. **[2026-08-28]** pool de 13 fotos `fixed_wing` + 10 `rotary_wing` (`pilot-images/<perfil>/part4/NN.jpg`), IA-geradas, ver `scripts/upload-pilot-part4-images.mjs` |
| agree_disagree_statement | text, nullable | Parte4: afirmação pra o candidato concordar/discordar com justificativa — **o único item da Parte 4 específico da foto** (os demais são fixos no runner) |
| order_index | int, nullable | índice no pool da parte. **Parte2: 1-30 = situações SEM imagem de complicação, 31+ = situações COM imagem** — `getSequenceForAttempt` usa esse corte pra montar a prova (3 sem imagem nos slots 1-3, 2 com imagem nos slots 4-5, estrutura real do SDEA). Parte3: 1-N contíguo por prova de origem. Sem tiering concreto/abstrato nem ordenação por dificuldade, diferente do controlador |
| expected_duration_seconds | int | |
| is_active | boolean | |
| created_at | timestamp | |

**`pilot_responses`** — mesmas colunas de `phase2_responses` (`simulation_attempt_id`,
`prompt_id` → `pilot_prompts`, `audio_url`, `transcript`, `ai_feedback`, `ai_provider`,
`model_version`, `processing_status`, `repetition_count`, `started_at`, `finished_at`,
`created_at`), só trocando `response_stage` pelo enum `pilot_response_stage` (ver abaixo).

**Composição por tentativa** (`PART_SIZES` em `src/services/simulations/pilot/state-machine.ts`,
diferente do controlador):
- Parte 1: 3 perguntas sorteadas do pool `part1` (`general`, compartilhado entre perfis)
- Parte 2: 5 situações sorteadas do pool `part2` do `aircraft_type` do usuário — cada uma
  com **4 sub-turnos**: readback de uma instrução do controlador, reação a um imprevisto
  narrado (às vezes com foto), confirmação/negação de um detalhe, e um relato em discurso
  indireto do que o controlador acabou de dizer
- Parte 3: 3 situações sorteadas do pool `part3` do `aircraft_type` — por item, o candidato
  ouve um diálogo piloto/controlador narrado e (a) reconta em discurso indireto, (b)
  responde 1 pergunta técnica; a última situação ganha um turno extra de comparação entre
  as 3
- Parte 4: 1 foto sorteada do pool `part4` do `aircraft_type` — descrição, hipótese de
  antes/depois, 2 perguntas de discussão, 1 afirmação pra concordar/discordar

**Conteúdo inicial (2026-08-24):** carregado via `scripts/seed-pilot-prompts.mjs` a partir
das 5 provas reais levantadas — 5 situações de Parte 2
+ 3 de Parte 3 + 1 foto de Parte 4 pra `fixed_wing`, e 20 situações de Parte 2 + 12 de Parte
3 pra `rotary_wing`. A Parte 1 herdou 15 perguntas dessas provas; **[2026-08-27]**
substituídas por um pool próprio de **30 perguntas abertas** escrito pela Sabrina (pool
`general`), ver `docs/project-status.md`. **Parte 4 de `rotary_wing` ficou sem conteúdo nesta rodada** — as
únicas fotos de helicóptero disponíveis tinham marca d'água de banco de imagens ou eram
fotos profissionais sem licença clara (achado real durante a sessão); só as 3 fotos vindas
do documento oficial da ANAC (Modelo SDEA) foram usadas. Um piloto `rotary_wing` hoje recebe
a mensagem "conteúdo insuficiente" (mesmo tratamento gracioso já usado pro controlador
sem perfil/pool). Ampliar o pool pra "dezenas por parte" e conseguir fotos de helicóptero
licenciadas ficou como próximo passo, fora do escopo desta rodada.

**Correção:** os documentos oficiais do SDEA são explícitos — a produção oral não é julgada
pela precisão técnica ou operacional (fraseologia incluída), só pela Escala OACI de 6
critérios. Por isso os prompts de IA da trilha do piloto (`src/lib/ai/pilot-track.ts`) nunca
avaliam fraseologia, mesmo na Parte 2 (readback/reação/confirmação) — mesma disciplina
"o que este estágio especificamente avalia" já usada nos prompts do controlador, e a mesma
regra inegociável de nota final = menor dos 6 critérios (nunca média).

---

## Enums de referência

```
role: admin | pilot | air_traffic_controller
operational_profile: TWR | APP | ACC | COpM | fixed_wing | rotary_wing | general
phase: phase1 | phase2 | pilot_interview
mode: practice | official
attempt_status: in_progress | completed | abandoned
part: part1 | part2 | part3 | part4
response_stage: main | situation_intro | situation_check | suggestion
               | image_observation | image_description | story_preparation | story_telling
pilot_response_stage: main | readback | reaction | confirmation | report_back
               | report | question | comparison
               | picture_description | narrative | discussion_1 | discussion_2 | agree_disagree
processing_status: queued | transcribing | analyzing | done | error
proficiency_level: weak | moderate | good | excellent
               (Fraco N1-N3 | Moderado N4 | Ótimo N5 | Excelente N6) — evolução futura: escala numérica OACI 1–6
```
