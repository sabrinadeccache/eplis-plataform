import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { expireRecordings } from "@/lib/simulations/retention";

// Execução AGENDADA da expiração de gravações — Milestone 3.2 (ver
// docs/project-status.md).
//
// **Achado da revisão (2026-09-12): a promessa de "apagada automaticamente"
// no texto de consentimento não correspondia à implementação** —
// `expireRecordings`/`scripts/expire-recordings.mjs` só rodavam se alguém
// executasse manualmente; não havia nenhuma execução agendada. Esta rota é
// o que fecha essa lacuna: chamada 1x/dia pelo Vercel Cron (`vercel.json`),
// aplica a expiração de verdade (`dryRun: false`) — nunca é o cliente do
// candidato quem aciona isto.
//
// Protegida por segredo compartilhado (`CRON_SECRET`), não por
// `authorize()`: quem chama é a infraestrutura da Vercel, não um usuário
// logado. O Vercel manda `Authorization: Bearer <CRON_SECRET>` nas
// invocações de cron configuradas em `vercel.json` — comparação char-a-char
// não é necessária aqui (não é verificação de assinatura criptográfica de
// alto risco de timing attack prático nesse contexto), mas falha fechado
// (sem `CRON_SECRET` configurado, a rota nunca executa).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET não configurado." }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const report = await expireRecordings({ admin, dryRun: false });

  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
