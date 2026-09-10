import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Role, UserRow } from "@/types/database";
import { canUseControllerTrack, canUsePilotTrack } from "@/lib/auth/roles";

export type AuthErrorCode = "unauthenticated" | "inactive" | "forbidden";

// Erro tipado e seguro para página/API — a `message` pode ir pro cliente sem
// vazar detalhe interno; `status` mapeia direto pra resposta HTTP das rotas.
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = code === "unauthenticated" ? 401 : 403;
  }
}

type ServerSupabase = SupabaseClient<Database>;

export type AuthorizeOptions = {
  // Trilha exigida pela rota. `controller` = EPLIS (Fase 1 e Fase 2);
  // `pilot` = SDEA. `admin` atende as duas.
  track?: "controller" | "pilot";
  // Papéis aceitos, quando a regra não é "trilha" e sim um papel específico.
  roles?: Role[];
};

// Função autoritativa de autorização. Roda no proxy (UX) E em cada Route
// Handler / Server Action — o proxy NÃO substitui esta checagem no servidor.
// Exige sessão válida, carrega a linha de `public.users`, recusa qualquer
// operação para quem não está `active`, e aplica a trilha/papel da rota.
export async function authorize(
  supabase: ServerSupabase,
  options: AuthorizeOptions = {},
): Promise<{ user: UserRow }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    throw new AuthError("unauthenticated", "Sessão expirada. Entre novamente.");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (!profile) {
    throw new AuthError("unauthenticated", "Conta não encontrada.");
  }

  const user = profile as UserRow;

  if (user.status !== "active") {
    throw new AuthError(
      "inactive",
      "Esta conta está bloqueada ou inativa. Fale com o administrador.",
    );
  }

  if (options.track === "controller" && !canUseControllerTrack(user.role)) {
    throw new AuthError("forbidden", "Sem permissão para esta área.");
  }
  if (options.track === "pilot" && !canUsePilotTrack(user.role)) {
    throw new AuthError("forbidden", "Sem permissão para esta área.");
  }
  if (options.roles && !options.roles.includes(user.role)) {
    throw new AuthError("forbidden", "Sem permissão para esta área.");
  }

  return { user };
}

// Versão para Server Actions chamadas por formulário: converte o erro tipado
// em redirect (a UX que o app já tinha), em vez de estourar o overlay de erro.
export async function authorizeOrRedirect(
  supabase: ServerSupabase,
  options: AuthorizeOptions = {},
): Promise<{ user: UserRow }> {
  try {
    return await authorize(supabase, options);
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === "unauthenticated") redirect("/login?erro=sessao");
      if (error.code === "inactive") {
        await supabase.auth.signOut();
        redirect("/login?erro=bloqueada");
      }
      redirect("/dashboard");
    }
    throw error;
  }
}
