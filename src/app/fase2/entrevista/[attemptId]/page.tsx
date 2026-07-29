import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { InterviewRunner } from "@/components/fase2/interview-runner";
import { getSequenceForAttempt, sequenceHasEnoughItems } from "@/services/simulations/phase2/queries";
import type { Part } from "@/types/database";

export default async function Fase2EntrevistaPage({
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
    .select("id, user_id, phase, status, current_part, current_item_index")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== user.id || attempt.phase !== "phase2") notFound();
  if (attempt.status !== "in_progress") redirect(`/fase2/resultado/${attemptId}`);

  const sequence = await getSequenceForAttempt(attemptId, user.operational_profile);

  if (!sequenceHasEnoughItems(sequence)) {
    return (
      <AppShell user={user}>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Fase 2</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Ainda não há conteúdo suficiente cadastrado para o seu perfil operacional. Tente
          novamente mais tarde.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell user={user}>
      <InterviewRunner
        attemptId={attemptId}
        sequence={sequence}
        initialPart={(attempt.current_part ?? "part1") as Part}
        initialItemIndex={attempt.current_item_index ?? 0}
      />
    </AppShell>
  );
}
