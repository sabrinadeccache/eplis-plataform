import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { isApproved } from "@/lib/phase1/scoring";
import { formatDate } from "@/lib/format-date";
import {
  Fase1ProgressChart,
  type Fase1ChartPoint,
} from "@/components/desempenho/fase1-progress-chart";
import { HistoryRow } from "@/components/desempenho/history-row";
import { BackLink } from "@/components/layout/back-link";

export default async function DesempenhoFase1Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "pilot") redirect("/dashboard");

  const supabase = await createClient();

  // Só o modo official conta como "prova" — o practice é treino livre.
  const { data: attempts } = await supabase
    .from("simulation_attempts")
    .select("id, score, started_at, finished_at")
    .eq("user_id", user.id)
    .eq("phase", "phase1")
    .eq("mode", "official")
    .eq("status", "completed")
    .order("finished_at", { ascending: false });

  const attemptIds = (attempts ?? []).map((a) => a.id);

  const { data: answers } =
    attemptIds.length > 0
      ? await supabase
          .from("phase1_answers")
          .select("simulation_attempt_id")
          .in("simulation_attempt_id", attemptIds)
      : { data: [] as { simulation_attempt_id: string }[] };

  const totalByAttempt = new Map<string, number>();
  for (const row of answers ?? []) {
    totalByAttempt.set(
      row.simulation_attempt_id,
      (totalByAttempt.get(row.simulation_attempt_id) ?? 0) + 1,
    );
  }

  const rows = (attempts ?? []).map((attempt) => {
    const total = totalByAttempt.get(attempt.id) ?? 0;
    const score = attempt.score ?? 0;
    const approved = isApproved(score, total);
    return {
      id: attempt.id,
      date: formatDate(attempt.finished_at ?? attempt.started_at),
      score,
      total,
      approved,
    };
  });

  const chartPoints: Fase1ChartPoint[] = rows
    .filter((r) => r.total > 0)
    .map((r) => ({
      attemptId: r.id,
      date: r.date,
      percent: (r.score / r.total) * 100,
      approved: r.approved,
    }));

  return (
    <AppShell user={user}>
      <BackLink href="/desempenho">Desempenho</BackLink>
      <h1 className="page-title">Desempenho — Fase 1</h1>

      {rows.length === 0 ? (
        <p className="page-intro">Você ainda não concluiu nenhum simulado da Fase 1.</p>
      ) : (
        <>
          <div className="mt-6">
            <Fase1ProgressChart points={chartPoints} />
          </div>

          <div className="mt-6 space-y-2">
            {rows.map((row) => (
              <HistoryRow
                key={row.id}
                href={`/fase1/resultado/${row.id}`}
                label={`Simulado ${row.date} — ${row.score} acertos${
                  row.total > 0 ? ` de ${row.total}` : ""
                }`}
                badgeText={row.approved ? "Aprovado" : "Reprovado"}
                badgeClass={
                  row.approved
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-danger/40 bg-danger/10 text-danger"
                }
              />
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
