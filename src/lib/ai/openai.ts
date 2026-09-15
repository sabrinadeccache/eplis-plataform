import OpenAI from "openai";
import { toFile } from "openai/uploads";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI não configurada no servidor.");
  client ??= new OpenAI({ apiKey });
  return client;
}

export async function transcribeAudio(buffer: Buffer, filename: string): Promise<string> {
  const file = await toFile(buffer, filename);
  const result = await getClient().audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "en",
  });
  return result.text;
}

export async function generateSpeechAudio(
  text: string,
  voice: "alloy" | "echo" | "onyx" | "nova" | "shimmer" | "fable" = "alloy",
): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await getClient().audio.speech.create({
    model: "tts-1",
    voice,
    input: text,
    response_format: "mp3",
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, mimeType: "audio/mpeg" };
}
