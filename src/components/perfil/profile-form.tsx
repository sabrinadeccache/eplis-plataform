"use client";

import { useActionState } from "react";
import { updateProfile, type AuthFormState } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/auth/submit-button";
import { ProfileDetailsFields } from "@/components/perfil/profile-details-fields";
import type { UserRow } from "@/types/database";

const initialState: AuthFormState = { error: null };

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  pilot: "Piloto",
  air_traffic_controller: "Controlador de tráfego aéreo",
};

const PROFILE_LABELS: Record<string, string> = {
  fixed_wing: "Asa fixa",
  rotary_wing: "Asa rotativa",
  general: "Geral",
  TWR: "TWR",
  APP: "APP",
  ACC: "ACC",
  COpM: "COpM",
};

export function ProfileForm({ user }: { user: UserRow }) {
  const [state, formAction] = useActionState(updateProfile, initialState);

  const roleLabel = ROLE_LABELS[user.role] ?? user.role;
  const profileLabel = user.operational_profile
    ? (PROFILE_LABELS[user.operational_profile] ?? user.operational_profile)
    : "não definido";

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="name" className="field-label">
          Nome
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="name"
          defaultValue={user.name}
          className="field-input"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="field-label">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          disabled
          value={user.email}
          className="field-input cursor-not-allowed bg-sunken text-muted"
        />
      </div>

      {/* Profissão e perfil operacional são geridos pelo administrador. */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
        <div className="bg-surface px-3 py-2.5">
          <dt className="text-xs text-muted">Profissão</dt>
          <dd className="mt-0.5 text-sm text-ink">{roleLabel}</dd>
        </div>
        <div className="bg-surface px-3 py-2.5">
          <dt className="text-xs text-muted">Perfil operacional</dt>
          <dd className="mt-0.5 text-sm text-ink">{profileLabel}</dd>
        </div>
      </dl>
      <p className="text-xs leading-relaxed text-muted">
        Para alterar sua profissão ou perfil operacional, entre em contato com o
        administrador.
      </p>

      <ProfileDetailsFields
        role={user.role === "air_traffic_controller" ? "air_traffic_controller" : "pilot"}
        defaults={{
          work_location: user.work_location,
          home_state: user.home_state,
          home_city: user.home_city,
          phone: user.phone,
          current_icao_level: user.current_icao_level,
          icao_level_valid_until: user.icao_level_valid_until,
          exam_target_date: user.exam_target_date,
          training_goal: user.training_goal,
        }}
      />

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

      <SubmitButton>Salvar alterações</SubmitButton>
    </form>
  );
}
