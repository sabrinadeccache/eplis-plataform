import { createClient } from "@/lib/supabase/server";
import type { UserRow } from "@/types/database";

// Used by authenticated Server Components to load the public.users row for
// the current session. Route protection itself lives in middleware.ts —
// this only fetches profile data for pages that already assume a session exists.
export async function getCurrentUser(): Promise<UserRow | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("id", auth.user.id)
    .single();

  const user = (data as UserRow | null) ?? null;

  // Conta `inactive`/`blocked` não opera: as páginas que usam getCurrentUser
  // tratam `null` como "sem sessão" e mandam pro /login (o proxy também barra,
  // mas cada superfície precisa checar — proxy é só UX).
  return user?.status === "active" ? user : null;
}
