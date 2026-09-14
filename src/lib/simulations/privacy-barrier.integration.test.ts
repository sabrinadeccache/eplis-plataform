// @vitest-environment node
// PostgreSQL real (WASM), sem Supabase/credenciais/rede. Exercita a migration
// efetiva, não uma implementação JS dos triggers. I/O pausado reproduz os
// dois ordenamentos de escrita/exclusão; PGlite usa uma conexão só.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const USER = "00000000-0000-4000-8000-000000000001";
const ATTEMPT = "00000000-0000-4000-8000-000000000002";
const RESPONSE = "00000000-0000-4000-8000-000000000003";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create type public.processing_status as enum ('queued','transcribing','analyzing','done','error');
    create table public.users(id uuid primary key, status text not null);
    create table public.simulation_attempts(id uuid primary key, user_id uuid references public.users(id) on delete set null);
    create table public.phase2_responses(
      id uuid primary key, simulation_attempt_id uuid references public.simulation_attempts(id),
      audio_path text, audio_url text, transcript text, ai_feedback text,
      processing_status public.processing_status not null default 'transcribing',
      started_at timestamptz, created_at timestamptz default now(), expires_at timestamptz
    );
    create table public.pilot_responses (like public.phase2_responses including all);
    create table public.simulation_feedbacks(id uuid primary key, simulation_attempt_id uuid references public.simulation_attempts(id), general_feedback text);
    grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to service_role;
  `);
  await db.exec(readFileSync(new URL("../../../supabase/migrations/20260912070000_privacy_barrier.sql", import.meta.url), "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("reset role; truncate public.privacy_uploads, public.privacy_deletion_requests, public.simulation_feedbacks, public.phase2_responses, public.pilot_responses, public.simulation_attempts, public.users cascade;");
  await db.query("insert into public.users values ($1, 'active')", [USER]);
  await db.query("insert into public.simulation_attempts values ($1, $2)", [ATTEMPT, USER]);
  for (const table of ["phase2_responses", "pilot_responses"]) {
    await db.query(`insert into public.${table}(id, simulation_attempt_id, started_at) values ($1,$2,now() - interval '40 days')`, [RESPONSE, ATTEMPT]);
  }
});

async function requestDeletion() {
  return (await db.query<{ ready: boolean }>("select public.request_privacy_deletion($1) as ready", [USER])).rows[0].ready;
}
async function begin(track: string) {
  return (await db.query<{ token: string }>("select public.begin_privacy_upload($1,$2,$3) as token", [USER, RESPONSE, track])).rows[0].token;
}
async function claim(track: string) {
  return (await db.query<{ claimed: boolean }>("select public.claim_recording_cleanup($1,$2,now(),true) as claimed", [track, RESPONSE])).rows[0].claimed;
}
async function claimBatch(track: string, ids = [RESPONSE]) {
  return (await db.query<{ response_id: string; claimed: boolean; upload_pending: boolean }>(
    "select * from public.claim_recording_cleanup_batch($1,$2::jsonb,now(),true)",
    [track, JSON.stringify(ids.map((id) => ({ id, audio_path: null })))],
  )).rows;
}

describe.each(["phase2", "pilot"])("barreira SQL (%s)", (track) => {
  const table = `${track}_responses`;
  it("upload reservado primeiro deixa exclusão pendente; depois de terminar, drena", async () => {
    const token = await begin(track);
    expect(await requestDeletion()).toBe(false);
    await expect(begin(track)).rejects.toThrow(/exclusão|inativa/);
    await expect(db.query("delete from public.users where id = $1", [USER])).rejects.toThrow(/Upload/);
    await db.query("select public.finish_privacy_upload($1)", [token]);
    expect(await requestDeletion()).toBe(true);
  });
  it("barreira primeiro recusa upload e tentativa, mesmo via service_role", async () => {
    expect(await requestDeletion()).toBe(true);
    await db.exec("set role service_role");
    await expect(begin(track)).rejects.toThrow(/exclusão|inativa/);
    await expect(db.query("insert into public.simulation_attempts values (gen_random_uuid(),$1)", [USER])).rejects.toThrow(/exclusão/);
  });
  it.each(["transcript", "ai_feedback"])("IA pausada não repovoa %s após limpeza e remoção da conta", async (field) => {
    let release!: () => void;
    const ai = new Promise<void>((resolve) => { release = resolve; });
    const lateWrite = ai.then(() => db.query(`update public.${table} set ${field} = 'conteúdo tardio' where id = $1`, [RESPONSE]));
    expect(await requestDeletion()).toBe(true);
    await db.query(`update public.${table} set transcript = null, ai_feedback = null, audio_path = null, audio_url = null where id = $1`, [RESPONSE]);
    await db.query("delete from public.users where id = $1", [USER]);
    const rejected = expect(lateWrite).rejects.toThrow(/invalidado/);
    release();
    await rejected;
    const { rows } = await db.query<Record<string, unknown>>(`select ${field} from public.${table} where id = $1`, [RESPONSE]);
    expect(rows[0][field]).toBeNull();
  });
  it("varredura cobre crash transcribing/analyzing, marca terminal e bloqueia retry/upload", async () => {
    expect(await claim(track)).toBe(true);
    await db.query(`update public.${table} set audio_path = null, recording_purged_at = now() where id = $1`, [RESPONSE]);
    expect(await claim(track)).toBe(false);
    await expect(begin(track)).rejects.toThrow(/indisponível/);
    await expect(db.query(`update public.${table} set processing_status='transcribing', started_at=now() where id=$1`, [RESPONSE])).rejects.toThrow(/limpeza/);
  });
  it("retry renovado primeiro não é apagado pela seleção velha do cron", async () => {
    await db.query(`update public.${table} set started_at=now() where id=$1`, [RESPONSE]);
    expect(await claim(track)).toBe(false);
  });
  it("retry com prazo antigo ainda persistido não perde o upload recém-enviado", async () => {
    await db.query(`update public.${table} set started_at=now(), audio_path='old-path', expires_at=now()-interval '1 day' where id=$1`, [RESPONSE]);
    const { rows } = await db.query<{ claimed: boolean }>("select public.claim_recording_cleanup($1,$2,now(),false,'old-path') as claimed", [track, RESPONSE]);
    expect(rows[0].claimed).toBe(false);
  });
  it("caminho alterado desde a listagem exige nova seleção", async () => {
    await db.query(`update public.${table} set audio_path='new-path', expires_at=now()-interval '1 day' where id=$1`, [RESPONSE]);
    const { rows } = await db.query<{ claimed: boolean }>("select public.claim_recording_cleanup($1,$2,now(),false,'old-path') as claimed", [track, RESPONSE]);
    expect(rows[0].claimed).toBe(false);
  });
  it("upload não finalizado não é confundido com worker morto por idade", async () => {
    await begin(track);
    expect(await claim(track)).toBe(false);
    expect(await claimBatch(track)).toEqual([{ response_id: RESPONSE, claimed: false, upload_pending: true }]);
  });
});

it("relatório final tardio é recusado, mas limpar relatório existente é permitido", async () => {
  await db.query("insert into public.simulation_feedbacks values ($1,$2,'fala')", [RESPONSE, ATTEMPT]);
  await requestDeletion();
  await expect(db.query("insert into public.simulation_feedbacks values (gen_random_uuid(),$1,'tardio')", [ATTEMPT])).rejects.toThrow(/invalidado/);
  await db.query("update public.simulation_feedbacks set general_feedback = null");
  await db.query("delete from public.users where id=$1", [USER]);
  await expect(db.query("update public.simulation_feedbacks set general_feedback='tardio'")).rejects.toThrow(/invalidado/);
});

it("limpeza de áudio em tentativa já anonimizada não é bloqueada por conteúdo inalterado", async () => {
  await db.query("update public.phase2_responses set audio_path='legacy/path', transcript='fala' where id=$1", [RESPONSE]);
  await requestDeletion();
  await db.query("delete from public.users where id=$1", [USER]);
  await db.query("update public.phase2_responses set audio_path=null, audio_url=null where id=$1", [RESPONSE]);
  const { rows } = await db.query<{ audio_path: string | null; transcript: string | null }>("select audio_path, transcript from public.phase2_responses where id=$1", [RESPONSE]);
  expect(rows[0]).toEqual({ audio_path: null, transcript: "fala" });
  await db.query("update public.phase2_responses set transcript=null where id=$1", [RESPONSE]);
});

it.each(["anon", "authenticated"])("%s não acessa tickets nem RPCs", async (role) => {
  await db.exec(`set role ${role}`);
  await expect(begin("phase2")).rejects.toThrow(/permission denied/);
  await expect(requestDeletion()).rejects.toThrow(/permission denied/);
  await expect(db.query("select * from public.privacy_uploads")).rejects.toThrow(/permission denied/);
  await expect(claim("phase2")).rejects.toThrow(/permission denied/);
  await expect(claimBatch("phase2")).rejects.toThrow(/permission denied/);
});
