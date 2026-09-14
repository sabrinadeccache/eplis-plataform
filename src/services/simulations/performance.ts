import type { createClient } from "@/lib/supabase/server";
import type { Phase } from "@/types/database";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getCompletedOfficialAttempts(
  supabase: ServerClient,
  userId: string,
  phase: Phase,
) {
  const { data, error } = await supabase
    .from("simulation_attempts")
    .select("id, score, started_at, finished_at")
    .eq("user_id", userId)
    .eq("phase", phase)
    .eq("mode", "official")
    .eq("status", "completed")
    .order("finished_at", { ascending: false });

  if (error) throw new Error("Não foi possível carregar o desempenho.");
  return data ?? [];
}
