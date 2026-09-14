# Conclusão do plano de correção (M5–M7)

## Matriz de rastreabilidade

| Requisito | UI | Servidor | Banco | Teste |
|---|---|---|---|---|
| Relógio oficial | início automático e hard-stop pelo limite do item | eventos autenticados; duração decodificada comparada ao relógio com 3 s de tolerância | `official_response_windows` persiste pergunta, gravação e envio | `official-timing.test.ts` e suítes das rotas |
| Repetição | consequência exibida antes do clique | contador oficial vem do evento autenticado, não do formulário | `repetition_count` na janela oficial | testes de relatório e rotas |
| Reload/relógio adulterado | gravação iniciada não reinicia silenciosamente | segundo `recording_started` recebe 409; relógio é do servidor | unicidade por tentativa, prompt e slot | validação de timing |
| Pergunta comparativa SDEA | conteúdo do item sorteado, com fallback legado | seleção inclui `comparison_question` | migration `20260903000000` | `queries.test.ts` + typecheck |
| Evidência acústica | pronúncia/fluência aparecem como indisponíveis | transcrição não gera pseudo-nota acústica; overall usa 4 critérios textuais | colunas ficam `null` em novos relatórios | `final-report.test.ts` e suítes de IA |
| Processamento e recuperação | upload/transcrição/avaliação distintos, expectativa de 20–60 s, timeout e retry sem regravar, código de suporte | reserva idempotente mantém o mesmo slot/objeto | caminho determinístico da resposta e status de processamento | suítes dos runners e das rotas |
| Legendas | preferência restaurada no dispositivo | não aplicável | `localStorage` (sem dado pessoal) | suítes dos runners |
| Estado REC | somente gravação/pausa mostra REC; demais estados mostram espera | não aplicável | não aplicável | suíte de componentes/runners |

## Comportamento oficial em interrupções

- Reload ou background depois do início da gravação não cria uma nova janela nem reinicia a resposta.
- O relógio do navegador não é aceito como fonte de verdade; início e fim são timestamps do servidor.
- O cliente encerra no limite do item e o servidor rejeita duração real ou janela acima do limite mais a tolerância.
- Em falha de rede após a gravação, os chunks permanecem na sessão da página e o botão de retry reenvia o mesmo áudio para o mesmo slot idempotente.
- Após reload, se a gravação oficial já começou e o blob local se perdeu, a plataforma bloqueia reinício silencioso e orienta pelo erro com código de suporte.
