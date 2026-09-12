// Acesso às gravações de voz do candidato — Milestone 3.1 do plano de
// correção (ver docs/project-status.md). Antes desta rodada os buckets
// `phase2-recordings`/`pilot-recordings` eram PÚBLICOS e o caminho da
// gravação era gravado em `audio_url` como URL pública: qualquer pessoa com
// a URL (sem conta, sem sessão) baixava a voz do candidato — confirmado em
// produção com um `HEAD` anônimo devolvendo `200` e o áudio inteiro.
//
// Agora: bucket privado + caminho com o DONO no prefixo + acesso só por URL
// ASSINADA de vida curta, gerada aqui depois de confirmar que quem pede é o
// titular da gravação (ou um admin).
import { randomBytes } from "node:crypto";
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

// Validade da URL assinada: curta de propósito. Serve pra tocar/baixar a
// gravação na hora, não pra virar um link compartilhável — se vazar, expira
// sozinha em minutos. Renovar é barato (uma chamada autorizada).
export const SIGNED_URL_TTL_SECONDS = 120;

// Caminho do objeto: `{userId}/{attemptId}/{promptId}-{stage}-{slot}-{aleatório}.{ext}`.
//
// - `userId` no 1º segmento: deixa a policy de storage checar o dono
//   diretamente (ver 20260912000000_private_recordings.sql) e garante que
//   nenhum caminho de um usuário caia sob o prefixo de outro.
// - `attemptId` no 2º: liga o objeto à tentativa (a policy confirma que a
//   tentativa é do próprio usuário) e dá o recorte natural pra retenção.
// - sufixo ALEATÓRIO no nome: o antigo usava `Date.now()`, que é adivinhável
//   — com prompt/stage conhecidos, um intervalo de timestamps pequeno torna
//   o caminho enumerável por tentativa e erro. 16 bytes aleatórios tornam o
//   caminho impossível de adivinhar mesmo por quem conhece os UUIDs.
export function buildRecordingPath(params: {
  userId: string;
  attemptId: string;
  promptId: string;
  stage: string;
  slot: number;
  ext: "webm" | "mp4";
}): string {
  const token = randomBytes(16).toString("hex");
  return `${params.userId}/${params.attemptId}/${params.promptId}-${params.stage}-${params.slot}-${token}.${params.ext}`;
}

// O dono de uma gravação é o dono da TENTATIVA a que ela pertence — não o
// 1º segmento do caminho. Checar pelo caminho seria confiar num dado que
// veio junto do pedido; aqui a posse é resolvida sempre pelo banco.
async function findOwnedRecordingPath(params: {
  supabase: SupabaseServerClient;
  admin: ReturnType<typeof createAdminClient>;
  track: RecordingTrack;
  responseId: string;
  user: UserRow;
}): Promise<string | null> {
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
    .select("audio_path, simulation_attempts(user_id)")
    .eq("id", responseId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as {
    audio_path: string | null;
    simulation_attempts: { user_id: string } | { user_id: string }[] | null;
  };
  if (!row.audio_path) return null;

  const attempt = Array.isArray(row.simulation_attempts)
    ? row.simulation_attempts[0]
    : row.simulation_attempts;
  if (!attempt) return null;

  if (!isAdmin && attempt.user_id !== user.id) return null;

  return row.audio_path;
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
  const path = await findOwnedRecordingPath(params);
  if (!path) {
    return { ok: false, status: 404, reason: "Gravação não encontrada." };
  }

  // Assinatura pelo service_role: o bucket é privado e a URL assinada é o
  // único caminho de leitura (nem o titular lê o objeto direto).
  const { data, error } = await params.admin.storage
    .from(recordingBucket(params.track))
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return { ok: false, status: 500, reason: "Não foi possível liberar o áudio agora." };
  }

  return { ok: true, url: data.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
}
