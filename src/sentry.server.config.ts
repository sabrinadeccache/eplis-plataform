import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/observability/sentry-scrub";

const dsn = process.env.SENTRY_DSN;
const isPlaceholderDsn = !dsn || dsn.includes("examplePublicKey");

if (!isPlaceholderDsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Nome/e-mail do candidato e a transcrição de voz da Fase 2 não devem
    // sair da aplicação dentro de um evento do Sentry.
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
  });
}
