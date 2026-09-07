import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";
import { BackLink } from "@/components/layout/back-link";
import { SubmitButton } from "@/components/auth/submit-button";
import { startAttempt } from "@/services/simulations/phase1/actions";

export default async function Fase1Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "pilot") redirect("/dashboard");

  return (
    <AppShell user={user}>
      <BackLink />
      <h1 className="page-title">Fase 1</h1>
      <p className="page-intro">
        Compreensão auditiva: você ouve comunicações aeronáuticas em inglês e responde uma
        pergunta de múltipla escolha sobre cada uma. Escolha o modo:
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="card flex flex-col p-5">
          <h2 className="font-medium text-ink">Practice</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Sem cronômetro e com replay à vontade. Depois de responder cada questão aparece
            a resposta certa e a <strong className="font-medium text-ink">transcrição
            do áudio</strong> — ouça de novo lendo o texto para treinar o ouvido. Não conta
            no Desempenho.
          </p>
          <form
            action={startAttempt.bind(null, "practice")}
            className="mt-auto flex flex-col gap-3 pt-4"
          >
            <label htmlFor="count" className="field-label">
              Quantas questões
              <select
                id="count"
                name="count"
                defaultValue="10"
                className="field-select mt-1"
              >
                <option value="10">10 questões</option>
                <option value="20">20 questões</option>
                <option value="30">30 questões</option>
              </select>
            </label>
            <SubmitButton className="btn btn-primary w-full">Iniciar practice</SubmitButton>
          </form>
        </div>

        <div className="card flex flex-col p-5">
          <h2 className="font-medium text-ink">Official</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            30 questões, fiel ao exame: 30s para ler a pergunta, o áudio, e 1 minuto para
            responder (incluindo reescuta). O resultado entra no Desempenho.
          </p>
          <form action={startAttempt.bind(null, "official")} className="mt-auto pt-4">
            <SubmitButton className="btn btn-primary w-full">
              Iniciar simulado official
            </SubmitButton>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
