import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";

export default async function Fase2Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Fase 2</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Entrevista simulada com gravação, transcrição e correção por IA — em construção
        (Fase 5 do roadmap).
      </p>
    </AppShell>
  );
}
