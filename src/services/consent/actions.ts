"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { authorizeOrRedirect } from "@/lib/auth/authorize";
import { CONSENT_VERSION } from "@/lib/simulations/consent";

// Registra o aceite do consentimento de gravação — Milestone 3.3 (ver
// docs/project-status.md). Escrita PELO PRÓPRIO usuário (não service_role):
// é análogo a `phase1_answers`, onde o titular registra o próprio dado sob
// RLS (`auth.uid() = user_id`) — não é uma escrita privilegiada como
// nota/estado de tentativa (M1), é o registro do aceite dele mesmo.
//
// Chama `revalidatePath` nas duas telas de entrevista — sem isso, a Server
// Action grava no banco mas o Server Component que decide "mostrar o gate
// de consentimento ou a entrevista" continua servindo a resposta antiga da
// rota (achado já documentado no projeto: mutação sem revalidatePath não
// reflete na tela atual no Next 16).
export async function acceptRecordingConsent(): Promise<void> {
  const supabase = await createClient();
  const { user } = await authorizeOrRedirect(supabase);

  const { error } = await supabase
    .from("recording_consents")
    .insert({ user_id: user.id, consent_version: CONSENT_VERSION });

  if (error) {
    throw new Error("Não foi possível registrar o consentimento. Tente novamente.");
  }

  revalidatePath("/fase2/entrevista/[attemptId]", "page");
  revalidatePath("/sdea/entrevista/[attemptId]", "page");
}
