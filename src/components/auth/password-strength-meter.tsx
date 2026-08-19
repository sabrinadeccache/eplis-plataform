"use client";

import { evaluatePasswordStrength } from "@/lib/auth/password";

const BAR_COLORS = [
  "bg-red-500",
  "bg-red-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-emerald-600",
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
              i <= score - 1 ? BAR_COLORS[score] : "bg-zinc-200 dark:bg-zinc-800"
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Força da senha: <span className="font-medium">{label}</span> — use ao menos 8
        caracteres com letras maiúsculas, minúsculas, números ou símbolos.
      </p>
    </div>
  );
}
