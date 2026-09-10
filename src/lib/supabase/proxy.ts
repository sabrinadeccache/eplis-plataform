import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /redefinir-senha precisa ser pública mesmo exigindo uma sessão de
// recuperação válida pra funcionar: no momento em que este proxy roda
// (server-side, lendo cookies), o link de recuperação ainda não foi
// processado pelo client Supabase do browser — isso só acontece depois que a
// página carrega. Sem a sessão, a página mostra estado de "link inválido/
// expirado" em vez do formulário (ver src/app/redefinir-senha/page.tsx).
const PUBLIC_PATHS = ["/login", "/cadastro", "/esqueci-senha", "/redefinir-senha"];

// Refreshes the Supabase auth session on every request that passes through
// proxy.ts, keeping cookies valid for both Server Components and Route Handlers,
// and gates access to authenticated routes before any page code runs.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not remove — this call refreshes the session token and must run before
  // any route logic reads the user.
  const { data } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  // Qualquer resposta que NÃO seja o `supabaseResponse` precisa levar junto os
  // cookies que o cliente Supabase acabou de escrever nele (token renovado, ou
  // cookies de sessão limpos quando o refresh token é inválido). Sem isso, um
  // redirect do proxy descarta a sessão renovada: o browser volta com o token
  // velho, o proxy manda pro /login, o /login vê a sessão (via getUser, que
  // renova de novo) e manda pro /dashboard, e assim por diante — "too many
  // redirects". Ver docs do @supabase/ssr (Next.js middleware).
  function redirectTo(path: string) {
    const res = NextResponse.redirect(new URL(path, request.url));
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  }

  if (!data.user && !isPublicPath && pathname !== "/") {
    return redirectTo("/login");
  }

  if (data.user) {
    // Sessão de auth válida — confere a linha em `public.users` em TODA rota
    // (não só nas públicas): conta removida, `handle_new_user` que falhou no
    // cadastro, ou conta `inactive`/`blocked` não podem navegar no app com uma
    // sessão antiga ainda válida. Sem tratar, /login redireciona pro /dashboard,
    // que não acha o perfil e volta pro /login — loop "too many redirects".
    // Só age se a consulta respondeu (erro de rede não desloga ninguém).
    // Isto é UX/porta de entrada — a autorização de verdade é `authorize()`
    // dentro de cada Route Handler / Server Action.
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("id, status")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!profileError && (!profile || profile.status !== "active")) {
      await supabase.auth.signOut();
      return redirectTo(
        profile?.status === "blocked" || profile?.status === "inactive"
          ? "/login?erro=bloqueada"
          : "/login?erro=conta",
      );
    }

    if (isPublicPath) {
      return redirectTo("/dashboard");
    }
  }

  return supabaseResponse;
}
