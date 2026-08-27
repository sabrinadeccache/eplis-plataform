import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import {
  Fase2ProgressChart,
  type Fase2ChartPoint,
} from "@/components/desempenho/fase2-progress-chart";
import type { ProficiencyLevel } from "@/types/database";
import {
  PROFICIENCY_LABEL as LEVEL_LABEL,
  PROFICIENCY_BADGE_CLASS as LEVEL_CLASS,
} from "@/lib/proficiency-display";
import { formatDate } from "@/lib/format-date";

export default async function DesempenhoFase2Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "pilot") redirect("/dashboard");

  const supabase = await createClient();

  const { data: attempts } = await supabase
    .from("simulation_attempts")
    .select("id, started_at, finished_at")
    .eq("user_id", user.id)
    .eq("phase", "phase2")
    .eq("status", "completed")
    .order("finished_at", { ascending: false });

  const attemptIds = (attempts ?? []).map((a) => a.id);

  const { data: feedbacks } =
    attemptIds.length > 0
      ? await supabase
          .from("simulation_feedbacks")
          .select("simulation_attempt_id, overall_score")
          .in("simulation_attempt_id", attemptIds)
      : { data: [] as { simulation_attempt_id: string; overall_score: string | null }[] };

  const levelByAttempt = new Map<string, ProficiencyLevel>();
  for (const row of feedbacks ?? []) {
    if (row.overall_score) {
      levelByAttempt.set(row.simulation_attempt_id, row.overall_score as ProficiencyLevel);
    }
  }

  const rows = (attempts ?? []).map((attempt) => ({
    id: attempt.id,
    date: formatDate(attempt.finished_at ?? attempt.started_at),
    level: levelByAttempt.get(attempt.id) ?? null,
  }));

  const chartPoints: Fase2ChartPoint[] = rows
    .filter((r): r is { id: string; date: string; level: ProficiencyLevel } => r.level !== null)
    .map((r) => ({ attemptId: r.id, date: r.date, level: r.level }));

  return (
    <AppShell user={user}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Desempenho — Fase 2
        </h1>
        <Link
          href="/desempenho"
          className="text-sm text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          Voltar
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Você ainda não concluiu nenhum simulado da Fase 2.
        </p>
      ) : (
        <>
          <Fase2ProgressChart points={chartPoints} />

          <div className="mt-6 space-y-2">
            {rows.map((row) => (
              <Link
                key={row.id}
                href={`/fase2/resultado/${row.id}`}
                className="flex items-center justify-between rounded-md border border-zinc-200 p-4 text-sm transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
              >
                <span className="text-zinc-900 dark:text-zinc-50">Simulado {row.date}</span>
                <span
                  className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                    row.level
                      ? LEVEL_CLASS[row.level]
                      : "border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                  }`}
                >
                  {row.level ? `NÍVEL ${LEVEL_LABEL[row.level].toUpperCase()}` : "SEM RELATÓRIO"}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
