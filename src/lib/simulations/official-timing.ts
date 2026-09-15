import { ItemGuardError } from "@/lib/simulations/item-guard";

export const OFFICIAL_DURATION_TOLERANCE_SECONDS = 3;

export type OfficialWindow = {
  id: string;
  recording_started_at: string | null;
  recording_finished_at: string | null;
  repetition_count: number | null;
  expected_duration_seconds: number;
};

export function validateOfficialTiming(window: OfficialWindow, decodedDurationSeconds: number): void {
  if (!window.recording_started_at || !window.recording_finished_at) {
    throw new ItemGuardError("A janela oficial desta gravação não foi registrada.", 409);
  }
  const start = Date.parse(window.recording_started_at);
  const finish = Date.parse(window.recording_finished_at);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start) {
    throw new ItemGuardError("A janela oficial desta gravação é inválida.", 409);
  }
  const serverDuration = (finish - start) / 1000;
  const allowed = window.expected_duration_seconds + OFFICIAL_DURATION_TOLERANCE_SECONDS;
  if (serverDuration > allowed || decodedDurationSeconds > allowed) {
    throw new ItemGuardError("O tempo máximo desta resposta oficial foi excedido.", 422);
  }
  // Impede substituir uma gravação longa por um arquivo muito menor ou vice-
  // versa. A folga absorve latência dos eventos e o arredondamento do codec.
  if (Math.abs(serverDuration - decodedDurationSeconds) > OFFICIAL_DURATION_TOLERANCE_SECONDS) {
    throw new ItemGuardError("A duração do áudio não corresponde à janela oficial registrada.", 422);
  }
}
