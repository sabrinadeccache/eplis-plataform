import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";

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
    .select("id, user_id, status, score, started_at, finished_at")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== user.id) notFound();
  if (attempt.status === "in_progress") redirect(`/fase1/simulado/${attemptId}`);

  const { data: answers } = await supabase
    .from("phase1_answers")
    .select(
      "selected_option, is_correct, phase1_questions(prompt, option_a, option_b, option_c, correct_option)",
    )
    .eq("simulation_attempt_id", attemptId);

  const total = answers?.length ?? 0;
  const score = attempt.score ?? 0;

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Resultado — Fase 1
      </h1>
      <p className="mt-1 text-lg text-zinc-700 dark:text-zinc-300">
        {score} de {total} questões corretas
      </p>

      <div className="mt-6 space-y-3">
        {(answers ?? []).map((answer: Record<string, unknown>, i: number) => {
          const question = answer.phase1_questions as {
            prompt: string;
            option_a: string;
            option_b: string;
            option_c: string;
            correct_option: string;
          };
          const optionLabel: Record<string, string> = {
            a: question.option_a,
            b: question.option_b,
            c: question.option_c,
          };
          const isCorrect = answer.is_correct as boolean;

          return (
            <div
              key={i}
              className={`rounded-md border p-4 text-sm ${
                isCorrect
                  ? "border-emerald-300 dark:border-emerald-800"
                  : "border-red-300 dark:border-red-800"
              }`}
            >
              <p className="font-medium text-zinc-900 dark:text-zinc-50">{question.prompt}</p>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                Sua resposta: {optionLabel[answer.selected_option as string]}
              </p>
              {!isCorrect && (
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                  Resposta correta: {optionLabel[question.correct_option]}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <Link
        href="/fase1"
        className="mt-8 inline-block text-sm font-medium text-zinc-900 underline dark:text-zinc-50"
      >
        Fazer novo simulado
      </Link>
    </AppShell>
  );
}
