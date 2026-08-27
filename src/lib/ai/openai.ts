import OpenAI from "openai";
import { toFile } from "openai/uploads";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function transcribeAudio(buffer: Buffer, filename: string): Promise<string> {
  const file = await toFile(buffer, filename);
  const result = await client.audio.transcriptions.create({
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
  const response = await client.audio.speech.create({
    model: "tts-1",
    voice,
    input: text,
    response_format: "mp3",
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, mimeType: "audio/mpeg" };
}
