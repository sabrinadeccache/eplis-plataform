# EPLIS Trainer — State Machine da Fase 2 (atualizada)

> Atualiza o documento STATE MACHINE original com o timeout de início de resposta e a
> regra de repetição diferenciada por parte, confirmados pelo Manual do Examinando.

## Fluxo geral

```
INTERVIEW_IDLE
 ↓
PART_1_INTRO
 ↓
PART_1_QUESTION x4
 ↓
PART_2_INTRO
 ↓
PART_2_SCENARIO x10
   ├─ situation_check (a IA descreve a situação e termina obrigatoriamente com
   │  "What's the situation?" — resposta do candidato já habilitada nesse turno)
   └─ suggestion
 ↓
PART_3_INTRO
 ↓
PART_3_QUESTION x4
 ↓
PART_4_INTRO
 ↓
image_observation → image_description → story_preparation → story_telling
 ↓
INTERVIEW_FINISHED
```

A cada transição de estado, `simulation_attempts.current_state`, `.current_part` e
`.current_item_index` são persistidos — isso é o que permite retomar uma tentativa
`official` interrompida sem reconstruir a posição a partir de `phase2_responses`.

## Regras por tipo de estágio

**intro/interlude** (sem interação do usuário, ambos os modos):
```
IA fala → 3s → avança automaticamente
```

**silent timed stage** (ex: observação de imagem, preparação de história):
```
IA fala → timer automático (15s / 30s) → avança
```

**response stage — practice:**
```
IA fala → aluno clica Speak → Restart → Stop → Next
```

**response stage — official [ALTERADO 2026-08-11]:**
```
IA fala → pausa de 5s (sem botão "Falar") → gravação inicia automaticamente
        → candidato conclui manualmente (Pausar/Continuar, Concluir e enviar — sem "Recomeçar")
```

Redesenhado a pedido da Sabrina pra ser mais fiel ao exame real: não existe botão "Falar" no
modo `official` — depois que a IA termina de falar, um cronômetro visível de 5s conta
regressivamente e a gravação começa sozinha ao chegar a zero, sem exigir clique do candidato.
Sem segunda chance: o botão "Recomeçar" (que reinicia a gravação do zero) só existe no modo
`practice`; no `official`, uma vez iniciada a gravação, só dá pra pausar/continuar ou concluir e
enviar. Timer de duração automática da resposta (cortar e enviar sozinho após 60s/90s) **ainda
não implementado** — decisão de escopo, ver `docs/project-status.md`.

## Regra de repetição/esclarecimento por parte [ALTERADO]

| Parte | Repetição da pergunta | Esclarecimento de vocabulário |
|---|---|---|
| 1, 3 | 1x por item | 1x por item; se usado, libera +1 repetição após a explicação |
| 2 | 1x por item | **não permitido** — a compreensão do vocabulário/estrutura é o que está sendo avaliado nesse item |
| 4 | 1x por item | 1x por item (mesma regra de 1/3) |

Cada pedido incrementa `phase2_responses.repetition_count`. O uso excessivo dessas
estratégias não bloqueia o candidato tecnicamente, mas é um sinal a considerar pela IA
na avaliação do critério "Interações" — candidatos em NP5/NP6 não deveriam precisar
delas com frequência.

**Exceção — descrição da situação na Parte 2:** o candidato pode responder ao turno
`situation_check` repetindo ou parafraseando de perto a própria descrição feita pela IA
(permitido no exame real). Isso é diferente de "esclarecimento de vocabulário" (não
permitido nessa parte) e não deve ser penalizado em nenhum critério — instrução
explícita nos prompts de avaliação em `src/lib/ai/anthropic.ts`.

## Feedback

Sem alteração em relação ao documento original:
- **Practice**: feedback curto/oral por resposta, sem card técnico; relatório
  consolidado com critérios ICAO ao final.
- **Official**: zero feedback durante a entrevista; relatório completo (pontos fortes,
  pontos fracos, exemplos de melhoria, estimativa por critério) só ao final.

**Regra de nota final:** o nível reportado é sempre o menor entre os 6 critérios —
nunca uma média (segue a mesma lógica de segurança operacional do exame real).

---

# State Machine da trilha do piloto (SDEA) **[NOVO, 2026-08-24]**

Fluxo próprio, dedicado (decisão fechada com a Sabrina — não forçado na state machine da
Fase 2 acima), implementado em `src/services/simulations/pilot/state-machine.ts` +
`src/components/sdea/pilot-interview-runner.tsx`. `PART_SIZES` são diferentes do
controlador (3/5/3/1, não 4/10/4/1), levantados a partir de 5 provas reais do SDEA (1
prova-modelo oficial de avião + 4 provas reais de helicóptero).

```
PILOT_PART_1_INTRO
 ↓
PILOT_PART_1_QUESTION x3
 ↓
PILOT_PART_2_INTRO
 ↓
PILOT_PART_2_SITUATION x5
   ├─ readback        (áudio de rádio pré-gerado do controlador → readback)
   ├─ reaction         (reage a um imprevisto narrado pelo examinador, às vezes com foto)
   ├─ confirmation      (2º áudio de rádio do controlador → confirma/nega um detalhe)
   └─ report_back        (discurso indireto: "tell me everything the controller said")
 ↓
PILOT_PART_3_INTRO
 ↓
PILOT_PART_3_SITUATION x3
   ├─ (áudio de rádio pré-gerado do diálogo piloto/controlador — toca 2x, fiel ao exame)
   ├─ report            (discurso indireto do diálogo inteiro)
   ├─ question           (pergunta técnica/de opinião sobre o tema)
   └─ comparison           (só no 3º item: compara as 3 situações — severidade/solução/prevenção)
 ↓
PILOT_PART_4_INTRO
 ↓
picture_description → narrative(antes, 1 de 4 variações) → narrative(depois)
   → discussion_1 → discussion_2 → agree_disagree
 ↓
INTERVIEW_FINISHED
```

Só `current_part`/`current_item_index` são persistidos (mesmo padrão do controlador) — os
sub-estágios dentro de um item vivem só no estado local do client component; um reload no
meio de um item reinicia os sub-estágios, mas não perde a posição de item.

**Diferenças reais em relação à Parte 2/3 do controlador**, confirmadas nos documentos
oficiais do SDEA:
- A Parte 2 é um **role-play bidirecional de fraseologia** (o candidato interpreta o
  piloto de uma aeronave fixa, call sign `LEVEL 6`), não uma "situação pra comentar" —
  por isso 4 sub-turnos por item em vez de 2.
- A Parte 3 termina com um turno de **comparação entre as 3 situações**, que não existe
  na Parte 3 do controlador.
- Sem tiering concreto/abstrato nem ordenação por dificuldade nas Partes 2/3 (diferente do
  controlador) — os documentos reais do SDEA não pedem isso.
- **[2026-08-28]** Áudios de rádio da Parte 2/3 são **pré-gerados** (TTS + efeito VHF,
  bucket `pilot-prompt-audio`), não TTS em runtime — só a narração do examinador é
  runtime. A gravação da Parte 3 toca **2x**. Na Parte 4, só a afirmação (`agree_disagree`)
  é específica da foto; itens 1–5 são fixos no runner (`PART4_*` em
  `pilot-interview-runner.tsx`), incluindo o sorteio 1-de-4 da pergunta de "antes".

**Correção — mesma regra do controlador, com uma ressalva própria do exame:** nota final
sempre o menor dos 6 critérios OACI, nunca média. A ressalva: os documentos oficiais do
SDEA são explícitos que a produção oral **não é julgada pela precisão técnica ou
operacional** — isso inclui fraseologia de radiotelefonia. Mesmo na Parte 2 (readback
inclusive), a IA avalia só proficiência linguística (estrutura, clareza, fluência,
compreensão), nunca se a fraseologia usada foi tecnicamente correta — ver
`src/lib/ai/pilot-track.ts`.

`official` vs. `practice` seguem exatamente as mesmas regras já descritas acima pro
controlador (auto-gravação em 5s / 1 repetição / sem "Recomeçar" / zero feedback ao vivo no
`official`; botão "Falar" manual / repetição ilimitada / feedback falado por resposta /
"Pausar simulado" no `practice`) — comportamento comprovado, só reaproveitado.
