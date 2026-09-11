// Lista ordenada dos estágios que efetivamente geram uma resposta gravada
// (kind: "response" em buildSteps, src/components/fase2/interview-runner.tsx)
// para um item da Fase 2 — usada pelo guard de item da route handler de envio
// de áudio (src/app/api/phase2/submit-response/route.ts) para saber, de forma
// autoritativa e só a partir de current_part/current_item_index (nunca de
// campos que o cliente manda), quantos "slots" de resposta aquele item tem e
// em que ordem. Os estágios "auto"/"silent" (intro de parte, observação de
// imagem, preparação de história) nunca chegam à route — não entram aqui.
//
// Mantido como dado separado (não reexportado de interview-runner.tsx, que é
// "use client") de propósito: route handlers e testes de servidor não podem
// puxar um módulo client component.
import type { Part, ResponseStage } from "@/types/database";

export function responseStagesForPhase2Item(part: Part): ResponseStage[] {
  switch (part) {
    case "part1":
    case "part3":
      return ["main"];
    case "part2":
      return ["situation_check", "suggestion"];
    case "part4":
      return ["image_description", "story_telling"];
  }
}
