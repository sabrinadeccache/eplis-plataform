import type { createAdminClient } from "@/lib/supabase/admin";
import { ItemGuardError } from "./item-guard";

type Admin = ReturnType<typeof createAdminClient>;

// Não liberar por timeout: uma chamada Storage ainda em voo pode terminar
// depois do relógio. Em crash/falha de liberação, a exclusão fica pendente.
export async function withPrivacyUpload<T extends { error: unknown }>(
  admin: Admin,
  userId: string,
  responseId: string,
  track: "phase2" | "pilot",
  upload: () => Promise<T>,
  rollback: () => Promise<{ error: unknown }>,
): Promise<T> {
  const { data: token, error } = await admin.rpc("begin_privacy_upload", { p_user_id: userId, p_response_id: responseId, p_track: track });
  if (error || !token) throw new ItemGuardError("Upload indisponível: conta inativa, em exclusão ou barreira indisponível.", error?.code === "42501" ? 403 : 503);
  // Throw/timeout tem resultado remoto incerto: não liberar. Um erro HTTP
  // concluído pode ser reconciliado apagando o path determinístico; só após
  // DELETE confirmado o ticket sai e o retry volta a funcionar.
  const result = await upload();
  let reconciled = !result.error;
  if (result.error) {
    try {
      reconciled = !(await rollback()).error;
    } catch {
      reconciled = false;
    }
  }
  if (reconciled) {
    const { error: releaseError } = await admin.rpc("finish_privacy_upload", { p_upload_id: token });
    if (releaseError) throw new ItemGuardError("Não foi possível finalizar o registro do upload.", 503);
  }
  return result;
}

export function assertPrivacyWrite(result: { error: { message: string; code?: string } | null }): void {
  if (result.error) {
    throw privacyWriteError(result.error);
  }
}

export function privacyWriteError(error: { message: string; code?: string }): ItemGuardError {
  return new ItemGuardError(
    error.code === "42501" ? "Conteúdo invalidado: conta em exclusão ou gravação em limpeza." : "Não foi possível persistir a resposta.",
    error.code === "42501" ? 403 : 503,
  );
}
