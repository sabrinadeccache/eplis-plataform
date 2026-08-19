"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, type AuthFormState } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/auth/submit-button";

const initialState: AuthFormState = { error: null };

export default function EsqueciSenhaPage() {
  const [state, formAction] = useActionState(requestPasswordReset, initialState);

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Esqueceu a senha?
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Informe seu e-mail para receber um link de redefinição.
          </p>
        </div>

        {state.info ? (
          <p role="status" className="text-center text-sm text-emerald-600 dark:text-emerald-400">
            {state.info}
          </p>
        ) : (
          <form action={formAction} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="email" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                E-mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            </div>

            {state.error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {state.error}
              </p>
            )}

            <SubmitButton>Enviar link</SubmitButton>
          </form>
        )}

        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/login" className="font-medium text-zinc-900 underline dark:text-zinc-50">
            Voltar para o login
          </Link>
        </p>
      </div>
    </div>
  );
}
