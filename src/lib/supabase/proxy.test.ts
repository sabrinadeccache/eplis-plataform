import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// **Achado real (2026-09-12, revisão do M3):** o proxy interceptava
// `/api/cron/expire-recordings` e redirecionava pra `/login` por falta de
// sessão — a chamada do Vercel Cron não manda cookie nenhum, só o header
// `Authorization` que a PRÓPRIA rota confere contra `CRON_SECRET`.
// Configurar a variável sozinho não resolvia: a execução nunca alcançava a
// rota. Este teste garante que a rota de cron passa direto pelo proxy, sem
// sequer tocar no client do Supabase (nenhuma sessão é checada) — e que
// isso não abre uma porta pública: a rota em si (route.test.ts) é quem
// continua exigindo o segredo.
const createServerClient = vi.fn();
vi.mock("@supabase/ssr", () => ({ createServerClient }));

const { updateSession } = await import("./proxy");

describe("updateSession — bypass de sessão pra rotas de segredo compartilhado", () => {
  it("deixa /api/cron/* passar direto, sem consultar sessão nenhuma", async () => {
    const request = new NextRequest("https://eplis-trainer.vercel.app/api/cron/expire-recordings");
    const response = await updateSession(request);

    expect(createServerClient).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("continua gateando por sessão qualquer outra rota (ex.: /api/recordings/...)", async () => {
    createServerClient.mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    });
    const request = new NextRequest("https://eplis-trainer.vercel.app/api/recordings/phase2/resp-1");
    const response = await updateSession(request);

    expect(createServerClient).toHaveBeenCalled();
    expect(response.status).toBe(307); // redirect pro /login
    expect(response.headers.get("location")).toContain("/login");
  });
});
