// Mesmo padrão de src/services/simulations/phase2/limits.ts — módulo separado
// (não "use server") porque `countAttemptsToday` recebe o client do Supabase
// como argumento não serializável. A checagem em si vive em
// src/lib/simulations/attempt-guards.ts (compartilhada com a Fase 2),
// generalizada por `phase`.
import {
  countAttemptsToday as countAttemptsTodayShared,
  type SupabaseServerClient,
} from "@/lib/simulations/attempt-guards";

// Mesmo teto de custo da Fase 2 (ver limits.ts de lá) — cada tentativa
// completa dispara várias chamadas pagas (Whisper, TTS, Claude).
export const PILOT_DAILY_ATTEMPT_LIMIT = 5;

export async function countAttemptsToday(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<number> {
  return countAttemptsTodayShared(supabase, userId, "pilot_interview");
}
