import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Cliente exclusivamente server-side para as mutações que o candidato NÃO pode
// fazer com a própria sessão: gravar nota/estado/posição da tentativa, inserir
// o relatório de feedback, escrever transcrição/feedback nas respostas. A RLS
// e os triggers de `20260910000000_lock_privileged_writes.sql` bloqueiam esses
// campos para o role `authenticated`; só o `service_role` (que este cliente
// usa) passa. A autorização e a posse continuam sendo checadas antes, no
// servidor — este cliente nunca deve ser usado sem um `authorize()` +
// verificação de dono acontecendo primeiro, e a chave nunca pode ser importada
// por Client Component nem exposta ao browser (só é chamada de Server Actions
// e Route Handlers).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase admin não configurado no servidor.");
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
