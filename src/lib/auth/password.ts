// Regra de força de senha compartilhada entre cadastro, alteração de senha no
// perfil e redefinição de senha ("esqueci minha senha") — mesmo padrão comum
// usado por vários sites: comprimento mínimo + variedade de tipo de
// caractere, com pontuação e rótulo pra dar feedback visual em tempo real.
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Muito fraca" | "Fraca" | "Média" | "Forte" | "Muito forte";
  isStrongEnough: boolean;
};

function countCharacterClasses(password: string): number {
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^a-zA-Z0-9]/.test(password)) classes += 1;
  return classes;
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { score: 0, label: "Muito fraca", isStrongEnough: false };
  }

  const classes = countCharacterClasses(password);
  const longEnough = password.length >= 12;

  let score: PasswordStrength["score"];
  if (classes <= 1) score = 1;
  else if (classes === 2) score = 2;
  else if (classes === 3) score = longEnough ? 4 : 3;
  else score = longEnough ? 4 : 3;

  const labels: Record<PasswordStrength["score"], PasswordStrength["label"]> = {
    0: "Muito fraca",
    1: "Fraca",
    2: "Média",
    3: "Forte",
    4: "Muito forte",
  };

  // Exige pelo menos 3 das 4 classes de caractere (minúscula/maiúscula/
  // número/especial) além do comprimento mínimo — barra a senha "forte o
  // bastante" pra ser aceita, não só informativa.
  return { score, label: labels[score], isStrongEnough: classes >= 3 };
}
