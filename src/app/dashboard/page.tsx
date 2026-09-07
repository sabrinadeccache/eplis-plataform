import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canUseControllerTrack, canUsePilotTrack } from "@/lib/auth/roles";
import { AppShell } from "@/components/layout/app-shell";
import {
  HeadsetIcon,
  MicIcon,
  RadioTowerIcon,
  TrendIcon,
} from "@/components/layout/section-icons";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  pilot: "Piloto",
  air_traffic_controller: "Controlador de tráfego aéreo",
};

const PROFILE_LABELS: Record<string, string> = {
  fixed_wing: "Asa fixa",
  rotary_wing: "Asa rotativa",
  general: "Geral",
};

type Card = { href: string; title: string; description: string; icon: React.ReactNode };

function daysFromNow(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const isPilot = user.role === "pilot";
  const showController = canUseControllerTrack(user.role);
  const showPilot = canUsePilotTrack(user.role);

  const supabase = await createClient();
  const { count } = await supabase
    .from("simulation_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  const firstAccess = (count ?? 0) === 0;

  const exam =
    user.role === "admin"
      ? "EPLIS + SDEA"
      : isPilot
        ? "Santos Dumont English Assessment"
        : "EPLIS";
  const profile = user.operational_profile
    ? (PROFILE_LABELS[user.operational_profile] ?? user.operational_profile)
    : "não definido";

  const cards: Card[] = [
    ...(showController
      ? [
          {
            href: "/fase1",
            title: "Fase 1",
            description: "Compreensão auditiva — 30 questões de múltipla escolha.",
            icon: <HeadsetIcon />,
          },
          {
            href: "/fase2",
            title: "Fase 2",
            description: "Entrevista simulada em quatro partes.",
            icon: <MicIcon />,
          },
        ]
      : []),
    ...(showPilot
      ? [
          {
            href: "/sdea",
            title: "Simulado SDEA",
            description:
              "4 partes — aviação, rádio, situações inesperadas e descrição de imagem.",
            icon: <RadioTowerIcon />,
          },
        ]
      : []),
    {
      href: "/desempenho",
      title: "Desempenho",
      description: "Simulados anteriores, nível geral obtido e evolução.",
      icon: <TrendIcon />,
    },
  ];

  const firstName = user.name.split(" ")[0] || user.name;
  const welcome = firstAccess
    ? "Seja bem-vindo ao seu treinamento de inglês aeronáutico. Escolha abaixo por onde começar."
    : "Bem-vindo de volta ao seu treinamento de inglês aeronáutico. Escolha abaixo por onde continuar.";
  const heroTag =
    user.role === "admin" ? "EPLIS · SDEA" : isPilot ? "SDEA" : "EPLIS";

  const daysUntilExam = daysFromNow(user.exam_target_date);
  const levelValidity = user.icao_level_valid_until
    ? new Date(user.icao_level_valid_until).toLocaleDateString("pt-BR", {
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <AppShell user={user}>
      {/* Hero — bloco de marca com a malha de carta, alinhado à esquerda. */}
      <section
        className="overflow-hidden rounded-2xl bg-brand-strong px-7 py-8 text-white"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "30px 30px",
        }}
      >
        <p className="data text-xs text-white/60">{heroTag}</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">Olá, {firstName}</h1>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-white/75">{welcome}</p>

        <dl className="mt-6 flex flex-wrap gap-2">
          {[
            [ROLE_LABELS[user.role] ?? user.role, "Função"],
            [profile, "Perfil operacional"],
            [exam, "Exame"],
            user.current_icao_level
              ? [
                  `Nível ${user.current_icao_level}${levelValidity ? ` · vence ${levelValidity}` : ""}`,
                  "Nível OACI atual",
                ]
              : null,
          ]
            .filter((x): x is [string, string] => x !== null)
            .map(([value, label]) => (
              <div
                key={label}
                className="rounded-lg bg-white/10 px-3 py-1.5 ring-1 ring-inset ring-white/15"
              >
                <dt className="text-[11px] text-white/55">{label}</dt>
                <dd className="text-sm">{value}</dd>
              </div>
            ))}

          {daysUntilExam !== null && daysUntilExam >= 0 && (
            <div className="rounded-lg bg-accent px-3 py-1.5 text-white">
              <dt className="text-[11px] text-white/70">Prova prevista</dt>
              <dd className="text-sm font-medium">
                {daysUntilExam === 0
                  ? "é hoje"
                  : `em ${daysUntilExam} ${daysUntilExam === 1 ? "dia" : "dias"}`}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <div className="section-head mt-10">
        <h2 className="text-sm font-medium text-ink">Começar</h2>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <a key={card.href} href={card.href} className="card-link flex gap-4 p-5">
            <span className="icon-chip shrink-0">{card.icon}</span>
            <span className="block">
              <span className="block font-medium text-ink">{card.title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-muted">
                {card.description}
              </span>
            </span>
          </a>
        ))}
      </div>
    </AppShell>
  );
}
