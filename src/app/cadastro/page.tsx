"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUp, type AuthFormState } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/auth/submit-button";

const initialState: AuthFormState = { error: null };

const OPERATIONAL_PROFILES = [
  { value: "", label: "Ainda não sei" },
  { value: "ab_initio", label: "Ab initio" },
  { value: "TWR", label: "TWR" },
  { value: "APP", label: "APP" },
  { value: "ACC", label: "ACC" },
  { value: "AFIS", label: "AFIS" },
  { value: "FIS", label: "FIS" },
  { value: "COpM", label: "COpM" },
];

export default function CadastroPage() {
  const [state, formAction] = useActionState(signUp, initialState);

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-10 dark:bg-black">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            EPLIS Trainer
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Criar sua conta</p>
        </div>

        <form action={formAction} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Nome
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              autoComplete="name"
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </div>

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
            <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="role" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Você é
            </label>
            <select
              id="role"
              name="role"
              defaultValue="pilot"
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            >
              <option value="pilot">Piloto</option>
              <option value="air_traffic_controller">Controlador de tráfego aéreo</option>
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="operational_profile"
              className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Perfil operacional
            </label>
            <select
              id="operational_profile"
              name="operational_profile"
              defaultValue=""
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            >
              {OPERATIONAL_PROFILES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
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

          <SubmitButton>Criar conta</SubmitButton>
        </form>

        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
          Já tem conta?{" "}
          <Link href="/login" className="font-medium text-zinc-900 underline dark:text-zinc-50">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
