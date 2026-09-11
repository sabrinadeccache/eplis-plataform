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
  // src/lib/audio/probe.ts (Milestone 2, 3ª rodada da revisão — validação de
  // áudio por decode real, não por metadado do container) chama o binário
  // do `ffmpeg-static` via caminho de arquivo (`path.join(__dirname, ...)`
  // dentro do próprio pacote), não via `require()` — o rastreamento
  // automático de arquivos do Next (`@vercel/nft`) só segue `require`/`import`
  // estáticos, então não inclui esse binário sozinho no bundle da função
  // serverless. Sem isto, a rota funciona local (o binário já está em
  // node_modules) mas quebra em produção na Vercel com "spawn ENOENT".
  outputFileTracingIncludes: {
    "/api/phase2/submit-response": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/sdea/submit-response": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
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
