// Acesso às gravações de voz do candidato — Milestone 3.1 do plano de
// correção (ver docs/project-status.md). Antes desta rodada os buckets
// `phase2-recordings`/`pilot-recordings` eram PÚBLICOS e o caminho da
// gravação era gravado em `audio_url` como URL pública: qualquer pessoa com
// a URL (sem conta, sem sessão) baixava a voz do candidato — confirmado em
// produção com um `HEAD` anônimo devolvendo `200` e o áudio inteiro.
//
// **Achado da revisão (2026-09-12): bucket privado não bastava** — as
// policies de storage ainda concediam INSERT/SELECT direto ao role
// `authenticated`, então o candidato podia subir/baixar o objeto direto,
// contornando consentimento, guard de item, decode real e o limite de 120s
// da URL assinada (comportamento documentado do Supabase: RLS em
// `storage.objects` dá acesso rw direto ao objeto). Migration
// 20260912050000 fecha isso: SEM policy nenhuma pra `authenticated` nesses
// dois buckets — toda escrita/leitura passa a ser só por `service_role`
// (`admin.storage`, nunca `supabase.storage`), depois de `authorize()` +
// os guards do M2.
import type { SupabaseServerClient } from "@/lib/simulations/attempt-guards";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { UserRow } from "@/types/database";

export type RecordingTrack = "phase2" | "pilot";

const BUCKET_BY_TRACK: Record<RecordingTrack, string> = {
  phase2: "phase2-recordings",
  pilot: "pilot-recordings",
};

const RESPONSE_TABLE_BY_TRACK: Record<RecordingTrack, "phase2_responses" | "pilot_responses"> = {
  phase2: "phase2_responses",
  pilot: "pilot_responses",
};

export function recordingBucket(track: RecordingTrack): string {
  return BUCKET_BY_TRACK[track];
}

export function recordingResponseTable(track: RecordingTrack): "phase2_responses" | "pilot_responses" {
  return RESPONSE_TABLE_BY_TRACK[track];
}

// Validade da URL assinada: curta de propósito. Serve pra tocar/baixar a
// gravação na hora, não pra virar um link compartilhável — se vazar, expira
// sozinha em minutos. Renovar é barato (uma chamada autorizada).
export const SIGNED_URL_TTL_SECONDS = 120;

// **Achado da revisão (2026-09-12): caminho por chamada órfão em retry.**
// A versão anterior gerava um sufixo aleatório NOVO a cada upload — um
// retry (mesma linha de resposta, ver item-guard.ts) criava um objeto NOVO
// e sobrescrevia `audio_path`, deixando o objeto anterior sem nenhuma linha
// que o referenciasse (invisível pros processos de retenção/exclusão, que
// só olham `audio_path`). Corrigido: o caminho é DETERMINÍSTICO a partir do
// id da própria linha de resposta (`responseId`, PK gerada pelo banco, não
// adivinhável) — toda tentativa de upload pra aquela linha, inclusive
// retry, aponta pro MESMO objeto, e o `upsert: true` do upload sobrescreve
// no lugar. Nunca mais que 1 objeto por linha de resposta, então
// `audio_path` nunca perde a referência do que existe de fato no bucket.
// Sem extensão de arquivo no caminho de propósito: o `contentType` já vai
// no upload, e assim um retry que troca de formato (webm → mp4) continua
// caindo no MESMO objeto, em vez de criar um 2º sob uma extensão diferente.
export function buildRecordingPath(params: { userId: string; attemptId: string; responseId: string }): string {
  return `${params.userId}/${params.attemptId}/${params.responseId}`;
}

type OwnedRecording = { path: string | null; expiresAt: string | null; ownerUserId: string };

// O dono de uma gravação é o dono da TENTATIVA a que ela pertence — não o
// 1º segmento do caminho. Checar pelo caminho seria confiar num dado que
// veio junto do pedido; aqui a posse é resolvida sempre pelo banco.
async function findOwnedRecording(params: {
  supabase: SupabaseServerClient;
  admin: ReturnType<typeof createAdminClient>;
  track: RecordingTrack;
  responseId: string;
  user: UserRow;
}): Promise<OwnedRecording | null> {
  const { supabase, admin, track, responseId, user } = params;
  const table = RESPONSE_TABLE_BY_TRACK[track];
  const isAdmin = user.role === "admin";

  // Admin usa o client de service_role (precisa ver gravação de qualquer
  // titular); o titular comum usa o próprio client, então a RLS de
  // `select own responses` ainda é uma segunda barreira além da checagem
  // explícita de posse abaixo.
  const client = isAdmin ? admin : supabase;

  const { data, error } = await client
    .from(table)
    .select("audio_path, expires_at, simulation_attempts(user_id)")
    .eq("id", responseId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as {
    audio_path: string | null;
    expires_at: string | null;
    simulation_attempts: { user_id: string } | { user_id: string }[] | null;
  };
  if (!row.audio_path) return null;

  const attempt = Array.isArray(row.simulation_attempts)
    ? row.simulation_attempts[0]
    : row.simulation_attempts;
  if (!attempt) return null;

  if (!isAdmin && attempt.user_id !== user.id) return null;

  // **Achado da revisão: a assinatura ignorava `expires_at`.** Uma
  // gravação já vencida (prazo de retenção passado) continuava assinável
  // até o processo de expiração rodar de fato — o prazo virava só uma
  // promessa de texto, não uma garantia. Tratada como "não existe" (mesma
  // resposta de not-found), consistente com o que o candidato foi
  // avisado no consentimento.
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;

  return { path: row.audio_path, expiresAt: row.expires_at, ownerUserId: attempt.user_id };
}

// Registro de acesso administrativo — item 3.2 do plano de correção
// ("registrar acesso administrativo sem conteúdo sensível"). Só metadado
// (quem, o quê, quando); nunca a URL assinada nem o áudio em si.
//
// **Achado da revisão (2026-09-12): erro de INSERT era ignorado.** A
// versão anterior não conferia o retorno deste insert — se a auditoria
// falhasse (índice, rede, o que for), a função seguia em frente e a URL
// assinada era entregue do mesmo jeito: um acesso administrativo real,
// sem NENHUM registro dele. Como auditabilidade é um requisito nomeado do
// M3.2 (não um "extra"), o comportamento correto é falhar fechado: se não
// dá pra provar que o acesso foi registrado, o acesso não acontece.
async function logAdminAccess(
  admin: ReturnType<typeof createAdminClient>,
  params: { adminUserId: string; track: RecordingTrack; responseId: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { error } = await admin.from("recording_access_log").insert({
    admin_user_id: params.adminUserId,
    track: params.track,
    response_id: params.responseId,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export type RecordingUrlResult =
  | { ok: true; url: string; expiresInSeconds: number }
  | { ok: false; status: 403 | 404 | 500; reason: string };

// Gera a URL assinada SÓ depois de confirmar autorização. Quem não é dono
// (nem admin) recebe a mesma resposta de "não existe" que receberia para um
// id inexistente — não confirma a existência da gravação de outra pessoa.
export async function createRecordingSignedUrl(params: {
  supabase: SupabaseServerClient;
  admin: ReturnType<typeof createAdminClient>;
  track: RecordingTrack;
  responseId: string;
  user: UserRow;
}): Promise<RecordingUrlResult> {
  const recording = await findOwnedRecording(params);
  if (!recording?.path) {
    return { ok: false, status: 404, reason: "Gravação não encontrada." };
  }

  // Assinatura pelo service_role: o bucket é privado e a URL assinada é o
  // único caminho de leitura (nem o titular lê o objeto direto).
  const { data, error } = await params.admin.storage
    .from(recordingBucket(params.track))
    .createSignedUrl(recording.path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return { ok: false, status: 500, reason: "Não foi possível liberar o áudio agora." };
  }

  // Só registra quando é de fato SUPERVISÃO administrativa — um admin
  // acessando a PRÓPRIA gravação (ele também usa a plataforma, ver
  // CLAUDE.md) não é o caso que o plano pede pra auditar.
  if (params.user.role === "admin" && recording.ownerUserId !== params.user.id) {
    const logResult = await logAdminAccess(params.admin, {
      adminUserId: params.user.id,
      track: params.track,
      responseId: params.responseId,
    });
    if (!logResult.ok) {
      return { ok: false, status: 500, reason: "Não foi possível registrar o acesso administrativo." };
    }
  }

  return { ok: true, url: data.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
}
