// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const USER = "00000000-0000-4000-8000-000000000001";
const ATTEMPT = "00000000-0000-4000-8000-000000000002";
const QUESTION = "00000000-0000-4000-8000-000000000003";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.simulation_attempts(
      id uuid primary key, user_id uuid, phase text not null, mode text not null,
      status text not null
    );
    create table public.phase1_answers(
      id uuid primary key default gen_random_uuid(), simulation_attempt_id uuid not null,
      question_id uuid not null, selected_option text not null, is_correct boolean not null
    );
  `);
  await db.exec(readFileSync(new URL("../../../supabase/migrations/20260914000000_phase1_consistency.sql", import.meta.url), "utf8"));
});

afterAll(async () => db?.close());

describe("constraints de consistência da Fase 1", () => {
  it("aceita timeout sem seleção, mas nunca duas respostas para a mesma questão", async () => {
    await db.query("insert into public.simulation_attempts values ($1,$2,'phase1','official','in_progress')", [ATTEMPT, USER]);
    await db.query("insert into public.phase1_answers(simulation_attempt_id,question_id,selected_option,is_correct) values ($1,$2,null,false)", [ATTEMPT, QUESTION]);
    await expect(
      db.query("insert into public.phase1_answers(simulation_attempt_id,question_id,selected_option,is_correct) values ($1,$2,'a',true)", [ATTEMPT, QUESTION]),
    ).rejects.toThrow(/unique/i);
  });

  it("impede duas tentativas in_progress do mesmo usuário, fase e modo", async () => {
    await expect(
      db.query("insert into public.simulation_attempts values (gen_random_uuid(),$1,'phase1','official','in_progress')", [USER]),
    ).rejects.toThrow(/unique/i);
    await db.query("insert into public.simulation_attempts values (gen_random_uuid(),$1,'phase1','practice','in_progress')", [USER]);
    await db.query("insert into public.simulation_attempts values (gen_random_uuid(),$1,'phase2','official','in_progress')", [USER]);
  });
});
