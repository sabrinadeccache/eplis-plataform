import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Sem isso, o Next dev bloqueia o WebSocket de HMR quando acessado por IP de
  // rede (ex.: testando pelo celular no mesmo wifi), o que quebra a
  // hidratação do React na página inteira — sintoma real: selects
  // controlados (ex. profissão → perfil operacional em /cadastro) paravam de
  // reagir a onChange, mas só quando acessados via 192.168.x.x, nunca via
  // localhost ou em produção.
  allowedDevOrigins: ["192.168.15.2"],
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  // Sem SENTRY_AUTH_TOKEN configurado, pula o upload de source maps em vez
  // de deixar o plugin avisar em todo build.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
