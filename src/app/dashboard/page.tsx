import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  pilot: "Piloto",
  air_traffic_controller: "Controlador de tráfego aéreo",
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Olá, {user.name}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {ROLE_LABELS[user.role] ?? user.role} · Perfil operacional:{" "}
        {user.operational_profile ?? "não definido"}
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <a
          href="/fase1"
          className="rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
        >
          <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Fase 1</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Compreensão auditiva — 30 questões
          </p>
        </a>
        <a
          href="/fase2"
          className="rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
        >
          <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Fase 2</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Entrevista simulada
          </p>
        </a>
        <a
          href="/historico"
          className="rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
        >
          <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Histórico</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Tentativas e evolução
          </p>
        </a>
      </div>
    </AppShell>
  );
}
