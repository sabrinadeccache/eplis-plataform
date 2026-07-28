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
- `.env.local` nunca vai para o git. Segredos novos (chaves de IA, etc.) entram lá, não
  em nenhum arquivo versionado.

@AGENTS.md
