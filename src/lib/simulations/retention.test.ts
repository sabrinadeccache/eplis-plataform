import { describe, expect, it } from "vitest";
import { RETENTION_DAYS, expireRecordings, purgeUserRecordings, recordingExpiresAt } from "./retention";

const DAY_MS = 24 * 60 * 60 * 1000;

// Fake do client de service_role: `.from(table).select(...)` com os filtros
// da expiração, `.update(...).in(...)`, e `.storage.from(bucket).remove([...])`.
function makeAdmin(options: {
  rows?: Record<string, { id: string; audio_path: string | null }[]>;
  storageFails?: boolean;
  updateFails?: boolean;
  selectFails?: boolean;
}) {
  const removed: { bucket: string; paths: string[] }[] = [];
  const updated: { table: string; payload: Record<string, unknown>; ids: string[] }[] = [];

  const admin = {
    from(table: string) {
      let payload: Record<string, unknown> | null = null;
      const builder = {
        select() {
          return builder;
        },
        not() {
          return builder;
        },
        lte() {
          return builder;
        },
        eq() {
          return builder;
        },
        limit() {
          return builder;
        },
        update(p: Record<string, unknown>) {
          payload = p;
          return builder;
        },
        in(_col: string, ids: string[]) {
          if (options.updateFails) {
            return Promise.resolve({ data: null, error: { message: "update falhou" } });
          }
          updated.push({ table, payload: payload ?? {}, ids });
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: { data: unknown; error: { message: string } | null }) => void) {
          if (options.selectFails) {
            resolve({ data: null, error: { message: "select falhou" } });
            return;
          }
          resolve({ data: options.rows?.[table] ?? [], error: null });
        },
      };
      return builder;
    },
    storage: {
      from(bucket: string) {
        return {
          async remove(paths: string[]) {
            if (options.storageFails) return { data: null, error: { message: "storage falhou" } };
            removed.push({ bucket, paths });
            return { data: null, error: null };
          },
        };
      },
    },
  };

  return { admin, removed, updated };
}

describe("recordingExpiresAt", () => {
  it("usa 30 dias no practice e 180 no official (decisão registrada no M3.2)", () => {
    expect(RETENTION_DAYS).toEqual({ practice: 30, official: 180 });
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(recordingExpiresAt("practice", from)).toBe(new Date(from.getTime() + 30 * DAY_MS).toISOString());
    expect(recordingExpiresAt("official", from)).toBe(new Date(from.getTime() + 180 * DAY_MS).toISOString());
  });
});

describe("expireRecordings", () => {
  const rows = {
    phase2_responses: [{ id: "p-1", audio_path: "u1/a1/x.webm" }],
    pilot_responses: [
      { id: "s-1", audio_path: "u1/a2/y.webm" },
      { id: "s-2", audio_path: "u1/a2/z.mp4" },
    ],
  };

  it("por padrão é DRY-RUN: conta o que venceria e não apaga nada", async () => {
    const { admin, removed, updated } = makeAdmin({ rows });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any });
    expect(report.dryRun).toBe(true);
    expect(report.byTrack.phase2.expired).toBe(1);
    expect(report.byTrack.pilot.expired).toBe(2);
    expect(report.byTrack.phase2.storageDeleted).toBe(0);
    expect(removed).toEqual([]);
    expect(updated).toEqual([]);
  });

  it("com dryRun=false apaga do storage e zera audio_path", async () => {
    const { admin, removed, updated } = makeAdmin({ rows });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any, dryRun: false });
    expect(report.errors).toEqual([]);
    expect(removed).toEqual([
      { bucket: "phase2-recordings", paths: ["u1/a1/x.webm"] },
      { bucket: "pilot-recordings", paths: ["u1/a2/y.webm", "u1/a2/z.mp4"] },
    ]);
    expect(updated.map((u) => u.payload)).toEqual([{ audio_path: null }, { audio_path: null }]);
    expect(report.byTrack.pilot.rowsCleared).toBe(2);
  });

  it("é idempotente: sem linha com audio_path, nada a fazer", async () => {
    const { admin, removed } = makeAdmin({ rows: {} });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any, dryRun: false });
    expect(report.byTrack.phase2.expired).toBe(0);
    expect(report.byTrack.pilot.expired).toBe(0);
    expect(removed).toEqual([]);
  });

  it("NÃO zera audio_path se o storage falhar — a próxima execução tenta de novo em vez de deixar gravação órfã", async () => {
    const { admin, updated } = makeAdmin({ rows, storageFails: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any, dryRun: false });
    expect(updated).toEqual([]);
    expect(report.errors.length).toBe(2);
    expect(report.byTrack.phase2.rowsCleared).toBe(0);
  });

  it("reporta erro de leitura sem apagar nada", async () => {
    const { admin, removed } = makeAdmin({ rows, selectFails: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any, dryRun: false });
    expect(removed).toEqual([]);
    expect(report.errors.length).toBe(2);
  });

  it("não expõe conteúdo sensível no relatório (só contagens)", async () => {
    const { admin } = makeAdmin({ rows });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any, dryRun: false });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("u1/a1/x.webm");
    expect(serialized).not.toContain("p-1");
  });
});

describe("purgeUserRecordings (exclusão de conta)", () => {
  const rows = {
    phase2_responses: [{ id: "p-1", audio_path: "u1/a1/x.webm" }],
    pilot_responses: [{ id: "s-1", audio_path: null }],
  };

  it("por padrão é DRY-RUN", async () => {
    const { admin, removed, updated } = makeAdmin({ rows });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await purgeUserRecordings({ admin: admin as any, userId: "u1" });
    expect(report.dryRun).toBe(true);
    expect(report.storageObjects).toBe(1);
    expect(removed).toEqual([]);
    expect(updated).toEqual([]);
  });

  it("apaga o áudio E zera transcrição/feedback (conteúdo de fala é dado pessoal)", async () => {
    const { admin, removed, updated } = makeAdmin({ rows });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await purgeUserRecordings({ admin: admin as any, userId: "u1", dryRun: false });
    expect(removed).toEqual([{ bucket: "phase2-recordings", paths: ["u1/a1/x.webm"] }]);
    for (const u of updated) {
      expect(u.payload).toEqual({ audio_path: null, transcript: null, ai_feedback: null });
    }
    // A resposta sem áudio também é limpa (a transcrição dela existe).
    expect(updated.map((u) => u.table).sort()).toEqual(["phase2_responses", "pilot_responses"]);
  });
});
