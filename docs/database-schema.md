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
     └─ simulation_feedbacks
```

---

## 1. `users`

| Campo | Tipo | Observações |
|---|---|---|
| id | uuid | vindo do Supabase Auth |
| name | text | |
| email | text | único |
| role | enum | `admin`, `pilot`, `air_traffic_controller` |
| status | enum | `active`, `inactive`, `blocked` |
| target_exam | text | ex: `EPLIS`, `ICAO_PILOT` — permite o mesmo usuário treinar para provas diferentes |
| operational_profile | enum, nullable | **[NOVO]** `TWR`, `APP`, `ACC`, `AFIS`, `FIS`, `COpM`, `ab_initio` — confirmado pelo Manual do Examinando (item 1.2.2) como o critério real de versionamento da Fase 2. Nullable porque `admin` não precisa. |
| created_at | timestamp | |

Senha **não** é armazenada aqui — delegada ao Supabase Auth.

---

## 2. `simulation_attempts`

| Campo | Tipo | Observações |
|---|---|---|
| id | uuid | |
| user_id | uuid → users | |
| phase | enum | `phase1`, `phase2` |
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
| operational_profile | enum, nullable | **[NOVO]** mesmo enum de `users.operational_profile`, mais `ab_initio` e `general` (item sem restrição de perfil, usado em qualquer versão). Confirma o RF-49 original mas agora com o campo que faltava no SPD (Tabela 5) |
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
| ai_feedback | text, nullable | preenchido em tempo real no `practice`, só ao final no `official` |
| ai_provider | text, nullable | ex: `anthropic` |
| model_version | text, nullable | ex: `claude-sonnet-5` |
| processing_status | enum | `queued`, `transcribing`, `analyzing`, `done`, `error` — controla a UI, não implica necessariamente fila assíncrona real (ver nota de arquitetura no SPD) |
| repetition_count | int, default 0 | **[NOVO]** quantas vezes o candidato pediu repetição/esclarecimento neste item — necessário para aplicar a regra abaixo |
| started_at | timestamp, nullable | |
| finished_at | timestamp, nullable | |
| created_at | timestamp | |

**Regra de repetição (confirmada pelo Manual do Examinando, item 1.2.3 — mais restrita do que o SRS original previa):**
- Partes 1 e 3: candidato pode pedir repetição da pergunta OU esclarecimento de vocabulário, 1 vez por item; se pediu esclarecimento, pode pedir mais 1 repetição após a explicação.
- **Parte 2: só repetição da frase é aceita — esclarecimento de vocabulário NÃO é permitido nessa parte**, porque o item avalia justamente se o candidato entendeu o vocabulário/estrutura sem ajuda.
- Uso excessivo dessas estratégias não é esperado para candidatos em nível 5/6 — é sinal para a IA considerar na avaliação de "Interações", não motivo de bloqueio técnico.

**Timeout de início de resposta [NOVO — não existia no SRS anterior]:** no modo `official`, o candidato tem no máximo 20s para começar a falar após a pergunta ser apresentada; se não iniciar, o sistema avança para o próximo item automaticamente. Isso é um timer diferente do timer de duração da resposta e precisa ser controlado separadamente na state machine (ver `docs/state-machine.md`).

---

## 8. `simulation_feedbacks`

| Campo | Tipo | Observações |
|---|---|---|
| id | uuid | |
| simulation_attempt_id | uuid → simulation_attempts | |
| phase | enum | `phase1`, `phase2` |
| overall_score | text/numeric | Fase 1: percentual. Fase 2: estimativa geral |
| pronunciation_score / structure_score / vocabulary_score / fluency_score / comprehension_score / interaction_score | enum | MVP: `weak`, `moderate`, `good` — evolução futura: escala numérica OACI 1–6 |
| general_feedback | text | |
| ai_provider | text, nullable | |
| model_version | text, nullable | |
| created_at | timestamp | |

**Regra de nota final (Doc 9835 / Manual do Examinando item 5.2):** por segurança operacional, o nível final é sempre o **menor** valor obtido entre os 6 critérios — não uma média. Essa regra deve estar no prompt de correção da IA como instrução explícita, não como algo inferido.

---

## Enums de referência

```
role: admin | pilot | air_traffic_controller
operational_profile: TWR | APP | ACC | AFIS | FIS | COpM | ab_initio | general
phase: phase1 | phase2
mode: practice | official
attempt_status: in_progress | completed | abandoned
part: part1 | part2 | part3 | part4
response_stage: main | situation_intro | situation_check | suggestion
               | image_observation | image_description | story_preparation | story_telling
processing_status: queued | transcribing | analyzing | done | error
proficiency_level (futuro): NP1 | NP2 | NP3 | NP4 | NP5 | NP6
```
