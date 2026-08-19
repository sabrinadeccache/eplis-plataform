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

  if (!data.user && !isPublicPath && pathname !== "/") {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (data.user && isPublicPath) {
    const dashboardUrl = new URL("/dashboard", request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  return supabaseResponse;
}
