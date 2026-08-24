// Módulo separado (não "use server") de propósito: um arquivo "use server"
// só pode exportar funções async — DAILY_ATTEMPT_LIMIT é uma constante.
// `countAttemptsToday` em si vive em src/lib/simulations/attempt-guards.ts
// (compartilhada com a trilha do piloto), generalizada por `phase`. Reaproveitado
// tanto pela Server Action (startAttempt) quanto pelo Server Component (/fase2)
// que decide se mostra os botões de iniciar ou o aviso de limite atingido.
import {
  countAttemptsToday as countAttemptsTodayShared,
  type SupabaseServerClient,
} from "@/lib/simulations/attempt-guards";

// Teto de custo: cada tentativa completa da Fase 2 dispara várias chamadas
// pagas (Whisper por resposta, TTS por estágio, Claude no relatório final).
// Sem limite nenhum, uma conta aberta ao público sem aprovação prévia (só
// confirmação de e-mail) pode gerar uma fatura de IA sem controle — não é uma
// trava de UX, é proteção de custo real. Ver docs/project-status.md.
export const DAILY_ATTEMPT_LIMIT = 5;

export async function countAttemptsToday(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<number> {
  return countAttemptsTodayShared(supabase, userId, "phase2");
}
