// Equivalente de src/services/simulations/phase2/response-stages.ts pra
// trilha do piloto/SDEA — espelha os estágios "kind: response" de buildSteps
// em src/components/sdea/pilot-interview-runner.tsx. Único ponto de atenção:
// a Parte 4 tem DOIS estágios seguidos com o mesmo `response_stage`
// ("narrative" — hipótese de antes e hipótese de depois da foto), então a
// posição na lista (o "slot") importa mais que o nome do estágio pra
// distinguir as duas respostas — é exatamente pra isso que o guard usa
// `item_slot`, não `response_stage`, como chave de posição.
import { PART_SIZES } from "@/services/simulations/pilot/state-machine";
import type { Part, PilotResponseStage } from "@/types/database";

export function responseStagesForPilotItem(part: Part, itemIndex: number): PilotResponseStage[] {
  switch (part) {
    case "part1":
      return ["main"];
    case "part2":
      return ["readback", "reaction", "confirmation", "report_back"];
    case "part3":
      return itemIndex === PART_SIZES.part3 - 1
        ? ["report", "question", "comparison"]
        : ["report", "question"];
    case "part4":
      return [
        "picture_description",
        "narrative",
        "narrative",
        "discussion_1",
        "discussion_2",
        "agree_disagree",
      ];
  }
}
