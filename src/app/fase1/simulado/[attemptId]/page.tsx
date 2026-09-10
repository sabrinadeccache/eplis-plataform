import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { Phase1Runner } from "@/components/fase1/phase1-runner";
import { Phase1PracticeRunner } from "@/components/fase1/phase1-practice-runner";
import { getRandomQuizQuestions } from "@/services/simulations/phase1/queries";

const PRACTICE_COUNTS = [10, 20, 30];

export default async function Fase1SimuladoPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ n?: string }>;
}) {
  const { attemptId } = await params;
  const { n } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, status, mode")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== user.id) notFound();
  if (attempt.status !== "in_progress") redirect(`/fase1/resultado/${attemptId}`);

  const isPractice = attempt.mode === "practice";
  const requested = Number(n);
  const count = isPractice && PRACTICE_COUNTS.includes(requested) ? requested : 30;

  const questions = await getRandomQuizQuestions(count, user.id);
  if (questions.length === 0) {
    return (
      <AppShell user={user}>
        <p className="page-intro">Nenhuma questão ativa disponível no momento.</p>
      </AppShell>
    );
  }

  return (
    <AppShell user={user}>
      {isPractice ? (
        <Phase1PracticeRunner attemptId={attemptId} questions={questions} />
      ) : (
        <Phase1Runner attemptId={attemptId} questions={questions} />
      )}
    </AppShell>
  );
}
