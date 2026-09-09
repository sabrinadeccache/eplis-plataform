"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Persiste o tempo decorrido acumulado de um simulado (Fase 2 / SDEA). Chamado
// pelo runner ao pausar, ao concluir e periodicamente — assim o cronômetro da
// IHM "pausa" ao sair e retoma do mesmo ponto ao reabrir. Só grava se o novo
// valor for maior (monotônico), pra uma chamada atrasada não regredir o total.
export async function recordElapsedSeconds(attemptId: string, seconds: number): Promise<void> {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login?erro=sessao");

  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, elapsed_seconds")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== auth.user.id) return;

  const next = Math.max(Math.floor(seconds), attempt.elapsed_seconds ?? 0);
  if (next === (attempt.elapsed_seconds ?? 0)) return;

  await supabase
    .from("simulation_attempts")
    .update({ elapsed_seconds: next })
    .eq("id", attemptId);
}
