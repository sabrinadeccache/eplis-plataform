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
- `OPENAI_API_KEY` **preenchida** (usada na Fase 4 para gerar os áudios de teste via TTS
  — `scripts/seed-phase1.mjs`). `ANTHROPIC_API_KEY` ainda **não** preenchida — necessária
  antes de começar a Fase 5 (engine da entrevista/correção).

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

Migration `supabase/migrations/20260727010000_signup_metadata.sql` aplicada e
verificada: estende `handle_new_user()` para ler `role`, `target_exam` e
`operational_profile` do `raw_user_meta_data` enviado pelo formulário de cadastro
(Fase 3), em vez de deixar tudo no default e exigir edição de perfil depois.

Migration `supabase/migrations/20260728000000_grant_authenticated_privileges.sql`
aplicada e verificada: **corrige um bug crítico presente desde a Fase 2** — a migration
inicial criou as RLS policies mas nunca deu `GRANT` de privilégio de tabela ao role
`authenticated` (RLS só é avaliado depois que o GRANT de tabela já passou). Sem isso,
toda query autenticada contra qualquer uma das 8 tabelas falhava com "permission denied
for table X", silenciosamente — o app não dava erro visível porque as páginas tratam
"sem dado" como "sem usuário" e redirecionam pro login, então isso passou despercebido
até a Fase 4. Se aparecer esse erro em uma tabela nova no futuro, é isso: falta
`grant select/insert/update on public.<tabela> to authenticated;`.

Consulte `docs/database-schema.md` para o modelo completo e as decisões de design
(perfil operacional, timers da Fase 2, state machine).

## Roadmap (SPD seção 12 / SRS seção 5)

- [x] **Fase 1 — Fundação técnica**: repositório, Next.js + TypeScript, Supabase
      configurado (Auth pronto no banco via trigger, RLS ativo), estrutura de pastas.
- [ ] **Fase 1 — pendente**: ambiente de deploy (Vercel — precisa da conta da Sabrina
      conectada ao GitHub; não configurado ainda).
- [ ] **Fase 2 — Banco e modelos**: schema aplicado ✅; seeds de teste da Fase 1 feitos
      (10 áudios sintéticos, ver Fase 4 abaixo); faltam seeds/prompts da Fase 2 e o
      cadastro do primeiro lote de conteúdo real (áudios oficiais, não sintéticos).
- [x] **Fase 3 — Fluxo do usuário**: cadastro (`/cadastro`) e login (`/login`) via
      Server Actions + Supabase Auth, proteção de rotas no `src/proxy.ts` (redireciona
      não-autenticado para `/login` e autenticado para fora das páginas públicas),
      dashboard (`/dashboard`) e placeholders autenticados de Fase 1/Fase 2/Histórico
      (`AppShell` compartilhado com navegação e logout). Testado ponta a ponta via
      Supabase Auth API (signup real, trigger populando `role`/`target_exam`/
      `operational_profile`, depois usuário de teste removido). Falta: nenhuma tela de
      "recuperar senha" ainda — não fazia parte do pedido desta rodada.
      **Nota importante:** o arquivo de proteção de rotas chama-se `proxy.ts`, não
      `middleware.ts` — no Next.js 16 o convention foi renomeado (`middleware` →
      `proxy`), e como este projeto usa `src/app/`, o arquivo tem que ficar em
      `src/proxy.ts` (raiz do repo não funciona). Um `middleware.ts` na raiz simplesmente
      não executa nesta versão, sem erro nenhum — se algo parecer "não estar protegido",
      confira isso primeiro.
- [x] **Fase 4 — Módulo Fase 1**: cadastro de 10 áudios de teste (sintetizados via TTS
      da OpenAI, `scripts/seed-phase1.mjs`, upload pro bucket `phase1-audios` do
      Supabase Storage) + suas perguntas de múltipla escolha. Fluxo completo: sorteio de
      até 30 questões ativas (`/fase1` → botão inicia tentativa → `/fase1/simulado/[id]`
      → timers oficiais de 30s leitura / 1min resposta com reescuta dentro da mesma
      janela, conforme Manual do Examinando 1.2.1 → `/fase1/resultado/[id]` com score e
      gabarito). Testado ponta a ponta via HTTP real (login, criação de tentativa,
      renderização de pergunta+áudio real, grading, tela de resultado) — não só
      build/lint. Falta: conteúdo oficial real (os 10 áudios atuais são só para
      desenvolvimento, 3 deles ficam abaixo do mínimo de 10s da especificação).
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
