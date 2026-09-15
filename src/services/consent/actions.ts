"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeOrRedirect } from "@/lib/auth/authorize";
import { CONSENT_VERSION } from "@/lib/simulations/consent";

// Registra o aceite do consentimento de gravação — Milestone 3.3 (ver
// docs/project-status.md).
//
// **Achado da revisão (2026-09-12): escrita pelo client do usuário permitia
// forjar o registro.** A policy de RLS só checava `auth.uid() = user_id` —
// nada impedia mandar um `consent_version` inventado ou um `accepted_at`
// retroativo direto pra PostgREST, o que destrói o valor do registro como
// prova de auditoria. Corrigido: escreve com `service_role`, depois de
// `authorize()` — `consent_version` vem sempre da constante do servidor
// (nunca de dado enviado pelo cliente) e `accepted_at` é sempre o `now()`
// do banco no momento da escrita (migration 20260912060000 revoga INSERT
// de `authenticated` na tabela).
//
// Chama `revalidatePath` nas duas telas de entrevista — sem isso, a Server
// Action grava no banco mas o Server Component que decide "mostrar o gate
// de consentimento ou a entrevista" continua servindo a resposta antiga da
// rota (achado já documentado no projeto: mutação sem revalidatePath não
// reflete na tela atual no Next 16).
export async function acceptRecordingConsent(): Promise<void> {
  const supabase = await createClient();
  const { user } = await authorizeOrRedirect(supabase);

  const admin = createAdminClient();
  const { error } = await admin
    .from("recording_consents")
    .insert({ user_id: user.id, consent_version: CONSENT_VERSION });

  if (error) {
    throw new Error("Não foi possível registrar o consentimento. Tente novamente.");
  }

  revalidatePath("/fase2/entrevista/[attemptId]", "page");
  revalidatePath("/sdea/entrevista/[attemptId]", "page");
}
