// Hand-written types matching docs/database-schema.md.
// Once the Supabase project exists and migrations are applied (Fase 2 do roadmap),
// replace this file with the generated output of
// `supabase gen types typescript` so it stays in sync with the real schema.

export type Role = "admin" | "pilot" | "air_traffic_controller";
export type UserStatus = "active" | "inactive" | "blocked";
export type OperationalProfile =
  | "TWR"
  | "APP"
  | "ACC"
  | "AFIS"
  | "FIS"
  | "COpM"
  | "ab_initio"
  | "general";

export type Phase = "phase1" | "phase2";
export type SimulationMode = "practice" | "official";
export type AttemptStatus = "in_progress" | "completed" | "abandoned";
export type Part = "part1" | "part2" | "part3" | "part4";
export type ResponseStage =
  | "main"
  | "situation_intro"
  | "situation_check"
  | "suggestion"
  | "image_observation"
  | "image_description"
  | "story_preparation"
  | "story_telling";
export type ProcessingStatus = "queued" | "transcribing" | "analyzing" | "done" | "error";
export type ProficiencyLevel = "weak" | "moderate" | "good";
export type Difficulty = "easy" | "medium" | "hard";
export type McqOption = "a" | "b" | "c";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  target_exam: string | null;
  operational_profile: OperationalProfile | null;
  created_at: string;
}

export interface SimulationAttemptRow {
  id: string;
  user_id: string;
  phase: Phase;
  mode: SimulationMode;
  status: AttemptStatus;
  score: number | null;
  current_state: string | null;
  current_part: Part | null;
  current_item_index: number | null;
  started_at: string;
  finished_at: string | null;
}

export interface Phase1AudioRow {
  id: string;
  title: string;
  audio_url: string;
  transcript: string | null;
  difficulty: Difficulty;
  category: string;
  accent: string | null;
  duration_seconds: number;
  is_active: boolean;
  created_at: string;
}

export interface Phase1QuestionRow {
  id: string;
  audio_id: string;
  prompt: string;
  option_a: string;
  option_b: string;
  option_c: string;
  correct_option: McqOption;
  is_active: boolean;
  created_at: string;
}

export interface Phase1AnswerRow {
  id: string;
  simulation_attempt_id: string;
  question_id: string;
  selected_option: McqOption;
  is_correct: boolean;
  created_at: string;
}

export interface Phase2PromptRow {
  id: string;
  part: Part;
  operational_profile: OperationalProfile | null;
  prompt_text: string;
  image_url: string | null;
  expected_duration_seconds: number;
  order_index: number | null;
  is_active: boolean;
  created_at: string;
}

export interface Phase2ResponseRow {
  id: string;
  simulation_attempt_id: string;
  prompt_id: string;
  response_stage: ResponseStage;
  audio_url: string | null;
  transcript: string | null;
  ai_feedback: string | null;
  ai_provider: string | null;
  model_version: string | null;
  processing_status: ProcessingStatus;
  repetition_count: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface SimulationFeedbackRow {
  id: string;
  simulation_attempt_id: string;
  phase: Phase;
  overall_score: string | null;
  pronunciation_score: ProficiencyLevel | null;
  structure_score: ProficiencyLevel | null;
  vocabulary_score: ProficiencyLevel | null;
  fluency_score: ProficiencyLevel | null;
  comprehension_score: ProficiencyLevel | null;
  interaction_score: ProficiencyLevel | null;
  general_feedback: string | null;
  ai_provider: string | null;
  model_version: string | null;
  created_at: string;
}

// Minimal Database shape so @supabase/ssr's generic client compiles.
// Replace with the full generated Database type in Fase 2.
export type Database = Record<string, unknown>;
