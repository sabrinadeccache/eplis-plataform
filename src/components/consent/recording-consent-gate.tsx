"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptRecordingConsent } from "@/services/consent/actions";
import { CONSENT_SECTIONS } from "@/lib/simulations/consent";

// Tela de bloqueio ANTES da 1ª gravação — Milestone 3.3 (ver
// docs/project-status.md). Renderizada no lugar do runner da entrevista
// (não é um modal por cima dela) enquanto o usuário não aceitou a versão
// atual do consentimento — quem chega aqui ainda não gravou nada, então não
// há retrocesso de UX em bloquear antes de mostrar a IHM da entrevista.
//
// `router.refresh()` depois do aceite: a Server Action já revalida as rotas
// de entrevista (`revalidatePath`), mas o componente client MONTADO agora
// (esta própria tela) só busca os dados de novo do servidor com um refresh
// explícito — sem isso o candidato ficaria olhando pra este gate mesmo
// depois de aceitar, até navegar pra outro lugar e voltar.
export function RecordingConsentGate() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function accept() {
    setError(null);
    startTransition(async () => {
      try {
        await acceptRecordingConsent();
        router.refresh();
      } catch {
        setError("Não foi possível registrar o consentimento. Tente novamente.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="page-title">Antes de começar</h1>
      <p className="page-intro">
        Esta entrevista simulada grava sua voz. Leia com atenção antes de continuar.
      </p>

      <div className="space-y-4">
        {CONSENT_SECTIONS.map((section) => (
          <div key={section.title} className="card space-y-1">
            <h2 className="section-head">{section.title}</h2>
            <p className="text-sm text-muted">{section.body}</p>
          </div>
        ))}
      </div>

      {error && <div className="note note-danger">{error}</div>}

      <button type="button" className="btn btn-primary" onClick={accept} disabled={isPending}>
        {isPending ? "Registrando…" : "Li e concordo — continuar"}
      </button>
    </div>
  );
}
