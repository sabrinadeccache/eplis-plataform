import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import type { ProficiencyLevel, SimulationFeedbackRow } from "@/types/database";
import {
  PROFICIENCY_LABEL as LEVEL_LABEL,
  PROFICIENCY_BADGE_CLASS as LEVEL_CLASS,
} from "@/lib/proficiency-display";

const CRITERIA: { key: keyof SimulationFeedbackRow; label: string }[] = [
  { key: "pronunciation_score", label: "Pronúncia" },
  { key: "structure_score", label: "Estrutura" },
  { key: "vocabulary_score", label: "Vocabulário" },
  { key: "fluency_score", label: "Fluência" },
  { key: "comprehension_score", label: "Compreensão" },
  { key: "interaction_score", label: "Interações" },
];

export default async function Fase2ResultadoPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "pilot") redirect("/dashboard");

  const supabase = await createClient();
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, phase, status")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== user.id || attempt.phase !== "phase2") notFound();
  if (attempt.status === "in_progress") redirect(`/fase2/entrevista/${attemptId}`);

  const { data: feedback } = await supabase
    .from("simulation_feedbacks")
    .select("*")
    .eq("simulation_attempt_id", attemptId)
    .single();

  const { data: responses } = await supabase
    .from("phase2_responses")
    .select("response_stage, transcript, ai_feedback, phase2_prompts(part, prompt_text)")
    .eq("simulation_attempt_id", attemptId)
    .order("created_at", { ascending: true });

  const overall = feedback?.overall_score as ProficiencyLevel | undefined;

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Resultado — Fase 2
      </h1>

      {!feedback ? (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          O relatório ainda não foi gerado.
        </p>
      ) : (
        <>
          <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Nível geral</p>
            <p
              className={`mt-1 inline-block rounded-md border px-3 py-1 text-lg font-semibold ${
                overall ? LEVEL_CLASS[overall] : ""
              }`}
            >
              {overall ? LEVEL_LABEL[overall] : feedback.overall_score}
            </p>
            <p className="mt-2 text-xs text-zinc-400">
              O nível geral é sempre igual ao critério mais fraco entre os seis abaixo — nunca uma
              média — por segurança operacional (Escala OACI).
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {CRITERIA.map(({ key, label }) => {
              const level = feedback[key] as ProficiencyLevel | null;
              return (
                <div
                  key={key}
                  className={`rounded-md border p-3 text-sm ${level ? LEVEL_CLASS[level] : "border-zinc-200 dark:border-zinc-800"}`}
                >
                  <p className="font-medium">{label}</p>
                  <p>{level ? LEVEL_LABEL[level] : "—"}</p>
                </div>
              );
            })}
          </div>

          {feedback.general_feedback && (
            <div className="mt-4 rounded-lg border border-zinc-200 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
              {feedback.general_feedback}
            </div>
          )}
        </>
      )}

      <h2 className="mt-8 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Respostas individuais
      </h2>
      <div className="mt-3 space-y-3">
        {(responses ?? []).map((r: Record<string, unknown>, i: number) => {
          const prompt = r.phase2_prompts as { part: string; prompt_text: string } | null;
          return (
            <div key={i} className="rounded-md border border-zinc-200 p-4 text-sm dark:border-zinc-800">
              <p className="text-xs text-zinc-400">
                {prompt?.part} · {r.response_stage as string}
              </p>
              <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-50">
                {prompt?.prompt_text}
              </p>
              {r.transcript ? (
                <p className="mt-2 text-zinc-700 dark:text-zinc-300">
                  <span className="text-xs font-medium text-zinc-400">Sua resposta: </span>
                  {r.transcript as string}
                </p>
              ) : null}
              {r.ai_feedback ? (
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                  <span className="text-xs font-medium text-zinc-400">Feedback: </span>
                  {r.ai_feedback as string}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <Link
        href="/fase2"
        className="mt-8 inline-block text-sm font-medium text-zinc-900 underline dark:text-zinc-50"
      >
        Fazer nova entrevista
      </Link>
    </AppShell>
  );
}
