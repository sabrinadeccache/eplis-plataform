"use client";

import { evaluatePasswordStrength } from "@/lib/auth/password";

const BAR_COLORS = [
  "bg-danger",
  "bg-danger",
  "bg-caution",
  "bg-success",
  "bg-success",
];

export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;

  const { score, label } = evaluatePasswordStrength(password);

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= score - 1 ? BAR_COLORS[score] : "bg-line"
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-muted">
        Força da senha: <span className="font-medium text-ink">{label}</span> — use ao
        menos 8 caracteres com letras maiúsculas, minúsculas, números ou símbolos.
      </p>
    </div>
  );
}
