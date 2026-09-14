import type { createAdminClient } from "@/lib/supabase/admin";
import type { SimulationMode } from "@/types/database";
import type { RecordingTrack } from "./recording-access";
type Admin = ReturnType<typeof createAdminClient>;
export const RETENTION_DAYS: Record<SimulationMode, number>;
export function recordingExpiresAt(mode: SimulationMode, from?: Date): string;
export type ExpiryReport = {
  dryRun: boolean;
  byTrack: Record<RecordingTrack, { expired: number; storageDeleted: number; rowsCleared: number; orphansSwept: number }>;
  errors: string[];
};
export type UserDataReport = {
  dryRun: boolean; storageObjectsRemoved: number; responsesCleared: number;
  feedbacksCleared: number; accountBlocked: boolean; errors: string[];
};
export function expireRecordings(params: { admin: Admin; now?: Date; dryRun?: boolean; batchSize?: number; maxBatches?: number }): Promise<ExpiryReport>;
export function purgeUserRecordings(params: { admin: Admin; userId: string; dryRun?: boolean }): Promise<UserDataReport>;
