import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";
import { SubmitButton } from "@/components/auth/submit-button";
import { startAttempt } from "@/services/simulations/phase1/actions";

export default async function Fase1Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "pilot") redirect("/dashboard");

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Fase 1</h1>
      <p className="mt-2 max-w-lg text-sm text-zinc-500 dark:text-zinc-400">
        Compreensão auditiva: você vai ouvir uma série de comunicações aeronáuticas em
        inglês e responder uma pergunta de múltipla escolha sobre cada uma. Você tem 30s
        para ler a pergunta (pode ouvir o áudio antes disso, se quiser) e 1 minuto para
        responder após o áudio, incluindo qualquer reescuta.
      </p>

      <form action={startAttempt} className="mt-6">
        <SubmitButton>Iniciar simulado</SubmitButton>
      </form>
    </AppShell>
  );
}
