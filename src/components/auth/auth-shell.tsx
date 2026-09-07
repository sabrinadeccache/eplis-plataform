import Link from "next/link";

/*
  Moldura das telas de autenticação. Coluna esquerda (só em telas largas):
  bloco de marca sobre azul de procedimento com uma malha discreta de carta.
  Coluna direita: o formulário, alinhado à esquerda.
*/
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside
        className="relative hidden shrink-0 flex-col justify-between overflow-hidden bg-brand-strong px-10 py-12 text-white md:flex md:w-[38%] md:max-w-md"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      >
        <Link href="/login" className="flex items-baseline gap-2">
          <span className="text-base font-semibold tracking-tight">EPLIS Trainer</span>
        </Link>
        <div>
          <p className="data text-xs text-white/60">EPLIS · SDEA</p>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/80">
            Treino de proficiência em inglês aeronáutico para controladores e pilotos —
            simulados fiéis ao exame e acompanhamento da sua evolução.
          </p>
        </div>
      </aside>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-xl font-semibold text-ink">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
          </div>
          {children}
          {footer ? <div className="mt-8 text-sm text-muted">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
