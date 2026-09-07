// Allowlist de contas que enxergam atalhos de teste na UI (ex.: botão "pular
// questão" no runner do SDEA/EPLIS). NÃO é um mecanismo de permissão de
// segurança — só evita que um controle útil pra QA manual apareça pra um
// candidato real. A checagem é feita no Server Component, que já carregou o
// `users` row, e o resultado desce como prop booleana pro componente client.
const DEV_TESTER_EMAILS = new Set<string>([
  "sdeccache@gmail.com",
]);

export function isDevTester(email: string | null | undefined): boolean {
  return !!email && DEV_TESTER_EMAILS.has(email.trim().toLowerCase());
}
