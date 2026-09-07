import { SubmitButton } from "@/components/auth/submit-button";

type PausedInfo = {
  href: string;
  partLabel: string;
  itemNumber: number;
  restartAction: () => void;
};

/*
  Seleção de modo (practice / official) compartilhada por Fase 2 e SDEA.
  As ações já chegam vinculadas (`startAttempt.bind(null, "practice")` etc.).

  Layout: dois cartões lado a lado num grid que estica os dois pra mesma altura;
  cada cartão é `flex flex-col` e a linha de botões fica em `mt-auto`, então as
  barras de ação alinham no rodapé independente do tamanho do texto.
*/
export function ModeChooser({
  intro,
  limitReached,
  limitLabel,
  paused,
  startPractice,
  startOfficial,
}: {
  intro: string;
  limitReached: boolean;
  limitLabel: string;
  paused: PausedInfo | null;
  startPractice: () => void;
  startOfficial: () => void;
}) {
  return (
    <>
      <p className="page-intro">{intro}</p>

      {limitReached && <p className="note note-caution mt-6">{limitLabel}</p>}

      {!limitReached && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {paused ? (
            <div className="card flex flex-col border-l-2 border-l-caution bg-caution/5 p-5">
              <h2 className="font-medium text-ink">Practice — pausado</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Você parou em {paused.partLabel}, item{" "}
                <span className="data">{paused.itemNumber}</span>.
              </p>
              <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
                <a href={paused.href} className="btn btn-primary w-full">
                  Continuar simulado
                </a>
                <form action={paused.restartAction}>
                  <SubmitButton className="btn btn-secondary w-full">
                    Começar novo simulado
                  </SubmitButton>
                </form>
              </div>
            </div>
          ) : (
            <div className="card flex flex-col p-5">
              <h2 className="font-medium text-ink">Practice</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Feedback curto (falado e na tela) após cada resposta, sem limite de tempo
                pra começar a falar nem de repetições, além do relatório completo ao final.
                Dá pra pausar e retomar depois.
              </p>
              <form action={startPractice} className="mt-auto pt-4">
                <SubmitButton className="btn btn-primary w-full">
                  Iniciar modo practice
                </SubmitButton>
              </form>
            </div>
          )}

          <div className="card flex flex-col p-5">
            <h2 className="font-medium text-ink">Official</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Sem feedback durante o simulado — só o relatório completo ao final. A gravação
              começa automaticamente 5s depois de cada pergunta (sem botão &quot;Falar&quot;),
              só 1 repetição de pergunta por item, e sem opção de recomeçar a resposta. Fiel
              ao exame real.
            </p>
            <form action={startOfficial} className="mt-auto pt-4">
              <SubmitButton className="btn btn-primary w-full">
                Iniciar modo official
              </SubmitButton>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
