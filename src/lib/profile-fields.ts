// Campos adicionais de perfil (coletados no cadastro e editáveis em /perfil):
// local de trabalho, cidade/estado, telefone, nível OACI atual + validade, data
// prevista da prova, objetivo. Sanitização compartilhada entre `signUp` e
// `updateProfile` (src/lib/auth/actions.ts).

export const UF_SIGLAS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export const TRAINING_GOALS = [
  "Primeira certificação",
  "Renovar meu nível atual",
  "Subir de nível",
  "Manter em dia / praticando",
] as const;

export const ICAO_LEVELS = [1, 2, 3, 4, 5, 6] as const;

export type ProfileExtraFields = {
  work_location: string | null;
  home_state: string | null;
  home_city: string | null;
  phone: string | null;
  current_icao_level: number | null;
  icao_level_valid_until: string | null;
  exam_target_date: string | null;
  training_goal: string | null;
};

function text(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v === "" ? null : v;
}

// aceita só YYYY-MM-DD (valor nativo do <input type="date">)
function isoDate(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : v;
}

export function readProfileExtraFields(formData: FormData): ProfileExtraFields {
  const uf = String(formData.get("home_state") ?? "").trim().toUpperCase();
  const levelRaw = String(formData.get("current_icao_level") ?? "").trim();
  const level = /^[1-6]$/.test(levelRaw) ? Number(levelRaw) : null;
  const goal = String(formData.get("training_goal") ?? "").trim();

  return {
    work_location: text(formData, "work_location"),
    home_state: (UF_SIGLAS as readonly string[]).includes(uf) ? uf : null,
    home_city: text(formData, "home_city"),
    phone: text(formData, "phone"),
    current_icao_level: level,
    icao_level_valid_until: isoDate(formData, "icao_level_valid_until"),
    exam_target_date: isoDate(formData, "exam_target_date"),
    training_goal: (TRAINING_GOALS as readonly string[]).includes(goal) ? goal : null,
  };
}

// Metadados do signUp precisam ser strings (JSON do raw_user_meta_data); o
// trigger faz o cast. null vira "" e o trigger devolve pra null via nullif.
export function profileExtraFieldsToMetadata(f: ProfileExtraFields): Record<string, string> {
  return {
    work_location: f.work_location ?? "",
    home_state: f.home_state ?? "",
    home_city: f.home_city ?? "",
    phone: f.phone ?? "",
    current_icao_level: f.current_icao_level ? String(f.current_icao_level) : "",
    icao_level_valid_until: f.icao_level_valid_until ?? "",
    exam_target_date: f.exam_target_date ?? "",
    training_goal: f.training_goal ?? "",
  };
}
