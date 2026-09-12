import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorize, AuthError } from "@/lib/auth/authorize";
import { createRecordingSignedUrl, type RecordingTrack } from "@/lib/simulations/recording-access";

// Único caminho de leitura de uma gravação de voz do candidato — Milestone
// 3.1 (ver docs/project-status.md). Os buckets são privados desde a
// migration 20260912000000; esta rota devolve uma URL ASSINADA de vida
// curta, e só depois de confirmar que quem pede é o titular da gravação (ou
// um admin).
//
// Devolve a URL em JSON em vez de redirecionar pro storage de propósito:
// um 302 pra URL assinada acabaria no histórico do navegador e em logs de
// referer, o que anula parte do ganho de ela ser curta.
//
// Nenhuma tela consome esta rota ainda (as telas de resultado mostram
// transcrição e feedback, não o áudio). Ela existe porque o acesso
// autorizado ao áudio é requisito do M3 — e é o que torna a privacidade
// verificável: sem ela, "bucket privado" seria só "áudio inacessível".
function parseTrack(value: string): RecordingTrack | null {
  if (value === "phase2" || value === "pilot") return value;
  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ track: string; responseId: string }> },
) {
  const { track: rawTrack, responseId } = await params;

  const track = parseTrack(rawTrack);
  if (!track) {
    return NextResponse.json({ error: "Trilha inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  let user;
  try {
    // Sem `track` aqui de propósito: um admin (que enxerga as duas trilhas)
    // e o titular de cada trilha passam pelo mesmo gate de sessão/status
    // `active`; a autorização específica da gravação é por POSSE, resolvida
    // no banco por `createRecordingSignedUrl`, não pela trilha da rota.
    ({ user } = await authorize(supabase));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const admin = createAdminClient();
  const result = await createRecordingSignedUrl({ supabase, admin, track, responseId, user });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  return NextResponse.json(
    { url: result.url, expiresInSeconds: result.expiresInSeconds },
    // A URL assinada não pode ser cacheada por proxy/CDN nem pelo browser:
    // é credencial de acesso, com validade própria.
    { headers: { "Cache-Control": "no-store" } },
  );
}
