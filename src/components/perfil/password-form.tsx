"use client";

import { useActionState, useState } from "react";
import { updatePassword, type AuthFormState } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/auth/submit-button";
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";

const initialState: AuthFormState = { error: null };

export function PasswordForm() {
  const [state, formAction] = useActionState(updatePassword, initialState);
  const [password, setPassword] = useState("");

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="current_password" className="field-label">
          Senha atual
        </label>
        <input
          id="current_password"
          name="current_password"
          type="password"
          required
          autoComplete="current-password"
          className="field-input"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="field-label">
          Nova senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field-input"
        />
        <PasswordStrengthMeter password={password} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirm_password" className="field-label">
          Confirmar nova senha
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="field-input"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.info && (
        <p role="status" className="text-sm text-success">
          {state.info}
        </p>
      )}

      <SubmitButton>Alterar senha</SubmitButton>
    </form>
  );
}
