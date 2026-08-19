"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, type AuthFormState } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/auth/submit-button";

const initialState: AuthFormState = { error: null };

export function LoginForm({ justReset }: { justReset: boolean }) {
  const [state, formAction] = useActionState(signIn, initialState);

  return (
    <div className="w-full max-w-sm space-y-6 rounded-lg border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">EPLIS Trainer</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Entrar na sua conta</p>
      </div>

      {justReset && (
        <p role="status" className="text-center text-sm text-emerald-600 dark:text-emerald-400">
          Senha redefinida. Entre com a nova senha.
        </p>
      )}

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

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Senha
            </label>
            <Link
              href="/esqueci-senha"
              className="text-xs text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Esqueceu a senha?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
        </div>

        {state.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}

        <SubmitButton>Entrar</SubmitButton>
      </form>

      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        Ainda não tem conta?{" "}
        <Link href="/cadastro" className="font-medium text-zinc-900 underline dark:text-zinc-50">
          Cadastre-se
        </Link>
      </p>
    </div>
  );
}
