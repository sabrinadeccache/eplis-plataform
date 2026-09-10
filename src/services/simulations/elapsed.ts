"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorize } from "@/lib/auth/authorize";

// Persiste o tempo decorrido acumulado de um simulado (Fase 2 / SDEA). Chamado
// pelo runner ao pausar, ao concluir e periodicamente — assim o cronômetro da
// IHM "pausa" ao sair e retoma do mesmo ponto ao reabrir. Só grava se o novo
// valor for maior (monotônico), pra uma chamada atrasada não regredir o total.
export async function recordElapsedSeconds(attemptId: string, seconds: number): Promise<void> {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  const supabase = await createClient();

  // Chamada "fire and forget" do runner (void) — falha silenciosa, sem redirect.
  const authed = await authorize(supabase).catch(() => null);
  if (!authed) return;
  const userId = authed.user.id;

  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, elapsed_seconds")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== userId) return;

  const next = Math.max(Math.floor(seconds), attempt.elapsed_seconds ?? 0);
  if (next === (attempt.elapsed_seconds ?? 0)) return;

  // `simulation_attempts` só aceita escrita via service_role.
  const admin = createAdminClient();
  await admin
    .from("simulation_attempts")
    .update({ elapsed_seconds: next })
    .eq("id", attemptId)
    .eq("user_id", userId);
}
