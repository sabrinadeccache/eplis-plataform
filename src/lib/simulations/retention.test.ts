import { describe, expect, it } from "vitest";
import { RETENTION_DAYS, expireRecordings, purgeUserRecordings, recordingExpiresAt } from "./retention";

const DAY_MS = 24 * 60 * 60 * 1000;

// Fake do client de service_role. Cada tabela é uma lista simples em
// memória; `select` aplica os filtros básicos usados por retention.ts
// (`eq`, `in`, `not(...,"is",null)`, `lte`) e devolve páginas via
// `.order().range(start,end)` (ambas as funções de retenção paginam).
type Row = Record<string, unknown>;

function makeAdmin(tables: Record<string, Row[]>) {
  const removed: { bucket: string; paths: string[] }[] = [];
  const updates: { table: string; payload: Row; ids: string[] }[] = [];
  let storageFails = false;
  let usersUpdateFails = false;

  function applyFilters(rows: Row[], filters: { col: string; op: string; val: unknown }[]) {
    return rows.filter((r) =>
      filters.every(({ col, op, val }) => {
        if (op === "eq") return r[col] === val;
        if (op === "in") return (val as unknown[]).includes(r[col]);
        if (op === "not-is-null") return r[col] != null;
        if (op === "is-null") return r[col] == null;
        if (op === "lte") return r[col] != null && (r[col] as string) <= (val as string);
        return true;
      }),
    );
  }

  const admin = {
    from(table: string) {
      const filters: { col: string; op: string; val: unknown }[] = [];
      let range: [number, number] | null = null;
      let updatePayload: Row | null = null;

      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push({ col, op: "eq", val });
          return builder;
        },
        in(col: string, val: unknown[]) {
          filters.push({ col, op: "in", val });
          return builder;
        },
        not(col: string, _cmp: string, val: unknown) {
          if (val === null) filters.push({ col, op: "not-is-null", val: null });
          return builder;
        },
        is(col: string, val: unknown) {
          if (val === null) filters.push({ col, op: "is-null", val: null });
          return builder;
        },
        lte(col: string, val: unknown) {
          filters.push({ col, op: "lte", val });
          return builder;
        },
        order() {
          return builder;
        },
        range(start: number, end: number) {
          range = [start, end];
          return builder;
        },
        limit(n: number) {
          range = [0, n - 1];
          return builder;
        },
        update(payload: Row) {
          updatePayload = payload;
          return builder;
        },
        then(resolve: (v: { data: Row[] | null; error: { message: string } | null }) => void) {
          const source = tables[table] ?? [];
          if (updatePayload) {
            if (table === "users" && usersUpdateFails) {
              resolve({ data: null, error: { message: "boom" } });
              return;
            }
            const matched = applyFilters(source, filters);
            updates.push({ table, payload: updatePayload, ids: matched.map((r) => r.id as string) });
            for (const row of matched) Object.assign(row, updatePayload);
            resolve({ data: null, error: null });
            return;
          }
          let matched = applyFilters(source, filters);
          if (range) matched = matched.slice(range[0], range[1] + 1);
          resolve({ data: matched, error: null });
        },
      };
      return builder;
    },
    storage: {
      from(bucket: string) {
        return {
          async remove(paths: string[]) {
            if (storageFails) return { data: null, error: { message: "storage falhou" } };
            removed.push({ bucket, paths });
            return { data: null, error: null };
          },
        };
      },
    },
  };

  return {
    admin,
    removed,
    updates,
    setStorageFails: (v: boolean) => {
      storageFails = v;
    },
    setUsersUpdateFails: (v: boolean) => {
      usersUpdateFails = v;
    },
  };
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
  function vencida(id: string, userId = "u1") {
    return {
      id,
      simulation_attempt_id: "a1",
      audio_path: `${userId}/a1/${id}`,
      expires_at: "2020-01-01T00:00:00Z",
      simulation_attempts: { user_id: userId },
    };
  }

  it("por padrão é DRY-RUN: conta o que venceria e não apaga nada", async () => {
    const { admin, removed, updates } = makeAdmin({
      phase2_responses: [vencida("p-1")],
      pilot_responses: [vencida("s-1"), vencida("s-2")],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any });
    expect(report.dryRun).toBe(true);
    expect(report.byTrack.phase2.expired).toBe(1);
    expect(report.byTrack.pilot.expired).toBe(2);
    expect(removed).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("com dryRun=false apaga do storage (caminho DERIVADO DOS IDS, não da coluna audio_path) e zera audio_path", async () => {
    const { admin, removed, updates } = makeAdmin({
      phase2_responses: [vencida("p-1")],
      pilot_responses: [],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any, dryRun: false });
    expect(report.errors).toEqual([]);
    expect(removed).toEqual([{ bucket: "phase2-recordings", paths: ["u1/a1/p-1"] }]);
    expect(updates).toEqual([{ table: "phase2_responses", payload: { audio_path: null }, ids: ["p-1"] }]);
    expect(report.byTrack.phase2.rowsCleared).toBe(1);
  });

  it("pagina de verdade: processa mais de um lote (achado da revisão — antes só o 1º lote era processado)", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => vencida(`p-${i}`));
    const { admin, removed } = makeAdmin({ phase2_responses: rows, pilot_responses: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any, dryRun: false, batchSize: 1 });
    expect(report.byTrack.phase2.expired).toBe(3);
    expect(report.byTrack.phase2.rowsCleared).toBe(3);
    expect(removed.flatMap((r) => r.paths)).toEqual(["u1/a1/p-0", "u1/a1/p-1", "u1/a1/p-2"]);
  });

  it("é idempotente: sem linha vencida, nada a fazer", async () => {
    const { admin, removed } = makeAdmin({ phase2_responses: [], pilot_responses: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any, dryRun: false });
    expect(report.byTrack.phase2.expired).toBe(0);
    expect(report.byTrack.pilot.expired).toBe(0);
    expect(removed).toEqual([]);
  });

  it("NÃO zera audio_path se o storage falhar — a próxima execução tenta de novo em vez de deixar gravação órfã", async () => {
    const { admin, updates, setStorageFails } = makeAdmin({ phase2_responses: [vencida("p-1")], pilot_responses: [] });
    setStorageFails(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any, dryRun: false });
    expect(updates).toEqual([]);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.byTrack.phase2.rowsCleared).toBe(0);
  });

  it("remove a UNIÃO do audio_path legado com o caminho determinístico (achado da revisão: só os IDs perdia gravação legada)", async () => {
    const legada = {
      id: "p-legado",
      simulation_attempt_id: "a1",
      audio_path: "caminho/bem/antigo.webm",
      expires_at: "2020-01-01T00:00:00Z",
      simulation_attempts: { user_id: "u1" },
    };
    const { admin, removed, updates } = makeAdmin({ phase2_responses: [legada], pilot_responses: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any, dryRun: false });
    expect(report.errors).toEqual([]);
    const phase2Removal = removed.find((r) => r.bucket === "phase2-recordings");
    expect(phase2Removal?.paths.sort()).toEqual(["caminho/bem/antigo.webm", "u1/a1/p-legado"]);
    expect(updates).toEqual([{ table: "phase2_responses", payload: { audio_path: null }, ids: ["p-legado"] }]);
  });

  it("varre e remove uploads órfãos (audio_path nulo, erro, mais velho que o prazo) mesmo sem bater no filtro principal", async () => {
    const orfao = {
      id: "p-orfao",
      simulation_attempt_id: "a1",
      audio_path: null,
      expires_at: null,
      processing_status: "error",
      created_at: "2020-01-01T00:00:00Z",
      simulation_attempts: { user_id: "u1" },
    };
    const { admin, removed } = makeAdmin({ phase2_responses: [orfao], pilot_responses: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any, dryRun: false });
    expect(report.byTrack.phase2.orphansSwept).toBe(1);
    const phase2Removal = removed.find((r) => r.bucket === "phase2-recordings");
    expect(phase2Removal?.paths).toContain("u1/a1/p-orfao");
  });

  it("dry-run da varredura de órfãos só conta, não remove", async () => {
    const orfao = {
      id: "p-orfao",
      simulation_attempt_id: "a1",
      audio_path: null,
      expires_at: null,
      processing_status: "error",
      created_at: "2020-01-01T00:00:00Z",
      simulation_attempts: { user_id: "u1" },
    };
    const { admin, removed } = makeAdmin({ phase2_responses: [orfao], pilot_responses: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any, dryRun: true });
    expect(report.byTrack.phase2.orphansSwept).toBe(1);
    expect(removed).toEqual([]);
  });

  it("não expõe conteúdo sensível no relatório (só contagens)", async () => {
    const { admin } = makeAdmin({ phase2_responses: [vencida("p-1")], pilot_responses: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await expireRecordings({ admin: admin as any, dryRun: false });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("u1/a1/p-1");
    expect(serialized).not.toContain("p-1");
  });
});

describe("purgeUserRecordings (exclusão de conta)", () => {
  function baseTables() {
    return {
      users: [{ id: "u1", status: "active" }],
      simulation_attempts: [
        { id: "a1", user_id: "u1" },
        { id: "a2", user_id: "u1" },
      ],
      phase2_responses: [
        { id: "p-1", simulation_attempt_id: "a1", audio_path: "u1/a1/p-1" },
        { id: "p-2", simulation_attempt_id: "a2", audio_path: null }, // upload nunca terminou de gravar o path
      ],
      pilot_responses: [] as Row[],
      simulation_feedbacks: [{ id: "f-1", simulation_attempt_id: "a1", general_feedback: "texto derivado da fala" }],
    };
  }

  it("por padrão é DRY-RUN: não bloqueia a conta nem apaga nada", async () => {
    const { admin, removed, updates } = makeAdmin(baseTables());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await purgeUserRecordings({ admin: admin as any, userId: "u1" });
    expect(report.dryRun).toBe(true);
    expect(report.accountBlocked).toBe(false);
    expect(report.responsesCleared).toBe(2);
    expect(removed).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("bloqueia a conta ANTES de tocar em qualquer dado — impede novo envio durante a limpeza (achado da revisão)", async () => {
    const tables = baseTables();
    const { admin, updates } = makeAdmin(tables);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await purgeUserRecordings({ admin: admin as any, userId: "u1", dryRun: false });
    const userUpdate = updates.find((u) => u.table === "users");
    expect(userUpdate).toEqual({ table: "users", payload: { status: "blocked" }, ids: ["u1"] });
  });

  it("remove pelo caminho DERIVADO DOS IDS mesmo quando audio_path está nulo (upload que nunca chegou a gravar o path)", async () => {
    const { admin, removed } = makeAdmin(baseTables());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await purgeUserRecordings({ admin: admin as any, userId: "u1", dryRun: false });
    const phase2Removal = removed.find((r) => r.bucket === "phase2-recordings");
    expect(phase2Removal?.paths.sort()).toEqual(["u1/a1/p-1", "u1/a2/p-2"]);
  });

  it("apaga áudio, zera transcript/ai_feedback/audio_url (inclusive legado) das respostas, E general_feedback do relatório final", async () => {
    const { admin, updates } = makeAdmin(baseTables());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await purgeUserRecordings({ admin: admin as any, userId: "u1", dryRun: false });
    const responseUpdate = updates.find((u) => u.table === "phase2_responses");
    expect(responseUpdate?.payload).toEqual({
      audio_path: null,
      audio_url: null,
      transcript: null,
      ai_feedback: null,
    });
    const feedbackUpdate = updates.find((u) => u.table === "simulation_feedbacks");
    expect(feedbackUpdate?.payload).toEqual({ general_feedback: null });
    expect(feedbackUpdate?.ids).toEqual(["f-1"]);
    expect(report.feedbacksCleared).toBe(1);
  });

  it("não mexe em tentativas/respostas de OUTRO usuário", async () => {
    const tables = baseTables();
    tables.simulation_attempts.push({ id: "a9", user_id: "outro" });
    tables.phase2_responses.push({ id: "p-9", simulation_attempt_id: "a9", audio_path: "outro/a9/p-9" });
    const { admin, removed } = makeAdmin(tables);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await purgeUserRecordings({ admin: admin as any, userId: "u1", dryRun: false });
    const phase2Removal = removed.find((r) => r.bucket === "phase2-recordings");
    expect(phase2Removal?.paths).not.toContain("outro/a9/p-9");
  });

  it("pagina de verdade DENTRO de um único bloco de tentativas (achado da revisão: consulta sem range truncava respostas)", async () => {
    const tables = baseTables();
    // Mais de uma "página" (500) de respostas na MESMA tentativa — antes
    // desta correção, a consulta única `.in(...)` sem `.range()` podia
    // truncar isso silenciosamente.
    tables.phase2_responses = Array.from({ length: 501 }, (_, i) => ({
      id: `p-${i}`,
      simulation_attempt_id: "a1",
      audio_path: `u1/a1/p-${i}`,
    }));
    const { admin, removed } = makeAdmin(tables);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await purgeUserRecordings({ admin: admin as any, userId: "u1", dryRun: false });
    expect(report.responsesCleared).toBe(501);
    const phase2Removal = removed.find((r) => r.bucket === "phase2-recordings");
    expect(phase2Removal?.paths.length).toBe(501);
  });

  it("se o bloqueio da conta falhar, para ali — não segue apagando dado com a conta ainda ativa", async () => {
    const { admin, setUsersUpdateFails, removed } = makeAdmin(baseTables());
    setUsersUpdateFails(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await purgeUserRecordings({ admin: admin as any, userId: "u1", dryRun: false });
    expect(report.accountBlocked).toBe(false);
    expect(report.responsesCleared).toBe(0);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(removed).toEqual([]);
  });
});
