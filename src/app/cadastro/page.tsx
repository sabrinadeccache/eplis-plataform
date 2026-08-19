"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signUp, type AuthFormState } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/auth/submit-button";
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";
import type { Role } from "@/types/database";

const initialState: AuthFormState = { error: null };

const ATC_PROFILES = [
  { value: "", label: "Ainda não sei" },
  { value: "TWR", label: "TWR" },
  { value: "APP", label: "APP" },
  { value: "ACC", label: "ACC" },
  { value: "COpM", label: "COpM" },
];

const PILOT_PROFILES = [
  { value: "", label: "Ainda não sei" },
  { value: "fixed_wing", label: "Asa fixa" },
  { value: "rotary_wing", label: "Asa rotativa" },
];

const EXAM_BY_ROLE: Record<Role, string> = {
  pilot: "Santos Dumont English Assessment",
  air_traffic_controller: "EPLIS",
  admin: "",
};

export default function CadastroPage() {
  const [state, formAction] = useActionState(signUp, initialState);
  const [role, setRole] = useState<Role>("pilot");
  const [operationalProfile, setOperationalProfile] = useState("");
  const [password, setPassword] = useState("");

  const profileOptions = role === "pilot" ? PILOT_PROFILES : ATC_PROFILES;

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
              Nome completo
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
            <label htmlFor="role" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Profissão
            </label>
            <select
              id="role"
              name="role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role);
                setOperationalProfile("");
              }}
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
              Perfil operacional atual
            </label>
            <select
              id="operational_profile"
              name="operational_profile"
              value={operationalProfile}
              onChange={(e) => setOperationalProfile(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            >
              {profileOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Exame: <span className="font-medium text-zinc-700 dark:text-zinc-300">{EXAM_BY_ROLE[role]}</span>
          </p>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Criar senha
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
              Confirmar senha
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
