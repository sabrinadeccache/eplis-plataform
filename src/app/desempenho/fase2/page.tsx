import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { BackLink } from "@/components/layout/back-link";
import {
  Fase2ProgressChart,
  type Fase2ChartPoint,
} from "@/components/desempenho/fase2-progress-chart";
import type { ProficiencyLevel } from "@/types/database";
import { HistoryRow } from "@/components/desempenho/history-row";
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
      <BackLink href="/desempenho">Desempenho</BackLink>
      <h1 className="page-title">Desempenho — Fase 2</h1>

      {rows.length === 0 ? (
        <p className="page-intro">Você ainda não concluiu nenhum simulado da Fase 2.</p>
      ) : (
        <>
          <div className="mt-6">
            <Fase2ProgressChart points={chartPoints} />
          </div>

          <div className="mt-6 space-y-2">
            {rows.map((row) => (
              <HistoryRow
                key={row.id}
                href={`/fase2/resultado/${row.id}`}
                label={`Simulado ${row.date}`}
                badgeText={row.level ? `Nível ${LEVEL_LABEL[row.level]}` : "Sem relatório"}
                badgeClass={
                  row.level ? LEVEL_CLASS[row.level] : "border-line bg-sunken text-muted"
                }
              />
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
