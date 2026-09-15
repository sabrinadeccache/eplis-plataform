-- Milestone 3, correção da revisão (2026-09-12) — dois achados de auditoria:
--
-- 1. `recording_consents` aceitava INSERT direto do role `authenticated`
-- com a policy só checando `auth.uid() = user_id` — nada impedia o cliente
-- de mandar `consent_version`/`accepted_at` arbitrários (uma versão futura
-- inventada, ou um timestamp retroativo), o que enfraquece o registro como
-- prova de auditoria. Corrigido revogando INSERT de `authenticated`: só
-- `service_role` escreve (a Server Action `acceptRecordingConsent` passa a
-- usar o client admin, depois de `authorize()`), então `consent_version` é
-- sempre a constante do servidor (nunca dado enviado pelo cliente) e
-- `accepted_at` é sempre o `now()` do momento da escrita. SELECT continua
-- liberado pro titular (`getConsentStatus` só lê, sem risco de forjar
-- registro passado).
--
-- 2. O plano (item 3.2) pede "registrar acesso administrativo [à gravação]
-- sem conteúdo sensível" — não existia esse registro. Nova tabela
-- `recording_access_log`: só metadado (quem, o quê, quando), nunca a URL
-- assinada nem o áudio.

revoke insert on public.recording_consents from authenticated;
drop policy if exists "insert own consents" on public.recording_consents;

create table public.recording_access_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.users (id) on delete cascade,
  track text not null check (track in ('phase2', 'pilot')),
  response_id uuid not null,
  accessed_at timestamptz not null default now()
);

create index recording_access_log_response_idx on public.recording_access_log (track, response_id);

alter table public.recording_access_log enable row level security;

-- Só `service_role` escreve (o registro é feito pelo backend, nunca a
-- pedido do próprio admin) e só `service_role` lê — este log não é dado do
-- titular da gravação, é trilha de auditoria interna.
grant select, insert on public.recording_access_log to service_role;
