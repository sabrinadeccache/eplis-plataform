// Efeito de rádio VHF nos mp3 da Parte 2 do SDEA, VARIADO por arquivo.
// Cada arquivo tem um "perfil de rádio" próprio, derivado de forma determinística
// do nome (mesmo arquivo => mesmo som sempre; a01 e a02 soam de estações diferentes).
// Uso: node radioize.mjs [--inplace] [--intensity N]   (N ~0.7..1.4, default 1)
//
// A fonte é SEMPRE `Audios-ORIGINAIS-backup/` quando ela existe (os mp3 limpos
// que a Sabrina guardou) — assim re-rodar o script é idempotente e nunca empilha
// o efeito de rádio sobre um arquivo já processado. Sem o backup, cai pra
// `Audios/`. Com `--inplace` a saída é `Audios/` (o que o app/upload usa); sem
// ele, `Audios-radio/` (espelho pra conferência).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg";
const ROOT = "/Users/sabrinadeccache/Desktop/Projeto Plataforma/Material Didático/Pilots/Material Didático/Part 2";
const BACKUP = join(ROOT, "Audios-ORIGINAIS-backup");
const SRC = existsSync(BACKUP) ? BACKUP : join(ROOT, "Audios");
const INPLACE = process.argv.includes("--inplace");
const OUT = INPLACE ? join(ROOT, "Audios") : join(ROOT, "Audios-radio");
const ii = process.argv.indexOf("--intensity");
const INTENSITY = ii > -1 ? Number(process.argv[ii + 1]) : 1;

const work = mkdtempSync(join(tmpdir(), "radio-"));
const ff = (args) => execFileSync(FFMPEG, ["-y", "-loglevel", "error", ...args]);

// PRNG determinístico a partir do nome do arquivo
function rng(seedStr) {
  let h = parseInt(createHash("md5").update(seedStr).digest("hex").slice(0, 8), 16);
  return () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 2 ** 32;
  };
}
const lerp = (r, a, b) => a + (b - a) * r();
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function profileFor(rel) {
  const r = rng(rel);
  const k = INTENSITY;
  return {
    hp: Math.round(lerp(r, 260, 420)),               // corte grave
    lp: Math.round(lerp(r, 2900, 3500)),              // corte agudo
    ratio: lerp(r, 4, 8),
    drive: lerp(r, 2.4, 3.6),
    crush: lerp(r, 0.12, 0.4) * k,                    // saturação
    hiss: lerp(r, 0.03, 0.09) * k,                    // chiado de fundo
    hissColor: pick(r, ["pink", "brown", "pink"]),
    crackle: lerp(r, 0.004, 0.014) * k,               // estalos
    bed: pick(r, ["none", "none", "hum", "rumble"]),  // fundo extra ocasional
    bedFreq: Math.round(lerp(r, 90, 180)),
    tail: lerp(r, 0.08, 0.22),                        // cauda de squelch
    clickVol: lerp(r, 0.35, 0.6),
    dropouts: r() < 0.28,                             // ~1/4 tem microcorte
    dropAt: lerp(r, 0.3, 0.7),
    wetEmphasis: r() < 0.5,
  };
}

function fixtures(p) {
  const click = join(work, "click.wav");
  ff(["-f", "lavfi", "-i", "anoisesrc=color=white:amplitude=0.5:sample_rate=24000", "-t", "0.04",
      "-af", `highpass=f=900,lowpass=f=3200,volume=${p.clickVol.toFixed(2)},afade=t=out:st=0.02:d=0.02`, click]);
  const tail = join(work, "tail.wav");
  ff(["-f", "lavfi", "-i", "anoisesrc=color=white:amplitude=0.6:sample_rate=24000", "-t", p.tail.toFixed(2),
      "-af", `highpass=f=1400,lowpass=f=3600,volume=0.32,afade=t=out:st=${(p.tail * 0.3).toFixed(2)}:d=${(p.tail * 0.7).toFixed(2)}`, tail]);
  return { click, tail };
}

function radioize(inPath, outPath, rel) {
  const p = profileFor(rel);
  const { click, tail } = fixtures(p);
  const body = join(work, "body.wav");

  const inputs = [
    "-i", inPath,
    "-f", "lavfi", "-t", "90", "-i", `anoisesrc=color=${p.hissColor}:amplitude=${p.hiss.toFixed(4)}:sample_rate=24000`,
    "-f", "lavfi", "-t", "90", "-i", `anoisesrc=color=white:amplitude=${p.crackle.toFixed(4)}:sample_rate=24000`,
  ];
  let voice =
    "[0:a]aformat=channel_layouts=mono:sample_rates=24000," +
    `highpass=f=${p.hp},lowpass=f=${p.lp},` +
    `acompressor=threshold=-20dB:ratio=${p.ratio.toFixed(1)}:attack=4:release=50,volume=${p.drive.toFixed(2)},` +
    `acrusher=bits=10:mode=lin:mix=${p.crush.toFixed(2)}`;
  if (p.wetEmphasis) voice += ",aemphasis=type=riaa:mode=production";
  if (p.dropouts) {
    voice += `,volume=enable='between(t,${p.dropAt.toFixed(2)},${(p.dropAt + 0.12).toFixed(2)})':volume=0.15`;
  }
  voice += "[v];";

  let mix = "[1:a]highpass=f=280,lowpass=f=3400[hiss];[2:a]highpass=f=1200[crk];";
  let last = "[v][hiss]amix=inputs=2:duration=first:normalize=0[vh];[vh][crk]amix=inputs=2:duration=first:normalize=0";
  if (p.bed !== "none") {
    const amp = p.bed === "hum" ? 0.05 : 0.07;
    inputs.push("-f", "lavfi", "-t", "90", "-i", `sine=frequency=${p.bedFreq}:sample_rate=24000`);
    mix += `[3:a]volume=${amp}[bed];`;
    last = last.replace("normalize=0", "normalize=0[pre];[pre][bed]amix=inputs=2:duration=first:normalize=0");
  }
  const filter = voice + mix + last + ",alimiter=limit=0.93,aformat=sample_rates=24000:channel_layouts=mono[out]";

  ff([...inputs, "-filter_complex", filter, "-map", "[out]", body]);

  const merged = join(work, "merged.wav");
  ff(["-i", click, "-i", body, "-i", tail,
      "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]", "-map", "[out]", merged]);
  mkdirSync(dirname(outPath), { recursive: true });
  ff(["-i", merged, "-codec:a", "libmp3lame", "-q:a", "4", outPath]);
  return p;
}

function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!name.toLowerCase().endsWith(".mp3")) continue;
    const rel = relative(SRC, full);
    const p = radioize(full, join(OUT, rel), rel);
    console.log(`ok ${rel}  [hp${p.hp} lp${p.lp} hiss${p.hiss.toFixed(3)} bed:${p.bed}${p.dropouts ? " drop" : ""}]`);
  }
}

walk(SRC);
console.log("\nSaída:", OUT);
