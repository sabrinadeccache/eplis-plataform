"use client";

import { useActionState, useState } from "react";
import { updateProfile, type AuthFormState } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/auth/submit-button";
import type { OperationalProfile, Role, UserRow } from "@/types/database";

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

// Se a conta for admin (papel sem opção neste form), mantém o valor salvo
// como piloto só pra escolher a lista de perfis certa na tela — o server
// action já preserva o role real de admin, não deixa rebaixar.
function initialRole(role: Role): "pilot" | "air_traffic_controller" {
  return role === "air_traffic_controller" ? "air_traffic_controller" : "pilot";
}

export function ProfileForm({ user }: { user: UserRow }) {
  const [state, formAction] = useActionState(updateProfile, initialState);
  const [role, setRole] = useState<"pilot" | "air_traffic_controller">(initialRole(user.role));
  const [operationalProfile, setOperationalProfile] = useState<OperationalProfile | "">(
    user.operational_profile ?? "",
  );

  const profileOptions = role === "pilot" ? PILOT_PROFILES : ATC_PROFILES;

  return (
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
          defaultValue={user.name}
          className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          disabled
          value={user.email}
          className="w-full rounded-md border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-500 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500"
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
            setRole(e.target.value as "pilot" | "air_traffic_controller");
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
          onChange={(e) => setOperationalProfile(e.target.value as OperationalProfile)}
          className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        >
          {profileOptions.map((option) => (
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

      <SubmitButton>Salvar alterações</SubmitButton>
    </form>
  );
}
