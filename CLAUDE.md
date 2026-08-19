# EPLIS Trainer

Plataforma de treinamento para o EPLIS (Exame de Proficiência em Inglês Aeronáutico do
SISCEAB). Ver `docs/project-status.md` primeiro em qualquer nova sessão — tem o status
atual, o que já foi feito, o que falta, e as decisões de design já fechadas.

## Leitura obrigatória antes de mexer em modelagem ou regras de negócio

- `docs/project-status.md` — ponto de retomada, infraestrutura provisionada, roadmap.
- `docs/database-schema.md` — modelo de dados completo (schema já aplicado no Supabase).
- `docs/state-machine.md` — fluxo de estados da entrevista (Fase 2).
- `docs/srs-updates.md` — changelog de requisitos vs. o SRS original.

## Stack

Next.js (App Router) + TypeScript, Tailwind, Supabase (Postgres + Auth + Storage),
OpenAI (transcrição), Anthropic Claude (engine de entrevista/correção), Sentry
(observabilidade — código real, desligado até `SENTRY_DSN` ser configurado, ver
`docs/project-status.md`), Vercel (deploy em produção: https://eplis-trainer.vercel.app,
deploy automático a cada push em `main`).

## Rodando localmente

`npm run dev` sobe tudo em `http://localhost:3000` — é um monólito, sem backend
separado. Ver `docs/project-status.md` → "Como testar localmente" para a pegadinha da
confirmação de e-mail no cadastro.

## Convenções

- Não reabrir decisões já registradas em `docs/project-status.md` sem motivo novo —
  várias vieram de especificações oficiais do EPLIS, não são arbitrárias.
- Migrations ficam em `supabase/migrations/`, aplicadas via `scripts/apply-migration.mjs`
  usando `SUPABASE_DB_URL` (`.env.local`) enquanto não há Supabase CLI/MCP autorizado
  nesta máquina. **`SUPABASE_DB_URL` aponta pro Session pooler** (host
  `aws-0-<região>.pooler.supabase.com`, usuário `postgres.<projeto>`), não pro host de
  conexão direta (`db.<projeto>.supabase.co`) — esse último é IPv6-only no Supabase e
  falha com `ENOTFOUND` em rede sem IPv6 (achado real, ver `docs/project-status.md`).
- **Toda migration que cria uma tabela nova precisa de `GRANT` explícito pro role
  `authenticated`** (`grant select/insert/update on public.<tabela> to authenticated;`),
  além das RLS policies — RLS só é avaliado depois que o GRANT de tabela já passou.
  A migration inicial esqueceu isso e toda query autenticada falhava silenciosamente
  ("permission denied for table X") até ser corrigido na Fase 4 — ver
  `docs/project-status.md`.
- Proteção de rotas fica em `src/proxy.ts` — **não** `middleware.ts`. Next.js 16 renomeou
  a convenção (`middleware` → `proxy`), e como o app mora em `src/app/`, o arquivo
  precisa ficar em `src/proxy.ts`; na raiz do repo ele simplesmente não executa, sem
  erro nenhum.
- **Scripts de seed (`scripts/seed-*.mjs`) precisam ser UPSERT, não delete-and-reinsert**
  — assim que existe uma linha de dado real do usuário com FK pra tabela de conteúdo
  (ex.: `phase2_responses.prompt_id` → `phase2_prompts.id`), um `DELETE` na tabela toda
  passa a falhar com "violates foreign key constraint". Aconteceu de verdade com
  `scripts/seed-phase2-prompts.mjs` assim que passou a haver tentativas de teste — ver
  `docs/project-status.md`. Casar por uma chave natural estável (texto do prompt,
  `order_index`, `image_url` etc.) e desativar (`is_active = false`) o que sair da lista
  em vez de apagar.
- `.env.local` nunca vai para o git. Segredos novos (chaves de IA, etc.) entram lá, não
  em nenhum arquivo versionado.
- **Deploy é automático via GitHub**: push em `main` já dispara build+deploy na Vercel
  (projeto `orion-flight-lab/eplis-trainer`) — não precisa rodar `vercel deploy`
  manualmente depois de um push normal. Só use `npx vercel deploy --prod` se precisar
  forçar um redeploy sem novo commit. Variáveis de ambiente de produção são gerenciadas
  com `npx vercel env add <NOME> production` (não edite pelo dashboard sem atualizar
  também `docs/project-status.md`) — ver lista completa das 7 vars usadas em runtime em
  `docs/project-status.md` → "Infraestrutura já provisionada".
- **Payload grande (ex.: áudio gravado no browser) nunca deve ir como argumento de
  Server Action** — mesmo aumentando `experimental.serverActions.bodySizeLimit` no
  `next.config.ts`, existe um limite separado e mais baixo no protocolo Flight que as
  Server Actions usam pra decodificar argumentos ("Maximum array nesting exceeded"),
  reproduzido de verdade ao enviar uma gravação mais longa da Fase 2 (Parte 4, história
  sem limite de tempo no modo practice) como string base64. Upload de binário grande
  precisa ir por uma route handler comum (`src/app/api/...`) recebendo
  `multipart/form-data`, não por Server Action — ver
  `src/app/api/phase2/submit-response/route.ts` e `docs/project-status.md`.
- **Server Action que só faz `update`/`insert` e não chama `revalidatePath`/`updateTag`/
  `refresh`/`redirect` (nem mexe em cookies) não re-renderiza a rota atual** — no Next.js
  16 isso não acontece de graça mais (ver
  `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`, seção "A single
  response carries data and UI"). O componente Server que passou os dados pra tela
  continua com os dados de antes da mutação, e o cache de rota do cliente também não é
  invalidado — dá a impressão de "a alteração não salvou" mesmo o `update` no Supabase
  tendo funcionado (reproduzido de verdade em `updateProfile`, `src/lib/auth/actions.ts`:
  nome/profissão/perfil operacional voltavam pro valor antigo em `/perfil` ao navegar pra
  fora e voltar). Toda Server Action que atualiza dado exibido na própria tela precisa de
  `revalidatePath(<rota>)` explícito no fim.
- Só se lembre desta pegadinha depois de já ter mexido em `phase1_questions`/
  `phase1_audios`: a RLS de `phase1_questions` só libera `select` de linhas com
  `is_active = true` — se uma pergunta referenciada por uma `phase1_answers` real for
  desativada depois da tentativa, qualquer join a partir de `phase1_answers` pra
  `phase1_questions` (ex.: página de resultado da Fase 1) retorna `null` naquela linha em
  vez de barrar a query inteira; sem tratar esse `null` no código que renderiza, quebra
  ("Error in Server Components render"). `src/app/fase1/resultado/[attemptId]/page.tsx`
  já trata isso.

@AGENTS.md
