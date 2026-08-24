// Módulo separado (não "use server") de propósito: um arquivo "use server"
// só pode exportar funções async — DAILY_ATTEMPT_LIMIT é uma constante, e
// countAttemptsToday recebe o client do Supabase como argumento (não
// serializável), então não pode viver em actions.ts. Reaproveitado tanto pela
// Server Action (startAttempt) quanto pelo Server Component (/fase2) que
// decide se mostra os botões de iniciar ou o aviso de limite atingido.
import type { SupabaseServerClient } from "@/services/simulations/phase2/actions";

// Teto de custo: cada tentativa completa da Fase 2 dispara várias chamadas
// pagas (Whisper por resposta, TTS por estágio, Claude no relatório final).
// Sem limite nenhum, uma conta aberta ao público sem aprovação prévia (só
// confirmação de e-mail) pode gerar uma fatura de IA sem controle — não é uma
// trava de UX, é proteção de custo real. Ver docs/project-status.md.
export const DAILY_ATTEMPT_LIMIT = 5;

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

export async function countAttemptsToday(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<number> {
  const { count } = await supabase
    .from("simulation_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("phase", "phase2")
    .gte("started_at", startOfTodayIso());
  return count ?? 0;
}
