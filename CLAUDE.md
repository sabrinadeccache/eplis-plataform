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
OpenAI (transcrição), Anthropic Claude (engine de entrevista/correção), Vercel (deploy,
ainda não configurado).

## Rodando localmente

`npm run dev` sobe tudo em `http://localhost:3000` — é um monólito, sem backend
separado. Ver `docs/project-status.md` → "Como testar localmente" para a pegadinha da
confirmação de e-mail no cadastro.

## Convenções

- Não reabrir decisões já registradas em `docs/project-status.md` sem motivo novo —
  várias vieram de especificações oficiais do EPLIS, não são arbitrárias.
- Migrations ficam em `supabase/migrations/`, aplicadas via conexão Postgres direta
  (`SUPABASE_DB_URL` em `.env.local`) enquanto não há Supabase CLI/MCP autorizado nesta
  máquina.
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
- **Payload grande (ex.: áudio gravado no browser) nunca deve ir como argumento de
  Server Action** — mesmo aumentando `experimental.serverActions.bodySizeLimit` no
  `next.config.ts`, existe um limite separado e mais baixo no protocolo Flight que as
  Server Actions usam pra decodificar argumentos ("Maximum array nesting exceeded"),
  reproduzido de verdade ao enviar uma gravação mais longa da Fase 2 (Parte 4, história
  sem limite de tempo no modo practice) como string base64. Upload de binário grande
  precisa ir por uma route handler comum (`src/app/api/...`) recebendo
  `multipart/form-data`, não por Server Action — ver
  `src/app/api/phase2/submit-response/route.ts` e `docs/project-status.md`.

@AGENTS.md
