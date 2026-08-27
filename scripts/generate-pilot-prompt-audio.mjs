// Gera os áudios pré-processados da Parte 2 (falas do ATC) e Parte 3
// (gravação piloto/controlador) do SDEA: TTS da OpenAI + efeito de rádio VHF
// (passa-banda 300-3400 Hz, compressão, estática baixa, clique de PTT) via
// ffmpeg, sobe pro bucket público `pilot-prompt-audio` e grava a URL em
// pilot_prompts (atc_audio_url / atc_followup_audio_url / dialogue_audio_url).
//
// Também grava uma cópia local de cada mp3 em
// `Material Didático/Pilots/Material Didático/{Fixed-wing,Rotary-wing}/Audios/`
// (nome `part2-01-atc.mp3`, `part2-01-followup.mp3`, `part3-01-dialogue.mp3`).
//
// Idempotente: pula a geração do que já tem URL (só baixa do Storage pra
// atualizar a cópia local). `--force` regenera tudo do zero.
// Pré-requisitos: ffmpeg no PATH, `pg` instalado (--no-save, ver CLAUDE.md),
// bucket criado (scripts/create-pilot-prompt-audio-bucket.mjs), migration
// 20260828000000 aplicada. Rodar sempre DEPOIS de seed-pilot-prompts.mjs.
//
// Uso: `node scripts/generate-pilot-prompt-audio.mjs [--force]`
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import OpenAI from "openai";
import { parseAtcDialogue } from "../src/lib/atc-dialogue.ts";

// --- config -------------------------------------------------------------
const VOICE = { atc: "onyx", pilot: "echo" };
const TTS_MODEL = "gpt-4o-mini-tts";
const TTS_INSTRUCTIONS =
  "Read as a real air traffic control / cockpit radio transmission: steady, professional, " +
  "moderately brisk pace, neutral international aviation English, no emotion.";
const BUCKET = "pilot-prompt-audio";
const FORCE = process.argv.includes("--force");

// Cópia local dos mp3 no material didático, por perfil (a Sabrina navega essas
// pastas fora do app). Quando a URL já existe e não é --force, o script só
// baixa o arquivo do Storage e grava aqui — sem refazer TTS/ffmpeg.
const MATERIAL_ROOT =
  "/Users/sabrinadeccache/Desktop/Projeto Plataforma/Material Didático/Pilots/Material Didático";
function localDirFor(aircraftType) {
  const folder = aircraftType === "rotary_wing" ? "Rotary-wing" : "Fixed-wing";
  const dir = join(MATERIAL_ROOT, folder, "Audios");
  mkdirSync(dir, { recursive: true });
  return dir;
}
function localName(part, orderIndex, kind) {
  const n = orderIndex == null ? "xx" : String(orderIndex).padStart(2, "0");
  return `${part}-${n}-${kind}.mp3`;
}
async function saveLocalFromUrl(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} falhou (${res.status})`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function loadEnv() {
  const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    env[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const work = mkdtempSync(join(tmpdir(), "sdea-audio-"));
function tmp(name) {
  return join(work, name);
}
// FFMPEG_BIN permite apontar pra um binário específico (ex.: nesta máquina o
// `ffmpeg` do brew ficou com dylib quebrada e o que funciona é o `ffmpeg-full`).
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
function ff(args) {
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", ...args]);
}

// --- building blocks ---------------------------------------------------
const CLICK = tmp("click.wav");
const GAP = tmp("gap.wav");
function buildFixtures() {
  // clique curto de abrir/fechar microfone (ruído branco filtrado, ~45 ms)
  ff([
    "-f", "lavfi", "-i", "anoisesrc=color=white:amplitude=0.35:sample_rate=24000",
    "-t", "0.045",
    "-af", "highpass=f=900,lowpass=f=3200,volume=0.45,afade=t=out:st=0.025:d=0.02",
    CLICK,
  ]);
  // silêncio de 250 ms entre falas na Parte 3
  ff(["-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.25", GAP]);
}

async function tts(text, voice, outPath) {
  const res = await openai.audio.speech.create({
    model: TTS_MODEL,
    voice,
    input: text,
    instructions: TTS_INSTRUCTIONS,
    response_format: "mp3",
  });
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

// aplica o efeito de rádio VHF + estática a uma fala
function radio(inPath, outPath) {
  ff([
    "-i", inPath,
    "-f", "lavfi", "-t", "60", "-i",
    "anoisesrc=color=pink:amplitude=0.02:sample_rate=24000",
    "-filter_complex",
    "[0:a]highpass=f=300,lowpass=f=3400," +
      "acompressor=threshold=-18dB:ratio=4:attack=5:release=60,volume=2.2," +
      "aformat=channel_layouts=mono:sample_rates=24000[v];" +
      "[1:a]volume=0.10[n];" +
      "[v][n]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[out]",
    "-map", "[out]", outPath,
  ]);
}

function concat(parts, outPath) {
  const inputs = parts.flatMap((p) => ["-i", p]);
  const filter = parts.map((_, i) => `[${i}:a]`).join("") + `concat=n=${parts.length}:v=0:a=1[out]`;
  ff([...inputs, "-filter_complex", filter, "-map", "[out]", outPath]);
}

function toMp3(inPath, outPath) {
  ff(["-i", inPath, "-codec:a", "libmp3lame", "-q:a", "4", outPath]);
}

// fala isolada -> [clique][rádio][clique] em .wav
async function transmission(text, voice, tag) {
  const raw = tmp(`${tag}.mp3`);
  const rad = tmp(`${tag}.radio.wav`);
  const out = tmp(`${tag}.tx.wav`);
  await tts(text, voice, raw);
  radio(raw, rad);
  concat([CLICK, rad, CLICK], out);
  return out;
}

// wav -> mp3 -> upload pro Storage -> cópia local. Devolve a URL pública.
async function publishMp3(wavPath, objectPath, localPath) {
  const mp3 = tmp("upload.mp3");
  toMp3(wavPath, mp3);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "audio/mpeg",
      "x-upsert": "true",
    },
    body: readFileSync(mp3),
  });
  if (!res.ok) {
    throw new Error(`upload ${objectPath} falhou (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  copyFileSync(mp3, localPath);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

// --- main -------------------------------------------------------------
async function main() {
  buildFixtures();
  const db = new Client({ connectionString: env.SUPABASE_DB_URL });
  await db.connect();

  const { rows } = await db.query(
    `select id, part, aircraft_type, order_index,
            atc_audio_text, atc_followup_audio_text, prompt_text,
            atc_audio_url, atc_followup_audio_url, dialogue_audio_url
       from pilot_prompts
      where is_active and part in ('part2', 'part3')
      order by aircraft_type, part, order_index nulls last, created_at`,
  );

  let made = 0;
  let copied = 0;
  for (const r of rows) {
    const dir = localDirFor(r.aircraft_type);

    // Parte 2 — duas falas de ATC (voz onyx)
    if (r.part === "part2") {
      for (const [textCol, urlCol, kind] of [
        ["atc_audio_text", "atc_audio_url", "atc"],
        ["atc_followup_audio_text", "atc_followup_audio_url", "followup"],
      ]) {
        if (!r[textCol]) continue;
        const local = join(dir, localName("part2", r.order_index, kind));
        if (r[urlCol] && !FORCE) {
          await saveLocalFromUrl(r[urlCol], local);
          copied++;
          continue;
        }
        const tx = await transmission(r[textCol], VOICE.atc, `${r.id}-${kind}`);
        const url = await publishMp3(tx, `${r.id}/${kind}.mp3`, local);
        await db.query(`update pilot_prompts set ${urlCol} = $1 where id = $2`, [url, r.id]);
        made++;
        console.log(`part2 ${r.aircraft_type} #${r.order_index} ${kind} -> ${url}`);
      }
    }

    // Parte 3 — diálogo piloto/controlador (vozes echo + onyx, concatenadas)
    if (r.part === "part3") {
      if (!r.prompt_text) continue;
      const local = join(dir, localName("part3", r.order_index, "dialogue"));
      if (r.dialogue_audio_url && !FORCE) {
        await saveLocalFromUrl(r.dialogue_audio_url, local);
        copied++;
        continue;
      }
      const segments = parseAtcDialogue(r.prompt_text);
      if (segments.length === 0) continue;
      const parts = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const voice = seg.speaker === "pilot" ? VOICE.pilot : VOICE.atc;
        parts.push(await transmission(seg.text, voice, `${r.id}-d${i}`));
        if (i < segments.length - 1) parts.push(GAP);
      }
      const dialogue = tmp(`${r.id}-dialogue.wav`);
      concat(parts, dialogue);
      const url = await publishMp3(dialogue, `${r.id}/dialogue.mp3`, local);
      await db.query(`update pilot_prompts set dialogue_audio_url = $1 where id = $2`, [url, r.id]);
      made++;
      console.log(`part3 ${r.aircraft_type} #${r.order_index} dialogue (${segments.length} falas) -> ${url}`);
    }
  }

  await db.end();
  rmSync(work, { recursive: true, force: true });
  console.log(
    `\n${made} áudio(s) gerado(s), ${copied} copiado(s) do Storage pro material didático.` +
      `${made === 0 && copied === 0 ? " (nada a fazer)" : ""}`,
  );
}

main().catch((e) => {
  rmSync(work, { recursive: true, force: true });
  console.error(e);
  process.exit(1);
});
