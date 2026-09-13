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
  | "COpM"
  | "fixed_wing"
  | "rotary_wing"
  | "general";

export type Phase = "phase1" | "phase2" | "pilot_interview";
export type SimulationMode = "practice" | "official";
export type AttemptStatus = "in_progress" | "completed" | "abandoned";
export type Part = "part1" | "part2" | "part3" | "part4";
export type ResponseStage =
  | "main"
  | "situation_check"
  | "suggestion"
  | "image_observation"
  | "image_description"
  | "story_preparation"
  | "story_telling";
export type PilotResponseStage =
  | "main"
  | "readback"
  | "reaction"
  | "confirmation"
  | "report_back"
  | "report"
  | "question"
  | "comparison"
  | "picture_description"
  | "narrative"
  | "discussion_1"
  | "discussion_2"
  | "agree_disagree";
export type ProcessingStatus = "queued" | "transcribing" | "analyzing" | "done" | "error";
// 4 faixas da Escala OACI (MVP): weak=Fraco (N1-N3), moderate=Moderado (N4),
// good=Ótimo (N5), excellent=Excelente (N6). Ordem do enum no banco é a mesma.
export type ProficiencyLevel = "weak" | "moderate" | "good" | "excellent";

// Ordem crescente — usada pra calcular o overall como o MENOR dos 6 critérios.
export const PROFICIENCY_ORDER: readonly ProficiencyLevel[] = [
  "weak",
  "moderate",
  "good",
  "excellent",
];

export function lowestProficiency(levels: ProficiencyLevel[]): ProficiencyLevel {
  return levels.reduce((lowest, level) =>
    PROFICIENCY_ORDER.indexOf(level) < PROFICIENCY_ORDER.indexOf(lowest) ? level : lowest,
  );
}
export type Difficulty = "easy" | "medium" | "hard";
export type McqOption = "a" | "b" | "c";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  target_exam: string | null;
  operational_profile: OperationalProfile | null;
  avatar_url: string | null;
  work_location: string | null;
  home_state: string | null;
  home_city: string | null;
  phone: string | null;
  current_icao_level: number | null;
  icao_level_valid_until: string | null;
  exam_target_date: string | null;
  training_goal: string | null;
  created_at: string;
};

export type SimulationAttemptRow = {
  id: string;
  // Anulável desde a migration 20260912030000 (`on delete set null`): ao
  // excluir a conta, a tentativa sobrevive ANONIMIZADA (sem dono) pra
  // estatística agregada — ver M3.2 em docs/project-status.md. As checagens
  // de posse (`attempt.user_id !== user.id`) e os filtros
  // `.eq("user_id", ...)` rejeitam nulo naturalmente.
  user_id: string | null;
  phase: Phase;
  mode: SimulationMode;
  status: AttemptStatus;
  score: number | null;
  current_state: string | null;
  current_part: Part | null;
  current_item_index: number | null;
  elapsed_seconds: number;
  // Sequência de prompts sorteada pro candidato, congelada no momento da
  // criação da tentativa — { part1: string[], part2: string[], ... } (ids de
  // phase2_prompts/pilot_prompts, na ordem em que aparecem no simulado). Sem
  // isso, `getSequenceForAttempt` recalculava a cada chamada a partir do
  // pool ativo e do perfil atual do usuário, que podem mudar no meio de uma
  // tentativa em andamento. `null` só em tentativas anteriores a essa coluna
  // (migration 20260911010000) — nesse caso o código cai no recálculo
  // antigo, ver comentário em queries.ts.
  item_sequence: Record<string, string[]> | null;
  // Timestamp do último envio de resposta aceito (qualquer slot, inclusive
  // retry) — usado só pelo rate limit (src/lib/simulations/rate-limit.ts)
  // como trava de cooldown via compare-and-swap; não tem relação com
  // `elapsed_seconds` nem com o cronômetro exibido ao candidato.
  last_submission_at: string | null;
  started_at: string;
  finished_at: string | null;
};

export type Phase1AudioRow = {
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
};

export type Phase1QuestionRow = {
  id: string;
  audio_id: string;
  prompt: string;
  option_a: string;
  option_b: string;
  option_c: string;
  correct_option: McqOption;
  is_active: boolean;
  created_at: string;
};

export type Phase1AnswerRow = {
  id: string;
  simulation_attempt_id: string;
  question_id: string;
  selected_option: McqOption;
  is_correct: boolean;
  created_at: string;
};

export type Phase2PromptRow = {
  id: string;
  part: Part;
  operational_profile: OperationalProfile | null;
  prompt_text: string;
  image_url: string | null;
  expected_duration_seconds: number;
  order_index: number | null;
  is_active: boolean;
  created_at: string;
};

export type Phase2ResponseRow = {
  id: string;
  simulation_attempt_id: string;
  prompt_id: string;
  response_stage: ResponseStage;
  // Posição (0-based) da resposta dentro da sequência de estágios do item —
  // ver src/services/simulations/phase2/response-stages.ts. Necessário
  // porque `response_stage` sozinho não é único dentro de um item em todo
  // lugar (a Parte 4 do SDEA repete "narrative"); é o `item_slot`, não o
  // nome do estágio, que o guard de item usa como chave de posição/idempotência
  // (Milestone 2, docs/project-status.md). `null` = linha antiga, de antes
  // dessa coluna existir (ver migration 20260911000000).
  item_slot: number | null;
  // Quantas vezes esta MESMA linha (mesmo item_slot) foi reprocessada depois
  // de um erro — ver reserveResponseSlot em src/lib/simulations/item-guard.ts.
  // Existe porque um retry reusa a linha (só muda processing_status/started_at),
  // então a contagem de LINHAS por tentativa não reflete retries.
  retry_count: number;
  // Caminho do objeto no bucket PRIVADO (M3.1, migration 20260912010000) —
  // `{userId}/{attemptId}/{...}`. Substitui `audio_url`: com bucket privado
  // não existe URL estável, o acesso é por URL assinada de vida curta
  // gerada sob demanda (src/lib/simulations/recording-access.ts).
  audio_path: string | null;
  // Quando a GRAVAÇÃO vence e passa a ser apagada pelo processo de retenção
  // (M3.2, migration 20260912020000): practice 30 dias, official 180.
  // Transcrição, feedback e notas não expiram — só o áudio.
  expires_at: string | null;
  // **Legado.** Guardava a URL PÚBLICA da gravação, de quando os buckets
  // eram públicos — as URLs gravadas aqui deixaram de funcionar quando os
  // buckets viraram privados (migration 20260912000000), o que era o
  // objetivo. O código novo não escreve mais nesta coluna.
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
};

export type PilotPromptRow = {
  id: string;
  part: Part;
  aircraft_type: OperationalProfile | null;
  prompt_text: string;
  atc_audio_text: string | null;
  expected_readback: string | null;
  complication_text: string | null;
  complication_image_url: string | null;
  expected_reaction: string | null;
  atc_followup_audio_text: string | null;
  expected_confirmation: string | null;
  discussion_question: string | null;
  discussion_question_2: string | null;
  image_url: string | null;
  agree_disagree_statement: string | null;
  order_index: number | null;
  expected_duration_seconds: number;
  is_active: boolean;
  created_at: string;
};

export type PilotResponseRow = {
  id: string;
  simulation_attempt_id: string;
  prompt_id: string;
  response_stage: PilotResponseStage;
  // Ver comentários equivalentes em Phase2ResponseRow (item_slot,
  // retry_count, audio_path, audio_url).
  item_slot: number | null;
  retry_count: number;
  audio_path: string | null;
  expires_at: string | null;
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
};

export type SimulationFeedbackRow = {
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
};

// Hand-written Database shape (mirrors the Row interfaces above) so the Supabase
// client gets real column types instead of falling back to `never`/`any` on every
// query. Replace with `supabase gen types typescript` output once the Supabase CLI
// is available on this machine — see docs/project-status.md, "Ferramentas indisponíveis".
type TableDef<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type UserInsert = Partial<Omit<UserRow, "id" | "created_at">> &
  Pick<UserRow, "id" | "name" | "email">;

type SimulationAttemptInsert = Partial<
  Omit<SimulationAttemptRow, "started_at" | "status">
> &
  Pick<SimulationAttemptRow, "phase" | "mode"> & {
    // `user_id` é anulável na LINHA (anonimização pós-exclusão de conta),
    // mas obrigatório no INSERT: criar tentativa sem dono nunca é o
    // caminho válido — o desvínculo só acontece via `on delete set null`.
    user_id: string;
    // Opcional: startAttempt() gera o id explicitamente (crypto.randomUUID())
    // quando precisa computar+persistir `item_sequence` no mesmo INSERT (a
    // seed da sequência é o próprio attemptId — ver queries.ts).
    id?: string;
    status?: AttemptStatus;
  };

type Phase1AudioInsert = Partial<Omit<Phase1AudioRow, "id" | "created_at">> &
  Pick<Phase1AudioRow, "title" | "audio_url" | "difficulty" | "category" | "duration_seconds">;

type Phase1QuestionInsert = Partial<Omit<Phase1QuestionRow, "id" | "created_at">> &
  Pick<
    Phase1QuestionRow,
    "audio_id" | "prompt" | "option_a" | "option_b" | "option_c" | "correct_option"
  >;

type Phase1AnswerInsert = Omit<Phase1AnswerRow, "id" | "created_at">;

type Phase2PromptInsert = Partial<Omit<Phase2PromptRow, "id" | "created_at">> &
  Pick<Phase2PromptRow, "part" | "prompt_text" | "expected_duration_seconds">;

type Phase2ResponseInsert = Partial<Omit<Phase2ResponseRow, "id" | "created_at">> &
  Pick<Phase2ResponseRow, "simulation_attempt_id" | "prompt_id" | "response_stage">;

type SimulationFeedbackInsert = Partial<Omit<SimulationFeedbackRow, "id" | "created_at">> &
  Pick<SimulationFeedbackRow, "simulation_attempt_id" | "phase">;

type PilotPromptInsert = Partial<Omit<PilotPromptRow, "id" | "created_at">> &
  Pick<PilotPromptRow, "part" | "prompt_text" | "expected_duration_seconds">;

type PilotResponseInsert = Partial<Omit<PilotResponseRow, "id" | "created_at">> &
  Pick<PilotResponseRow, "simulation_attempt_id" | "prompt_id" | "response_stage">;

// Registro do aceite de consentimento pra gravação de voz — M3.3 (migration
// 20260912040000). Imutável por design: sem update/delete pra
// `authenticated`, ver src/lib/simulations/consent.ts.
export type RecordingConsentRow = {
  id: string;
  user_id: string;
  consent_version: string;
  accepted_at: string;
  created_at: string;
};
type RecordingConsentInsert = Pick<RecordingConsentRow, "user_id" | "consent_version">;

// Auditoria de acesso ADMINISTRATIVO a uma gravação (item 3.2 do plano de
// correção) — só metadado, nunca conteúdo. Escrita/leitura só por
// service_role (migration 20260912060000).
export type RecordingAccessLogRow = {
  id: string;
  admin_user_id: string;
  track: "phase2" | "pilot";
  response_id: string;
  accessed_at: string;
};
type RecordingAccessLogInsert = Pick<RecordingAccessLogRow, "admin_user_id" | "track" | "response_id">;

export type Database = {
  public: {
    Tables: {
      users: TableDef<UserRow, UserInsert>;
      simulation_attempts: TableDef<SimulationAttemptRow, SimulationAttemptInsert>;
      phase1_audios: TableDef<Phase1AudioRow, Phase1AudioInsert>;
      phase1_questions: TableDef<Phase1QuestionRow, Phase1QuestionInsert>;
      phase1_answers: TableDef<Phase1AnswerRow, Phase1AnswerInsert>;
      phase2_prompts: TableDef<Phase2PromptRow, Phase2PromptInsert>;
      phase2_responses: TableDef<Phase2ResponseRow, Phase2ResponseInsert>;
      pilot_prompts: TableDef<PilotPromptRow, PilotPromptInsert>;
      pilot_responses: TableDef<PilotResponseRow, PilotResponseInsert>;
      simulation_feedbacks: TableDef<SimulationFeedbackRow, SimulationFeedbackInsert>;
      recording_consents: TableDef<RecordingConsentRow, RecordingConsentInsert>;
      recording_access_log: TableDef<RecordingAccessLogRow, RecordingAccessLogInsert>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

