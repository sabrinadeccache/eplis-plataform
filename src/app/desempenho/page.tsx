import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";

export default async function DesempenhoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const isPilot = user.role === "pilot";

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Desempenho</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        {isPilot
          ? "Veja seus simulados anteriores do SDEA e sua evolução."
          : "Escolha uma fase para ver seus simulados anteriores e sua evolução."}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {isPilot ? (
          <a
            href="/desempenho/sdea"
            className="rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
          >
            <h2 className="font-medium text-zinc-900 dark:text-zinc-50">SDEA</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Simulados do Santos Dumont English Assessment, nível geral obtido e evolução por
              simulado.
            </p>
          </a>
        ) : (
          <>
            <a
              href="/desempenho/fase1"
              className="rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
            >
              <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Fase 1</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Simulados de compreensão auditiva, aprovação e evolução do percentual de acertos.
              </p>
            </a>
            <a
              href="/desempenho/fase2"
              className="rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
            >
              <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Fase 2</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Entrevistas simuladas, nível geral obtido e evolução por simulado.
              </p>
            </a>
          </>
        )}
      </div>
    </AppShell>
  );
}
