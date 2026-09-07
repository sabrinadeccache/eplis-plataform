import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";
import { BackLink } from "@/components/layout/back-link";
import { TrendIcon } from "@/components/layout/section-icons";
import { canUseControllerTrack, canUsePilotTrack } from "@/lib/auth/roles";

export default async function DesempenhoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const isPilot = user.role === "pilot";

  const cards = [
    ...(canUseControllerTrack(user.role)
      ? [
          {
            href: "/desempenho/fase1",
            title: "Fase 1",
            description:
              "Simulados de compreensão auditiva, aprovação e evolução do percentual de acertos.",
          },
          {
            href: "/desempenho/fase2",
            title: "Fase 2",
            description:
              "Entrevistas simuladas, nível geral obtido e evolução por simulado.",
          },
        ]
      : []),
    ...(canUsePilotTrack(user.role)
      ? [
          {
            href: "/desempenho/sdea",
            title: "SDEA",
            description:
              "Simulados do Santos Dumont English Assessment, nível geral obtido e evolução por simulado.",
          },
        ]
      : []),
  ];

  return (
    <AppShell user={user}>
      <BackLink />
      <h1 className="page-title">Desempenho</h1>
      <p className="page-intro">
        {isPilot
          ? "Veja seus simulados anteriores do SDEA e sua evolução."
          : "Escolha uma fase para ver seus simulados anteriores e sua evolução."}
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <a key={card.href} href={card.href} className="card-link flex gap-4 p-5">
            <span className="icon-chip shrink-0">
              <TrendIcon />
            </span>
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
