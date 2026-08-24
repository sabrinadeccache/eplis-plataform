import Anthropic from "@anthropic-ai/sdk";

// Base do SDK compartilhada entre os prompts do controlador (anthropic.ts) e
// os da trilha do piloto/SDEA (pilot-track.ts) — sem regra de negócio aqui.
export const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export const MODEL_VERSION = "claude-sonnet-5";

// Extrai o primeiro bloco de texto da resposta. Sonnet 5 usa "thinking"
// adaptativo por padrão — quando o modelo decide pensar, `content[0]` pode ser
// um bloco de raciocínio em vez do texto, então indexar direto em [0] deixava
// o feedback vazio de forma intermitente (bug real observado: feedback sumia
// em algumas respostas e aparecia em outras). Desabilitamos thinking nas
// chamadas dos dois módulos (não precisam de raciocínio pra feedback
// curto/JSON), e ainda assim buscamos o bloco de texto explicitamente como
// defesa extra.
export function extractText(content: Anthropic.ContentBlock[]): string {
  const block = content.find((b) => b.type === "text");
  return block?.type === "text" ? block.text : "";
}
