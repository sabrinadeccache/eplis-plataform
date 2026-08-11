import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";
import { SubmitButton } from "@/components/auth/submit-button";
import { startAttempt } from "@/services/simulations/phase2/actions";

export default async function Fase2Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Fase 2</h1>
      <p className="mt-2 max-w-lg text-sm text-zinc-500 dark:text-zinc-400">
        Entrevista simulada: 4 partes — perguntas pessoais, situações operacionais, perguntas
        abertas e uma imagem para descrever e narrar. Escolha o modo:
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Practice</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Feedback curto (falado e na tela) após cada resposta, sem limite de tempo pra
            começar a falar nem de repetições, além do relatório completo ao final.
          </p>
          <form action={startAttempt.bind(null, "practice")} className="mt-4">
            <SubmitButton>Iniciar modo practice</SubmitButton>
          </form>
        </div>

        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Official</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Sem feedback durante a entrevista — só o relatório completo ao final. A gravação
            começa automaticamente 5s depois de cada pergunta (sem botão &quot;Falar&quot;), só 1
            repetição de pergunta por item, e sem opção de recomeçar a resposta. Fiel ao exame
            real.
          </p>
          <form action={startAttempt.bind(null, "official")} className="mt-4">
            <SubmitButton>Iniciar modo official</SubmitButton>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
