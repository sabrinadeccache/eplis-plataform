import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { Phase1Runner } from "@/components/fase1/phase1-runner";
import { Phase1PracticeRunner } from "@/components/fase1/phase1-practice-runner";
import { getQuizQuestionsByIds, phase1SequenceIds } from "@/services/simulations/phase1/queries";
import { ensurePhase1Sequence, finishAttempt } from "@/services/simulations/phase1/actions";

export default async function Fase1SimuladoPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, phase, status, mode, item_sequence")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== user.id || attempt.phase !== "phase1") notFound();
  if (attempt.status !== "in_progress") redirect(`/fase1/resultado/${attemptId}`);

  const isPractice = attempt.mode === "practice";
  let questionIds = phase1SequenceIds(attempt.item_sequence);
  if (questionIds.length === 0) questionIds = await ensurePhase1Sequence(attemptId);

  const { count: answeredCount, error: countError } = await supabase
    .from("phase1_answers")
    .select("id", { count: "exact", head: true })
    .eq("simulation_attempt_id", attemptId);
  if (countError) throw new Error("Não foi possível recuperar o progresso do simulado.");
  const startIndex = answeredCount ?? 0;
  if (startIndex >= questionIds.length) {
    await finishAttempt(attemptId);
    redirect(`/fase1/resultado/${attemptId}`);
  }

  const questions = await getQuizQuestionsByIds(questionIds);
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
        <Phase1PracticeRunner attemptId={attemptId} questions={questions} startIndex={startIndex} />
      ) : (
        <Phase1Runner attemptId={attemptId} questions={questions} startIndex={startIndex} />
      )}
    </AppShell>
  );
}
