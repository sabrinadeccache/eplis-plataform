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
  // **Achado real, M3 (2026-09-12):** o mesmo `require()` dinâmico do
  // `@ffmpeg-installer` acima faz o rastreamento de arquivos do Next
  // desistir de traçar só o necessário e incluir o REPOSITÓRIO INTEIRO no
  // bundle dessas duas rotas — confirmado inspecionando
  // `.next/server/app/api/*/submit-response/route.js.nft.json` depois do
  // build: 241 arquivos fora de `node_modules`, entre eles
  // `certificates/localhost-key.pem` (uma CHAVE PRIVADA indo pro bundle de
  // produção), todas as migrations, todo `docs/`, todo `scripts/`, e os
  // arquivos de teste. Turbopack avisa isso no build ("Encountered
  // unexpected file in NFT list"). `.env.local` (segredos reais do
  // projeto) NÃO foi varrido — confirmado por grep no manifesto — mas o
  // padrão é perigoso por natureza: qualquer arquivo novo na raiz do repo
  // vira candidato a vazar pro bundle público até isto ser corrigido.
  outputFileTracingExcludes: {
    "/api/phase2/submit-response": [
      "./certificates/**",
      "./docs/**",
      "./scripts/**",
      "./supabase/**",
      "./public/**",
      "./*.md",
      "./package-lock.json",
      "./tsconfig.tsbuildinfo",
      "./src/**/*.test.ts",
      "./src/**/*.test.tsx",
      "./src/lib/audio/fixtures/**",
    ],
    "/api/sdea/submit-response": [
      "./certificates/**",
      "./docs/**",
      "./scripts/**",
      "./supabase/**",
      "./public/**",
      "./*.md",
      "./package-lock.json",
      "./tsconfig.tsbuildinfo",
      "./src/**/*.test.ts",
      "./src/**/*.test.tsx",
      "./src/lib/audio/fixtures/**",
    ],
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
