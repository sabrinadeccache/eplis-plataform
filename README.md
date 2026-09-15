# EPLIS Trainer

Plataforma privada de treinamento para o EPLIS e o SDEA, construída em Next.js 16,
TypeScript, Supabase, OpenAI e Anthropic. O produto oferece modos Practice e Official,
retomada segura, histórico de desempenho e tratamento privado das gravações.

Não há vínculo oficial com DECEA, ICEA ou ANAC. O conteúdo é próprio e baseado nas
especificações públicas dos exames.

## Desenvolvimento

Requisitos: Node.js 20+, npm e as variáveis descritas em `.env.example`.

```bash
npm install
npm run dev
```

Antes de publicar uma mudança:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
npm audit --omit=dev
```

## Segurança e avaliação

- Gravações ficam em buckets privados, com retenção de 30 dias no Practice e 180 dias
  no Official; o cron de expiração exige `CRON_SECRET`.
- No modo Official, início, fim e repetição são validados pelo relógio do servidor; não
  há pausa durante a resposta.
- A avaliação atual usa somente transcrições. Pronúncia e fluência ficam explicitamente
  indisponíveis até existir um avaliador acústico validado; nenhuma nota é inventada.
- Relatórios registram versões do modelo, da régua, do prompt e do pipeline.

## Documentação

- `docs/project-status.md` — estado atual, implantação e pendências.
- `docs/database-schema.md` — modelo de dados e migrations.
- `docs/state-machine.md` — fluxos EPLIS e SDEA.
- `docs/srs-updates.md` — alterações de requisitos.
- `docs/m3-privacy-handoff.md` — ordem obrigatória da implantação de privacidade.
- `docs/correction-plan-completion.md` — rastreabilidade das M5–M7.

Produção: https://eplis-trainer.vercel.app. O deploy é automático a partir de `main`.
