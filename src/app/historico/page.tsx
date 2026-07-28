import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";

export default async function HistoricoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Histórico</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Tentativas anteriores e evolução por critério ICAO — em construção (Fase 6 do
        roadmap).
      </p>
    </AppShell>
  );
}
