"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { OperationalProfile, Role } from "@/types/database";

export type AuthFormState = {
  error: string | null;
  info?: string | null;
};

const OPERATIONAL_PROFILES: OperationalProfile[] = [
  "TWR",
  "APP",
  "ACC",
  "AFIS",
  "FIS",
  "COpM",
  "ab_initio",
  "general",
];

export async function signUp(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "pilot") as Role;
  const operationalProfileRaw = String(formData.get("operational_profile") ?? "");
  const operationalProfile = OPERATIONAL_PROFILES.includes(
    operationalProfileRaw as OperationalProfile,
  )
    ? (operationalProfileRaw as OperationalProfile)
    : null;

  if (!name || !email || !password) {
    return { error: "Preencha nome, e-mail e senha." };
  }
  if (password.length < 8) {
    return { error: "A senha precisa ter no mínimo 8 caracteres." };
  }
  if (role !== "pilot" && role !== "air_traffic_controller") {
    return { error: "Perfil inválido." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        role,
        target_exam: "EPLIS",
        operational_profile: operationalProfile,
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (!data.session) {
    return {
      error: null,
      info: "Cadastro criado. Confirme seu e-mail antes de entrar.",
    };
  }

  redirect("/dashboard");
}

export async function signIn(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Informe e-mail e senha." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "E-mail ou senha inválidos." };
  }

  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
