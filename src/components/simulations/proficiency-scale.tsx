import type { ProficiencyLevel } from "@/types/database";
import {
  PROFICIENCY_LEVELS,
  PROFICIENCY_LABEL,
  PROFICIENCY_COLOR,
} from "@/lib/proficiency-display";

/*
  Elemento central das telas de resultado: a Escala OACI como uma faixa
  contínua de 4 bandas (Fraco → Excelente), com a banda obtida acesa e um
  marcador acima dela. Referência: a régua de mínimos de uma carta de
  aproximação.
*/
export function ProficiencyScale({ level }: { level: ProficiencyLevel | null }) {
  const achievedIndex = level ? PROFICIENCY_LEVELS.indexOf(level) : -1;

  return (
    <div>
      <div className="flex gap-1">
        {PROFICIENCY_LEVELS.map((band, i) => {
          const active = i === achievedIndex;
          return (
            <div key={band} className="flex-1">
              <div
                className="h-2 rounded-full"
                style={{
                  backgroundColor: active
                    ? PROFICIENCY_COLOR[band]
                    : "color-mix(in srgb, var(--muted) 22%, transparent)",
                }}
              />
              <div className="mt-2">
                <span
                  className={active ? "text-xs font-medium text-ink" : "text-xs text-muted"}
                >
                  {PROFICIENCY_LABEL[band]}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CRITERION_LABELS: Record<string, string> = {
  pronunciation_score: "Pronúncia",
  structure_score: "Estrutura",
  vocabulary_score: "Vocabulário",
  fluency_score: "Fluência",
  comprehension_score: "Compreensão",
  interaction_score: "Interações",
};

export function CriteriaGrid({
  criteria,
}: {
  criteria: { key: string; level: ProficiencyLevel | null }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
      {criteria.map(({ key, level }) => (
        <div key={key} className="bg-surface p-3">
          <p className="text-xs text-muted">{CRITERION_LABELS[key] ?? key}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink">
            {level ? (
              <>
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: PROFICIENCY_COLOR[level] }}
                />
                {PROFICIENCY_LABEL[level]}
              </>
            ) : (
              "—"
            )}
          </p>
        </div>
      ))}
    </div>
  );
}
