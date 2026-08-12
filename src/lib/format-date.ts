// `toLocaleDateString` depende do fuso horário do runtime — o servidor (UTC) e
// o navegador do usuário (fuso local) podem calcular dias diferentes pra um
// mesmo timestamp perto da meia-noite, causando hydration mismatch em Server
// Components. Formata sempre a partir dos campos UTC, sem depender de locale
// nem de fuso horário do ambiente.
export function formatDate(iso: string): string {
  const date = new Date(iso);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}
