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
  // src/lib/audio/probe.ts (Milestone 2 — validação de áudio por decode
  // real, não por metadado do container) chama o binário do
  // `@ffmpeg-installer/<plataforma>` via caminho de arquivo resolvido em
  // runtime, não via `require()` — o rastreamento
  // automático de arquivos do Next (`@vercel/nft`) só segue `require`/`import`
  // estáticos, então não inclui esse binário sozinho no bundle da função
  // serverless. Sem isto, a rota funciona local (o binário já está em
  // node_modules) mas quebra em produção na Vercel com "spawn ENOENT".
  // `@ffmpeg-installer/ffmpeg` resolve o binário da plataforma com
  // `require()` DINÂMICO (o nome do pacote é montado em runtime a partir de
  // os/arch). O Turbopack não consegue resolver isso estaticamente e o build
  // falha com "Module not found: Can't resolve <dynamic>" — marcar o pacote
  // como externo faz o Next deixá-lo como um `require` nativo em runtime, que
  // é exatamente o comportamento desejado pra um pacote que carrega binário.
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  outputFileTracingIncludes: {
    "/api/phase2/submit-response": ["./node_modules/@ffmpeg-installer/**"],
    "/api/sdea/submit-response": ["./node_modules/@ffmpeg-installer/**"],
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
