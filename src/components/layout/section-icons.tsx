/*
  Ícones de linha das áreas de treino — usados nos selos (.icon-chip) dos
  cartões de navegação. Traço fino, 24×24, herdam currentColor.
*/
type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 20,
  height: 20,
  "aria-hidden": true,
};

// Fase 1 — compreensão auditiva (headset)
export function HeadsetIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="3" y="13" width="4" height="7" rx="1.4" />
      <rect x="17" y="13" width="4" height="7" rx="1.4" />
      <path d="M20 20a3 3 0 0 1-3 3h-3" />
    </svg>
  );
}

// Fase 2 / entrevista — fala ao microfone
export function MicIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

// SDEA — rádio / torre
export function RadioTowerIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 9v12M8 21h8M9.5 21 12 11l2.5 10" />
      <path d="M7.5 7.5a6 6 0 0 1 9 0M5 5a9.5 9.5 0 0 1 14 0" />
    </svg>
  );
}

// Desempenho — linha de progresso
export function TrendIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 18 10 12l4 4 6-8" />
      <path d="M15 6h5v5" />
    </svg>
  );
}

// Perfil
export function UserIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}
