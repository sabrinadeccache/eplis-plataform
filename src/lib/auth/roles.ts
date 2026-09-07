import type { OperationalProfile, Role } from "@/types/database";

// `admin` enxerga e usa as duas trilhas (EPLIS do controlador e SDEA do piloto).
// `pilot` só o SDEA; `air_traffic_controller` só o EPLIS.

export function isPilotProfile(
  p: OperationalProfile | null,
): p is "fixed_wing" | "rotary_wing" {
  return p === "fixed_wing" || p === "rotary_wing";
}

export function canUsePilotTrack(role: Role): boolean {
  return role === "pilot" || role === "admin";
}

export function canUseControllerTrack(role: Role): boolean {
  return role === "air_traffic_controller" || role === "admin";
}

// Tipo de aeronave pra montar um simulado SDEA. Quem não tem perfil de piloto
// (ex.: admin que é controlador) roda como asa fixa por padrão.
export function sdeaAircraftType(
  p: OperationalProfile | null,
): "fixed_wing" | "rotary_wing" {
  return isPilotProfile(p) ? p : "fixed_wing";
}
