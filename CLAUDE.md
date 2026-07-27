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

## Convenções

- Não reabrir decisões já registradas em `docs/project-status.md` sem motivo novo —
  várias vieram de especificações oficiais do EPLIS, não são arbitrárias.
- Migrations ficam em `supabase/migrations/`, aplicadas via conexão Postgres direta
  (`SUPABASE_DB_URL` em `.env.local`) enquanto não há Supabase CLI/MCP autorizado nesta
  máquina.
- `.env.local` nunca vai para o git. Segredos novos (chaves de IA, etc.) entram lá, não
  em nenhum arquivo versionado.

@AGENTS.md
