import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { isApproved } from "@/lib/phase1/scoring";

export default async function Fase1ResultadoPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, status, score, mode, started_at, finished_at")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== user.id) notFound();
  if (attempt.status === "in_progress") redirect(`/fase1/simulado/${attemptId}`);

  const isPractice = attempt.mode === "practice";

  const { data: answers } = await supabase
    .from("phase1_answers")
    .select(
      "selected_option, is_correct, phase1_questions(prompt, option_a, option_b, option_c, correct_option)",
    )
    .eq("simulation_attempt_id", attemptId);

  const total = answers?.length ?? 0;
  const score = attempt.score ?? 0;
  const errors = total - score;
  const approved = isApproved(score, total);

  return (
    <AppShell user={user}>
      <h1 className="page-title">Resultado — Fase 1{isPractice ? " · practice" : ""}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="text-lg text-ink">
          <span className="data">{score}</span> acertos,{" "}
          <span className="data">{errors}</span> erros — de{" "}
          <span className="data">{total}</span> questões
        </p>
        {!isPractice && (
          <span
            className={`rounded-full border px-3 py-0.5 text-sm font-medium ${
              approved
                ? "border-success/40 bg-success/10 text-success"
                : "border-danger/40 bg-danger/10 text-danger"
            }`}
          >
            {approved ? "Aprovado" : "Reprovado"}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        {isPractice
          ? "Treino livre — não entra no Desempenho."
          : "Aprovação exige pelo menos 70% de acertos."}
      </p>

      <div className="mt-6 space-y-3">
        {(answers ?? []).map((answer: Record<string, unknown>, i: number) => {
          const question = answer.phase1_questions as {
            prompt: string;
            option_a: string;
            option_b: string;
            option_c: string;
            correct_option: string;
          } | null;

          // A RLS de phase1_questions só libera leitura de perguntas com
          // is_active = true — uma pergunta desativada depois da tentativa (ex.:
          // trocada por outra no mesmo áudio) vira null aqui no join em vez de
          // barrar a query inteira. Sem esse guard, a página quebra ao tentar
          // ler campos de um objeto null (era exatamente o crash reportado após
          // finalizar o simulado da Fase 1).
          if (!question) {
            return (
              <div key={i} className="card p-4 text-sm text-muted">
                Questão não disponível mais para exibição (foi removida do banco após esta tentativa).
              </div>
            );
          }

          const optionLabel: Record<string, string> = {
            a: question.option_a,
            b: question.option_b,
            c: question.option_c,
          };
          const isCorrect = answer.is_correct as boolean;

          return (
            <div
              key={i}
              className={`card border-l-2 p-4 text-sm ${
                isCorrect ? "border-l-success" : "border-l-danger"
              }`}
            >
              <p className="font-medium text-ink">{question.prompt}</p>
              <p className="mt-1 text-muted">
                Sua resposta: {optionLabel[answer.selected_option as string]}
              </p>
              {!isCorrect && (
                <p className="mt-1 text-muted">
                  Resposta correta: {optionLabel[question.correct_option]}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <Link href="/fase1" className="btn btn-primary mt-8">
        Fazer novo simulado
      </Link>
    </AppShell>
  );
}
