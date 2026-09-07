import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { isDevTester } from "@/lib/auth/dev-testers";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { PilotInterviewRunner } from "@/components/sdea/pilot-interview-runner";
import { getSequenceForAttempt, sequenceHasEnoughItems, type PilotAircraftType } from "@/services/simulations/pilot/queries";
import { canUsePilotTrack, isPilotProfile, sdeaAircraftType } from "@/lib/auth/roles";
import type { Part, SimulationMode } from "@/types/database";

export default async function SdeaEntrevistaPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canUsePilotTrack(user.role)) redirect("/dashboard");

  // Piloto sem avião/helicóptero definido volta pra /sdea (que orienta a
  // contatar o admin); admin sem perfil de piloto roda como asa fixa.
  if (user.role === "pilot" && !isPilotProfile(user.operational_profile)) {
    redirect("/sdea");
  }
  const aircraftType: PilotAircraftType = sdeaAircraftType(user.operational_profile);

  const supabase = await createClient();
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, phase, status, mode, current_part, current_item_index")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== user.id || attempt.phase !== "pilot_interview") notFound();
  if (attempt.status !== "in_progress") redirect(`/sdea/resultado/${attemptId}`);

  const sequence = await getSequenceForAttempt(attemptId, aircraftType);

  if (!sequenceHasEnoughItems(sequence)) {
    return (
      <AppShell user={user}>
        <h1 className="page-title">SDEA</h1>
        <p className="page-intro">
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
        canSkip={isDevTester(user.email)}
      />
    </AppShell>
  );
}
