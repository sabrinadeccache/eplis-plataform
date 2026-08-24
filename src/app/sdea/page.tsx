import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { SubmitButton } from "@/components/auth/submit-button";
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
  if (user.role !== "pilot") redirect("/dashboard");

  if (!user.operational_profile || user.operational_profile === "general") {
    return (
      <AppShell user={user}>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">SDEA</h1>
        <p className="mt-2 max-w-lg text-sm text-zinc-500 dark:text-zinc-400">
          Pra iniciar o simulado, primeiro defina seu perfil operacional (avião ou
          helicóptero) no seu perfil.
        </p>
        <a
          href="/perfil"
          className="mt-4 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Completar perfil
        </a>
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
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">SDEA</h1>
      <p className="mt-2 max-w-lg text-sm text-zinc-500 dark:text-zinc-400">
        Santos Dumont English Assessment simulado: 4 partes — perguntas sobre aviação,
        interação por rádio com o controle, situações inesperadas e uma foto para
        descrever e discutir. Escolha o modo:
      </p>

      {limitReached && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Você atingiu o limite de {PILOT_DAILY_ATTEMPT_LIMIT} simulados do SDEA por dia. Volte
          amanhã para iniciar um novo.
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {pausedAttempt ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
            <h2 className="font-medium text-amber-900 dark:text-amber-200">Practice — pausado</h2>
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
              Você parou em {PART_LABEL[(pausedAttempt.current_part ?? "part1") as Part]}, item{" "}
              {(pausedAttempt.current_item_index ?? 0) + 1}.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={`/sdea/entrevista/${pausedAttempt.id}`}
                className="rounded-md bg-amber-900 px-4 py-2 text-sm font-medium text-white dark:bg-amber-200 dark:text-amber-950"
              >
                Continuar simulado
              </a>
              <form action={abandonAndRestartAttempt.bind(null, pausedAttempt.id)}>
                <SubmitButton className="rounded-md border border-amber-300 px-4 py-2 text-sm font-medium text-amber-900 dark:border-amber-700 dark:text-amber-200">
                  Abandonar e começar novo
                </SubmitButton>
              </form>
            </div>
          </div>
        ) : !limitReached ? (
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Practice</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Feedback curto (falado e na tela) após cada resposta, sem limite de tempo pra
              começar a falar nem de repetições, além do relatório completo ao final. Dá pra
              pausar e retomar depois.
            </p>
            <form action={startAttempt.bind(null, "practice")} className="mt-4">
              <SubmitButton>Iniciar modo practice</SubmitButton>
            </form>
          </div>
        ) : null}

        {!limitReached && (
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Official</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Sem feedback durante o simulado — só o relatório completo ao final. A gravação
              começa automaticamente 5s depois de cada pergunta (sem botão &quot;Falar&quot;), só 1
              repetição de pergunta por item, e sem opção de recomeçar a resposta. Fiel ao exame
              real.
            </p>
            <form action={startAttempt.bind(null, "official")} className="mt-4">
              <SubmitButton>Iniciar modo official</SubmitButton>
            </form>
          </div>
        )}
      </div>
    </AppShell>
  );
}
