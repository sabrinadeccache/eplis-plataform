import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const expireRecordings = vi.fn();
vi.mock("@/lib/simulations/retention", () => ({ expireRecordings }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { GET } = await import("./route");

function makeRequest(authHeader: string | null): Request {
  return {
    headers: { get: (name: string) => (name.toLowerCase() === "authorization" ? authHeader : null) },
  } as unknown as Request;
}

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  expireRecordings.mockResolvedValue({ dryRun: false, byTrack: {}, errors: [] });
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe("GET /api/cron/expire-recordings", () => {
  it("recusa sem CRON_SECRET configurado no ambiente — falha fechado, nunca executa sem segredo", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("Bearer qualquer-coisa"));
    expect(res.status).toBe(500);
    expect(expireRecordings).not.toHaveBeenCalled();
  });

  it("recusa sem o header Authorization", async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(401);
    expect(expireRecordings).not.toHaveBeenCalled();
  });

  it("recusa com o segredo errado", async () => {
    const res = await GET(makeRequest("Bearer segredo-errado"));
    expect(res.status).toBe(401);
    expect(expireRecordings).not.toHaveBeenCalled();
  });

  it("executa a expiração DE VERDADE (dryRun: false) com o segredo correto — é a única execução agendada que existe", async () => {
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(expireRecordings).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }));
  });
});
