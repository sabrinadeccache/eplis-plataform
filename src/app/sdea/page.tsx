import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { BackLink } from "@/components/layout/back-link";
import { ModeChooser } from "@/components/simulations/mode-chooser";
import { canUsePilotTrack } from "@/lib/auth/roles";
import { startAttempt, abandonAndRestartAttempt } from "@/services/simulations/pilot/actions";
import { countAttemptsToday, PILOT_DAILY_ATTEMPT_LIMIT } from "@/services/simulations/pilot/limits";
import type { Part } from "@/types/database";

const PART_LABEL: Record<Part, string> = {
  part1: "Parte 1",
  part2: "Parte 2",
  part3: "Parte 3",
  part4: "Parte 4",
};

export default async function SdeaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canUsePilotTrack(user.role)) redirect("/dashboard");

  // Só o piloto precisa ter escolhido avião/helicóptero; admin roda como asa
  // fixa por padrão (ver sdeaAircraftType).
  if (user.role === "pilot" && (!user.operational_profile || user.operational_profile === "general")) {
    return (
      <AppShell user={user}>
        <BackLink />
        <h1 className="page-title">SDEA</h1>
        <p className="page-intro">
          Seu perfil operacional (avião ou helicóptero) ainda não foi definido — ele é
          necessário para montar o simulado. Entre em contato com o administrador para
          configurá-lo.
        </p>
      </AppShell>
    );
  }

  const supabase = await createClient();
  const { data: pausedAttempt } = await supabase
    .from("simulation_attempts")
    .select("id, current_part, current_item_index")
    .eq("user_id", user.id)
    .eq("phase", "pilot_interview")
    .eq("mode", "practice")
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const attemptsToday = pausedAttempt ? 0 : await countAttemptsToday(supabase, user.id);
  const limitReached = attemptsToday >= PILOT_DAILY_ATTEMPT_LIMIT;

  return (
    <AppShell user={user}>
      <BackLink />
      <h1 className="page-title">SDEA</h1>
      <ModeChooser
        intro="Santos Dumont English Assessment simulado: 4 partes — perguntas sobre aviação, interação por rádio com o controle, situações inesperadas e uma foto para descrever e discutir. Escolha o modo:"
        limitReached={limitReached}
        limitLabel={`Você atingiu o limite de ${PILOT_DAILY_ATTEMPT_LIMIT} simulados do SDEA por dia. Volte amanhã para iniciar um novo.`}
        paused={
          pausedAttempt
            ? {
                href: `/sdea/entrevista/${pausedAttempt.id}`,
                partLabel:
                  PART_LABEL[(pausedAttempt.current_part ?? "part1") as Part],
                itemNumber: (pausedAttempt.current_item_index ?? 0) + 1,
                restartAction: abandonAndRestartAttempt.bind(null, pausedAttempt.id),
              }
            : null
        }
        startPractice={startAttempt.bind(null, "practice")}
        startOfficial={startAttempt.bind(null, "official")}
      />
    </AppShell>
  );
}
