import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { isApproved } from "@/lib/phase1/scoring";
import { formatDate } from "@/lib/format-date";
import {
  Fase1ProgressChart,
  type Fase1ChartPoint,
} from "@/components/desempenho/fase1-progress-chart";

export default async function DesempenhoFase1Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "pilot") redirect("/dashboard");

  const supabase = await createClient();

  const { data: attempts } = await supabase
    .from("simulation_attempts")
    .select("id, score, started_at, finished_at")
    .eq("user_id", user.id)
    .eq("phase", "phase1")
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Desempenho — Fase 1
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
          Você ainda não concluiu nenhum simulado da Fase 1.
        </p>
      ) : (
        <>
          <Fase1ProgressChart points={chartPoints} />

          <div className="mt-6 space-y-2">
            {rows.map((row) => (
              <Link
                key={row.id}
                href={`/fase1/resultado/${row.id}`}
                className="flex items-center justify-between rounded-md border border-zinc-200 p-4 text-sm transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
              >
                <span className="text-zinc-900 dark:text-zinc-50">
                  Simulado {row.date} — {row.score} acertos
                  {row.total > 0 ? ` de ${row.total}` : ""}
                </span>
                <span
                  className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                    row.approved
                      ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"
                      : "border-red-300 text-red-700 dark:border-red-800 dark:text-red-400"
                  }`}
                >
                  {row.approved ? "APROVADO" : "REPROVADO"}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
