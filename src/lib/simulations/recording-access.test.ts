import { describe, expect, it } from "vitest";
import {
  SIGNED_URL_TTL_SECONDS,
  buildRecordingPath,
  createRecordingSignedUrl,
  recordingBucket,
} from "./recording-access";
import type { UserRow } from "@/types/database";

function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "user-1",
    name: "Candidato",
    email: "candidato@test.local",
    role: "air_traffic_controller",
    status: "active",
    operational_profile: "APP",
    ...overrides,
  } as UserRow;
}

// Fake mínimo: `.from(table).select(...).eq("id", ...).maybeSingle()` para a
// linha da resposta, e `.storage.from(bucket).createSignedUrl(path, ttl)`.
function makeClients(options: {
  row?: { audio_path: string | null; ownerId: string } | null;
  adminRow?: { audio_path: string | null; ownerId: string } | null;
  signedUrl?: string | null;
}) {
  const signCalls: { bucket: string; path: string; ttl: number }[] = [];

  function makeDb(row: { audio_path: string | null; ownerId: string } | null | undefined) {
    return {
      from() {
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          async maybeSingle() {
            if (!row) return { data: null, error: null };
            return {
              data: { audio_path: row.audio_path, simulation_attempts: { user_id: row.ownerId } },
              error: null,
            };
          },
        };
        return builder;
      },
    };
  }

  const storage = {
    from(bucket: string) {
      return {
        async createSignedUrl(path: string, ttl: number) {
          signCalls.push({ bucket, path, ttl });
          if (options.signedUrl === null) return { data: null, error: { message: "falhou" } };
          return { data: { signedUrl: options.signedUrl ?? `https://signed.test/${path}` }, error: null };
        },
      };
    },
  };

  const supabase = makeDb(options.row);
  const admin = { ...makeDb(options.adminRow ?? options.row), storage };
  return { supabase, admin, signCalls };
}

describe("buildRecordingPath", () => {
  it("põe o dono no 1º segmento e a tentativa no 2º (o que a policy de storage checa)", () => {
    const path = buildRecordingPath({
      userId: "user-1",
      attemptId: "attempt-1",
      promptId: "prompt-1",
      stage: "main",
      slot: 0,
      ext: "webm",
    });
    const segments = path.split("/");
    expect(segments[0]).toBe("user-1");
    expect(segments[1]).toBe("attempt-1");
    expect(path.endsWith(".webm")).toBe(true);
  });

  it("não é adivinhável: dois caminhos do MESMO item diferem (sufixo aleatório, não timestamp)", () => {
    const args = {
      userId: "user-1",
      attemptId: "attempt-1",
      promptId: "prompt-1",
      stage: "main",
      slot: 0,
      ext: "webm",
    } as const;
    const a = buildRecordingPath(args);
    const b = buildRecordingPath(args);
    expect(a).not.toBe(b);
  });

  it("distingue slots do mesmo estágio (caso `narrative` x2 da Parte 4 do SDEA)", () => {
    const base = {
      userId: "user-1",
      attemptId: "attempt-1",
      promptId: "prompt-1",
      stage: "narrative",
      ext: "webm",
    } as const;
    expect(buildRecordingPath({ ...base, slot: 1 })).toContain("-narrative-1-");
    expect(buildRecordingPath({ ...base, slot: 2 })).toContain("-narrative-2-");
  });
});

describe("recordingBucket", () => {
  it("mapeia cada trilha pro seu bucket", () => {
    expect(recordingBucket("phase2")).toBe("phase2-recordings");
    expect(recordingBucket("pilot")).toBe("pilot-recordings");
  });
});

describe("createRecordingSignedUrl", () => {
  const base = { track: "phase2" as const, responseId: "resp-1" };

  it("assina pro titular da gravação, com TTL curto", async () => {
    const { supabase, admin, signCalls } = makeClients({
      row: { audio_path: "user-1/attempt-1/a.webm", ownerId: "user-1" },
    });
    const result = await createRecordingSignedUrl({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      ...base,
      user: user(),
    });
    expect(result).toEqual({
      ok: true,
      url: "https://signed.test/user-1/attempt-1/a.webm",
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    });
    expect(signCalls).toEqual([
      { bucket: "phase2-recordings", path: "user-1/attempt-1/a.webm", ttl: SIGNED_URL_TTL_SECONDS },
    ]);
  });

  it("NÃO assina áudio de outro usuário — e não confirma que ele existe (404, não 403)", async () => {
    const { supabase, admin, signCalls } = makeClients({
      row: { audio_path: "outro/attempt-9/a.webm", ownerId: "outro-usuario" },
    });
    const result = await createRecordingSignedUrl({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      ...base,
      user: user(),
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
    // Crucial: nenhuma assinatura foi gerada.
    expect(signCalls).toEqual([]);
  });

  it("admin assina gravação de qualquer titular", async () => {
    const { supabase, admin, signCalls } = makeClients({
      adminRow: { audio_path: "outro/attempt-9/a.webm", ownerId: "outro-usuario" },
    });
    const result = await createRecordingSignedUrl({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      ...base,
      user: user({ role: "admin" }),
    });
    expect(result).toMatchObject({ ok: true });
    expect(signCalls).toHaveLength(1);
  });

  it("devolve 404 quando a resposta não tem gravação (audio_path nulo)", async () => {
    const { supabase, admin, signCalls } = makeClients({
      row: { audio_path: null, ownerId: "user-1" },
    });
    const result = await createRecordingSignedUrl({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      ...base,
      user: user(),
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(signCalls).toEqual([]);
  });

  it("devolve 404 quando a resposta não existe", async () => {
    const { supabase, admin } = makeClients({ row: null });
    const result = await createRecordingSignedUrl({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      ...base,
      user: user(),
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("falha fechado (500) se o storage não conseguir assinar", async () => {
    const { supabase, admin } = makeClients({
      row: { audio_path: "user-1/attempt-1/a.webm", ownerId: "user-1" },
      signedUrl: null,
    });
    const result = await createRecordingSignedUrl({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      ...base,
      user: user(),
    });
    expect(result).toMatchObject({ ok: false, status: 500 });
  });

  it("usa o bucket do piloto quando a trilha é `pilot`", async () => {
    const { supabase, admin, signCalls } = makeClients({
      row: { audio_path: "user-1/attempt-1/a.webm", ownerId: "user-1" },
    });
    await createRecordingSignedUrl({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      track: "pilot",
      responseId: "resp-1",
      user: user({ role: "pilot", operational_profile: "fixed_wing" }),
    });
    expect(signCalls[0].bucket).toBe("pilot-recordings");
  });
});

describe("SIGNED_URL_TTL_SECONDS", () => {
  it("é curto (a URL não deve virar link compartilhável)", () => {
    expect(SIGNED_URL_TTL_SECONDS).toBeGreaterThan(0);
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
  });
});

// Guarda de regressão do P0 que motivou o M3.1: nenhuma rota pode voltar a
// usar `getPublicUrl` pra gravação de candidato.
describe("regressão: gravações não voltam a ser públicas", () => {
  it("as rotas de submit-response não chamam getPublicUrl", async () => {
    const { readFileSync } = await import("node:fs");
    for (const p of [
      "src/app/api/phase2/submit-response/route.ts",
      "src/app/api/sdea/submit-response/route.ts",
    ]) {
      expect(readFileSync(p, "utf8")).not.toContain("getPublicUrl");
    }
  });
});
