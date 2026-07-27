# EPLIS Trainer — Status do Projeto

> Ponto de retomada para uma nova sessão. Ler isto primeiro, depois `docs/database-schema.md`,
> `docs/state-machine.md` e `docs/srs-updates.md` se for mexer em modelagem/regras de negócio.

## O que é o projeto

Plataforma privada de treinamento para o EPLIS (Exame de Proficiência em Inglês
Aeronáutico do SISCEAB/DECEA). Monólito modular em Next.js + TypeScript, Supabase
(Postgres + Auth + Storage), IA híbrida (OpenAI para transcrição, Anthropic Claude para
condução da entrevista simulada e correção). Sem vínculo oficial com DECEA/ICEA/ANAC —
conteúdo próprio, baseado nas especificações públicas do exame.

Responsável: Sabrina Deccache.

## Infraestrutura já provisionada

- **GitHub**: https://github.com/sabrinadeccache/eplis-plataform (branch `main`)
- **Supabase**: projeto `nkjnvmuatkibrvfsojmp` (`https://nkjnvmuatkibrvfsojmp.supabase.co`)
  — Data API ligado, auto-expose de tabelas novas desligado, RLS automático ligado.
- **Credenciais**: em `.env.local` (gitignored, não sobe pro GitHub). Inclui
  `SUPABASE_DB_URL` com a senha do Postgres, usado para aplicar migrations diretamente
  via `pg` (não temos Supabase CLI nem o MCP autorizado nesta máquina — ver seção
  "Ferramentas indisponíveis" abaixo).
- `OPENAI_API_KEY` e `ANTHROPIC_API_KEY` ainda **não** preenchidas — necessárias antes
  de começar a Fase 5 (módulo Fase 2 / IA).

## Ferramentas indisponíveis nesta máquina (checar de novo em nova sessão)

- `gh` (GitHub CLI) — não instalado. Push feito via `git push` com credenciais já
  configuradas no sistema (funcionou sem prompt).
- MCP do Supabase (`mcp__claude_ai_Supabase__*`) — não autorizado. Precisaria ser
  liberado nas configurações de conector do claude.ai. Enquanto isso, migrations são
  aplicadas via conexão Postgres direta (`pg` instalado com `--no-save`, não está no
  `package.json`).

## Banco de dados — já aplicado

Migration `supabase/migrations/20260727000000_init_schema.sql` aplicada e verificada:
8 tabelas (`users`, `simulation_attempts`, `phase1_audios`, `phase1_questions`,
`phase1_answers`, `phase2_prompts`, `phase2_responses`, `simulation_feedbacks`), enums,
RLS habilitado em todas com policies de isolamento por usuário, trigger
`on_auth_user_created` criando a linha em `public.users` no cadastro via Supabase Auth.

Consulte `docs/database-schema.md` para o modelo completo e as decisões de design
(perfil operacional, timers da Fase 2, state machine).

## Roadmap (SPD seção 12 / SRS seção 5)

- [x] **Fase 1 — Fundação técnica**: repositório, Next.js + TypeScript, Supabase
      configurado (Auth pronto no banco via trigger, RLS ativo), estrutura de pastas.
- [ ] **Fase 1 — pendente**: ambiente de deploy (Vercel — precisa da conta da Sabrina
      conectada ao GitHub; não configurado ainda).
- [ ] **Fase 2 — Banco e modelos**: schema aplicado ✅; faltam seeds iniciais
      (áudios/perguntas/prompts de exemplo) e cadastro do primeiro lote de conteúdo real.
- [ ] **Fase 3 — Fluxo do usuário**: login, dashboard, páginas Fase 1/Fase 2, histórico.
      **Próximo passo em aberto** — ficou decidido perguntar se seguimos por aqui ou
      fechamos o deploy na Vercel primeiro; a conversa foi interrompida antes da resposta.
- [ ] **Fase 4 — Módulo Fase 1**: sorteio de 30 questões, player de áudio, correção,
      score.
- [ ] **Fase 5 — Módulo Fase 2**: state machine da entrevista (ver
      `docs/state-machine.md`), gravação, transcrição (OpenAI), engine de prompts
      (Claude), modos practice/official.
- [ ] **Fase 6 — Relatórios**: histórico, evolução por critério ICAO.
- [ ] **Fase 7 — Refino e lançamento**: responsividade, testes, observabilidade, deploy
      público.

## Decisões de design já fechadas (não reabrir sem motivo novo)

- Arquitetura: monólito modular Next.js (Route Handlers + Server Actions), sem backend
  separado no MVP.
- IA dividida por especialidade: OpenAI (transcrição/Whisper), Anthropic Claude (engine
  da entrevista + correção segundo a Escala OACI).
- `operational_profile` (TWR/APP/ACC/AFIS/FIS/COpM/ab_initio) faz parte do MVP — não é
  algo a adiar, confirmado pelas especificações oficiais como estrutural na Fase 2.
- Pipeline de IA da Fase 2: tentar **síncrono primeiro** (resposta única costuma
  processar em segundos); só introduzir fila real se a medição empírica mostrar
  necessidade. `processing_status` no schema é para a UI, não implica fila desde já.
- Timeout de 20s pra começar a responder no modo `official` (Manual do Examinando,
  item 1.2.4) — separado do timer de duração da resposta.
- Regra de repetição/esclarecimento difere por parte da entrevista — Parte 2 só aceita
  repetição, não esclarecimento de vocabulário (ver `docs/state-machine.md`).
- Nota final por critério ICAO = sempre o **menor** valor entre os 6 critérios, nunca
  média — regra de segurança operacional da OACI, deve estar explícita no prompt de
  correção da IA.

## Documentos-fonte (só existiram como PDFs anexados no chat, não estão no repo)

Se precisar reconsultar o texto integral das especificações oficiais do EPLIS ou dos
documentos internos que originaram este projeto, peça para a Sabrina reanexar:
`ESTRUTURA TÉCNICA BANCO DE DADOS.pdf`, `PRODUTO MÍNIMO VIÁVEL.pdf`,
`SPD_Plataforma_EPLIS.pdf`, `SRS_Plataforma_EPLIS.pdf`, `STATE MACHINE.pdf`,
`Especificacoes_Fase1.pdf`, `Especificacoes_Fase2.pdf`, `Manual do Examinando.pdf`.
Os pontos relevantes de todos eles já foram extraídos para `docs/database-schema.md`,
`docs/state-machine.md` e `docs/srs-updates.md` — normalmente não é necessário reabrir
os PDFs.
