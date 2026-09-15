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
// linha da resposta, `.storage.from(bucket).createSignedUrl(path, ttl)`, e
// `.from("recording_access_log").insert(...)` pro registro de auditoria.
function makeClients(options: {
  row?: { audio_path: string | null; expires_at?: string | null; ownerId: string } | null;
  adminRow?: { audio_path: string | null; expires_at?: string | null; ownerId: string } | null;
  signedUrl?: string | null;
  auditLogFails?: boolean;
}) {
  const signCalls: { bucket: string; path: string; ttl: number }[] = [];
  const auditLogInserts: Record<string, unknown>[] = [];

  function makeDb(row: { audio_path: string | null; expires_at?: string | null; ownerId: string } | null | undefined) {
    return {
      from(table: string) {
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
              data: {
                audio_path: row.audio_path,
                expires_at: row.expires_at ?? null,
                simulation_attempts: { user_id: row.ownerId },
              },
              error: null,
            };
          },
          insert(payload: Record<string, unknown>) {
            if (table === "recording_access_log") {
              if (options.auditLogFails) return Promise.resolve({ data: null, error: { message: "boom" } });
              auditLogInserts.push(payload);
            }
            return Promise.resolve({ data: null, error: null });
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
  return { supabase, admin, signCalls, auditLogInserts };
}

describe("buildRecordingPath", () => {
  it("é determinístico por responseId: mesmos parâmetros, mesmo caminho — nunca cria objeto novo num retry", () => {
    const args = { userId: "user-1", attemptId: "attempt-1", responseId: "resp-1" };
    expect(buildRecordingPath(args)).toBe(buildRecordingPath(args));
  });

  it("põe o dono no 1º segmento e a tentativa no 2º", () => {
    const path = buildRecordingPath({ userId: "user-1", attemptId: "attempt-1", responseId: "resp-1" });
    expect(path.split("/")).toEqual(["user-1", "attempt-1", "resp-1"]);
  });

  it("distingue as duas ocorrências de 'narrative' da Parte 4 do SDEA pelo responseId — cada slot tem sua própria linha, logo seu próprio caminho", () => {
    const pathSlot1 = buildRecordingPath({ userId: "user-1", attemptId: "attempt-1", responseId: "resp-slot-1" });
    const pathSlot2 = buildRecordingPath({ userId: "user-1", attemptId: "attempt-1", responseId: "resp-slot-2" });
    expect(pathSlot1).not.toBe(pathSlot2);
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
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  it("assina pro titular da gravação, com TTL curto", async () => {
    const { supabase, admin, signCalls } = makeClients({
      row: { audio_path: "user-1/attempt-1/resp-1", expires_at: future, ownerId: "user-1" },
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
      url: "https://signed.test/user-1/attempt-1/resp-1",
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    });
    expect(signCalls).toEqual([
      { bucket: "phase2-recordings", path: "user-1/attempt-1/resp-1", ttl: SIGNED_URL_TTL_SECONDS },
    ]);
  });

  it("NÃO assina áudio de outro usuário — e não confirma que ele existe (404, não 403)", async () => {
    const { supabase, admin, signCalls } = makeClients({
      row: { audio_path: "outro/attempt-9/a", expires_at: future, ownerId: "outro-usuario" },
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

  it("NÃO assina gravação já vencida (expires_at no passado) — trata como não existe, igual ao que o retenção faria", async () => {
    const { supabase, admin, signCalls } = makeClients({
      row: { audio_path: "user-1/attempt-1/resp-1", expires_at: past, ownerId: "user-1" },
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

  it("admin assina gravação de outro titular E registra o acesso administrativo (item 3.2 do plano)", async () => {
    const { supabase, admin, signCalls, auditLogInserts } = makeClients({
      adminRow: { audio_path: "outro/attempt-9/a", expires_at: future, ownerId: "outro-usuario" },
    });
    const result = await createRecordingSignedUrl({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      ...base,
      user: user({ id: "admin-1", role: "admin" }),
    });
    expect(result).toMatchObject({ ok: true });
    expect(signCalls).toHaveLength(1);
    expect(auditLogInserts).toEqual([
      { admin_user_id: "admin-1", track: "phase2", response_id: "resp-1" },
    ]);
  });

  it("falha fechado (500) se o registro de auditoria falhar — nenhum acesso administrativo sai sem log (achado da revisão)", async () => {
    const { supabase, admin, signCalls, auditLogInserts } = makeClients({
      adminRow: { audio_path: "outro/attempt-9/a", expires_at: future, ownerId: "outro-usuario" },
      auditLogFails: true,
    });
    const result = await createRecordingSignedUrl({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      ...base,
      user: user({ id: "admin-1", role: "admin" }),
    });
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(auditLogInserts).toEqual([]);
    // A URL já tinha sido assinada quando o log falhou (a assinatura roda
    // antes da auditoria) — mas ela nunca é DEVOLVIDA ao chamador, é isso
    // que garante que nenhum acesso sem auditoria "vaza" pro admin.
    expect(signCalls).toHaveLength(1);
  });

  it("admin acessando a PRÓPRIA gravação não gera registro de auditoria (não é supervisão de terceiro)", async () => {
    const { supabase, admin, auditLogInserts } = makeClients({
      adminRow: { audio_path: "admin-1/attempt-1/resp-1", expires_at: future, ownerId: "admin-1" },
    });
    await createRecordingSignedUrl({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      ...base,
      user: user({ id: "admin-1", role: "admin" }),
    });
    expect(auditLogInserts).toEqual([]);
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
      row: { audio_path: "user-1/attempt-1/resp-1", expires_at: future, ownerId: "user-1" },
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
      row: { audio_path: "user-1/attempt-1/resp-1", expires_at: future, ownerId: "user-1" },
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

// Guarda de regressão do P0 que motivou o M3.1/revisão: nenhuma rota pode
// voltar a usar `getPublicUrl`, nem subir gravação com o client do usuário
// (só `admin.storage`, nunca `supabase.storage`, nos buckets de gravação).
describe("regressão: gravações não voltam a ser públicas nem gravadas pelo client do usuário", () => {
  it("as rotas de submit-response não chamam getPublicUrl nem supabase.storage", async () => {
    const { readFileSync } = await import("node:fs");
    for (const p of [
      "src/app/api/phase2/submit-response/route.ts",
      "src/app/api/sdea/submit-response/route.ts",
    ]) {
      const content = readFileSync(p, "utf8");
      expect(content).not.toContain("getPublicUrl");
      expect(content).not.toContain("supabase.storage");
    }
  });
});
