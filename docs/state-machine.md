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
