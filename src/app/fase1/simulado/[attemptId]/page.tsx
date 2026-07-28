import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { Phase1Runner } from "@/components/fase1/phase1-runner";
import { getRandomQuizQuestions } from "@/services/simulations/phase1/queries";

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
    .select("id, user_id, status")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== user.id) notFound();
  if (attempt.status !== "in_progress") redirect(`/fase1/resultado/${attemptId}`);

  const questions = await getRandomQuizQuestions();
  if (questions.length === 0) {
    return (
      <AppShell user={user}>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Nenhuma questão ativa disponível no momento.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell user={user}>
      <Phase1Runner attemptId={attemptId} questions={questions} />
    </AppShell>
  );
}
