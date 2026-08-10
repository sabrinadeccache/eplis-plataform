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
  "Ferramentas indisponíveis" abaixo). **Achado (2026-08-10)**: `SUPABASE_DB_URL` usava o
  host de conexão direta (`db.<projeto>.supabase.co`), que passou a ser IPv6-only no
  Supabase — em redes sem IPv6 funcional isso falha com `getaddrinfo ENOTFOUND`,
  reproduzido de verdade na máquina da Sabrina. Trocado pro host do **Session pooler**
  (`aws-0-sa-east-1.pooler.supabase.com:5432`, usuário `postgres.<projeto>` em vez de só
  `postgres` — string obtida em Database Settings → Connect → aba "Session pooler" no
  painel do Supabase), que é IPv4-compatível.
- `OPENAI_API_KEY` **preenchida** — usada na Fase 4 (áudios de teste via TTS, depois
  substituídos por gravações reais) e agora também na Fase 5 (transcrição via Whisper e
  TTS da voz da IA na entrevista simulada). `ANTHROPIC_API_KEY` **preenchida e testada**
  (Fase 5) — usada no engine de feedback/correção da entrevista (`claude-sonnet-5`).

## Como testar localmente

`npm run dev` na raiz do projeto sobe tudo (é um monólito Next.js — não tem backend
separado) em `http://localhost:3000`. Sem sessão, redireciona pra `/login`.

**Pegadinha do fluxo de cadastro**: o projeto Supabase exige confirmação de e-mail antes
do login funcionar. Ao testar `/cadastro` manualmente, é preciso abrir o e-mail recebido
e confirmar antes de conseguir logar — senão o login falha silenciosamente com "E-mail ou
senha inválidos" (mensagem genérica de propósito, não é bug). Pra pular essa etapa em
teste manual, dá pra confirmar um usuário direto via API admin do Supabase
(`POST /auth/v1/admin/users` com `email_confirm: true`, ou `PUT
/auth/v1/admin/users/{id}` com o mesmo campo pra um usuário já existente) usando a
`SUPABASE_SERVICE_ROLE_KEY`.

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

Migration `supabase/migrations/20260728010000_grant_service_role_privileges.sql`
aplicada e verificada: mesma lacuna, mas para o role `service_role` (que ignora RLS por
padrão no Supabase, mas ainda precisa do GRANT de tabela para ser acessado via API REST
com a service key — só não travou o app porque os scripts administrativos usam conexão
Postgres direta, que ignora GRANT).

Conteúdo real da Fase 1 (ver Fase 4 no roadmap abaixo): os 10 áudios sintéticos (TTS) de
teste foram substituídos por 10 gravações reais de comunicações ATC (bucket
`phase1-audios`, script `scripts/replace-phase1-audios.mjs`), com perguntas baseadas nas
transcrições reais (`Material Didático/Phase 1 - Audios/transcricoes_audios.pdf`, fora
do repo) e dificuldade variada (3 easy, 4 medium, 3 hard) proporcional à complexidade de
cada gravação.

Bucket de Storage `phase2-images` criado em 2026-08-06 (`scripts/create-phase2-images-
bucket.mjs`, público, mesmo padrão do `phase1-audios`/`phase2-recordings`) — imagens da
Parte 4. Hoje tem 3 imagens `general` (picsum, placeholder original) + 2 imagens de teste
marcadas `operational_profile = 'TWR'` (`scripts/seed-phase2-images-twr-test.mjs`, também
picsum — só pra validar o sorteio por perfil, não são fotos reais de torre).

Consulte `docs/database-schema.md` para o modelo completo e as decisões de design
(perfil operacional, timers da Fase 2, state machine).

## Atualização (2026-08-10) — perfil operacional real na Fase 2 (Partes 2 e 4)

Teste manual ponta a ponta completo (Partes 1-4 + relatório final) validado pela Sabrina. Achados
corrigidos nesta rodada:
- Feedback (curto por resposta e relatório final) tratava transcrição vazia/ruído/corte de
  microfone como resposta fraca em inglês, pedindo pra "tentar de novo" — corrigido em
  `src/lib/ai/anthropic.ts`: agora a IA reconhece que é provável problema técnico (não de
  proficiência), não avalia a resposta como língua, e **sugere** (nunca pergunta) checar
  microfone/equipamento antes das próximas perguntas; o relatório final não rebaixa nenhum dos 6
  critérios por causa de uma resposta assim.
- Tela de resultado (`/fase2/resultado/[id]`) não mostrava a transcrição da resposta do aluno, só
  pergunta + feedback — corrigido incluindo `transcript` no select e exibindo "Sua resposta" antes
  do feedback de cada item.
- `SUPABASE_DB_URL` usava o host de conexão direta do Postgres (`db.<projeto>.supabase.co`), que é
  IPv6-only no Supabase — falhava com `ENOTFOUND` em rede sem IPv6. Trocado pro **Session pooler**
  (`aws-0-sa-east-1.pooler.supabase.com:5432`, usuário `postgres.<projeto>`).

**Decisão de escopo fechada nesta rodada**: o produto passa a cobrir só 4 áreas operacionais reais
— TWR, APP, ACC, COpM (COpM = Controlador de Operações Militares, cobre o papel de defesa
aérea/identificação de aeronaves não identificadas no SISCEAB). Enum `operational_profile`
restrito de 8 pra 5 valores (`AFIS`, `FIS` e `ab_initio` removidos — não fazem parte do escopo de
conteúdo desta rodada; `general` mantido, marca conteúdo sem restrição de perfil usado nas Partes
1/3 e como fallback). Migration `20260810000000_narrow_operational_profile.sql`. Cadastro
(`/cadastro`) atualizado pra oferecer só "Ainda não sei" (nulo), TWR, APP, ACC, COpM.

**Conteúdo real por perfil**:
- **Parte 2**: 40 situações operacionais reais (10 por perfil), pesquisadas pra refletir o dia a
  dia de cada área — TWR (torre: runway incursion, bird strike, wind shear, go-around etc.), APP
  (aproximação: TCAS RA, conflito de tráfego no terminal, vetoração, missed approach), ACC (área:
  emergência médica em voo, falha de motor em rota, descompressão, desvio por clima), COpM
  (operações militares/defesa aérea: aeronave não identificada, intrusão em área restrita,
  scramble de interceptador, cenário de sequestro/renegade). Script
  `scripts/seed-phase2-part2-profiles.mjs` — faz DELETE de verdade das 12 linhas antigas
  `general` (seguro porque roda depois da limpeza de `phase2_responses`) e insere as 40 novas,
  `order_index` 1-10 dentro de cada perfil.
- **Parte 4**: 1 imagem real por perfil (bucket `phase2-images`, arquivos `TWR-01.png`,
  `APP-01.jpg`, `ACC-01.webp`, `COpM-01.jpg`, fornecidos pela Sabrina), registradas via
  `scripts/seed-phase2-part4-profile-images.mjs`. Como `PART_SIZES.part4` é 1 e cada perfil agora
  tem exatamente 1 imagem própria (os placeholders picsum `general` e os 2 de teste `TWR` foram
  desativados, não apagados), o sorteio da Parte 4 fica determinístico por perfil — cada candidato
  sempre vê a imagem real da sua área. Candidato sem perfil definido ("Ainda não sei") não tem
  conteúdo de Parte 2/4 — cai na mensagem já existente "conteúdo insuficiente pro perfil", mesmo
  comportamento gracioso que já existia pra pool vazio.

**Limpeza de dados de teste**: `scripts/dev-clean-test-data.mjs` (novo, reutilizável) apagou todas
as `simulation_attempts`/`phase1_answers`/`phase2_responses`/`simulation_feedbacks` de teste da
Sabrina antes da migration do enum (pré-requisito — não dava pra estreitar o enum com linhas
usando os valores removidos). Banco de tentativas está zerado; conteúdo (`phase1_questions`,
`phase1_audios`, `phase2_prompts`) e usuários preservados.

**Achado corrigido (mesma rodada, feedback da Parte 2)**: mesmo já proibindo penalizar
repetição/paráfrase na resposta de `situation_check` (achado da rodada de 2026-08-06 abaixo), o
modelo ainda deixava escapar sugestões tipo "seria melhor usar suas próprias palavras" quando o
candidato repetia a descrição da IA — o que soa como crítica mesmo sem afetar a nota. Reforçado em
`src/lib/ai/anthropic.ts` (feedback curto e relatório final): agora é proibido até insinuar isso;
repetir e parafrasear são tratados como igualmente corretos, só o parafrasear ganha destaque
*positivo* quando acontece, nunca como contraste negativo pra quem repetiu.

**Teste manual ponta a ponta nos 4 perfis operacionais reais (TWR, APP, ACC, COpM)**: validado
pela Sabrina — transição Parte 1 → Parte 2 (pool de 10 situações por perfil correto) e transição
Parte 3 → Parte 4 (imagem real por perfil sorteada corretamente) confirmadas nos 4 perfis. Novo
utilitário de dev pra isso: `node scripts/dev-set-profile.mjs <email> <TWR|APP|ACC|COpM>` troca o
perfil operacional de um usuário já cadastrado sem precisar de conta nova por área — combinado com
`dev-jump-phase2-part.mjs <email> <part> <itemIndex>` (esse último ganhou o parâmetro opcional
`itemIndex` nesta rodada, pra pular direto pro último item de uma parte e testar só a transição).

## Fase 2 (entrevista simulada, modo `practice`) — fluxo considerado fechado (2026-08-10)

Ponta a ponta validado manualmente pela Sabrina: as 4 partes, tamanho oficial (4/10/4/1), relatório
final gerado no fluxo real do app (não isolado via script), conteúdo real por perfil operacional
(Parte 2 e Parte 4) nos 4 perfis, feedback técnico de microfone, e exibição de
pergunta+resposta+feedback por item na tela de resultado. Ver "Atualização (2026-08-10)" acima e
"Atualização (2026-08-06)" abaixo para o histórico completo de achados corrigidos até chegar aqui.

Próximos passos possíveis (perguntar à Sabrina qual priorizar): (1) fechar o deploy na Vercel;
(2) implementar o modo `official` da Fase 2 (timer de 20s pra começar a responder, limite rígido de
repetição por parte — hoje só existe o modo `practice`); (3) completar o conteúdo da Fase 1 (só 10
dos até 30 áudios possíveis) ou ampliar o conteúdo real da Fase 2 (só 1 imagem por perfil na Parte
4 — o exame real pode ter mais variedade); (4) Fase 6 (histórico/relatórios de evolução) ou Fase 7
(responsividade, testes, observabilidade).

## Histórico (Fase 5 antes de fechar — 2026-08-06 e anteriores)

**Atualização (2026-08-06)**: rodada de teste manual ponta a ponta das Partes 2-4, com
`PART_SIZES` temporariamente reduzido (2/2/2/1) pra acelerar os ciclos de teste e
revertido pros valores oficiais (4/10/4/1) ao final desta sessão — ver
`src/services/simulations/phase2/queries.ts` e `state-machine.ts`. Achados reais
corrigidos nessa rodada (detalhes completos na seção "Fase 5" abaixo):
- Feedback da Parte 2 (`situation_check` vs `suggestion`) não diferenciava o que cada
  estágio deveria avaliar — corrigido em `src/lib/ai/anthropic.ts`.
- Botão "Continuar" do feedback falado liberava antes do áudio da IA terminar (ou até
  começar) de tocar, cortando e emendando com a próxima pergunta — agora fica bloqueado
  até o áudio realmente terminar.
- Parte 4 nunca renderizava a imagem (`<img>` simplesmente não existia no componente,
  apesar do `image_url` já estar no banco) — corrigido; imagem fica visível durante todo
  o item (observação, descrição e história).
- Bucket de Storage `phase2-images` criado (público, mesmo padrão do
  `phase2-recordings`) + 2 imagens de teste (ainda placeholder do picsum, não fotos
  reais) marcadas `operational_profile = 'TWR'`, pra validar que o sorteio de imagem da
  Parte 4 respeita o perfil operacional do candidato — script
  `scripts/seed-phase2-images-twr-test.mjs`. **O mesmo mecanismo de filtro por perfil já
  vale pra Parte 2 (código compartilhado em `queries.ts`), mas ainda não há conteúdo real
  por perfil cadastrado lá** — só o placeholder `general` existente.
- Áudio bloqueado pelo navegador (autoplay) quando a página da entrevista é aberta direto
  por link, sem nenhuma interação prévia — antes falhava silenciosamente; agora aparece
  um aviso com botão "🔊 Ativar áudio" pra destravar com um clique.
- **Achado mais sério**: enviar uma resposta de áudio longa (a história da Parte 4, sem
  limite de tempo no modo practice) derrubava a chamada com `Error: Maximum array
  nesting exceeded`, um limite interno do protocolo Flight que as Server Actions usam
  pra decodificar argumentos — **diferente e mais baixo** que o `bodySizeLimit`
  configurável do Next.js (que não resolve isso). Corrigido migrando o envio de resposta
  de Server Action para uma route handler comum (`src/app/api/phase2/submit-response/
  route.ts`), que recebe o áudio como upload binário real (`multipart/form-data`) em vez
  de string base64 — contorna o limite por completo, além de eliminar o overhead de
  converter pra base64 no client. `submitResponse` foi removida de
  `src/services/simulations/phase2/actions.ts` (só restou `assertOwnAttemptInProgress`,
  agora exportada pra ser reaproveitada pela rota).
- O feedback (curto por resposta e no relatório final) da resposta de história da Parte 4
  usava o mesmo `prompt_text` do banco da etapa de descrição da imagem ("Describe what
  you see in this image."), fazendo a IA cobrar descrição literal da imagem numa resposta
  que devia ser uma história livre. Corrigido com estágios explícitos
  (`image_description` / `story_telling`) em `generateResponseFeedback` e no contexto
  passado pro relatório final.

Utilitário novo pra testes futuros: `node scripts/dev-jump-phase2-part.mjs <email>
<part1|part2|part3|part4>` pula uma tentativa em andamento (ou cria uma nova) direto pro
início da parte pedida, sem precisar responder as partes anteriores de novo.

A performance (cada resposta leva alguns segundos entre upload → transcrição → feedback
→ TTS do feedback) foi discutida com a Sabrina e **decisão fechada: não otimizar agora**
— ela considerou aceitável pra fase de testes, e vamos seguir o princípio já registrado
neste documento ("síncrono primeiro, otimizar só se a medição em produção mostrar
necessidade") em vez de otimizar preventivamente.

Próximos passos, em ordem sugerida: (1) rodar um teste manual ponta a ponta completo, do
zero, já com os tamanhos oficiais das partes (4/10/4/1), incluindo o relatório final
gerado no fluxo real do app; (2) depois disso, perguntar à Sabrina entre — fechar o
deploy na Vercel, implementar o modo `official` da Fase 2 (timers rígidos, limite de
repetição por parte), substituir o conteúdo placeholder da Fase 2 por prompts/imagens
reais (inclusive por perfil operacional, não só `general`), ou completar o conteúdo da
Fase 1 com mais áudios reais.

## Roadmap (SPD seção 12 / SRS seção 5)

- [x] **Fase 1 — Fundação técnica**: repositório, Next.js + TypeScript, Supabase
      configurado (Auth pronto no banco via trigger, RLS ativo), estrutura de pastas.
- [ ] **Fase 1 — pendente**: ambiente de deploy (Vercel — precisa da conta da Sabrina
      conectada ao GitHub; não configurado ainda).
- [ ] **Fase 2 — Banco e modelos**: schema aplicado ✅; conteúdo real da Fase 1 já
      cadastrado (10 áudios reais, ver Fase 4 abaixo); conteúdo real das Partes 2 e 4 da
      entrevista simulada já cadastrado por perfil operacional (ver Fase 5 abaixo) —
      falta ainda ampliar variedade (só 1 imagem por perfil na Parte 4) e cadastrar
      conteúdo real pras Partes 1 e 3 (hoje `general`, placeholder).
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
- [x] **Fase 4 — Módulo Fase 1**: fluxo completo — sorteio de até 30 questões ativas
      (`/fase1` → botão inicia tentativa → `/fase1/simulado/[id]` → timers oficiais de
      30s leitura / 1min resposta com reescuta dentro da mesma janela, conforme Manual
      do Examinando 1.2.1 → `/fase1/resultado/[id]` com score e gabarito). Testado ponta
      a ponta via HTTP real (login, criação de tentativa, renderização de
      pergunta+áudio real, grading, tela de resultado) — não só build/lint.
      **Conteúdo**: os 10 áudios são gravações reais de comunicações ATC (fornecidas
      pela Sabrina, `Material Didático/Phase 1 - Audios/`, fora do repo), com perguntas
      próprias baseadas na transcrição real e dificuldade alternada (3 easy/4 medium/3
      hard) — não é mais placeholder sintético. Script de carga:
      `scripts/replace-phase1-audios.mjs` (idempotente — roda de novo se precisar
      recadastrar). Falta: só tem 10 itens (a Fase 1 real sorteia até 30); mais áudios
      reais precisam ser adicionados quando disponíveis.
- [x] **Fase 5 — Módulo Fase 2 (modo practice)**: entrevista simulada completa —
      4 partes sorteadas de forma determinística por tentativa (PRNG seedado pelo
      `attemptId`, sem persistir os prompts sorteados em coluna/tabela nova — ver
      `src/services/simulations/phase2/queries.ts` e `state-machine.ts`), narração da
      IA via TTS real (OpenAI `tts-1`, gerado sob demanda, sem cache — mesmo princípio
      de "síncrono primeiro" já usado no resto do projeto), gravação da resposta via
      `MediaRecorder` no browser, transcrição via OpenAI Whisper, feedback curto por
      resposta e relatório final (6 critérios ICAO + regra do menor valor, nunca média)
      via Anthropic Claude (`claude-sonnet-5`). **Fluxo completo (4 partes, tamanho
      oficial, relatório final) testado manualmente ponta a ponta pela Sabrina com
      microfone real, inclusive nos 4 perfis operacionais reais — ver "Fase 2 — fluxo
      considerado fechado (2026-08-10)" no topo deste documento.**
      **Achado corrigido nesta rodada**: `simulation_feedbacks` tinha só policy/GRANT de
      `select`, sem `insert` — mesma classe de bug do GRANT ausente já documentada
      acima; corrigido em `20260729000000_phase2_feedback_insert.sql`.
      **Escopo desta rodada**: só modo `practice` (sem timer de 20s pra começar a
      falar, sem limite rígido de repetição por parte) — modo `official` fica para uma
      rodada futura. Sub-estágios dentro de um item (ex.: `situation_check` →
      `suggestion` na Parte 2) vivem só no estado local do client component, não são
      persistidos — um reload no meio de um item reinicia os sub-estágios daquele item,
      mas não perde a posição de item (`current_part`/`current_item_index`, esses sim
      persistidos).
      **Atualização (2026-07-29)**: Parte 2 mudou de 3 para 2 estágios por item —
      `situation_intro` foi removido; a IA agora descreve a situação e já termina o
      mesmo turno com "What's the situation?" obrigatório (conteúdo do
      `scripts/seed-phase2-prompts.mjs` ajustado para terminar todos os 12 itens da
      Parte 2 com essa frase fixa), habilitando o botão de resposta assim que a fala
      termina — sem pausa automática de 3s no meio. Também ficou explícito nos prompts
      de avaliação (`src/lib/ai/anthropic.ts`) que repetir/parafrasear a descrição da
      IA nessa resposta é permitido no exame real e não deve ser penalizado. Ver
      `docs/state-machine.md`.
      **Conteúdo**: Partes 1 e 3 seguem com conteúdo placeholder (perfil `general`,
      script `scripts/seed-phase2-prompts.mjs`) — não fazem parte do escopo de
      segmentação por perfil operacional. Partes 2 e 4 têm conteúdo real por perfil
      desde 2026-08-10 (ver seção correspondente no topo deste documento) — deixaram de
      ser placeholder.
      **Achado corrigido (script de seed deixou de ser idempotente na prática)**:
      `scripts/seed-phase2-prompts.mjs` era "apaga tudo com `operational_profile =
      'general'` e reinsere" — funcionava enquanto o banco só tinha dados de seed, mas
      quebrou assim que passou a existir `phase2_responses` real (de tentativas de
      teste) referenciando `phase2_prompts.id`: o `DELETE` passou a falhar com
      "violates foreign key constraint" (23503). Reescrito para fazer **UPSERT** de
      verdade (update se já existe, insert se não) casando por uma chave natural — Parte
      2 usa `order_index` (já existia e é estável), Partes 1 e 3 usam `prompt_text`
      (único dentro de cada parte), Parte 4 usa `image_url` (as 3 imagens compartilham o
      mesmo `prompt_text`, "Describe what you see in this image." — usar texto como
      chave ali colapsava as 3 linhas em 1, bug real encontrado e corrigido durante o
      teste). Item que sai da lista atual é só desativado (`is_active = false`), nunca
      apagado, pra não quebrar `phase2_responses` históricas. Testado rodando o script 2x
      seguidas: contagens estáveis (6/12/6/3, todas `is_active = true`), sem erro de FK.
      Lição geral: **qualquer script de seed que faça `DELETE` de linhas que podem ter
      sido referenciadas por FK de dados reais de usuário precisa ser upsert, não
      delete-and-reinsert** — ver convenção correspondente no `CLAUDE.md`.
      **Auditoria de RLS (2026-07-29)**: conferidas as 8 tabelas do schema `public`
      (`users`, `phase1_questions`, `phase1_audios`, `phase1_answers`, `phase2_prompts`,
      `phase2_responses`, `simulation_attempts`, `simulation_feedbacks`) e o storage
      (`storage.objects` para os buckets `phase1-audios` e `phase2-recordings`) — RLS
      habilitado em todas, `GRANT` pro role `authenticated` e policies coerentes entre
      si em todas (nenhum `GRANT` sem policy correspondente nem policy sem `GRANT`).
      Nenhuma correção foi necessária; ver detalhes de cada policy em
      `docs/database-schema.md` se precisar reconferir.
      **Storage**: bucket `phase2-recordings` criado via
      `scripts/create-phase2-recordings-bucket.mjs` (público para leitura, como
      `phase1-audios`), com policy de INSERT restrita ao dono da tentativa em
      `20260729010000_phase2_recordings_storage_policy.sql`.
      **Achado corrigido (2ª rodada de testes manuais)**: só a policy de INSERT não
      bastou — a API de Storage faz um `INSERT ... RETURNING` internamente pra devolver
      os metadados do objeto, e o Postgres exige que a linha também seja visível por uma
      policy de SELECT (sem ela, o RETURNING falha com "new row violates row-level
      security policy" mesmo com a policy de INSERT correta e satisfeita — confirmado
      isolando o problema em SQL direto). Corrigido em
      `20260729020000_phase2_recordings_storage_select_policy.sql`. Lição: toda vez que
      criar uma policy de INSERT em uma tabela usada com `RETURNING` (a maioria dos
      clients faz isso por padrão), checar se também existe policy de SELECT.
      **Achado corrigido (mesma rodada, client component)**: o TTS de cada estágio
      remontava um `<audio>` novo a cada pergunta, e navegadores bloqueiam autoplay em
      elementos de mídia recém-criados sem gesto recente do usuário — a partir da 2ª
      pergunta a tela travava esperando um evento `ended` que nunca disparava. Corrigido
      usando um único elemento `<audio>` persistente (nunca remontado) durante toda a
      entrevista, com fallback: se o autoplay for bloqueado mesmo assim, o código trata
      como "terminou de falar" na hora em vez de travar. Também trocado o texto visível
      da pergunta por apenas o áudio + indicador "IA está falando", e os controles de
      resposta agora são Falar/Pausar/Continuar falando/Recomeçar/Concluir e enviar
      (usando pause()/resume() nativos do MediaRecorder), a pedido da Sabrina.
      **Achado corrigido (3ª rodada de testes manuais)**: o feedback curto por resposta
      sumia de forma intermitente (apareceu nas questões 3 e 4 da Parte 1, mas não nas
      1 e 2). Causa: `claude-sonnet-5` usa "thinking" adaptativo por padrão, e quando o
      modelo decide pensar, `content[0]` da resposta pode ser um bloco de raciocínio em
      vez do texto — o código indexava direto em `content[0]`, então o feedback saía
      vazio sempre que o modelo pensava antes de responder. Corrigido em
      `src/lib/ai/anthropic.ts`: `thinking: {type: "disabled"}` nas duas chamadas (não
      precisam de raciocínio) + busca explícita pelo primeiro bloco `type === "text"`
      em vez de indexar `[0]`, como defesa extra. Testado repetindo a chamada 4x — antes
      da correção, tipo do bloco variava; depois, sempre `text`.
      **Ajustes de idioma (decisão final desta rodada)**: a entrevista em si — narração
      da IA (introduções, instruções, situações da Parte 2/4) e o feedback curto falado
      após cada resposta — é toda em inglês (o aluno treina o ouvido antes do exame de
      verdade). O **relatório final** (`simulation_feedbacks.general_feedback`, exibido
      em `/fase2/resultado/[id]`) é em **português**, já que fica salvo como registro de
      progresso do aluno; o prompt pede explicitamente que explique cada um dos 6
      critérios individualmente (com exemplo concreto da resposta do candidato), não só
      uma impressão geral. Feedback curto por resposta é falado em voz alta (TTS) além
      de exibido na tela.
      **Achado corrigido (parsing do relatório final)**: ao pedir explicação mais
      detalhada por critério, o modelo às vezes envolve o JSON em cercas de código
      (` ```json ... ``` `) mesmo com a instrução de responder só JSON — isso quebrava o
      `JSON.parse` e caía no relatório de fallback. Corrigido removendo as cercas antes
      de parsear; `max_tokens` do relatório final também subiu de 1000 para 2000 (a
      explicação por critério é mais longa e estava sendo cortada no meio).
      **Atualização (2026-08-06) — teste manual das Partes 2-4**: ver bloco
      "Atualização (2026-08-06)" em "Próximo passo em aberto" no topo deste documento
      pra a lista completa de achados corrigidos nessa rodada (feedback da Parte 2 por
      estágio, botão "Continuar" cortando o áudio do feedback, imagem da Parte 4 nunca
      renderizada, bucket `phase2-images` + conteúdo de teste por perfil TWR, bloqueio de
      autoplay do navegador, migração do envio de resposta de Server Action pra route
      handler por causa do limite "Maximum array nesting exceeded" do protocolo Flight, e
      feedback da história da Parte 4 usando o prompt errado). Todos testados
      manualmente por completo ponta a ponta (não só lint/build).
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
- Idioma da Fase 2: a entrevista em si (narração da IA, feedback curto falado após cada
  resposta) é **toda em inglês**, pra o aluno treinar o ouvido antes do exame de
  verdade. O relatório final salvo (`simulation_feedbacks.general_feedback`) é em
  **português**, já que fica como registro de progresso do aluno — explicando cada um
  dos 6 critérios individualmente, não só uma impressão geral.
- Performance da Fase 5 (latência de alguns segundos por resposta): decisão fechada de
  **não otimizar preventivamente** (sem cache de TTS, sem paralelizar as chamadas de IA)
  até haver medição em produção mostrando necessidade — consistente com o princípio já
  registrado acima pro pipeline de IA.

## Documentos-fonte (só existiram como PDFs anexados no chat, não estão no repo)

Se precisar reconsultar o texto integral das especificações oficiais do EPLIS ou dos
documentos internos que originaram este projeto, peça para a Sabrina reanexar:
`ESTRUTURA TÉCNICA BANCO DE DADOS.pdf`, `PRODUTO MÍNIMO VIÁVEL.pdf`,
`SPD_Plataforma_EPLIS.pdf`, `SRS_Plataforma_EPLIS.pdf`, `STATE MACHINE.pdf`,
`Especificacoes_Fase1.pdf`, `Especificacoes_Fase2.pdf`, `Manual do Examinando.pdf`.
Os pontos relevantes de todos eles já foram extraídos para `docs/database-schema.md`,
`docs/state-machine.md` e `docs/srs-updates.md` — normalmente não é necessário reabrir
os PDFs.
