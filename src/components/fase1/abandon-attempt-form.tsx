"use client";

import { SubmitButton } from "@/components/auth/submit-button";

export function AbandonAttemptForm({ action }: { action: () => void }) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm("Abandonar esta tentativa? O progresso não poderá ser recuperado.")) {
          event.preventDefault();
        }
      }}
    >
      <SubmitButton className="btn btn-secondary w-full">Abandonar</SubmitButton>
    </form>
  );
}

