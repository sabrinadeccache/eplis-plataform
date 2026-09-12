// Consentimento pra gravação de voz — Milestone 3.3 do plano de correção
// (ver docs/project-status.md). Decisão da Sabrina: exigido ANTES da 1ª
// gravação de qualquer trilha (Fase 2/SDEA compartilham o mesmo
// consentimento — o processamento é o mesmo: Whisper transcreve, Claude
// avalia, o áudio vai pro mesmo tipo de storage/retenção nas duas).
//
// `CONSENT_VERSION` identifica QUAL texto foi aceito — se o conteúdo abaixo
// mudar de forma relevante, mude a versão junto. Isso invalida os aceites
// antigos (quem aceitou uma versão anterior precisa aceitar de novo) sem
// apagar o histórico: as linhas antigas em `recording_consents` continuam
// provando o que foi aceito e quando.
export const CONSENT_VERSION = "2026-09-12";

// Estrutura de dados, não texto solto: cada seção mapeia direto num item do
// plano de correção (finalidade, serviços, armazenamento/prazo,
// papéis com acesso, canal de exclusão), pra não faltar nenhum na tela.
export const CONSENT_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Plataforma preparatória, sem vínculo oficial",
    body:
      "O EPLIS Trainer é uma plataforma de treinamento privada, independente. Não tem " +
      "vínculo com o DECEA, o ICEA, a ANAC ou qualquer banca examinadora oficial do EPLIS " +
      "ou do SDEA. O conteúdo é próprio, baseado em especificações públicas dos exames — " +
      "concluir os simulados aqui não é parte de nenhum processo de certificação real.",
  },
  {
    title: "Finalidade da gravação",
    body:
      "Ao gravar sua voz numa entrevista simulada (Fase 2 ou SDEA), o áudio é usado só pra " +
      "gerar a transcrição da sua resposta e a avaliação/feedback do seu desempenho em " +
      "inglês — pronúncia, estrutura, vocabulário, fluência, compreensão e interação.",
  },
  {
    title: "Serviços de transcrição e avaliação",
    body:
      "A transcrição é feita pela API de fala da OpenAI (Whisper); a avaliação e o " +
      "feedback são gerados pela API da Anthropic (Claude). O áudio é enviado a esses " +
      "serviços só pra esse processamento, no momento em que você envia cada resposta.",
  },
  {
    title: "Armazenamento e prazo de retenção",
    body:
      "A gravação fica num espaço de armazenamento privado, nunca público — só você e um " +
      "administrador da plataforma têm acesso a ela (por link de acesso temporário, gerado " +
      "sob demanda). Ela é apagada automaticamente depois de 30 dias (modo Practice) ou " +
      "180 dias (modo Official, prazo maior pra permitir contestar/reavaliar um resultado). " +
      "A transcrição, o feedback e a nota não são apagados nesse prazo — só o áudio.",
  },
  {
    title: "Quem tem acesso",
    body:
      "Você, titular da gravação, e um administrador da plataforma (pra suporte técnico ou " +
      "auditoria de um resultado contestado). Ninguém mais — nem outros candidatos, nem " +
      "terceiros fora dos serviços de transcrição/avaliação citados acima.",
  },
  {
    title: "Como pedir a exclusão dos seus dados",
    body:
      "Você pode pedir a exclusão da sua conta e dos seus dados a qualquer momento, " +
      "escrevendo para o e-mail de contato da plataforma. Ao excluir a conta, suas " +
      "gravações são apagadas; o histórico de uso (notas e critérios, sem a gravação nem a " +
      "transcrição) é mantido de forma anônima, sem identificar você.",
  },
];

export type ConsentStatus = { accepted: boolean; version: string; acceptedAt: string | null };

// Só diz SE já aceitou a versão atual — nunca decide sozinho o que fazer
// com isso (bloquear a tela é responsabilidade de quem chama, no Server
// Component da entrevista).
export async function getConsentStatus(
  supabase: import("@/lib/simulations/attempt-guards").SupabaseServerClient,
  userId: string,
): Promise<ConsentStatus> {
  const { data } = await supabase
    .from("recording_consents")
    .select("consent_version, accepted_at")
    .eq("user_id", userId)
    .eq("consent_version", CONSENT_VERSION)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { accepted: false, version: CONSENT_VERSION, acceptedAt: null };
  return { accepted: true, version: data.consent_version, acceptedAt: data.accepted_at };
}
