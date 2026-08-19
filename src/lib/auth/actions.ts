"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { evaluatePasswordStrength } from "@/lib/auth/password";
import type { OperationalProfile, Role } from "@/types/database";

export type AuthFormState = {
  error: string | null;
  info?: string | null;
};

const ATC_OPERATIONAL_PROFILES: OperationalProfile[] = ["TWR", "APP", "ACC", "COpM"];
const PILOT_OPERATIONAL_PROFILES: OperationalProfile[] = ["fixed_wing", "rotary_wing"];

function allowedProfilesForRole(role: Role): OperationalProfile[] {
  return role === "pilot" ? PILOT_OPERATIONAL_PROFILES : ATC_OPERATIONAL_PROFILES;
}

// Cada profissão treina para um exame diferente — controlador de tráfego
// aéreo faz o EPLIS (SISCEAB/DECEA); piloto faz o Santos Dumont English
// Assessment. Derivado do role no cadastro, não escolhido pelo usuário.
function targetExamForRole(role: Role): string {
  return role === "pilot" ? "Santos Dumont English Assessment" : "EPLIS";
}

const PASSWORD_STRENGTH_ERROR =
  "Senha muito fraca — use ao menos 8 caracteres combinando letras maiúsculas, minúsculas, números e símbolos (pelo menos 3 desses tipos).";

async function requestOrigin(): Promise<string> {
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

export async function signUp(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");
  const role = String(formData.get("role") ?? "pilot") as Role;
  const operationalProfileRaw = String(formData.get("operational_profile") ?? "");

  if (!name || !email || !password || !confirmPassword) {
    return { error: "Preencha nome, e-mail e senha." };
  }
  if (role !== "pilot" && role !== "air_traffic_controller") {
    return { error: "Perfil inválido." };
  }
  if (password !== confirmPassword) {
    return { error: "As senhas não coincidem." };
  }
  if (!evaluatePasswordStrength(password).isStrongEnough) {
    return { error: PASSWORD_STRENGTH_ERROR };
  }

  const allowedProfiles = allowedProfilesForRole(role);
  const operationalProfile = allowedProfiles.includes(
    operationalProfileRaw as OperationalProfile,
  )
    ? (operationalProfileRaw as OperationalProfile)
    : null;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        role,
        target_exam: targetExamForRole(role),
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

export async function requestPasswordReset(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const genericInfo =
    "Se esse e-mail estiver cadastrado, você vai receber um link para redefinir sua senha.";

  if (!email) {
    return { error: "Informe seu e-mail." };
  }

  const supabase = await createClient();
  const origin = await requestOrigin();

  // Não checa/propaga o resultado real da chamada — sempre a mesma mensagem
  // genérica, exista ou não o e-mail, pra não permitir enumerar contas.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/redefinir-senha`,
  });

  return { error: null, info: genericInfo };
}

export async function updateProfile(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "") as Role;
  const operationalProfileRaw = String(formData.get("operational_profile") ?? "");

  if (!name) {
    return { error: "O nome não pode ficar em branco." };
  }
  if (role !== "pilot" && role !== "air_traffic_controller") {
    return { error: "Perfil inválido." };
  }

  const allowedProfiles = allowedProfilesForRole(role);
  const operationalProfile = allowedProfiles.includes(
    operationalProfileRaw as OperationalProfile,
  )
    ? (operationalProfileRaw as OperationalProfile)
    : null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return { error: "Sessão expirada. Entre novamente." };
  }

  // O formulário de perfil só oferece piloto/controlador — se a conta for
  // admin (papel que não passa por este formulário), o `role` não é tocado
  // pra não rebaixar a conta sem querer.
  const { data: current } = await supabase
    .from("users")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  const nextRole = current?.role === "admin" ? "admin" : role;

  const { error } = await supabase
    .from("users")
    .update({ name, role: nextRole, operational_profile: operationalProfile })
    .eq("id", auth.user.id);

  if (error) {
    return { error: "Não foi possível salvar as alterações. Tente novamente." };
  }

  // Sem isso, a rota /perfil não é re-renderizada nem tem seu cache
  // invalidado (uma action só ganha isso de graça se chamar updateTag/
  // revalidatePath/refresh/redirect ou mexer em cookies — ver
  // node_modules/next/dist/docs/01-app/02-guides/server-actions.md), então a
  // tela mostrava o snapshot em cache de antes da edição ao navegar pra fora
  // e voltar — parecendo que nome/profissão/perfil operacional "voltaram".
  revalidatePath("/perfil");

  return { error: null, info: "Dados atualizados." };
}

export async function updatePassword(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const currentPassword = String(formData.get("current_password") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!currentPassword || !password || !confirmPassword) {
    return { error: "Preencha a senha atual, a nova senha e a confirmação." };
  }
  if (password !== confirmPassword) {
    return { error: "As senhas não coincidem." };
  }
  if (!evaluatePasswordStrength(password).isStrongEnough) {
    return { error: PASSWORD_STRENGTH_ERROR };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.email) {
    return { error: "Sessão expirada. Entre novamente." };
  }

  // Reautentica com a senha atual antes de trocar — evita que alguém com a
  // sessão aberta (ex.: dispositivo destravado) troque a senha sem saber a
  // atual, mesmo o Supabase não exigindo isso pra updateUser com sessão
  // válida.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: auth.user.email,
    password: currentPassword,
  });
  if (reauthError) {
    return { error: "Senha atual incorreta." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }

  return { error: null, info: "Senha alterada." };
}
