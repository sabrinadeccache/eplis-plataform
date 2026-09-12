-- Milestone 3.3 do plano de correção — consentimento pra gravação de voz
-- (ver docs/project-status.md). Decisão da Sabrina: exigido ANTES da 1ª
-- gravação (Fase 2/SDEA), texto cobrindo finalidade, serviços de
-- transcrição/avaliação, prazo de retenção, papéis com acesso, canal de
-- exclusão, e o aviso de que a plataforma é PREPARATÓRIA (sem vínculo com
-- DECEA/ANAC).
--
-- Tabela dedicada (não uma coluna em `users`) de propósito: consentimento
-- precisa ser um registro IMUTÁVEL e AUDITÁVEL (versão do texto + timestamp
-- do aceite) — uma coluna que se sobrescreve perde o histórico de quando e
-- de qual versão o titular aceitou. Se o texto mudar no futuro,
-- `consent_version` muda junto e uma nova linha é exigida — as antigas
-- continuam como prova do que foi aceito antes.
create table public.recording_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  consent_version text not null,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index recording_consents_user_id_idx on public.recording_consents (user_id);

alter table public.recording_consents enable row level security;

-- Select/insert do titular: ele registra o PRÓPRIO aceite e consulta se já
-- aceitou. Sem update/delete pra `authenticated` — um consentimento
-- registrado é histórico, não se edita nem se apaga (mesma lógica de não
-- deixar o candidato alterar nota/estado de tentativa, M1).
create policy "select own consents"
on public.recording_consents
for select
to authenticated
using (auth.uid() = user_id);

create policy "insert own consents"
on public.recording_consents
for insert
to authenticated
with check (auth.uid() = user_id);

-- Grant explícito — tabela nova sem isso falha silenciosamente pro role
-- authenticated (achado real já documentado no projeto, ver CLAUDE.md).
grant select, insert on public.recording_consents to authenticated;
grant select, insert, delete on public.recording_consents to service_role;
