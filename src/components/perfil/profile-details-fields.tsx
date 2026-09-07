"use client";

import { useEffect, useState } from "react";
import { TRAINING_GOALS, ICAO_LEVELS, type ProfileExtraFields } from "@/lib/profile-fields";
import type { UF } from "@/data/br-locations";

type Role = "pilot" | "air_traffic_controller";

const WORK_LOCATION_COPY: Record<Role, { label: string; placeholder: string }> = {
  air_traffic_controller: {
    label: "Órgão onde trabalha",
    placeholder: "Ex.: TWR-SBGL, APP-CF, ACC-RE",
  },
  pilot: {
    label: "Empresa ou base",
    placeholder: "Ex.: LATAM, Azul, GRU",
  },
};

export function ProfileDetailsFields({
  role,
  defaults,
}: {
  role: Role;
  defaults?: Partial<ProfileExtraFields>;
}) {
  const [states, setStates] = useState<UF[]>([]);
  const [citiesByUf, setCitiesByUf] = useState<Record<string, string[]>>({});
  const [uf, setUf] = useState(defaults?.home_state ?? "");
  const [city, setCity] = useState(defaults?.home_city ?? "");

  useEffect(() => {
    let active = true;
    import("@/data/br-locations").then((m) => {
      if (!active) return;
      setStates(m.BR_STATES);
      setCitiesByUf(m.BR_CITIES_BY_UF);
    });
    return () => {
      active = false;
    };
  }, []);

  const cities = uf ? (citiesByUf[uf] ?? []) : [];
  const locationsLoaded = states.length > 0;
  const work = WORK_LOCATION_COPY[role];

  return (
    <div className="space-y-4 border-t border-line pt-4">
      <p className="text-sm font-medium text-ink">Sobre você</p>

      <div className="space-y-1.5">
        <label htmlFor="work_location" className="field-label">
          {work.label}
        </label>
        <input
          id="work_location"
          name="work_location"
          type="text"
          defaultValue={defaults?.work_location ?? ""}
          placeholder={work.placeholder}
          className="field-input"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="home_state" className="field-label">
            Estado onde mora
          </label>
          <select
            id="home_state"
            name="home_state"
            value={uf}
            disabled={!locationsLoaded}
            onChange={(e) => {
              setUf(e.target.value);
              setCity("");
            }}
            className="field-select"
          >
            <option value="">{locationsLoaded ? "Selecione" : "Carregando…"}</option>
            {states.map((s) => (
              <option key={s.sigla} value={s.sigla}>
                {s.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="home_city" className="field-label">
            Cidade onde mora
          </label>
          <select
            id="home_city"
            name="home_city"
            value={city}
            disabled={!uf || cities.length === 0}
            onChange={(e) => setCity(e.target.value)}
            className="field-select"
          >
            <option value="">{uf ? "Selecione" : "Escolha o estado antes"}</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="phone" className="field-label">
          Telefone / WhatsApp
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={defaults?.phone ?? ""}
          placeholder="(11) 90000-0000"
          className="field-input"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="current_icao_level" className="field-label">
            Nível OACI atual
          </label>
          <select
            id="current_icao_level"
            name="current_icao_level"
            defaultValue={defaults?.current_icao_level ? String(defaults.current_icao_level) : ""}
            className="field-select"
          >
            <option value="">Não informar</option>
            {ICAO_LEVELS.map((n) => (
              <option key={n} value={n}>
                Nível {n}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="icao_level_valid_until" className="field-label">
            Validade do nível atual
          </label>
          <input
            id="icao_level_valid_until"
            name="icao_level_valid_until"
            type="date"
            defaultValue={defaults?.icao_level_valid_until ?? ""}
            className="field-input"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="exam_target_date" className="field-label">
            Data prevista da prova
          </label>
          <input
            id="exam_target_date"
            name="exam_target_date"
            type="date"
            defaultValue={defaults?.exam_target_date ?? ""}
            className="field-input"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="training_goal" className="field-label">
            Objetivo no treinamento
          </label>
          <select
            id="training_goal"
            name="training_goal"
            defaultValue={defaults?.training_goal ?? ""}
            className="field-select"
          >
            <option value="">Não informar</option>
            {TRAINING_GOALS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
