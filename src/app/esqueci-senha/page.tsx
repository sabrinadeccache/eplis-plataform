"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, type AuthFormState } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/auth/submit-button";
import { AuthShell } from "@/components/auth/auth-shell";

const initialState: AuthFormState = { error: null };

export default function EsqueciSenhaPage() {
  const [state, formAction] = useActionState(requestPasswordReset, initialState);

  return (
    <AuthShell
      title="Esqueceu a senha?"
      subtitle="Informe seu e-mail para receber um link de redefinição."
      footer={
        <Link href="/login" className="link font-medium">
          Voltar para o login
        </Link>
      }
    >
      {state.info ? (
        <p role="status" className="note note-success">
          {state.info}
        </p>
      ) : (
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="field-label">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="field-input"
            />
          </div>

          {state.error && (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          )}

          <SubmitButton>Enviar link</SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
