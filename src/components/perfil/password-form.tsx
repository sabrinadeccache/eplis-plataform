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
      <div className="space-y-1">
        <label
          htmlFor="current_password"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Senha atual
        </label>
        <input
          id="current_password"
          name="current_password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
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
          className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <PasswordStrengthMeter password={password} />
      </div>

      <div className="space-y-1">
        <label
          htmlFor="confirm_password"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Confirmar nova senha
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.info && (
        <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
          {state.info}
        </p>
      )}

      <SubmitButton>Alterar senha</SubmitButton>
    </form>
  );
}
