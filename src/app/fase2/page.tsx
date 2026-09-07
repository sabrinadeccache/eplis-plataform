import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { BackLink } from "@/components/layout/back-link";
import { ModeChooser } from "@/components/simulations/mode-chooser";
import { startAttempt, abandonAndRestartAttempt } from "@/services/simulations/phase2/actions";
import { countAttemptsToday, DAILY_ATTEMPT_LIMIT } from "@/services/simulations/phase2/limits";
import type { Part } from "@/types/database";

const PART_LABEL: Record<Part, string> = {
  part1: "Parte 1",
  part2: "Parte 2",
  part3: "Parte 3",
  part4: "Parte 4",
};

export default async function Fase2Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "pilot") redirect("/dashboard");

  const supabase = await createClient();
  // Pausar só existe no modo practice (o official é fiel ao exame real, sem
  // segunda chance) — ver `pauseAttempt` em InterviewRunner. Uma tentativa
  // `practice` pausada fica `in_progress` aguardando aqui até ser retomada
  // ou abandonada explicitamente.
  const { data: pausedAttempt } = await supabase
    .from("simulation_attempts")
    .select("id, current_part, current_item_index")
    .eq("user_id", user.id)
    .eq("phase", "phase2")
    .eq("mode", "practice")
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Retomar uma tentativa pausada não conta como um novo simulado, então só
  // checamos o limite diário quando não há nenhuma pausada — sem isso,
  // alguém perto do limite não conseguiria nem voltar pra terminar a que já
  // tinha começado.
  const attemptsToday = pausedAttempt ? 0 : await countAttemptsToday(supabase, user.id);
  const limitReached = attemptsToday >= DAILY_ATTEMPT_LIMIT;

  return (
    <AppShell user={user}>
      <BackLink />
      <h1 className="page-title">Fase 2</h1>
      <ModeChooser
        intro="Entrevista simulada: 4 partes — perguntas pessoais, situações operacionais, perguntas abertas e uma imagem para descrever e narrar. Escolha o modo:"
        limitReached={limitReached}
        limitLabel={`Você atingiu o limite de ${DAILY_ATTEMPT_LIMIT} simulados da Fase 2 por dia. Volte amanhã para iniciar um novo.`}
        paused={
          pausedAttempt
            ? {
                href: `/fase2/entrevista/${pausedAttempt.id}`,
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
