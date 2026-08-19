// Nomes de campo que nunca devem sair da aplicação dentro de um evento do
// Sentry — request body/query string, contexto extra e breadcrumbs são
// percorridos recursivamente e qualquer chave batendo aqui tem o valor
// substituído. Cobre dados pessoais do candidato (nome, e-mail) e a
// transcrição da resposta de voz da Fase 2 (pode conter informação pessoal
// dita pelo candidato durante a entrevista simulada), além de segredos que
// nunca deveriam vazar em log nenhum.
const SENSITIVE_KEYS = [
  "name",
  "email",
  "transcript",
  "password",
  "access_token",
  "refresh_token",
  "authorization",
  "service_role",
  "api_key",
];

const REDACTED = "[Filtered]";

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive));
}

// Query strings chegam como uma string crua "chave=valor&chave=valor", não
// como objeto.
function scrubQueryString(value: string): string {
  const params = new URLSearchParams(value);
  for (const key of [...params.keys()]) {
    if (isSensitiveKey(key)) {
      params.set(key, REDACTED);
    }
  }
  return params.toString();
}

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > 6 || value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED : scrubValue(nested, depth + 1);
    }
    return result;
  }

  return value;
}

// Hook beforeSend do Sentry.init: remove os campos sensíveis acima de
// request.data/query_string/headers/cookies, extra e breadcrumbs antes do
// evento ser enviado para o servidor do Sentry.
export function scrubSentryEvent<T>(event: T): T {
  const scrubbed = { ...event } as Record<string, unknown>;

  const request = scrubbed.request as Record<string, unknown> | undefined;
  if (request) {
    scrubbed.request = {
      ...request,
      data: scrubValue(request.data, 0),
      query_string:
        typeof request.query_string === "string"
          ? scrubQueryString(request.query_string)
          : scrubValue(request.query_string, 0),
      cookies: request.cookies ? REDACTED : request.cookies,
      headers: scrubValue(request.headers, 0),
    };
  }

  if (scrubbed.extra) {
    scrubbed.extra = scrubValue(scrubbed.extra, 0);
  }

  if (Array.isArray(scrubbed.breadcrumbs)) {
    scrubbed.breadcrumbs = (scrubbed.breadcrumbs as Record<string, unknown>[]).map((crumb) => ({
      ...crumb,
      data: scrubValue(crumb.data, 0),
    }));
  }

  return scrubbed as T;
}
