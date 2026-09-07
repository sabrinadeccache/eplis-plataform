import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import type { ProficiencyLevel, SimulationFeedbackRow } from "@/types/database";
import { PROFICIENCY_LABEL as LEVEL_LABEL } from "@/lib/proficiency-display";
import { canUsePilotTrack } from "@/lib/auth/roles";
import {
  ProficiencyScale,
  CriteriaGrid,
} from "@/components/simulations/proficiency-scale";

const CRITERIA_KEYS: (keyof SimulationFeedbackRow)[] = [
  "pronunciation_score",
  "structure_score",
  "vocabulary_score",
  "fluency_score",
  "comprehension_score",
  "interaction_score",
];

export default async function SdeaResultadoPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canUsePilotTrack(user.role)) redirect("/dashboard");

  const supabase = await createClient();
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, phase, status")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== user.id || attempt.phase !== "pilot_interview") notFound();
  if (attempt.status === "in_progress") redirect(`/sdea/entrevista/${attemptId}`);

  const { data: feedback } = await supabase
    .from("simulation_feedbacks")
    .select("*")
    .eq("simulation_attempt_id", attemptId)
    .single();

  const { data: responses } = await supabase
    .from("pilot_responses")
    .select("response_stage, transcript, ai_feedback, pilot_prompts(part, prompt_text)")
    .eq("simulation_attempt_id", attemptId)
    .order("created_at", { ascending: true });

  const overall = feedback?.overall_score as ProficiencyLevel | undefined;

  return (
    <AppShell user={user}>
      <h1 className="page-title">Resultado — SDEA</h1>

      {!feedback ? (
        <p className="page-intro">O relatório ainda não foi gerado.</p>
      ) : (
        <>
          <div className="card mt-5 p-5">
            <div className="section-head">
              <p className="text-sm font-medium text-ink">Nível geral</p>
              <p className="text-lg font-semibold text-ink">
                {overall ? LEVEL_LABEL[overall] : feedback.overall_score}
              </p>
            </div>
            <div className="mt-5">
              <ProficiencyScale level={overall ?? null} />
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted">
              O nível geral é sempre igual ao critério mais fraco entre os seis abaixo —
              nunca uma média — por segurança operacional (Escala OACI).
            </p>
          </div>

          <div className="mt-4">
            <CriteriaGrid
              criteria={CRITERIA_KEYS.map((key) => ({
                key,
                level: feedback[key] as ProficiencyLevel | null,
              }))}
            />
          </div>

          {feedback.general_feedback && (
            <div className="note mt-4">{feedback.general_feedback}</div>
          )}
        </>
      )}

      <div className="section-head mt-10">
        <h2 className="text-sm font-medium text-ink">Respostas individuais</h2>
      </div>
      <div className="mt-4 space-y-3">
        {(responses ?? []).map((r: Record<string, unknown>, i: number) => {
          const prompt = r.pilot_prompts as { part: string; prompt_text: string } | null;
          return (
            <div key={i} className="card p-4 text-sm">
              <p className="data text-xs text-muted">
                {prompt?.part} · {r.response_stage as string}
              </p>
              <p className="mt-1 font-medium text-ink">{prompt?.prompt_text}</p>
              {r.transcript ? (
                <p className="mt-2 text-ink">
                  <span className="text-xs font-medium text-muted">Answer: </span>
                  {r.transcript as string}
                </p>
              ) : null}
              {r.ai_feedback ? (
                <p className="mt-1 text-muted">
                  <span className="text-xs font-medium text-muted">Feedback: </span>
                  {r.ai_feedback as string}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <Link href="/sdea" className="btn btn-primary mt-8">
        Fazer novo simulado
      </Link>
    </AppShell>
  );
}
