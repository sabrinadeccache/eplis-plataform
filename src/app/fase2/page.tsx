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
        Entrevista simulada (modo practice): 4 partes — perguntas pessoais, situações
        operacionais, perguntas abertas e uma imagem para descrever e narrar. Você recebe um
        feedback curto após cada resposta e um relatório completo ao final, com os 6 critérios
        da Escala OACI.
      </p>

      <form action={startAttempt} className="mt-6">
        <SubmitButton>Iniciar entrevista</SubmitButton>
      </form>
    </AppShell>
  );
}
