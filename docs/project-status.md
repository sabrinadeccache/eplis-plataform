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

- **Vercel**: projeto `orion-flight-lab/eplis-trainer` (deploy em produção:
  https://eplis-trainer.vercel.app), GitHub repo conectado (`sabrinadeccache/eplis-plataform`,
  branch `main`) — push em `main` dispara deploy automático. Variáveis de ambiente de produção
  configuradas via `vercel env add`: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (as 7 usadas em `src/`, conferido
  por grep antes de configurar — `SUPABASE_DB_URL` fica de fora porque só é usada pelos scripts
  locais, nunca em runtime do app; `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` também
  ficam de fora, são opcionais e só afetam upload de source map no build). **[2026-08-19]**
  `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` adicionadas — projeto Sentry `eplis-trainer` criado na
  mesma organização/conta do `orion-flight-lab` (região EU já herdada da organização), mesmo DSN
  nas duas vars porque o EPLIS é um monólito único (diferente do orion, que tem API e web como
  projetos Sentry separados). Testado com um evento de smoke test real (`Sentry.captureException`
  + `flush`) antes de configurar em produção. Deploy testado: `curl -I` na raiz retorna 307 pra
  `/login`, confirmando que
  `src/proxy.ts` está ativo em produção. Login na Vercel CLI (`npx vercel`) foi via device
  flow (`vercel whoami` deflagrou automaticamente, sem precisar abrir navegador manualmente).
  **Nota**: o projeto caiu no team `orion-flight-lab` porque é o único team/scope existente
  na conta da Sabrina na Vercel (criado antes por outro projeto) — não tem relação de conteúdo
  com o EPLIS Trainer, é só o namespace de organização.
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
- MCP do Supabase (`mcp__claude_ai_Supabase__*`) — **autorizado a partir de 2026-08-27**
  (projeto `nkjnvmuatkibrvfsojmp` / org `hnhboswcygsjdczakfif`). `execute_sql` e
  `apply_migration` funcionam direto. As migrations/seeds via conexão Postgres direta
  (`pg`, `SUPABASE_DB_URL` do Session pooler) continuam válidas e são o caminho dos
  scripts em `scripts/`.

## Atualização (2026-09-03) — Conserto da pipeline do SDEA + áudios e imagens reais da Parte 2 + fix do sorteio

A Sabrina reorganizou o material didático do piloto de
`Material Didático/Pilots/Material Didático/{Fixed-wing,Rotary-wing}/` para
`.../Part 1..4/`, aplicou o efeito de rádio VHF nos áudios da Parte 2 **in-place**
(originais preservados em `Part 2/Audios-ORIGINAIS-backup/`) e vai subir os áudios
manualmente. Isso deixou vários scripts com caminho morto. Nesta rodada só o
conserto (sem tocar em conteúdo do banco nem em código do app):

- **Removidos**: `scripts/generate-pilot-prompt-audio.mjs` (gerador de TTS
  sintético + rádio VHF — superado pelas gravações reais da Sabrina) e
  `scripts/upload-pilot-part2-part4-images.mjs` (100% morto: referenciava 3 jpgs
  que não existem mais, ninguém importava).
- **`scripts/upload-pilot-part4-images.mjs`**: caminho corrigido para
  `Part 4/Images/<slug>/<slug>NN.png` (era `{Fixed-wing,Rotary-wing}/Images/`);
  guard `import.meta.url` protegido contra `process.argv[1]` undefined.
- **`scripts/radioize-part2-audio.mjs`**: fonte agora é sempre
  `Part 2/Audios-ORIGINAIS-backup/` quando existe (re-rodar não empilha mais o
  efeito); `--inplace` escreve em `Part 2/Audios/`; removido o backup hard-coded
  `Audios-clean/` (que não batia com o nome real `Audios-ORIGINAIS-backup/`).
- **`scripts/seed-pilot-prompts.mjs`** e **`src/lib/atc-dialogue.ts`**:
  comentários de cabeçalho atualizados (não citam mais os scripts removidos).
- **Docs**: `database-schema.md` — colunas `atc_audio_url`/`atc_followup_audio_url`/
  `dialogue_audio_url` não citam mais o gerador removido.
**Upload dos áudios da Parte 2 (feito nesta rodada)**: script novo
`scripts/upload-pilot-part2-audio.mjs` — sobe as 174 gravações reais
(`Part 2/Audios/<slug>/{1, 2 e 3 | 4 e 5}/sN-a{01,02}[-I].mp3`) pro bucket
`pilot-prompt-audio` como `<prompt_id>/{atc,followup}.mp3` e grava
`atc_audio_url` (a01) / `atc_followup_audio_url` (a02) casando por `order_index`
(s1..s30 → 1..30; `4 e 5/` sufixo `-I` → 30+K). Idempotente (`x-upsert` + update
incondicional), tem `--dry-run`. **Rodado em produção**: 174/174 enviadas, 0
faltando; as 87 situações (43 fixed_wing + 44 rotary_wing) agora têm as duas URLs,
HEAD na URL pública retorna 200 `audio/mpeg`.

**Sorteio da Parte 2 corrigido** (`src/services/simulations/pilot/queries.ts`): as
pastas `1, 2 e 3` / `4 e 5` são os **slots da prova**, não um índice plano — a
Parte 2 do SDEA tem 5 situações, sendo as 3 primeiras SEM imagem e as 2 últimas
COM imagem de complicação. `getSequenceForAttempt` fazia `shuffle(pool).slice(0,5)`
sem distinguir; agora separa o pool por `order_index` (1..30 sem imagem, 31+ com
imagem — convenção de `scripts/pilot-content-part234.mjs`) e sorteia **3 do
primeiro grupo + 2 do segundo**, nessa ordem. +2 testes em `queries.test.ts`.

- `tsc`/`lint`/`test` (44/44) limpos. Áudios já no Storage/DB de produção; código
  (correções + uploader + sorteio) ainda não commitado.

**Imagens de complicação da Parte 2 (feito nesta rodada)**: script novo
`scripts/upload-pilot-part2-images.mjs` — 13 `fixed_wing` + 14 `rotary_wing`
(`Part 2/Images/<slug>/<slug>-<nome>.png`) → JPEG (máx. 1600px, q82) →
`pilot-images/<slug>/part2/<order_index>.jpg`, grava `complication_image_url` nas
situações `order_index` 31+. Mapa nome→situação nas abas `FIXED-WING IMAGE` /
`ROTARY-WING IMAGE` de `Part 2/questions-map.xlsx` (`s{N}` → `order_index` 30+N),
hardcoded no script; conferido 1:1 pelo texto da situação contra
`pilot-content-part234.mjs`. Idempotente, `--dry-run`. **Rodado em produção**:
27/27, 0 faltando, 0 vazando pra `order_index` ≤30; HEAD → 200 `image/jpeg`.

**Áudios da Parte 3 (feito nesta rodada)**: script novo
`scripts/upload-pilot-part3-audio.mjs` — 38 gravações reais de R/T
(`Part 3/Audios/<basename>.mp3`, sem efeito sintético) → `pilot-prompt-audio/<id>/dialogue.mp3`,
grava `dialogue_audio_url`. Mapa situação→arquivo da coluna ÁUDIO da aba `PART III`
de `Part 3/questions-map-part-3.xlsx` (hardcoded; ordem conferida 1:1 com
`order_index` no banco e com `pilot-content-part234.mjs`). Idempotente, `--dry-run`.
**Rodado em produção**: 38/38, HEAD → 200 `audio/mpeg`. O runner toca 2x
(comportamento já existente).

**Segue em aberto**: teste real do runner da Parte 2/3 ponta a ponta (áudios
reais + fotos + os 2x da Parte 3); revisão do inglês do ATC; teste com microfone.

## Atualização (2026-09-03) — Conteúdo novo das Partes 2, 3 e 4 do SDEA no banco (só texto)

Pool de conteúdo do piloto ampliado a partir do Material Didático reescrito pela Sabrina
(planilhas `questions-map*.xlsx` + roteiros em `Material Didático/Pilots/Material
Didático/Part 2..4/`). **Esta rodada inseriu só o TEXTO no banco** — áudios e imagens
ficam pra depois (upload pro Storage + ajustes no runner).

- **Parte 1**: inalterada (as 30 perguntas já estavam no banco).
- **Parte 2**: de 25 → **87 situações** (43 `fixed_wing` + 44 `rotary_wing`), sendo por
  perfil 30 sem imagem (`order_index` 1-30) + as com imagem (`order_index` 31+). Colunas:
  `prompt_text` = fala de contexto do examinador, `atc_audio_text` = ÁUDIO 1 do
  controlador, `complication_text` = narração do imprevisto ("Now, …"),
  `atc_followup_audio_text` = ÁUDIO 2. `expected_readback`/`expected_reaction`/
  `expected_confirmation` agora ficam **null** (o roteiro novo não traz respostas de
  referência e a correção da trilha do piloto não julga fraseologia).
  `complication_image_url` = **null** nesta rodada; as situações "com imagem" rodam como
  texto até o upload das fotos + marcação no runner.
- **Parte 3**: de 15 (separadas por perfil) → **38 diálogos reais `general`** (o roteiro
  novo não segmenta por tipo de aeronave, igual à Parte 1). As 15 antigas
  (`fixed_wing`/`rotary_wing`) foram **desativadas** (`is_active = false`). `prompt_text` =
  transcrição com rótulos `pilot:`/`atc:` (parser `src/lib/atc-dialogue.ts` aceita),
  `discussion_question` = pergunta do áudio, **`comparison_question`** (coluna nova) =
  pergunta de comparação final das 3 situações.
- **Parte 4**: 13+10 já estavam no banco com imagens funcionando; só sincronizei o texto
  de 2 `agree_disagree_statement` que a Sabrina encurtou. As 23 imagens novas em
  `Part 4/Images/` (renomeadas `fixed-wing01..13`, `rotary-wing01..10`) **não foram
  comparadas** com o pool atual — se forem diferentes, precisam de upload numa próxima
  rodada.

- **Migration** `20260903000000_pilot_part3_comparison_question.sql`: `pilot_prompts`
  ganhou `comparison_question text` nullable. Aplicada em produção via MCP.
- **Código**: `scripts/pilot-content-part234.mjs` (novo, gerado das planilhas, exporta
  `PART2_FIXED_WING`/`PART2_ROTARY_WING`/`PART3_GENERAL`); `scripts/seed-pilot-prompts.mjs`
  passou a importar dele, Parte 3 virou loop único `general`, `upsertPart3` grava
  `comparison_question`. `tsc`/`lint` limpos. Seed rodado: 30/43/44/38/13/10.
- **Efeito de rádio da Parte 2**: `scripts/radioize-part2-audio.mjs` (novo) aplica um
  efeito VHF **variado por arquivo** (perfil determinístico pelo nome — `a01`/`a02` soam
  de estações diferentes) nos 174 mp3 de `Part 2/Audios/` → espelho `Part 2/Audios-radio/`.
  Aceita `--intensity N` (0.7 limpo … 1.4 sujo) e `--inplace` (faz backup em
  `Audios-clean/`). **A Sabrina ainda não aprovou a intensidade final** — decidir isso
  antes de rodar `--inplace` e subir pro Storage. Os áudios da Parte 3 são gravações
  reais de R/T e provavelmente não precisam do efeito.
- **Falta pra virar simulador SDEA usável** (fora do escopo desta rodada): upload dos
  ~260 áudios (Parte 2 radioizados em `Audios-radio/`, Parte 3) e ~50 imagens pro Storage;
  runner da Parte 2 (87 situações + split 3 sem imagem / 2 com imagem + tocar a01/a02
  pré-gravados) e da Parte 3 (tocar 2×, 5 s de intervalo, 1 repetição, turno de
  comparação lendo `comparison_question`); passe de revisão do inglês de ~10 falas do ATC
  da Parte 2; teste real ponta a ponta com microfone.

## Atualização (2026-08-28) — Call sign `LEVEL 6` e áudios sintéticos da Parte 2/3 zerados (SDEA)

- **Call sign da Parte 2 trocado `ANAC 123` → `LEVEL 6`** (a plataforma não tem vínculo
  com a ANAC; `LEVEL 6` é um trocadilho com o nível máximo da escala de proficiência
  linguística da OACI, que é o alvo do candidato). Troca feita em
  `scripts/seed-pilot-prompts.mjs` (dados da Parte 2 — falas do ATC e respostas de
  referência), no texto de introdução da Parte 2 em
  `src/components/sdea/pilot-interview-runner.tsx` e nos docs. Referências à **ANAC como
  órgão** (nome do exame SDEA em `src/lib/ai/pilot-track.ts`, comentários) foram mantidas.
  Seed já rodado em produção (`ANAC 123` restante: 0).
- **Todos os áudios sintéticos pré-gerados da Parte 2/3 foram apagados** (decisão da
  Sabrina — ela vai gravar/subir os TTS manualmente): 65 objetos removidos do bucket
  `pilot-prompt-audio` (o bucket em si foi mantido) e as 40 linhas de `pilot_prompts`
  com `atc_audio_url`/`atc_followup_audio_url`/`dialogue_audio_url` foram zeradas.
  Enquanto essas colunas estiverem `null`, o runner cai no **TTS em runtime** (`alloy`,
  sem efeito de rádio) — comportamento de fallback que já existia. Não havia cópia local
  no Material Didático.
- **Script novo**: `scripts/delete-pilot-prompt-audio.mjs` (idempotente, tem `--dry-run`)
  — lista recursivamente o bucket, apaga os objetos e zera as 3 colunas de URL.
- Para religar um áudio manual: subir o mp3 e gravar a URL pública na coluna
  correspondente de `pilot_prompts` (casar por `id`: `<id>/atc.mp3`, `<id>/followup.mp3`,
  `<id>/dialogue.mp3`). O pipeline `scripts/generate-pilot-prompt-audio.mjs` continua
  existindo caso se queira regenerar via OpenAI no futuro (`--force`).
- `tsc`/`lint`/`test`/`build` limpos.

## Atualização (2026-08-27) — Pool de 30 perguntas da Parte 1 do SDEA

A Parte 1 da trilha do piloto rodava com as **15 perguntas** herdadas das provas-modelo
(3 do "Modelo SDEA.pdf" + 12 dos "Test 1-4 helicopter"). A Sabrina escreveu um **pool
próprio de 30 perguntas abertas** pra substituir, mantendo o pool `general` (Parte 1 é
agnóstica ao tipo de aeronave). As 30 estão organizadas em 3 blocos temáticos
(conhecimento operacional/técnico, experiência pessoal/carreira, opinião/futuro da
aviação) — só comentário no seed, não há campo de categoria no schema.

- **DB**: as 15 linhas antigas de `pilot_prompts` (`part='part1'`) foram **apagadas**
  (`DELETE`, não `is_active=false`) — confirmado antes que nenhuma `pilot_responses` as
  referenciava (`count = 0`), então não havia risco de FK. As 30 novas foram inseridas
  (`aircraft_type='general'`, `expected_duration_seconds=60`, `is_active=true`).
  Aplicado direto via MCP do Supabase (`execute_sql`). Contagem final: 30.
- **`scripts/seed-pilot-prompts.mjs`**: array `PART1` reescrito com as 30, comentário de
  cabeçalho atualizado. O seed continua idempotente (`upsertPart1` casa por `prompt_text`,
  `deactivateStale` desativa o que sair da lista) — rodar de novo mantém as 30.
- **`Material Didático/Pilots/Material Didático/Docs/Material_pilotos.docx`**: catálogo do
  material do piloto. Ganhou a seção **PART 1** com as 30 perguntas numeradas (já tinha
  PART 4). Editado com `python-docx`.

`npm run lint` limpo.

## Atualização (2026-08-28) — Pool de fotos da Parte 4 (SDEA), avião e helicóptero

A Sabrina forneceu 23 cenas IA-geradas pra Parte 4 (descrição de imagem): 13 de avião
(`fixed_wing`) + 10 de helicóptero (`rotary_wing`), em `Material Didático/Pilots/
Material Didático/{Fixed-wing,Rotary-wing}/Images/`. Isso **fecha a lacuna** da Parte 4
de `rotary_wing`, que estava vazia desde a implementação da trilha (2026-08-24).

- **`scripts/upload-pilot-part4-images.mjs`** (novo): converte cada PNG (até ~46 MB) pra
  JPEG (máx. 1600px, q82) com ImageMagick e sobe pra `pilot-images/<perfil>/part4/NN.jpg`.
- **Estrutura da Parte 4 alinhada com o "Modelo SDEA com anotações"** (decisão da
  Sabrina): dos 6 itens, **só a afirmação (item 6, `agree_disagree_statement`) é
  específica da foto**. Os demais são fixos e vivem no runner
  (`PART4_BEFORE_VARIATIONS`, `PART4_DISCUSSION_1/2` em `pilot-interview-runner.tsx`):
  - item 1 — descrição (prompt fixo)
  - item 2 — hipótese de "antes", **4 variações**, uma sorteada por prova
    (determinística por `hashStringToSeed(prompt.id)`, e a foto já é sorteada por
    tentativa)
  - item 3 — hipótese de "depois" (prompt fixo, mesmo estágio `narrative`)
  - itens 4 e 5 — perguntas de discussão fixas (severidade/risco; consequências e
    prevenção)
  - item 6 — afirmação da foto, do banco
  `discussion_question` / `discussion_question_2` de `pilot_prompts` **não são mais
  lidas na Parte 4**.
- **`scripts/seed-pilot-prompts.mjs`**: `PART4_FIXED_WING` (13) + `PART4_ROTARY_WING`
  (10), cada um só com a afirmação; `upsertPart4` ganhou `order_index`; `deactivateStale`
  desativou a foto antiga do pneu (`part4-tire-blowout.jpg`) automaticamente.
- **Achado**: o guard `import.meta.url === \`file://${process.argv[1]}\`` dos scripts de
  upload quebra em path com espaço (o real é URL-encoded) — o `main()` nunca rodava.
  Trocado por `pathToFileURL(process.argv[1]).href` em `upload-pilot-part4-images.mjs` e
  `upload-pilot-part2-part4-images.mjs`.
- 23 imagens no bucket, 23 linhas ativas (`13` + `10`), `tsc`/`lint`/`test` (42/42) e
  `build` limpos. Sem migration.

## Atualização (2026-08-28) — Áudios de rádio da Parte 2 e Parte 3 (SDEA)

Antes, todo áudio da entrevista do piloto era TTS em runtime (`generateSpeech` →
`tts-1`/`alloy`), uma voz só, sem efeito. O documento (pág. 7) pede que as falas do
controlador na Parte 2 e as gravações da Parte 3 sejam **sintéticas, com voz distinta e
efeito de rádio/ruído**; a pág. 5 pede que cada gravação da Parte 3 **toque 2×**.

- **Pipeline de pré-geração** (`scripts/generate-pilot-prompt-audio.mjs`, idempotente,
  `--force` regenera): para cada `pilot_prompts` ativo das Partes 2/3 → TTS OpenAI
  (`gpt-4o-mini-tts`, voz `onyx` p/ ATC, `echo` p/ piloto) → `ffmpeg` aplica rádio VHF
  (passa-banda 300–3400 Hz + compressão + estática pink ~-20 dB + clique de PTT) → mp3
  no bucket público **`pilot-prompt-audio`** → grava a URL em `pilot_prompts`.
  Parte 3: parseia `prompt_text` (`Pilot:`/`ATC:`) com `src/lib/atc-dialogue.ts` e
  concatena as falas com 250 ms de silêncio.
- **Schema** (`20260828000000_pilot_prompt_audio_urls.sql`): 3 colunas nullable em
  `pilot_prompts` — `atc_audio_url`, `atc_followup_audio_url`, `dialogue_audio_url`.
  Nullable de propósito: URL `null` → runner cai no TTS em runtime, conteúdo sem áudio
  gerado continua funcionando.
- **Runner** (`src/components/sdea/pilot-interview-runner.tsx`): `Step` ganhou
  `audioUrl`; quando presente toca o arquivo direto (sem `generateSpeech`). A narração
  do examinador continua TTS `alloy`, sem efeito. O step "auto" da gravação da Parte 3
  toca 2× (pausa de 1,5 s entre as duas). "Repetir pergunta" já opera sobre o `<audio>`.
- **Ordem de execução**: `seed-pilot-prompts.mjs` → `generate-pilot-prompt-audio.mjs`
  (mesma relação seed↔upload que já existe com as imagens da Parte 2/4).
- O script também grava uma **cópia local** de cada mp3 em `Material Didático/Pilots/
  Material Didático/{Fixed-wing,Rotary-wing}/Audios/` (`part2-01-atc.mp3` etc.); rodar
  sem `--force` quando a URL já existe só rebaixa o arquivo do Storage pra atualizar a
  cópia local.
- **Reorganização do material didático (2026-08-28)**: a Sabrina moveu tudo pra
  `Material Didático/{ATC,Pilots}/…`. Paths atualizados em `scripts/add-phase1-audios-batch2.mjs`,
  `scripts/replace-phase1-audios.mjs` (→ `ATC/Phase 1 - Audios`),
  `scripts/add-phase2-part4-images-batch2.mjs` (→ `ATC/Phase 2`) e
  `scripts/upload-pilot-part2-part4-images.mjs` (→ `Pilots/Material Didático`; **os 3
  arquivos de imagem que ele referenciava não existem mais nesse diretório novo — o
  pool de imagens do piloto foi trocado por um conjunto maior, refazer isso é tarefa à
  parte**).
- **Escala futura**: quando o pool crescer pras 10 provas (200 áudios Parte 2 / 60
  Parte 3), o script cobre automaticamente — é só rodar de novo.
- `tsc`/`lint`/`test` (42/42, +5 do parser) e `build` limpos.
- **[2026-08-28] Revertido**: os 65 áudios gerados aqui foram apagados depois (Storage +
  colunas de URL zeradas) — a Sabrina vai subir os TTS manualmente. Ver a atualização de
  2026-08-28 no topo. Toda a infra descrita acima continua válida.

## Atualização (2026-08-27) — Demonstrativo por parte no modo Official

Regra da pág. 8 do "Modelo SDEA com anotações": no modo `official` o relatório geral
fica em português, mas o **demonstrativo de cada resposta** (pergunta + resposta +
feedback curto) fica **em inglês**. Antes o `official` não gerava `ai_feedback` nenhum.

- `advanceState` (EPLIS `phase2/actions.ts` e SDEA `pilot/actions.ts`), no bloco de
  finalização: depois de salvar `simulation_feedbacks` e concluir a tentativa, se o
  modo é `official`, gera `generateResponseFeedback`/`generatePilotResponseFeedback`
  para cada resposta **em paralelo** (`Promise.all`) e grava em `ai_feedback`. Cada
  item tem `try/catch` — falha/timeout de um não derruba a finalização (o resultado
  principal já está persistido nesse ponto).
- Nada muda no fluxo da prova `official`: a `submit-response` route continua NÃO
  chamando IA por resposta (sem latência entre perguntas, `feedback: null` pro
  cliente). O feedback só existe depois, na tela de resultado.
- Telas de resultado (`/fase2/resultado`, `/sdea/resultado`) já renderizavam
  `ai_feedback` quando presente — só passam a ter conteúdo no `official` agora. Rótulo
  "Sua resposta" → "Answer" (demonstrativo em inglês).
- `tsc`/`lint`/`test` (37/37) e `build` limpos. Sem migration.
- **Fim dos pendentes desta leva do documento** (escala 4 faixas, botão repeat,
  não-rigidez Ótimo/Excelente, demonstrativo Official). Segue aberto o pool de
  conteúdo amplo e as fotos de helicóptero.

## Atualização (2026-08-27) — Botão "repetir pergunta" pesa no relatório

Regra da pág. 8 do "Modelo SDEA com anotações", aplicada a EPLIS **e** SDEA (Partes 2/4
do controlador e todas as 4 do piloto):

- **UI** (`InterviewRunner` e `PilotInterviewRunner`, modo `official`): o botão
  "Repetir pergunta" não bloqueia mais depois do 1º uso — fica verde no 1º clique e
  âmbar a partir daí, sempre clicável, com um aviso de que repetições extras podem
  reduzir o critério Compreensão. No `practice` o botão já era ilimitado; ganhou o mesmo
  aviso.
- **Relatório final**: `repetition_count` (já persistido por resposta) agora é lido em
  `generateFinalReport`/`generatePilotFinalReport` e marcado no corpo enviado ao modelo
  (`[pediu repetição Nx neste item]`). Regra no prompt (`repetitionRuleFor(mode)` em
  `src/lib/ai/anthropic.ts`):
  - `practice`: **qualquer** repetição conta — só no critério Compreensão — e é
    mencionada no `general_feedback`.
  - `official`: só quando um item teve **mais de uma** repetição.
  - Nos dois: nunca afeta os outros 5 critérios nem bloqueia; e **não rebaixa
    Compreensão abaixo de "good"** se a compreensão demonstrada nas respostas foi de
    nível Ótimo/Excelente (essa última parte também cobre o item "não ser rígido entre
    Ótimo e Excelente" do documento).
- `tsc`/`lint`/`test` (37/37, +3) e `build` limpos.
## Atualização (2026-08-27) — Escala de proficiência passa de 3 para 4 faixas

O documento "Modelo SDEA com anotações" (pág. 9) fechou a escala de avaliação em **4
faixas** da Escala OACI, retroativa também ao EPLIS:

| enum (`public.proficiency_level`) | rótulo | equivalência OACI |
|---|---|---|
| `weak` | Fraco | N1, N2, N3 |
| `moderate` | Moderado | N4 |
| `good` | **Ótimo** (era "Bom") | N5 |
| `excellent` | Excelente (**novo**) | N6 |

- Migration `20260827000000_add_excellent_proficiency_level.sql`: só um
  `alter type ... add value 'excellent' after 'good'`. Linhas históricas com `good`
  passam a aparecer como "Ótimo" — sem migração de dados (decisão: aceitável pra um
  tracker de progresso MVP).
- `ProficiencyLevel` (`src/types/database.ts`) ganhou `"excellent"` + helpers
  `PROFICIENCY_ORDER` e `lowestProficiency`. Rótulos/cores/eixo dos gráficos
  centralizados em `src/lib/proficiency-display.ts` (as 4 telas — 2 de resultado, 2 de
  desempenho — e os 2 componentes de gráfico deixaram de duplicar o mapa).
- Prompts de relatório final (EPLIS e SDEA) descrevem as 4 faixas via
  `PROFICIENCY_SCALE_PROMPT` compartilhado. A regra "overall = menor dos 6" agora é
  **garantida no código** (`normalizeFinalReport` em `src/lib/ai/anthropic.ts`), não só
  pedida no prompt — também saneia faixa desconhecida pra `moderate`.
- `vitest.setup.ts` passou a guardar o stub de mídia com `typeof window` pra permitir
  testes puros em `// @vitest-environment node` (`src/lib/ai/final-report.test.ts`).
- `npx tsc --noEmit`, `npm run lint`, `npm run test` (34/34, 4 novos) e `npm run build`
  limpos. **Migration ainda não aplicada em produção** / não commitado.
- Os outros pontos desta leva do documento (botão "repeat question", não-rigidez
  Ótimo/Excelente, demonstrativo Official) foram feitos logo em seguida — ver as
  seções acima com a mesma data.

## Atualização (2026-08-24) — Trilha do piloto (SDEA), implementada do zero

Nova trilha completa pro exame de pilotos, paralela ao EPLIS do controlador: **Santos
Dumont English Assessment (SDEA)**, exame da ANAC (Anexo 1 OACI + RBAC 61), mesma Escala
OACI de 6 critérios já usada no EPLIS. Levantamento feito a partir de documentos oficiais
da ANAC (Instruções ao candidato, Manual do candidato, Escala de níveis, lista de palavras
difíceis) + **1 prova-modelo oficial completa** (`Modelo SDEA.pdf`, avião/`fixed_wing`) +
**4 provas reais completas de helicóptero** (`Test 1-4 helicopter ICAO 2024`,
`rotary_wing`), todas trazidas pela Sabrina. Padrão real da prova, confirmado nos 5
documentos:
- **Parte 1** — 3 perguntas abertas de carreira/aviação (pool compartilhado entre
  perfis, agnóstico a tipo de aeronave).
- **Parte 2** — 5 situações de role-play como piloto (call sign fixo `LEVEL 6`), cada
  uma com **4 sub-turnos**: readback de uma instrução do controlador, reação a um
  imprevisto narrado (às vezes com foto), confirmação/negação de um detalhe, e um relato
  em discurso indireto do que o controlador disse — mecanicamente bem mais rico que a
  Parte 2 do controlador (situação + sugestão).
- **Parte 3** — 3 situações inesperadas (diálogo piloto/controlador narrado, o candidato
  só escuta): relato em discurso indireto + 1 pergunta técnica por item, com um turno
  extra de comparação entre as 3 situações no final (não existe equivalente no
  controlador).
- **Parte 4** — 1 foto: descrição, hipótese de antes/depois, 2 perguntas de discussão, e
  1 afirmação pra concordar/discordar.

**Decisões fechadas com a Sabrina antes de implementar:** construir os dois perfis
(`fixed_wing` e `rotary_wing`) desde já; Parte 2 como fluxo de state machine dedicado, não
forçado na mecânica situation_check/suggestion do controlador; arquitetura completa
primeiro, ampliação do pool de conteúdo pra "dezenas por parte" fica pra uma rodada
separada depois (igual ao histórico do EPLIS); rota `/sdea`; dashboard/nav passam a ser
condicionais por `role` (piloto vê só "Simulado SDEA" + Desempenho, controlador continua
vendo Fase 1/Fase 2/Desempenho).

**Schema novo** (`20260824000000_add_pilot_interview_phase.sql`,
`20260824010000_pilot_track_schema.sql`, `20260824020000_pilot_recordings_storage_policies.sql`):
- `phase` ganhou o valor `pilot_interview` — `simulation_attempts` e `simulation_feedbacks`
  já eram genéricas por `phase` (nenhuma coluna específica de controlador), então são
  **100% reaproveitadas sem alteração**, só um novo valor de `phase`.
- Tabelas novas `pilot_prompts` (larga, mesma convenção de campos nullable-por-parte de
  `phase2_prompts` — ver `docs/database-schema.md` seção 9 pro detalhamento completo de
  cada coluna) e `pilot_responses` (espelha `phase2_responses`, com enum próprio
  `pilot_response_stage` cobrindo os 13 estágios das 4 partes). GRANT pra `authenticated`
  **e** `service_role` já saíram certos de primeira no mesmo arquivo da migration —
  lição aprendida do histórico da Fase 2 (que precisou de 2 rodadas separadas).
- Bucket `pilot-recordings` (gravações) e `pilot-images` (fotos da Parte 2/4), com as
  mesmas policies de INSERT+SELECT escopadas por dono de tentativa (a policy de SELECT já
  saiu junto — outra lição já aprendida, o `INSERT ... RETURNING` interno da API de
  Storage exige as duas).

**Reaproveitamento do código existente** (sem tocar no comportamento do controlador,
testes da Fase 2 continuam 16/16 verdes): PRNG determinístico (`mulberry32`/
`seededShuffle`/`hashStringToSeed`) extraído pra `src/lib/prng.ts`; checagem de posse de
tentativa (`assertOwnAttemptInProgress`) e contagem de tentativas do dia
(`countAttemptsToday`) extraídas e generalizadas por `phase` em
`src/lib/simulations/attempt-guards.ts`; base do SDK Anthropic (`client`/`MODEL_VERSION`/
`extractText`) extraída pra `src/lib/ai/anthropic-client.ts`. O motor de gravação/TTS/
timers do `InterviewRunner` (áudio `<audio>` persistente, detecção de autoplay bloqueado,
MediaRecorder, diferenças `practice`/`official`) foi **reaproveitado por releitura direta**
num componente novo (`PilotInterviewRunner`), não generalizado — a Parte 2 do piloto tem
sub-estágios genuinamente diferentes e o risco de mexer no componente já testado do
controlador não valia a pena pra 2 consumidores.

**Correção de IA** (`src/lib/ai/pilot-track.ts`, `generatePilotResponseFeedback` +
`generatePilotFinalReport`): mesma regra inegociável de nota final = menor dos 6 critérios,
nunca média. Achado importante dos documentos oficiais: a produção oral do SDEA **não é
julgada pela precisão técnica/operacional** (fraseologia incluída) — mesmo o readback da
Parte 2 é avaliado só como inglês falado (clareza, estrutura), nunca por fraseologia
correta, diferente do que se poderia supor de um exame tão focado em rádio.

**Conteúdo inicial** (`scripts/seed-pilot-prompts.mjs`, UPSERT/idempotente): as 5 provas
reais carregadas geram 15 perguntas de Parte 1, 5+3+1 (Parte2+Parte3+Parte4) pra
`fixed_wing` e 20+12 (Parte2+Parte3) pra `rotary_wing` — suficiente pra 1 tentativa
completa por perfil sem repetição, não pro pool amplo (decisão já registrada acima).
**Achado real durante a sessão**: as fotos da Parte 2/4 precisaram ser extraídas dos PDFs
(`pdfimages`/`pdftoppm`/ImageMagick instalados via Homebrew nesta máquina, mesmo padrão de
instalar ferramenta local sob demanda já usado antes com yt-dlp/mkcert) — uma das 3 fotos
candidatas pra Parte 4 de helicóptero tinha marca d'água visível da 123RF (banco de imagens
pago) e as outras 2 eram fotos profissionais sem licença clara. **Decisão: usar só as 2
fotos que vieram do documento oficial da ANAC** (radar meteorológico e bird strike, Parte
2; pneu estourado, Parte 4) — a Parte 4 de `rotary_wing` ficou **sem conteúdo** nesta
rodada (mesmo tratamento gracioso já existente de "conteúdo insuficiente pro perfil"),
até existirem fotos próprias/licenciadas de helicóptero.

**Validado ponta a ponta com Playwright** (usuários de teste descartáveis criados via
`scripts/dev-create-pilot-test-user.mjs`, novo utilitário reutilizável, apagados ao final):
login como piloto `fixed_wing` → dashboard mostra só "Simulado SDEA" + Desempenho → nav
sem Fase 1/Fase 2 → `/fase1` e `/fase2` redirecionam pro dashboard (guarda de rota por
`role` confirmada) → `/sdea` mostra os 2 modos → iniciar `practice` → entrevista renderiza
a Parte 1 com TTS real tocando e botão "Falar" habilitado → "Pausar simulado" funciona e
volta pro card "Practice — pausado" → `/desempenho` mostra só o card SDEA. Piloto
`rotary_wing` iniciando um simulado recebeu corretamente a mensagem de conteúdo
insuficiente (Parte 4 vazia). Nenhum erro de console/página durante o teste.

`npx tsc --noEmit`, `npm run lint`, `npm run test` (30/30 — 14 testes novos da trilha do
piloto) e `npm run build` (produção, todas as rotas `/sdea/*` registradas) conferidos
limpos antes de considerar a rodada pronta.

**Ainda em aberto** (fora do escopo desta rodada, por decisão): ampliar o pool de conteúdo
pra "dezenas por parte" nos dois perfis (script de geração + arquivo de revisão pra
Sabrina aprovar, igual ao histórico do EPLIS); ~~conseguir fotos de helicóptero
próprias/licenciadas pra Parte 4 de `rotary_wing`~~ (resolvido em 2026-08-28, ver seção
"Pool de fotos da Parte 4" acima); testes automatizados de
`generateResponseFeedback`/`generateFinalReport` (mesma lacuna já registrada pro
controlador); nenhum teste manual real com áudio/microfone ainda (Playwright headless não
grava áudio de verdade — só validou o fluxo até o botão "Falar" ficar disponível).

---

## Atualização (2026-08-22) — teste ponta a ponta pelo celular (Fase 1 e Fase 2)

Sabrina testou o app pelo celular, no mesmo wifi do Mac, acessando `next dev` pelo IP da
rede local (ex.: `http://192.168.15.2:3000`) em vez de `localhost`. Dois achados reais,
os dois já corrigidos:

- **Select controlado parava de reagir a `onChange` só quando acessado por IP de rede**
  (reproduzido em `/cadastro`: trocar a profissão para "Controlador de tráfego aéreo" não
  atualizava as opções de perfil operacional nem o nome do exame — mas funcionava normal
  em `localhost` e em produção). Causa: o Next dev bloqueia por padrão o WebSocket de HMR
  quando a origem não é `localhost` ("Blocked cross-origin request to Next.js dev resource
  ... by \"<ip>\""), o que quebra a hidratação do React na página inteira — não é um bug
  de UI isolado, qualquer interatividade client-side para de funcionar. Corrigido
  adicionando `allowedDevOrigins` em `next.config.ts` com o IP da máquina de teste. **Esse
  IP muda entre redes** (`ipconfig getifaddr en0` pra descobrir de novo) — se testar de
  outro wifi, precisa atualizar essa lista antes.
- **Gravação de áudio na Fase 2 falhava silenciosamente pelo celular** (Fase 1, que só
  toca áudio, funcionou normal). Causa: `getUserMedia` só funciona em contexto seguro
  (HTTPS), exceto em `localhost` — por IP de rede em HTTP puro o navegador nem expõe a
  API, sem pedir permissão nenhuma, e `startRecording()` em
  `src/components/fase2/interview-runner.tsx` não tinha `try/catch` nenhum ao redor do
  `await getUserMedia(...)`, então a falha virava uma unhandled promise rejection e a tela
  ficava travada sem nenhuma mensagem. Duas correções: (1) `startRecording` agora captura
  o erro (`navigator.mediaDevices` ausente, ou rejeição da permissão) e mostra um banner
  vermelho explicando o motivo, em vez de falhar em silêncio; (2) para testar de verdade
  pelo celular, é preciso subir o dev server em HTTPS — gerado certificado autoassinado
  local com `mkcert` (baixado automaticamente pelo `next dev --experimental-https` na
  primeira tentativa, em `~/Library/Caches/mkcert/`) **sem** rodar `mkcert -install` (que
  exige senha de admin interativa e falha em execução não interativa); em vez disso os
  certs foram gerados direto (`mkcert -key-file ... -cert-file ... localhost 127.0.0.1
  ::1 <ip-da-rede>`, salvos em `certificates/`, já no `.gitignore`) e o servidor subido com
  `next dev -H 0.0.0.0 --experimental-https --experimental-https-key
  ./certificates/localhost-key.pem --experimental-https-cert ./certificates/localhost.pem`.
  Certificado não é confiável pro sistema (não rodou `-install`), então o navegador do
  celular mostra aviso de conexão não seguro ao abrir — precisa aceitar manualmente
  ("Avançado" → "Continuar mesmo assim") uma vez por sessão de teste; depois disso o
  microfone funciona normal.

Resultado: Fase 1 e Fase 2 validadas ponta a ponta pelo celular, incluindo gravação de
áudio real.

**Auditoria do Sentry (mesmo dia)**: revisado o feed de issues (`orion-flight-lab.sentry.io`,
projeto `eplis-plataform`) pra conferir se os erros capturados em testes anteriores já tinham
sido corrigidos no código. Achado real ainda não corrigido: `goToNextItem` em
`src/components/fase2/interview-runner.tsx` não tinha a mesma trava de concorrência que o
`Phase1Runner` já tinha (`advancingRef`, do commit `2d77e41`) — o timer automático de 3s do
step `"auto"` e o clique em "Continuar" podiam chamar `advanceState()` quase ao mesmo tempo no
último step de um item, e a segunda chamada encontrava a tentativa já avançada/concluída pela
primeira, lançando "Tentativa inválida ou já finalizada." como unhandled rejection (capturado
pelo Sentry, `EPLIS-PLATAFORM-4`). Corrigido com a mesma trava (`advancingItemRef`). O
`TypeError: Load failed` em `/fase1` (1 evento só) não teve causa encontrada no código — não há
nenhum `fetch()` desprotegido na Fase 1; mais provável ter sido uma queda de wifi pontual
durante o teste pelo celular do que um bug real.

## Atualização (2026-08-19) — bugs reportados pela Sabrina em teste real da Fase 1/perfil

Teste manual real da Sabrina achou dois bugs, mais um pedido de UI:

- **Race condition em `Phase1Runner`** (`src/components/fase1/phase1-runner.tsx`):
  `advance()` podia ser disparada tanto pelo timer de resposta (`onExpire`, 60s) quanto
  pelo clique do botão "Confirmar e avançar"/"Finalizar simulado" quase ao mesmo tempo —
  nada travava execuções concorrentes durante o `startTransition`. No meio do simulado
  isso fazia `setIndex(i => i + 1)` rodar duas vezes (pulava uma questão sem exibir); na
  última questão fazia `finishAttempt` rodar duas vezes — a primeira salvava o resultado
  (aparecia em Desempenho), a segunda via a tentativa já `completed` e lançava exceção,
  virando o 500 ("Error in Server Components render") relatado ao finalizar. Corrigido
  com uma trava (`advancingRef`) que ignora chamadas de `advance()` enquanto uma já está
  em andamento.
- **`updateProfile` sem `revalidatePath`** (`src/lib/auth/actions.ts`): o `update` no
  Supabase funcionava, mas a tela `/perfil` não era re-renderizada nem tinha cache
  invalidado (comportamento novo do Next 16 pra Server Actions — ver bullet no
  `CLAUDE.md`), então nome/profissão/perfil operacional voltavam pro valor antigo (ou pro
  default `pilot`/`null`, se o cache nunca tivesse sido invalidado desde o cadastro) ao
  navegar pra fora de `/perfil` e voltar. Corrigido com `revalidatePath("/perfil")` no
  fim da action.
- **Página de resultado da Fase 1 quebrando com `null`** (
  `src/app/fase1/resultado/[attemptId]/page.tsx`): efeito colateral do fix de conteúdo
  abaixo — se uma pergunta referenciada por uma resposta real for desativada, a RLS de
  `phase1_questions` (`is_active = true`) faz o join retornar `null` pra aquela linha em
  vez de barrar a query. Sem tratar, a página quebrava lendo campo de objeto `null`.
  Blindado: renderiza um aviso "Questão não disponível mais para exibição" no lugar.
- **Correção de conteúdo v02a/v02c (Cair 217, Fase 1)**: a pergunta certa ("O que a torre
  informa à Cair 217 antes do pouso?") estava linkada ao áudio errado (v02c, que tinha
  conteúdo de menor qualidade). Relinkada pro áudio v02a; a pergunta antiga do v02a ("Por
  que a Cair 217 solicitou retornar a Boston?") foi **desativada, não apagada** — havia
  resposta real (tentativa `059e1435-...`, a mesma do relato do bug acima) referenciando
  ela via FK sem `ON DELETE CASCADE`. Arquivo `v02c.mp3` removido do bucket
  `phase1-audios`; a linha `phase1_audios` de v02c foi desativada (sem pergunta ativa e
  sem arquivo, ficaria órfã se continuasse ativa).
- **Player de áudio da Fase 1 redesenhado** (mesmo arquivo do primeiro item): botão
  "Ouvir áudio agora" (dentro do card, canto do texto de tempo) virou um player circular
  centralizado logo abaixo de "Questão X de Y", reaproveitado nas três fases (tocar na
  leitura, indicador visual tocando, repetir na hora de responder).

Os quatro pontos de código testados com `tsc --noEmit` + `eslint` limpos, e os dois de UI
validados ponta a ponta num browser headless (Playwright via `npx`, já que não há
`chromium-cli` nesta máquina) com um usuário descartável criado e depois apagado via API
admin do Supabase — login real, edição de perfil + navegação pra fora e volta, início de
simulado da Fase 1 com screenshot da tela.

## Atualização (2026-08-18) — conteúdo real ampliado (Fase 1 e Parte 2/4 da Fase 2)

Sessão focada em ampliar o conteúdo real (não mexeu em código do app, só em dados —
`npx tsc --noEmit` e `npm run lint` conferidos limpos no fim). Três scripts novos em
`scripts/`, todos **aditivos** (nunca apagam o que já existe) e idempotentes via UPSERT,
seguindo a convenção do `CLAUDE.md`:

- **`add-phase1-audios-batch2.mjs`**: Fase 1 foi de 10 para **43 áudios / 60 perguntas**.
  Os 33 áudios novos vieram de cortes de vídeos reais de comunicação ATC do YouTube — a
  Sabrina passou os links, um pipeline local (`yt-dlp` + `ffmpeg-static`, instalados via
  `pip3 install --user` / `npm install --no-save`, nenhum dos dois está no
  `package.json`) baixou o áudio e cortou em trechos de 10-45s (spec oficial de duração
  do `phase1_audios`), e o Whisper (`OPENAI_API_KEY`) gerou transcrição com timestamps
  pra achar os pontos de corte certos. A Sabrina revisou manualmente todos os cortes,
  corrigiu as transcrições (arquivos em `Material Didático/ATC/Phase 1 - Audios/
  transcrições/`, fora do repo) e descartou 7 trechos de baixa qualidade. Áudios mais
  longos/ricos ganharam 2 perguntas em vez de 1 (17 dos 33 têm 2). Pergunta/opções em
  português, sem gírias em inglês entre parênteses/aspas explicativas (achado da
  revisão: várias perguntas — inclusive 5 dos 10 áudios originais — tinham glosses tipo
  "(hold short)" que foram removidos; mantido só quando é citação literal do que foi
  dito no rádio, ex. `"stop"`).
  **Achado de implementação**: o casamento UPSERT de `phase1_questions` inicialmente
  usava o texto do `prompt` como chave natural — quebrou assim que o texto de uma
  pergunta foi editado entre rodadas (virou um insert novo em vez de update, duplicando
  a pergunta). Corrigido pra `delete` + reinsert escopado por `audio_id` (seguro porque
  `phase1_answers` está zerado — sem nenhuma resposta real de usuário referenciando
  essas perguntas ainda; confirmado antes de mudar a estratégia).
- **`add-phase2-part4-images-batch2.mjs`**: Parte 4 foi de 1 imagem fixa por perfil pra
  um pool real — 21 (TWR), 22 (APP), 22 (ACC), 21 (COpM), a partir de fotos fornecidas
  pela Sabrina em `Material Didático/ATC/Phase 2/<PERFIL>/`. Confirmado que o
  sorteio já filtra só pelo próprio perfil (`profileFilter = [profile, 'general']` em
  `src/services/simulations/phase2/queries.ts`, e não sobrou nenhuma imagem `general`
  ativa) — não precisou mudar código, só os dados já resolviam.
- **`add-phase2-part2-situations-batch2.mjs`** e **`batch3.mjs`**: Parte 2 foi de 10
  para **30 situações por perfil** (120 no total), em duas levas de 10 pra garantir
  variedade temática entre si (evitar repetição/decoreba). Índice `order_index` 11-20 e
  21-30 dentro de cada perfil, sem mexer nas 10 originais.

Dois arquivos de revisão foram gerados (fora do repo, em `Material Didático/`) pra
Sabrina conferir antes de aprovar — `Fase 1 - Perguntas (revisao).md` (áudio +
transcrição + pergunta(s) de cada um dos 43 itens) e `Fase 2 - Situacoes Parte 2
(revisao).md` (as 120 situações, indexadas por perfil). **Ambos já foram revisados e
aprovados pela Sabrina** nesta sessão — conteúdo é considerado fechado.

## Atualização (2026-08-19) — conteúdo real da Fase 2, Partes 1 e 3

Partes 1 e 3 da entrevista simulada deixaram de usar o placeholder de 6 perguntas cada
(`scripts/seed-phase2-prompts.mjs`) e passaram a ter pool real, ambas continuando com
`operational_profile = 'general'` (não segmentadas por perfil, como já era o caso e como
pedido pela Sabrina — só as Partes 2 e 4 são por perfil):

- **Parte 1** (4 perguntas abertas sobre dia a dia profissional e carreira do
  examinando): pool ampliado para **120 perguntas**, cobrindo papel atual, motivação de
  carreira, rotina, comunicação/trabalho em equipe, desafios, orgulho profissional,
  cultura de trabalho, tecnologia, equilíbrio vida-trabalho, planos futuros, experiências
  marcantes e conselhos. Script `scripts/seed-phase2-part1-pool.mjs` (UPSERT por
  `prompt_text`, desativa o que sair da lista, nunca apaga).
- **Parte 3** (4 perguntas abertas sobre controle de tráfego aéreo/aviação em geral,
  ordenadas por nível de dificuldade — as 2 primeiras concretas sobre o trabalho, as 2
  últimas abstratas): pool ampliado para **120 perguntas (60 concretas + 60 abstratas)**.
  Script `scripts/seed-phase2-part3-pool.mjs`.
  **Achado real**: a regra de "2 concretas + 2 abstratas nessa ordem" já estava
  documentada em `docs/database-schema.md` (tabela `phase2_prompts`) desde antes, mas
  **nunca tinha sido implementada no código** — `getSequenceForAttempt` em
  `src/services/simulations/phase2/queries.ts` fazia sorteio uniforme das 4 perguntas da
  Parte 3, sem distinguir nível algum. Corrigido nesta rodada: a coluna `order_index`
  (até então só usada pela Parte 2, como posição de sequência) foi reaproveitada pela
  Parte 3 como **marcador de nível** (`1` = concreta, `2` = abstrata, não posição
  literal) — o sorteio agora escolhe 2 do pool concreto e 2 do pool abstrato,
  concatenando concretas antes de abstratas, mantendo o PRNG determinístico por
  `attemptId` (consumo sequencial do rng preservado).

`npx tsc --noEmit` e `npm run lint` conferidos limpos. Conteúdo ainda não testado
manualmente ponta a ponta pela Sabrina nesta rodada (avaliar se vale rodar um teste
rápido da Parte 1/3 antes de considerar fechado).

## Atualização (2026-08-19) — observabilidade: integração com Sentry (Fase 7)

Trazido do padrão já validado no outro projeto da Sabrina (`orion-flight-lab`, ver
`CLAUDE.md` de lá — integração real e testada com Sentry + filtro de PII), adaptado pro
EPLIS Trainer. Instalado `@sentry/nextjs` e criados:
- `src/instrumentation.ts` (hook `register`/`onRequestError`, chamado automaticamente
  pelo Next.js) e `src/instrumentation-client.ts` (inicialização no browser) — seguem a
  mesma convenção de `src/proxy.ts` (arquivo de convenção do Next.js precisa ficar em
  `src/` porque o app mora em `src/app/`).
- `src/sentry.server.config.ts` e `src/sentry.edge.config.ts` — inicializam o SDK por
  runtime (`tracesSampleRate` menor em produção).
- `src/app/global-error.tsx` — captura qualquer erro não tratado que escapa da árvore de
  componentes (`Sentry.captureException`) e mostra uma tela de erro genérica com botão
  "Tentar novamente" em vez de tela branca.
- `src/lib/observability/sentry-scrub.ts` — hook `beforeSend` que filtra recursivamente
  campos sensíveis (`name`, `email`, `transcript` — a transcrição de voz da Fase 2 pode
  conter dado pessoal dito pelo candidato — `password`, tokens) de `request.data`,
  `query_string`, `headers`, `extra` e `breadcrumbs` antes do evento sair da aplicação.
  `sendDefaultPii: false` explícito nos 4 pontos de `Sentry.init`.
- `next.config.ts` — `withSentryConfig(...)`, com upload de source maps desligado
  (`sourcemaps.disable`) enquanto `SENTRY_AUTH_TOKEN` não estiver configurado.

**Desligado com segurança por padrão**: todo `Sentry.init` só roda se `SENTRY_DSN` /
`NEXT_PUBLIC_SENTRY_DSN` estiver preenchido e não for o DSN de exemplo (`isPlaceholderDsn`)
— sem essas vars (caso de hoje), o SDK simplesmente não inicializa, sem quebrar nada.
Confirmado: `npx tsc --noEmit`, `npm run lint`, `npm run build` (produção) e `npm run dev`
todos limpos com Sentry desligado.

**Ativado em produção (2026-08-19)**: `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` preenchidas em
`.env.local` e configuradas em produção via `npx vercel env add` — projeto Sentry
`eplis-trainer` criado na mesma organização/conta do `orion-flight-lab` (projeto separado,
região EU herdada da organização). Validado com um evento de smoke test real
(`Sentry.captureException` + `flush`, confirmado antes de configurar em produção).
`SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` continuam sem configurar — opcionais, só
habilitam upload de source map no build, e podem ser adicionadas depois se fizer sentido.

## Atualização (2026-08-19) — telas de autenticação/perfil refeitas (spec da Sabrina)

A pedido da Sabrina (spec em imagem: tela de login, cadastro com confirmação por e-mail,
perfil do usuário), refeitas as três telas:

- **Login** (`src/app/login/page.tsx` + novo `src/components/auth/login-form.tsx`): ganhou
  link "Esqueceu a senha?" → `/esqueci-senha`. Página virou Server Component (lê
  `searchParams` pra mostrar aviso "Senha redefinida" vindo de `/redefinir-senha`) com o
  formulário extraído pro client component — evitou usar `useSearchParams` (exigiria
  Suspense boundary) ou `useEffect`+`setState` só pra isso (lint `react-hooks/set-state-in-effect`
  pegou a primeira tentativa).
- **Cadastro** (`src/app/cadastro/page.tsx`): campos reorganizados — "Nome completo",
  e-mail, "Profissão" (piloto/controlador), **"Perfil operacional atual" com opções
  condicionais por profissão** (controlador: TWR/APP/ACC/COpM; piloto: asa fixa/asa
  rotativa — `fixed_wing`/`rotary_wing`, dois valores **novos** no enum
  `operational_profile`, ver abaixo), linha informativa de "Exame" derivada da profissão
  (não é mais um campo escolhido — `EPLIS` pra controlador, `Santos Dumont English
  Assessment` pra piloto), senha com medidor de força visual + confirmação de senha.
  **Confirmação por e-mail já existia** (Supabase Auth, comportamento de sempre — não foi
  necessário criar nada novo pra "usuário recebe e-mail confirmando o cadastro").
- **Perfil** (`src/app/perfil/page.tsx` e componentes em `src/components/perfil/`): ganhou
  upload de foto (`AvatarUpload`, bucket `avatars`), perfil operacional com as mesmas
  opções condicionais por profissão do cadastro, e a troca de senha passou a **exigir a
  senha atual** antes de aceitar a nova (reautentica via `signInWithPassword` antes de
  chamar `updateUser` — o Supabase não exige isso por padrão com sessão válida, mas foi
  pedido explicitamente).
- **Novo**: `/esqueci-senha` (pede e-mail, sempre mostra a mesma mensagem genérica exista
  ou não a conta — evita enumeração) e `/redefinir-senha` (nova senha + confirmação).
  `/redefinir-senha` é **100% client-side** — chama `supabase.auth.updateUser` direto do
  browser Supabase client (não Server Action): o link de recuperação só estabelece sessão
  *no browser*, depois da página carregar; se a troca de senha fosse uma Server Action, a
  segunda requisição (o próprio submit) já chegaria com cookie de sessão, e o
  `src/proxy.ts` redirecionaria pra `/dashboard` antes de rodar a action (path público +
  usuário já "autenticado" = redirect, ver `PUBLIC_PATHS` em
  `src/lib/supabase/proxy.ts`) — achado real durante a implementação, não só teórico.
  `/esqueci-senha` e `/redefinir-senha` adicionadas a `PUBLIC_PATHS`.

**Schema**: migration `20260819000000_pilot_operational_profiles_and_avatar.sql` — enum
`operational_profile` ganhou `fixed_wing`/`rotary_wing` (só `ADD VALUE`, não precisou
recriar o tipo como em 2026-08-10 porque não removeu nada) e `users` ganhou coluna
`avatar_url`. Bucket de Storage `avatars` criado (`scripts/create-avatars-bucket.mjs`,
público, limite 5MB, só PNG/JPEG/WebP) com policies de INSERT/UPDATE/SELECT escopadas por
`{userId}/` no path (migration `20260819010000_avatars_storage_policies.sql`, mesmo
padrão de `phase2-recordings`, incluindo a policy de SELECT necessária por causa do
`INSERT ... RETURNING` interno da API de Storage).

**Importante — escopo real vs. capturado**: cadastro de piloto (`role = pilot`,
`operational_profile = fixed_wing/rotary_wing`, `target_exam = "Santos Dumont English
Assessment"`) já funciona e persiste corretamente, mas **não existe nenhum conteúdo ou
simulado pra essa trilha** — Fase 1 e Fase 2 continuam 100% sobre o exame EPLIS
(controlador). Um piloto que se cadastra hoje só tem os dados capturados; ao entrar no
app, vê as mesmas telas de Fase 1/Fase 2 do EPLIS (não faz sentido pra ele). Construir a
trilha própria do piloto é um projeto à parte, não coberto nesta rodada.

**Validado**: `npx tsc --noEmit`, `npm run lint`, `npm run build` (produção) limpos.
Testado via HTTP real contra o Supabase: criação de usuário `pilot`/`fixed_wing`/
`Santos Dumont English Assessment` confirmada na tabela `users` via trigger
`handle_new_user`; upload de avatar testado com usuário autenticado real (não
`service_role`) confirmando que as RLS policies do bucket `avatars` funcionam — dado de
teste limpo ao final (usuário e objeto de storage removidos).

**Recuperação de senha validada em produção (2026-08-19)**: Redirect URL
(`https://eplis-trainer.vercel.app/redefinir-senha`) confirmada na allowlist do Supabase
Auth; fluxo `/esqueci-senha` → e-mail real recebido → `/redefinir-senha` testado
ponta a ponta pela Sabrina e funcionou. Sem pendência.

## Atualização (2026-08-21) — Fase 7: responsividade do cabeçalho (`AppShell`)

Início da Fase 7 (responsividade/testes/deploy público). Testado em viewport mobile
(390px, via Playwright) todo o fluxo autenticado — dashboard, perfil, Fase 1 (início e
simulado em andamento), Fase 2 (início e entrevista), Desempenho (lista e resultado de
cada fase). Único problema real encontrado: o cabeçalho do `AppShell` (nav + perfil +
Sair) não tinha nenhum tratamento pra telas pequenas — os itens não quebravam de linha
nem encolhiam, causando overflow horizontal (o botão "Sair" ficava cortado fora da tela).
O restante do conteúdo (cards, formulários, gráficos de `/desempenho`, gravador de áudio
da Fase 2) já se adaptava bem sem ajuste.

**Corrigido**: navegação extraída para `src/components/layout/app-nav.tsx` (novo Client
Component) com um botão hambúrguer abaixo do breakpoint `md` (768px) que abre um menu
suspenso com os mesmos links, perfil e "Sair" empilhados verticalmente; acima de `md`
mantém o layout horizontal original, sem nenhuma mudança visual em desktop.
`src/components/layout/app-shell.tsx` ficou só delegando pro `AppNav`. Validado
visualmente com Playwright (mobile fechado/aberto + desktop 1280px) — `scrollWidth` do
documento igual à largura do viewport em mobile, confirmando ausência de overflow
horizontal. `npx tsc --noEmit`, `npm run lint` e `npm run build` (produção) limpos antes
do push.

## Atualização (2026-08-19) — pausar/retomar simulado (Fase 2, modo practice)

A pedido da Sabrina, depois de validar ponta a ponta o conteúdo ampliado da Fase 2
(Partes 1-4, testado com um botão temporário de "pular pergunta" removido ao final desta
sessão): o modo `practice` ganhou botão **"Pausar simulado"** dentro da entrevista
(`InterviewRunner`, visível só quando `mode === "practice"` — o `official` não pausa, fiel
ao exame real). Não precisou de coluna nova: a posição (`current_part`/
`current_item_index`) já era persistida a cada `advanceState`, então pausar é só liberar o
microfone (se uma gravação estiver em andamento) e navegar de volta pra `/fase2` — o
sub-estágio dentro do item atual se perde, mesmo comportamento já documentado de um reload
no meio de um item.

A tela `/fase2` agora detecta uma tentativa `practice` `in_progress` do usuário e mostra
"Practice — pausado" (com a posição onde parou) em vez do formulário de iniciar, com dois
botões: **"Continuar simulado"** (link direto pra `/fase2/entrevista/[id]`) e **"Abandonar
e começar novo"** (nova Server Action `abandonAndRestartAttempt` em
`src/services/simulations/phase2/actions.ts` — marca a tentativa antiga como `abandoned`,
valor que já existia no enum `attempt_status` mas nunca tinha sido usado no código até
agora, e cria uma nova). `SubmitButton` (`src/components/auth/submit-button.tsx`) ganhou
`className` opcional pra permitir o estilo âmbar desse botão sem quebrar os outros usos
(login, cadastro, perfil, Fase 1) que continuam com o estilo padrão.

`npx tsc --noEmit` e `npm run lint` limpos.

**Dois achados corrigidos ainda na mesma sessão, testados ponta a ponta pela Sabrina**:
- A tela `/fase2` fazia `.order("created_at", ...)` pra achar a tentativa `practice`
  pausada, mas a coluna real de `simulation_attempts` é `started_at` (não
  `created_at`) — a query falhava silenciosamente (Supabase retorna `data: null` em erro
  de coluna inexistente nesse client), então o card "Practice — pausado" nunca aparecia,
  mesmo com a tentativa pausada existindo no banco. Corrigido trocando pra `started_at`.
- Pausar exatamente na tela de feedback do **último estágio de um item** (resposta já
  enviada e gravada, aguardando clique em "Continuar") perdia esse avanço: a posição
  (`current_part`/`current_item_index`) só é persistida quando `advanceState` roda, e isso
  só acontecia ao clicar "Continuar" — pausar ali saía sem chamar `advanceState`, então ao
  retomar a tentativa voltava pro mesmo item já respondido. Corrigido em `pauseAttempt`
  (`InterviewRunner`): quando `recorderState === "feedback"` e é o último estágio do item
  (`stepIndex + 1 >= steps.length`), chama `advanceState` antes de navegar pra `/fase2`.

**Limpeza completa pra teste do zero (2026-08-19)**: a pedido da Sabrina, todos os
usuários (Auth + `public.users`, cascade em `simulation_attempts`/`phase1_answers`/
`phase2_responses`/`simulation_feedbacks` via FK `on delete cascade`) e os objetos de
Storage por usuário/tentativa (`avatars`, `phase2-recordings`) foram apagados —
**conteúdo preservado** (60 perguntas/43 áudios da Fase 1, 458 prompts da Fase 2 nas 4
partes). Novo utilitário reutilizável: `scripts/dev-wipe-all-users.mjs` (usa
`supabase.auth.admin.deleteUser` por usuário, que cascade-limpa o resto via FK, mais
`storage.remove()` nos dois buckets por usuário/tentativa).

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
transcrições reais (`Material Didático/ATC/Phase 1 - Audios/transcricoes_audios.pdf`, fora
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

## Fase 6 — Desempenho (histórico/relatórios de evolução) — implementada e fechada (2026-08-12)

Renomeado "Histórico" para **Desempenho** em toda a navegação (`AppShell`) e nas rotas —
`src/app/historico/page.tsx` (placeholder) removido, substituído por:
- `/desempenho` — landing com dois cards, Fase 1 e Fase 2.
- `/desempenho/fase1` — lista de simulados concluídos da Fase 1 (`Simulado <data> — <score>
  acertos`, badge APROVADO/REPROVADO) + gráfico de barras do percentual de acertos por
  simulado em ordem cronológica, com linha tracejada marcando o corte de aprovação. Clicar
  num simulado leva pro relatório existente (`/fase1/resultado/[id]`, reaproveitado sem
  rota nova).
- `/desempenho/fase2` — lista de simulados concluídos da Fase 2 (`Simulado <data> — NÍVEL
  <nível>`) + gráfico de linha do nível geral (Fraco/Moderado/Bom) por simulado em ordem
  cronológica. Clicar num simulado leva pro relatório existente
  (`/fase2/resultado/[id]`).

**Critério de aprovação da Fase 1 fechado com a Sabrina (2026-08-12): 70% de acertos**
entre as questões respondidas no simulado (não um número fixo — o pool ativo hoje só tem
10 questões das até 30 possíveis, então o total por tentativa varia). Centralizado em
`src/lib/phase1/scoring.ts` (`PASSING_RATIO`, `isApproved`) — reaproveitado tanto pela
tela de Desempenho quanto pelo relatório de resultado da Fase 1
(`/fase1/resultado/[id]`, que agora também mostra número de acertos/erros e o badge
APROVADO/REPROVADO, além das perguntas com resposta certa vs. resposta do usuário que já
existiam).

**Achado corrigido (hydration mismatch)**: a primeira versão dos dois gráficos usava
`toLocaleDateString("pt-BR")` pra formatar as datas nos eixos/labels — como o resultado
depende do fuso horário do runtime (servidor roda em UTC, navegador no fuso local), datas
perto da meia-noite podiam "virar" um dia diferente entre servidor e cliente, quebrando a
hidratação do React. Corrigido com um formatador determinístico baseado em campos UTC
(`src/lib/format-date.ts`), que dá o mesmo resultado nos dois lados independente do fuso.

**Segundo achado corrigido (hydration mismatch, causa real diferente)**: mesmo depois da
correção acima, o erro persistia — a causa de verdade era o uso de `<title>` como tooltip
nativo dentro dos elementos `<rect>`/`<circle>` do SVG. O React 19 trata qualquer tag
`<title>` como metadado de documento e tenta fazer hoisting automático pro `<head>`,
mesmo quando é um `<title>` de SVG usado como tooltip acessível — isso divergia a árvore
renderizada entre servidor e cliente. Corrigido removendo os `<title>` de dentro do SVG e
implementando tooltip via estado local do React (`useState` + `onMouseEnter`/`onFocus`),
renderizado como `<div>` HTML posicionado por porcentagem sobre o SVG — os dois
componentes de gráfico (`src/components/desempenho/fase1-progress-chart.tsx` e
`fase2-progress-chart.tsx`) viraram Client Components por causa disso. Lição: evitar
`<title>` como filho direto de elementos SVG em React 19 mesmo fora do contexto de
`<head>` — preferir tooltip controlado por estado desde o início.

Testado visualmente pela Sabrina com dados fictícios gerados por dois scripts de dev novos
— `scripts/dev-seed-fase1-demo.mjs` e `scripts/dev-seed-fase2-demo.mjs` (uso: `node
scripts/dev-seed-fase1-demo.mjs <email>` / `dev-seed-fase2-demo.mjs <email>`, criam 5
tentativas concluídas cada, com datas e resultados variados) — depois removidos do banco
com `scripts/dev-clean-test-data.mjs` antes de fechar a rodada, deixando o banco de
tentativas zerado (conteúdo e usuários preservados).

**Escopo desta rodada**: só o que foi pedido — lista + gráfico + link pro relatório já
existente de cada fase. Não inclui evolução por critério ICAO individual da Fase 2 ao
longo do tempo (hoje o gráfico mostra só o nível geral por simulado, não os 6 critérios
separados) nem exportação/impressão de relatório — não fizeram parte do pedido.

**Decisão fechada com a Sabrina (2026-08-19): não vai ter evolução por critério ICAO
individual.** Mostrar só o nível geral (Fraco/Moderado/Bom) é proposital, não uma
limitação a corrigir — evita que a tela pareça estar afirmando um nível OACI oficial
específico (ex.: "nível 5") pro aluno, quando o objetivo é só mostrar que ele está
evoluindo. Não reabrir sem motivo novo.

## Modo `official` da Fase 2 — implementado e fechado (2026-08-11)

Implementado o modo `official`, que já era especificado em `docs/state-machine.md` e
`docs/database-schema.md` mas nunca tinha código antes desta rodada: `startAttempt` agora recebe
`mode` (tela `/fase2` oferece os dois botões, practice e official) e `InterviewRunner`
(`src/components/fase2/interview-runner.tsx`) se comporta diferente conforme o modo. Testado ponta
a ponta pela Sabrina, com 2 rodadas de ajuste fino pra ficar fiel ao exame real (histórico de
achados abaixo). Comportamento final do `official`:
- **Zero feedback durante a entrevista**: `src/app/api/phase2/submit-response/route.ts` pula a
  chamada de `generateResponseFeedback` inteiramente quando `attempt.mode === "official"` (evita
  custo/latência de uma chamada de IA que nunca seria mostrada); `ai_feedback` fica `null` nessas
  respostas, e a tela de resultado já lida bem com isso (só não renderiza a linha "Feedback:").
- **Sem botão "Falar"**: a gravação começa sozinha 5s depois da IA terminar de falar a pergunta —
  cronômetro visível (`ResponseStartTimer`, mesmo padrão do `SilentTimer` já existente),
  `onExpire` chama `startRecording` direto. Só existe no `official`; `practice` mantém o botão
  "Falar" manual, sem esse timer.
- **Cronômetro pausa durante "Repetir pergunta"**: `ResponseStartTimer` só renderiza enquanto
  `!speaking` (mesmo estado global que já controla o indicador "IA está falando 🔊", atualizado
  pelos eventos `playing`/`ended`/`pause` do `<audio>` compartilhado) — desmonta (parando o
  `setTimeout` interno) enquanto a pergunta repetida toca, e remonta com 5s cheios quando termina.
  Sem isso, o cronômetro rodava em paralelo à repetição e podia disparar a gravação no meio dela.
- **Limite de repetição**: botão "Repetir pergunta" desabilita após 1 uso em `official` (sem
  limite no `practice`, como já era).
- **Sem botão "Recomeçar"**: uma vez que a gravação começou no `official`, só dá pra
  pausar/continuar ou concluir e enviar — sem reiniciar a resposta do zero (sem segunda chance,
  fiel ao exame real). `practice` mantém o botão.
- **Relatório final mais rico**: a pedido da Sabrina, o `official` precisa compensar a ausência de
  feedback contínuo — `generateFinalReport` (`src/lib/ai/anthropic.ts`) aceita `mode` e, só quando
  `official`, anexa um bloco de instrução extra (`OFFICIAL_MODE_ADDENDUM`) pedindo que o
  `general_feedback` também destaque as melhores respostas dadas (com exemplo concreto) e os
  erros/padrões mais recorrentes ao longo das 4 partes, sem precisar ser item a item. O relatório
  do `practice` não muda em nada — reaproveita a mesma infraestrutura que já existia (`advanceState`
  já coletava os transcripts das 4 partes numa única chamada final, não precisou de tabela nem
  agregação nova).

`docs/state-machine.md` e `docs/database-schema.md` atualizados pra refletir o comportamento final
(gravação automática após 5s, não um timeout de 20s que pulava o item — versão descartada ainda na
mesma rodada de testes, antes de fechar).

**Utilitário de dev atualizado**: `scripts/dev-jump-phase2-part.mjs` ganhou um 4º argumento
opcional `mode` (`practice`/`official`) — sem ele, o script reaproveita a tentativa `in_progress`
mais recente **de qualquer modo**, o que já causou confusão real (pulou pra uma tentativa
`practice` esquecida de um teste anterior ao tentar testar `official`). Com o modo explícito, o
script só reaproveita (ou cria) uma tentativa daquele modo específico, e sempre imprime o modo da
tentativa usada. Uso: `node scripts/dev-jump-phase2-part.mjs <email> <part> [itemIndex] [mode]`.

**Decisões de escopo fechadas com a Sabrina, fora desta rodada**:
- Limite de repetição simplificado: só um cap de 1x no botão "Repetir pergunta" já existente, sem
  distinguir "esclarecimento de vocabulário" de "repetição da pergunta" (essa distinção da tabela
  em `docs/state-machine.md` nunca existiu no app, nem no `practice` — só existe o botão de
  repetir).
- Sem corte automático de duração de resposta (60s pra descrição, 90s pra história, etc.) — a
  gravação em ambos os modos só termina quando o candidato clica "Concluir e enviar" ou pausa.

## Fase 2 (entrevista simulada, modo `practice`) — fluxo considerado fechado (2026-08-10)

Ponta a ponta validado manualmente pela Sabrina: as 4 partes, tamanho oficial (4/10/4/1), relatório
final gerado no fluxo real do app (não isolado via script), conteúdo real por perfil operacional
(Parte 2 e Parte 4) nos 4 perfis, feedback técnico de microfone, e exibição de
pergunta+resposta+feedback por item na tela de resultado. Ver "Atualização (2026-08-10)" acima e
"Atualização (2026-08-06)" abaixo para o histórico completo de achados corrigidos até chegar aqui.

Deploy na Vercel fechado em 2026-08-10 — ver "Infraestrutura já provisionada" acima. Modo
`official` da Fase 2 implementado e fechado em 2026-08-11 — ver "Modo `official` da Fase 2 —
implementado e fechado" acima. Fase 6 (Desempenho) implementada e fechada em 2026-08-12 — ver
"Fase 6 — Desempenho (histórico/relatórios de evolução) — implementada e fechada" acima. Conteúdo
real de todas as 4 partes da Fase 2 e da Fase 1 fechado em 2026-08-19 — ver "Atualização
(2026-08-19)" acima. Único item de roadmap restante: **Fase 7** (responsividade, testes,
observabilidade, deploy público) — ver roadmap abaixo. Corte automático de duração de resposta e
distinção completa repetição/esclarecimento no modo `official` seguem como escopo deixado de fora
por decisão (ver "Modo `official` da Fase 2 — implementado e fechado" acima); evolução por
critério ICAO individual da Fase 2 ao longo do tempo é decisão fechada de **não fazer** (ver
"Atualização (2026-08-19)" acima).

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
      Deploy na Vercel fechado em 2026-08-10 (https://eplis-trainer.vercel.app, deploy
      automático a cada push em `main`) — ver "Infraestrutura já provisionada" acima.
- [x] **Fase 2 — Banco e modelos**: schema aplicado ✅; conteúdo real da Fase 1 ampliado
      pra 43 áudios / 60 perguntas (ver "Atualização (2026-08-18)" acima); Parte 2 da
      Fase 2 com 30 situações por perfil (120 no total), Parte 4 com pool real de
      21-22 imagens por perfil (idem), Parte 1 com 120 perguntas gerais de
      carreira/dia-a-dia e Parte 3 com 120 perguntas gerais (60 concretas + 60
      abstratas) sobre aviação/ATC (ver "Atualização (2026-08-19)" acima) — todo o
      conteúdo da Fase 2 deixou de ser placeholder.
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
      pela Sabrina, `Material Didático/ATC/Phase 1 - Audios/`, fora do repo), com perguntas
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
      falar, sem limite rígido de repetição por parte) — modo `official` implementado
      só em 2026-08-11, ver "Modo `official` da Fase 2 — implementado e fechado" no topo
      deste documento. Sub-estágios dentro de um item (ex.: `situation_check` →
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
- [x] **Fase 6 — Desempenho**: telas `/desempenho`, `/desempenho/fase1` e
      `/desempenho/fase2` (lista de simulados + gráfico de evolução por fase, link pro
      relatório de cada simulado) — ver "Fase 6 — Desempenho (histórico/relatórios de
      evolução) — implementada e fechada (2026-08-12)" acima. Falta: evolução por critério
      ICAO individual da Fase 2 ao longo do tempo (hoje só nível geral) — avaliar se entra
      numa rodada futura.
- [ ] **Fase 7 — Refino e lançamento**: responsividade, testes, observabilidade, deploy
      público. Observabilidade (Sentry) já feita — ver "Atualização (2026-08-19) —
      observabilidade" acima. Responsividade: cabeçalho (`AppShell`) corrigido em
      2026-08-21 (menu mobile) — ver "Atualização (2026-08-21)" acima; resto do fluxo já
      validado responsivo na mesma rodada, sem mudança necessária. Testes automatizados:
      suíte inicial criada em 2026-08-22 (ver "Atualização (2026-08-22) — testes
      automatizados" abaixo). Proteção de custo de IA antes do lançamento público: limite
      diário de tentativas da Fase 2 e trava de posse no `generateSpeech` implementados em
      2026-08-22 (ver "Atualização (2026-08-22) — proteção de custo" abaixo). Falta:
      decidir/anunciar o lançamento público em si (hoje só a Sabrina tem acesso, mas não
      há mais nenhuma trava técnica óbvia impedindo abrir o cadastro).
- [x] **Trilha do piloto (SDEA)** — implementada em 2026-08-24, ver "Atualização
      (2026-08-24) — Trilha do piloto (SDEA)" acima: schema, backend, IA, UI e role
      gating completos e validados ponta a ponta; conteúdo inicial carregado (15
      perguntas de Parte 1, 5 situações de Parte 2 + 3 de Parte 3 + 1 foto de Parte 4 pra
      `fixed_wing`, 20 + 12 pra `rotary_wing` sem foto de Parte 4 ainda). Falta: ampliar o
      pool pra "dezenas por parte" (decisão de escopo, rodada separada) e conseguir fotos
      de helicóptero licenciadas pra Parte 4 de `rotary_wing`.

## Atualização (2026-08-22) — testes automatizados (início da cobertura da Fase 7)

Projeto não tinha nenhum framework de teste. Instalado **Vitest** (`vitest.config.mts`,
ambiente `jsdom`) + Testing Library (`@testing-library/react`, `@testing-library/jest-dom`)
como devDependencies, com `npm run test` (`vitest run`) novo no `package.json`. Escolhido
Vitest em vez de Jest por já compartilhar a config do Vite/esbuild que o ecossistema Next
usa, sem precisar de transform extra pra TS/JSX. `vitest.setup.ts` faz stub de
`HTMLMediaElement.prototype.play/pause` (jsdom não implementa reprodução de mídia — sem o
stub, qualquer `<audio>.play()` real dos runners de Fase 1/Fase 2 lança "not implemented"
antes de chegar na lógica que importa).

Cobertura inicial (11 testes, 4 arquivos) priorizou a classe de bug que já se repetiu
duas vezes neste projeto — race condition de avanço por clique duplo/timer concorrente
(`Phase1Runner.advance`, corrigido em 2026-08-19; `InterviewRunner.goToNextItem`,
corrigido em 2026-08-22, ambos documentados acima) — e a lógica pura mais arriscada de
regredir silenciosamente:

- **`state-machine.test.ts`**: `computeNextPosition` (Fase 2) — avanço dentro da mesma
  parte, transição pra intro da próxima parte, e retorno `null` ao terminar a Parte 4.
- **`queries.test.ts`**: `getSequenceForAttempt` (Fase 2) — determinismo do PRNG seedado
  por `attemptId` (mesmo attempt sempre sorteia a mesma sequência, attempts diferentes
  sorteiam sequências diferentes), tamanhos corretos por parte, sem repetição de item, e
  a regra de Parte 3 (2 primeiras concretas + 2 últimas abstratas, sempre nessa ordem) —
  essa é a regra que ficou documentada no schema por meses sem estar implementada até
  2026-08-19, o tipo de regressão silenciosa que um teste pego cedo evita. `createClient`
  do Supabase mockado via `vi.mock` (sem bater no banco real).
- **`phase1-runner.test.tsx`** e **`interview-runner.test.tsx`**: montam o componente de
  verdade (Testing Library) e disparam dois cliques rápidos no botão de avanço na tela de
  resposta/feedback — replica o cenário real que gerou os dois bugs de produção — e
  verificam que a Server Action de avanço (`recordAnswer`/`finishAttempt`/`advanceState`,
  todas mockadas) só é chamada uma vez. `interview-runner.test.tsx` também mocka
  `MediaRecorder`, `navigator.mediaDevices.getUserMedia` e `fetch` (não existem/não fazem
  sentido em jsdom) com um fake mínimo só do necessário pro fluxo Falar → Concluir e
  enviar → Continuar.

**Fora do escopo desta rodada** (avaliar depois): testes E2E de verdade (Playwright,
hoje só usado ad-hoc em sessões de teste manual, não como suíte no repo), testes de
grading da Fase 1 e do parsing do relatório final da Fase 2 (`src/lib/ai/anthropic.ts`),
e testes das Server Actions em si (exigiriam mockar Supabase mais a fundo — a cobertura
de hoje mocka no nível de módulo de ações/queries, não a Server Action inteira).

`npx tsc --noEmit`, `npm run lint`, `npm run build` (produção) e `npm run test` (11/11)
todos limpos.

## Atualização (2026-08-22) — proteção de custo de IA antes do lançamento público

Discutido com a Sabrina o que "deploy público" realmente implica: o cadastro
(`/cadastro`) já é público hoje, só exige confirmação de e-mail — não há aprovação
manual nem nenhum teto de uso. Cada tentativa completa da Fase 2 dispara várias chamadas
pagas (Whisper por resposta, TTS por estágio narrado pela IA, Claude no relatório final)
sem nenhum limite — hoje o único freio é o limite de gasto configurado na própria conta
OpenAI/Anthropic. Decisão: em vez de fechar o cadastro atrás de convite (adiaria o
lançamento público de verdade), adicionar um teto de custo simples antes de divulgar o
link. Duas mudanças:

- **Limite diário de tentativas da Fase 2** (`DAILY_ATTEMPT_LIMIT = 5`, novo módulo
  `src/services/simulations/phase2/limits.ts`): `startAttempt` conta quantas tentativas
  (qualquer status) o usuário já iniciou desde a meia-noite local e recusa uma nova acima
  do limite. A tela `/fase2` já checa o mesmo limite no Server Component e some com os
  botões de iniciar, mostrando um aviso âmbar em vez de deixar o clique estourar como
  erro genérico — retomar uma tentativa `practice` pausada não conta pro limite (senão
  alguém perto do teto não conseguiria nem voltar pra terminar a que já tinha começado).
  Fase 1 ficou de fora de propósito — não faz nenhuma chamada de IA (grading é comparação
  direta com `correct_option`), então não tem o mesmo risco de custo.
  **Achado durante a implementação**: `DAILY_ATTEMPT_LIMIT` e `countAttemptsToday`
  inicialmente foram colocados direto em `actions.ts`, que já é `"use server"` — quebrou
  o build inteiro do módulo ("The module has no exports at all") porque um arquivo
  `"use server"` só pode exportar funções async (constantes e funções que recebem
  argumento não serializável, como o client do Supabase, não são permitidas). Corrigido
  extraindo os dois pra `limits.ts` (módulo comum, sem a diretiva), importado tanto pela
  Server Action quanto pelo Server Component da página.
- **`generateSpeech` (TTS) passou a exigir `attemptId`**: antes aceitava qualquer string
  de texto de um usuário autenticado, sem nenhum vínculo com uma entrevista real — dava
  pra chamar a Server Action direto (fora do fluxo normal da UI) com texto arbitrário
  repetidamente e gerar custo de TTS sem relação nenhuma com um simulado de verdade.
  Agora reaproveita `assertOwnAttemptInProgress` (mesma checagem de posse/estado já usada
  pelo resto da Fase 2) e rejeita texto acima de 1500 caracteres (folga generosa acima do
  maior texto real que passa por ali — o feedback curto por resposta, limitado a
  `max_tokens: 300` no Claude). Os dois pontos de chamada em `interview-runner.tsx`
  atualizados para passar `attemptId`.

Cobertura de teste ampliada: `actions.test.ts` (novo) cobre `generateSpeech` — sucesso,
texto longo demais, sem sessão, tentativa de outro usuário, tentativa já concluída — com
Supabase mockado no mesmo padrão de `queries.test.ts`. Suíte total foi de 11 para 16
testes. `npx tsc --noEmit`, `npm run lint`, `npm run build` e `npm run test` (16/16)
todos limpos.

**Ainda em aberto**: os limites (5/dia, 1500 caracteres) são estimativas razoáveis, não
calibradas com uso real — reavaliar depois de alguém de fora usar de verdade. Sem
rate-limit por minuto (só diário) — não protege contra um script que dispara muitas
chamadas em poucos segundos dentro do teto diário; aceitável por ora porque cada
`generateSpeech` já está amarrado a uma tentativa própria em andamento (não dá pra ter
tentativas `in_progress` ilimitadas rodando ao mesmo tempo sem também estourar o limite
diário de tentativas).

**Commitado e enviado para produção (2026-08-24)**: dois commits —
`7b9bdb3` (suíte de testes automatizados) e `959a174` (proteção de custo de IA) — via
`git push` em `main`, disparando o deploy automático na Vercel (ver "Convenções" no
`CLAUDE.md`). `tsc --noEmit`, `lint`, `npm run test` (16/16) e `npm run build` conferidos
limpos imediatamente antes do push. **Validado em produção (2026-08-24)**: 5 tentativas fictícias (`status = 'abandoned'`,
`started_at = now()`) inseridas direto no banco pro usuário da Sabrina via novo script
`scripts/dev-seed-fase2-limit-test.mjs` (sem gastar nenhuma chamada de IA — status
`abandoned` conta pro `DAILY_ATTEMPT_LIMIT` mas não aparece como tentativa "pausada" na
tela). Sabrina confirmou o aviso âmbar "Você atingiu o limite de 5 simulados..." em
`https://eplis-trainer.vercel.app/fase2` no lugar dos botões de iniciar. Tentativas de
teste apagadas em seguida com `scripts/dev-delete-attempts.mjs` (novo, contraparte de
limpeza por id). Os dois scripts commitados (`99d3042`) — reaproveitáveis pra qualquer
teste futuro parecido, sem precisar rodar 5 simulados de verdade.

Com isso, a checagem técnica de "posso abrir o cadastro pro público?" está fechada — falta
só a decisão de negócio de divulgar o link (não é mais uma pendência de código).

**Ponto de retomada (2026-08-24, fim de sessão)** — 4 commits enviados a `main` nesta
rodada, todos já em produção e revalidados (`tsc --noEmit`, `lint`, `npm run test` 16/16,
`npm run build` limpos; `vercel ls` confirma o deploy mais recente `Ready`/`Production`;
`curl -I` na raiz de produção retorna 307 pra `/login`, proteção de rota ativa):

1. `7b9bdb3` — suíte de testes automatizados (Vitest + Testing Library), primeira
   cobertura de testes do projeto.
2. `959a174` — proteção de custo de IA na Fase 2 (limite diário de tentativas +
   `generateSpeech` exigindo posse da tentativa).
3. `99d3042` — scripts de dev (`dev-seed-fase2-limit-test.mjs`,
   `dev-delete-attempts.mjs`) pra testar o limite diário sem gastar chamada de IA.
4. `4614887` — registro da validação em produção do limite diário no project-status.

Working tree limpa, nada pendente de commit. Fase 7 (refino e lançamento): responsividade
✅, observabilidade (Sentry) ✅, testes automatizados ✅ (cobertura inicial — dá pra
ampliar depois), proteção de custo ✅. Falta só a decisão de negócio de divulgar o link
publicamente — não há mais nenhuma pendência técnica conhecida bloqueando isso. Ver a
lista completa de próximos passos possíveis (fora da Fase 7) na seção "Roadmap" acima:
mais áudios reais da Fase 1, evolução por critério ICAO individual na tela de Desempenho,
e a trilha própria do piloto (Santos Dumont English Assessment) — hoje sem nenhum
conteúdo, só os campos de cadastro capturados.

**[Superado pela atualização abaixo — a trilha do piloto foi implementada ainda no mesmo
dia, numa sessão seguinte.]**

---

**Ponto de retomada (2026-08-28, fim da sessão de conteúdo do SDEA)** — sessão inteira
dedicada a implementar as diretrizes do documento **"Modelo SDEA com anotações"** (trazido
pela Sabrina) e a plugar o material didático. Detalhamento técnico completo nas seções
datadas 2026-08-27 e 2026-08-28 acima. **6 commits enviados a `main`** (deploy automático
na Vercel dispara a partir daí):

1. `e25e28d` — escala de proficiência de 3 → 4 faixas (+`excellent`/N6), retroativa ao
   EPLIS. Migration `20260827000000` **já aplicada em produção**. `normalizeFinalReport`
   garante `overall = menor dos 6` no código.
2. `a9c40fb` — botão "repetir pergunta" pesa no critério Compreensão do relatório
   (practice: qualquer uso; official: 2ª repetição em diante), sem rebaixar quem
   demonstrou Ótimo/Excelente.
3. `70f8e13` — modo `official` passou a gerar o demonstrativo por resposta em inglês
   (pergunta + resposta + feedback curto) na finalização, sem latência durante a prova.
4. `e57b801` — áudios de rádio pré-gerados da Parte 2 (50 clipes) e Parte 3 (15 diálogos)
   do SDEA: TTS + ffmpeg (VHF + estática + clique de PTT). Migration `20260828000000`
   (`atc_audio_url`/`atc_followup_audio_url`/`dialogue_audio_url`) e bucket
   `pilot-prompt-audio` **já aplicados em produção**; 65 áudios gerados e no Storage.
   Parte 3 toca 2x. **[2026-08-28] Esses 65 áudios foram DEPOIS apagados** (Storage +
   colunas de URL zeradas) — a Sabrina vai subir os TTS manualmente; ver a atualização
   de 2026-08-28 no topo. O runner voltou ao TTS em runtime enquanto as URLs forem `null`.
5. `95e476b` — a Sabrina reorganizou o material didático (`Material Didático/{ATC,Pilots}/`);
   caminhos atualizados em 4 scripts de seed/upload. `generate-pilot-prompt-audio.mjs`
   passou a gravar cópia local dos mp3 em `Pilots/Material Didático/{Fixed-wing,Rotary-wing}/Audios/`.
6. `bc3f421` — pool de fotos da Parte 4: 13 avião + 10 helicóptero (IA-geradas, fornecidas
   pela Sabrina), otimizadas e no bucket `pilot-images/<perfil>/part4/`; 23 linhas ativas
   em `pilot_prompts`. **Fecha a lacuna da Parte 4 de `rotary_wing`.** Estrutura da Parte 4:
   só a afirmação é da foto, resto fixo no runner (item 2 com sorteio 1-de-4).

**Tudo já aplicado no Supabase de produção durante a sessão** (2 migrations, 1 bucket,
re-seed de `pilot_prompts`, 65 áudios + 23 imagens no Storage) — não há "falta aplicar"
pendente; os pushes só levaram o código do repo. `npx tsc --noEmit`, `npm run lint`,
`npm run test` (42/42, +12 novos), `npm run build` conferidos limpos antes de cada push.
Working tree limpa.

**Pendências reais em aberto** (sem mudança nesta sessão): ampliar o pool de conteúdo do
SDEA pras 10 provas por perfil (as 200/60 áudios da Parte 2/3 e mais imagens da Parte 4 —
o script de áudio já cobre linhas novas automaticamente); refazer o pool de **imagens de
complicação da Parte 2** do piloto com o conjunto novo (o `upload-pilot-part2-part4-images.mjs`
referencia 3 arquivos que não existem mais — as 2 imagens em uso seguem no bucket/DB);
testes automatizados de `generate*Feedback`/`generate*FinalReport` (lacuna antiga, EPLIS e
SDEA); nenhum teste manual real com áudio/microfone da entrevista do piloto ainda; item 2
da Parte 4 poderia virar estágio `future` próprio (hoje reusa `narrative`) se quiser
feedback separado por item.

**Achado de máquina** (registrado em memória): o `ffmpeg` do Homebrew nesta máquina está
quebrado (`libx265` defasado) — usar `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` via
`FFMPEG_BIN`.

**Ponto de retomada (2026-08-27, pool da Parte 1 do SDEA)** — sessão curta: a Sabrina
trocou o conteúdo da Parte 1 da trilha do piloto. Detalhe técnico na seção "Atualização
(2026-08-27) — Pool de 30 perguntas da Parte 1 do SDEA" acima. Resumo:

- `pilot_prompts` (`part='part1'`): 15 linhas antigas **apagadas**, 30 novas inseridas
  (pool `general`), aplicado direto no Supabase de produção via MCP — **não há "falta
  aplicar"**, o commit só leva o código.
- `scripts/seed-pilot-prompts.mjs` — array `PART1` e comentário de cabeçalho atualizados.
- `Material Didático/Pilots/Material Didático/Docs/Material_pilotos.docx` — nova seção
  PART 1 (30 perguntas). Fora do repo Git (mora em `Material Didático/`, irmão de
  `Project/`), então não entra no commit.
- Verificação: `npm run lint`, `npx tsc --noEmit` e `npm run test` limpos antes do push.
- Novidade de ambiente: **MCP do Supabase agora está autorizado** (ver "Ferramentas
  indisponíveis" — a seção foi atualizada).

Nada mais do projeto mudou nesta rodada.

**Ponto de retomada (2026-08-24, fim da sessão da trilha do piloto)** — trilha completa do
SDEA implementada nesta rodada (ver "Atualização (2026-08-24) — Trilha do piloto (SDEA)"
acima para o detalhamento técnico completo: schema, backend, IA, UI, role gating,
conteúdo inicial, validação com Playwright). Commit enviado a `main` nesta rodada:

1. `b0f9030` — trilha do piloto (SDEA) completa: migrations, backend
   (`src/services/simulations/pilot/`), IA (`src/lib/ai/pilot-track.ts`), UI
   (`src/components/sdea/`, `src/app/sdea/*`, `src/app/api/sdea/*`), role gating
   (dashboard/nav/rotas condicionais por `role`), conteúdo inicial (5 provas reais
   carregadas via `scripts/seed-pilot-prompts.mjs`), pequena refatoração de reuso
   (`src/lib/prng.ts`, `src/lib/simulations/attempt-guards.ts`,
   `src/lib/ai/anthropic-client.ts`, comportamento da Fase 2 preservado — 16/16 testes
   originais continuam verdes).

`npx tsc --noEmit`, `npm run lint`, `npm run test` (30/30 — 14 novos da trilha do piloto) e
`npm run build` conferidos limpos antes do push. **Validado em produção após o push**
(`b0f9030` + `eb4cd4a`, o segundo só corrigindo o hash aqui neste documento): `npx vercel
ls` confirma o deploy mais recente `Ready`/`Production` (37s de build); `curl -I` na raiz e
em `/sdea` de produção retornam 307 pra `/login`, confirmando que a nova rota está servindo
de verdade (não 404/500) e que a proteção de rota continua ativa. **Atenção**: diferente de
rodadas
anteriores, as migrations desta sessão (`20260824000000`, `20260824010000`,
`20260824020000`) e o conteúdo (`scripts/seed-pilot-prompts.mjs`,
`scripts/upload-pilot-part2-part4-images.mjs`, buckets `pilot-recordings`/`pilot-images`)
**já foram aplicados diretamente no Supabase de produção durante a sessão** (não é um
"falta aplicar" pendente) — só o código do repo estava faltando ser commitado/enviado, o
que este push resolve. Deploy na Vercel dispara automático a partir daqui.

Working tree limpa após o push. Pendências reais em aberto pra trilha do piloto (fora do
escopo desta rodada, por decisão): ampliar o pool de conteúdo pra "dezenas por parte" nos
dois perfis (script de geração + arquivo de revisão pra Sabrina aprovar, igual ao
histórico do EPLIS); conseguir fotos de helicóptero próprias/licenciadas pra Parte 4 de
`rotary_wing` (hoje sem conteúdo — pool insuficiente, tratamento gracioso já existente);
testes automatizados de `generateResponseFeedback`/`generateFinalReport` (mesma lacuna já
registrada pro controlador); nenhum teste manual real com áudio/microfone ainda feito
pela Sabrina (só validado via Playwright headless até o ponto de gravação).

Resto do projeto (Fase 7 do controlador — responsividade, observabilidade, testes,
proteção de custo) continua no estado descrito no ponto de retomada anterior, sem
mudanças nesta rodada.

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
- Modo `official`: sem botão manual pra começar a responder — a gravação inicia sozinha 5s
  depois da pergunta, fiel ao exame real (decisão da Sabrina, 2026-08-11, substituiu a ideia
  inicial de timeout de 20s com botão "Falar" manual) — separado do timer de duração da
  resposta (não implementado). Ver `docs/state-machine.md`.
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
- Trilha do piloto (SDEA, 2026-08-24): fluxo/state machine da Parte 2 é **dedicado**, não
  forçado na mecânica situation_check/suggestion do controlador — role-play de 4
  sub-turnos (readback/reação/confirmação/discurso indireto) é estruturalmente diferente.
  Correção do SDEA **nunca avalia fraseologia** (nem no readback), só proficiência
  linguística — confirmado nos documentos oficiais da ANAC. Conteúdo de Parte 2/3/4 é
  segregado por `aircraft_type` (`fixed_wing`/`rotary_wing`), sem fallback pro outro tipo
  (diferente do `general` da Parte 1). Regra de licença de imagem: nunca usar fotos com
  marca d'água/sem licença clara, nem como placeholder — por isso a Parte 4 de
  `rotary_wing` rodou sem conteúdo até 2026-08-28, quando a Sabrina forneceu um pool
  IA-gerado (13 avião + 10 helicóptero, ver "Atualização (2026-08-28) — Pool de fotos da
  Parte 4").
- **[2026-08-28] Parte 4 do SDEA**: dos 6 itens, só a afirmação (`agree_disagree_statement`)
  é específica da foto; os demais (descrição, hipótese de antes com 4 variações sorteadas,
  hipótese de depois, 2 perguntas de discussão) são **fixos no runner** (`PART4_*` em
  `pilot-interview-runner.tsx`) — decisão da Sabrina, seguindo o "Modelo SDEA com
  anotações". `discussion_question`/`_2` de `pilot_prompts` não são lidas na Parte 4.
- **[2026-09-03] Áudio da Parte 2/3 do SDEA**: gravações reais da Sabrina (não mais TTS).
  **Parte 2**: as 174 falas (a01/a02 de cada uma das 87 situações) já estão no bucket
  `pilot-prompt-audio` (`<prompt_id>/atc.mp3` e `<prompt_id>/followup.mp3`) e
  `atc_audio_url`/`atc_followup_audio_url` estão preenchidas — subidas por
  `scripts/upload-pilot-part2-audio.mjs` a partir de
  `Material Didático/.../Part 2/Audios/<slug>/{1, 2 e 3 | 4 e 5}/sN-a{01,02}[-I].mp3`
  (efeito de rádio VHF por `scripts/radioize-part2-audio.mjs`, originais em
  `Part 2/Audios-ORIGINAIS-backup/`). **Parte 3**: as 38 gravações reais de R/T já estão
  no bucket (`<prompt_id>/dialogue.mp3`) e `dialogue_audio_url` preenchida — subidas por
  `scripts/upload-pilot-part3-audio.mjs` (fonte `.../Part 3/Audios/`, sem efeito sintético).
  O gerador `scripts/generate-pilot-prompt-audio.mjs` foi **removido** (superado). O
  runner/`queries.ts` tocam o mp3 direto quando a URL existe; Parte 3 toca 2x. `null` em
  qualquer coluna → fallback TTS em runtime (`alloy`).
- **[2026-08-28] Call sign da Parte 2 = `LEVEL 6`** (não `ANAC 123` — sem vínculo com a
  ANAC; trocadilho com o nível OACI máximo). Fixo nos dados da Parte 2 e no runner.
  Referências à ANAC como órgão regulador (nome do exame SDEA) foram mantidas.
- **[2026-08-27] Escala de proficiência = 4 faixas** (`weak`/`moderate`/`good`/`excellent`
  = Fraco N1-3 / Moderado N4 / Ótimo N5 / Excelente N6), retroativa ao EPLIS. Regra
  "overall = menor dos 6" agora garantida no código (`normalizeFinalReport`).
- Tela de Desempenho (Fase 6): **não mostrar evolução por critério ICAO individual**, só
  o nível geral (Fraco/Moderado/Bom) por simulado — proposital, não limitação a
  corrigir. Evita que a tela pareça afirmar um nível OACI oficial específico pro aluno;
  o objetivo é só mostrar que ele está evoluindo (decisão da Sabrina, 2026-08-19).

## Documentos-fonte (só existiram como PDFs anexados no chat, não estão no repo)

Se precisar reconsultar o texto integral das especificações oficiais do EPLIS ou dos
documentos internos que originaram este projeto, peça para a Sabrina reanexar:
`ESTRUTURA TÉCNICA BANCO DE DADOS.pdf`, `PRODUTO MÍNIMO VIÁVEL.pdf`,
`SPD_Plataforma_EPLIS.pdf`, `SRS_Plataforma_EPLIS.pdf`, `STATE MACHINE.pdf`,
`Especificacoes_Fase1.pdf`, `Especificacoes_Fase2.pdf`, `Manual do Examinando.pdf`.
Os pontos relevantes de todos eles já foram extraídos para `docs/database-schema.md`,
`docs/state-machine.md` e `docs/srs-updates.md` — normalmente não é necessário reabrir
os PDFs.
