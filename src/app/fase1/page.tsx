import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { BackLink } from "@/components/layout/back-link";
import { SubmitButton } from "@/components/auth/submit-button";
import { AbandonAttemptForm } from "@/components/fase1/abandon-attempt-form";
import { abandonAttempt, startAttempt } from "@/services/simulations/phase1/actions";
import { phase1SequenceIds } from "@/services/simulations/phase1/queries";

export default async function Fase1Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "pilot") redirect("/dashboard");

  const supabase = await createClient();
  const { data: openAttempts } = await supabase
    .from("simulation_attempts")
    .select("id, mode, item_sequence")
    .eq("user_id", user.id)
    .eq("phase", "phase1")
    .eq("status", "in_progress")
    .order("started_at", { ascending: false });
  const openIds = (openAttempts ?? []).map((attempt) => attempt.id);
  const { data: openAnswers } = openIds.length
    ? await supabase.from("phase1_answers").select("simulation_attempt_id").in("simulation_attempt_id", openIds)
    : { data: [] as { simulation_attempt_id: string }[] };
  const answeredByAttempt = new Map<string, number>();
  for (const answer of openAnswers ?? []) {
    answeredByAttempt.set(answer.simulation_attempt_id, (answeredByAttempt.get(answer.simulation_attempt_id) ?? 0) + 1);
  }
  const practiceAttempt = openAttempts?.find((attempt) => attempt.mode === "practice") ?? null;
  const officialAttempt = openAttempts?.find((attempt) => attempt.mode === "official") ?? null;

  return (
    <AppShell user={user}>
      <BackLink />
      <h1 className="page-title">Fase 1</h1>
      <p className="page-intro">
        Compreensão auditiva: você ouve comunicações aeronáuticas em inglês e responde uma
        pergunta de múltipla escolha sobre cada uma. Escolha o modo:
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className={`card flex flex-col p-5 ${practiceAttempt ? "border-l-2 border-l-caution bg-caution/5" : ""}`}>
          <h2 className="font-medium text-ink">Practice</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Sem cronômetro e com replay à vontade. Depois de responder cada questão aparece
            a resposta certa e a <strong className="font-medium text-ink">transcrição
            do áudio</strong> — ouça de novo lendo o texto para treinar o ouvido. Não conta
            no Desempenho.
          </p>
          {practiceAttempt ? (
            <div className="mt-auto pt-4">
              <p className="mb-3 text-sm text-muted">
                Progresso salvo: questão <span className="data">{Math.min((answeredByAttempt.get(practiceAttempt.id) ?? 0) + 1, phase1SequenceIds(practiceAttempt.item_sequence).length || 10)}</span>
                {` de ${phase1SequenceIds(practiceAttempt.item_sequence).length || 10}`}.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <a href={`/fase1/simulado/${practiceAttempt.id}`} className="btn btn-primary w-full">Continuar</a>
                <AbandonAttemptForm action={abandonAttempt.bind(null, practiceAttempt.id)} />
              </div>
            </div>
          ) : (
            <form action={startAttempt.bind(null, "practice")} className="mt-auto flex flex-col gap-3 pt-4">
              <label htmlFor="count" className="field-label">
                Quantas questões
                <select id="count" name="count" defaultValue="10" className="field-select mt-1">
                  <option value="10">10 questões</option>
                  <option value="20">20 questões</option>
                  <option value="30">30 questões</option>
                </select>
              </label>
              <SubmitButton className="btn btn-primary w-full">Iniciar practice</SubmitButton>
            </form>
          )}
        </div>

        <div className={`card flex flex-col p-5 ${officialAttempt ? "border-l-2 border-l-caution bg-caution/5" : ""}`}>
          <h2 className="font-medium text-ink">Official</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            30 questões, fiel ao exame: 30s para ler a pergunta, o áudio, e 1 minuto para
            responder (incluindo reescuta). O resultado entra no Desempenho.
          </p>
          {officialAttempt ? (
            <div className="mt-auto pt-4">
              <p className="mb-3 text-sm text-muted">
                Progresso salvo: questão <span className="data">{Math.min((answeredByAttempt.get(officialAttempt.id) ?? 0) + 1, phase1SequenceIds(officialAttempt.item_sequence).length || 30)}</span>
                {` de ${phase1SequenceIds(officialAttempt.item_sequence).length || 30}`}. A retomada continua do próximo item ainda não respondido.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <a href={`/fase1/simulado/${officialAttempt.id}`} className="btn btn-primary w-full">Continuar</a>
                <AbandonAttemptForm action={abandonAttempt.bind(null, officialAttempt.id)} />
              </div>
            </div>
          ) : (
            <form action={startAttempt.bind(null, "official")} className="mt-auto pt-4">
              <SubmitButton className="btn btn-primary w-full">Iniciar simulado official</SubmitButton>
            </form>
          )}
        </div>
      </div>
    </AppShell>
  );
}
