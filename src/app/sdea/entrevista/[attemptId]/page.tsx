import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { PilotInterviewRunner } from "@/components/sdea/pilot-interview-runner";
import { getSequenceForAttempt, sequenceHasEnoughItems, type PilotAircraftType } from "@/services/simulations/pilot/queries";
import type { Part, SimulationMode } from "@/types/database";

export default async function SdeaEntrevistaPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "pilot") redirect("/dashboard");

  const aircraftType = user.operational_profile;
  if (aircraftType !== "fixed_wing" && aircraftType !== "rotary_wing") {
    redirect("/sdea");
  }

  const supabase = await createClient();
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, phase, status, mode, current_part, current_item_index")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== user.id || attempt.phase !== "pilot_interview") notFound();
  if (attempt.status !== "in_progress") redirect(`/sdea/resultado/${attemptId}`);

  const sequence = await getSequenceForAttempt(attemptId, aircraftType as PilotAircraftType);

  if (!sequenceHasEnoughItems(sequence)) {
    return (
      <AppShell user={user}>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">SDEA</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Ainda não há conteúdo suficiente cadastrado para o seu perfil operacional. Tente
          novamente mais tarde.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell user={user}>
      <PilotInterviewRunner
        attemptId={attemptId}
        mode={attempt.mode as SimulationMode}
        sequence={sequence}
        initialPart={(attempt.current_part ?? "part1") as Part}
        initialItemIndex={attempt.current_item_index ?? 0}
      />
    </AppShell>
  );
}
