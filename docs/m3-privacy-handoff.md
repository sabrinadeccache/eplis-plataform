# M3 — retomada para Claude / revisão Codex (2026-09-12)

Base: `8c63842`, branch `privacy/private-recordings-consent`. Sabrina autorizou
implementar as correções e documentá-las. Alterações locais nesta branch; **sem
commit/push, merge, migration aplicada, segredo alterado ou operação em produção**.
Não tratar este documento como autorização para deploy.

## O que mudou e por quê

1. A rechecagem `assertAccountStillActive` era TOCTOU: depois dela ainda havia
   upload, Whisper, Claude e escritas administrativas. Agora a migration
   `20260912070000_privacy_barrier.sql` serializa início de upload e pedido de
   exclusão pelo mesmo lock de usuário. `privacy_deletion_requests` é a barreira
   durável; bloquear/desbloquear `users.status` não a remove.
2. `privacy_uploads` registra o I/O externo antes de iniciá-lo. A exclusão só
   prossegue quando não há tickets. Durante upload, retorna pendência, mantém a
   conta bloqueada e **não limpa conteúdo nem apaga Auth**. Depois de confirmação
   do Storage o ticket é removido; repetir a exclusão então permite concluir.
3. Os triggers das duas tabelas de resposta e de `simulation_feedbacks` recusam
   conteúdo após a barreira, **inclusive service_role**. Escritas para NULL são
   permitidas. O lock fica na transação da escrita, não num SELECT separado da
   aplicação. Assim, IA iniciada antes da exclusão pode acabar depois, mas não
   repovoa transcrição/feedback/relatório — nem após `user_id` tornar-se NULL.
   A criação de tentativa também é bloqueada pela barreira. Rotas verificam os
   erros das escritas; inserção do relatório final não ignora mais erro.
4. `retention-core.mjs` é a implementação única: cron, `retention.ts` (reexport
   tipado) e os dois scripts Node usam o mesmo código. Não duplicar a lógica nos
   scripts. `.d.mts` descreve o contrato TypeScript; não há dependência de `tsx`.
5. Varredura com cursor por ID, em lotes de até 500, e `recording_purged_at`
   persistido **só depois** de remover o Storage. Segunda execução não reprocessa
   os primeiros 500. Órfãos incluem `error`, `transcribing` e `analyzing`; usa
   `started_at` (último retry), com fallback para `created_at` legado. Sem caminho
   e sem dono não inventa prefixo `anon`: retorna erro para reconciliação.
6. `claim_recording_cleanup` revalida prazo/estado sob lock da resposta;
   `claim_recording_cleanup_batch` faz uma ida ao PostgREST por página. Se o
   retry ganhou, a seleção antiga não autoriza apagar áudio novo. Se a limpeza
   ganhou, `recording_cleanup_pending=true` fecha **permanentemente o upload
   daquele slot vencido**. Não reabrir esse flag ao fim: isso recriaria a corrida
   com cron simultâneo/repetido. Crash após claim é retomável porque apagar o
   mesmo caminho continua seguro. Sem alteração do prazo 30/180 dias.
7. Paginação de feedbacks também no núcleo compartilhado; Storage em blocos de
   até 500 caminhos, UPDATE em até 100 IDs. Cron devolve 503 em falha parcial ou
   limite de lotes, scripts terminam com exit 1. Não declarar limpeza concluída
   apenas por HTTP 200 da API Storage para objetos inexistentes.
8. `audio_path` persistido só é removido se estiver no namespace real da
   tentativa (legado `{attemptId}/arquivo` ou atual
   `{userId}/{attemptId}/arquivo`). Isso evita que um ponteiro legado
   envenenado apague gravação de outra tentativa; inconsistência falha fechado.

## Falhas de upload: pendência explícita, não liberação por timeout

**Um timeout local não prova que o Storage parou de escrever.** Em throw/timeout,
crash, falha da remoção compensatória ou falha para liberar o ticket, a reserva
permanece. Um erro HTTP concluído tenta remover o path determinístico e libera o
ticket somente se essa compensação for confirmada. Novo upload para a mesma resposta, expiração dessa gravação e exclusão
da conta ficam bloqueados/falham fechado. Outros registros continuam sendo
varridos. Não há expiração automática de tickets; isso é intencional para não
trocar a corrida por outra baseada em relógio.

Procedimento operacional necessário para um ticket preso:

1. Identificar o ticket exato em `privacy_uploads` (`id`, usuário, resposta,
   trilha, início), usando acesso administrativo, sem registrar conteúdo/segredos.
2. Bloquear novos envios do titular pelo fluxo `request_privacy_deletion` caso o
   destino seja exclusão. Se for recuperação de retry, bloquear a conta durante
   a investigação. Confirmar pelos logs/plataforma que a invocação original
   terminou **e que a operação remota do Storage não está mais em voo**. Idade
   do ticket sozinha não é prova; na dúvida manter pendente e escalar ao operador.
3. Reconciliar o objeto determinístico e eventual caminho legado. Só depois da
   confirmação, liberar **aquele UUID** via `finish_privacy_upload`. Nunca limpar
   todos os tickets em lote nem liberar apenas para fazer o script passar.
4. Repetir dry-run e aplicação da operação necessária. Em exclusão, a barreira
   permanece até o Auth ser removido; limpar o ticket não reativa a conta.

Isso pode exigir intervenção após falha de infraestrutura. Não prometer que
exclusão/expiração de um upload de resultado incerto será automática sem essa
reconciliação. O sistema sinaliza a pendência, não finge sucesso ou perde o alvo.

## Ordem de implantação (ainda não executada)

1. Revisar o diff e homologar em ambiente isolado. Não copiar segredos de produção
   para Preview. Preview sem infraestrutura própria continua pendente.
2. Aplicar as migrations M3 `20260912000000` a `20260912040000`, depois
   `20260912060000` e **`20260912070000`**, antes deste código. A 070000 pressupõe
   `audio_path` e `expires_at`; as RPCs são obrigatórias, não têm fallback inseguro.
   **Pular 20260912050000 neste passo.** Não executar `db push` indiscriminado:
   ele aplicaria 050000 na ordem errada para o código ainda em produção.
3. Deploy do código desta branch, após aprovação. Confirmar que usa
   `admin.storage` + `withPrivacyUpload` nas duas trilhas.
4. Aplicar `20260912050000` (revoga acesso direto aos buckets) **depois do código**.
   Não iniciar exclusões/cron enquanto deployments antigos ainda puderem receber
   tráfego ou terminar uploads: eles não registravam tickets. Drenar/retirar
   todos os writers antigos e impedir acesso aos deployments legados.
5. Configurar `CRON_SECRET` em Production e verificar o cron sem cookie (segredo
   correto, errado e ausente); só então considerar a retenção agendada ativa.
6. Homologar com usuário descartável e arquivos WebM/MP4 reais: assinatura legada
   e nova, posse/admin/auditoria, replay/retry, expiração, exclusão durante upload
   e durante Whisper/Claude, relatório final tardio e recuperação de falha.

Rollback: não remover 070000 mantendo este código (RPC obrigatória); não reabrir
buckets públicos. Preferir correção para frente. Se precisar reverter código,
suspender envios/cron/exclusões e drenar workers antes; preservar tickets e
barreiras para reconciliação. Retomar código antigo sem esse protocolo invalidaria
a garantia de exclusão. Nenhuma migration reversa destrutiva foi executada.

## Verificações locais e limites de evidência

- `npm test`: 274 testes passando, incluindo 23 testes da migration no PostgreSQL
  embarcado (PGlite), sem Supabase/rede; testes de I/O pausado e de 1.203 órfãos /
  1.203 relatórios, duas trilhas, segunda execução, path legado envenenado,
  falhas e permissões das RPCs.
- `tsc --noEmit --incremental false` e `npm run lint` passaram, sem erros/warnings.
- `npm run build` passou em cópia isolada, com valores fictícios de ambiente,
  sem `.env.local`. Permanece o aviso conhecido de tracing amplo do ffmpeg.
  Manifestos das duas rotas: ffmpeg presente, PGlite/testes e `.env.local`
  fora do bundle (o pacote do ffmpeg contém seu próprio arquivo `.env`).
  Isso não substitui homologação do binário Linux na Vercel.
- PGlite exercita SQL/constraints/triggers reais, mas usa uma conexão; não é
  homologação multi-conexão do Supabase, do Storage remoto ou da Vercel.
- PGlite é somente devDependency. Não importar o teste/módulo em código runtime.
- A instalação disparou `npm audit`: 6 alertas (5 high, 1 critical) em dependências
  já existentes. Com `--omit=dev`, permanecem 4 de runtime (3 high, 1 critical):
  `next` direto e `fast-uri`/`postcss`/`sharp` transitivos. O audit propõe Next
  16.3.5 sem salto semântico. Não rodei `audit fix` nem misturei upgrade do
  framework nesta correção de concorrência. Tratar em mudança separada antes de
  liberar deploy; alerta não prova por si só explorabilidade desta aplicação.

## Próximo passo para Claude

Revisar alterações locais (não resetar a branch nem sobrescrevê-las), confirmar os
cenários acima e concluir homologação isolada. Não afirmar que a M3 está em
produção. Não mergear/aplicar migrations sem aprovação da Sabrina.
