"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signUp, type AuthFormState } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/auth/submit-button";
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";
import { AuthShell } from "@/components/auth/auth-shell";
import { ProfileDetailsFields } from "@/components/perfil/profile-details-fields";
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
    <AuthShell
      title="Criar sua conta"
      subtitle="Leva um minuto. Você confirma o e-mail depois."
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/login" className="link font-medium">
            Entrar
          </Link>
        </>
      }
    >
      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="name" className="field-label">
            Nome completo
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="name"
            className="field-input"
          />
        </div>

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

        <div className="space-y-1.5">
          <label htmlFor="role" className="field-label">
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
            className="field-select"
          >
            <option value="pilot">Piloto</option>
            <option value="air_traffic_controller">Controlador de tráfego aéreo</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="operational_profile" className="field-label">
            Perfil operacional atual
          </label>
          <select
            id="operational_profile"
            name="operational_profile"
            value={operationalProfile}
            onChange={(e) => setOperationalProfile(e.target.value)}
            className="field-select"
          >
            {profileOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <p className="text-sm text-muted">
          Exame: <span className="font-medium text-ink">{EXAM_BY_ROLE[role]}</span>
        </p>

        <ProfileDetailsFields
          role={role === "air_traffic_controller" ? "air_traffic_controller" : "pilot"}
        />

        <div className="space-y-1.5 border-t border-line pt-4">
          <label htmlFor="password" className="field-label">
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
            className="field-input"
          />
          <PasswordStrengthMeter password={password} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm_password" className="field-label">
            Confirmar senha
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

        <SubmitButton>Criar conta</SubmitButton>
      </form>
    </AuthShell>
  );
}
