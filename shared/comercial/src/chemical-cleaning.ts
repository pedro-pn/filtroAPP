import type { DimensioningFields } from "./dimensioning.js";
import type { ChemicalPumpChoice, VolumeSystem } from "./cost-model.js";

/** LEC v1.3, CUSTO.Produtos!L40, O43:R45 e O47:R49. */
export const CHEMICAL_SYSTEM_MAX_LENGTH_M = 50;
export const LEC_CHEMICAL_PI = 3.14;
export const CHEMICAL_PUMPS = [
  { id: "120", maxDiameterMm: 76.2, reservoirLiters: 120, hoseLiters: 50 },
  { id: "240", maxDiameterMm: 203.2, reservoirLiters: 240, hoseLiters: 100 },
  {
    id: "1000",
    maxDiameterMm: Infinity,
    reservoirLiters: 1000,
    hoseLiters: 200,
  },
] as const;

type PumpMaterial = "carbon_steel" | "stainless_steel";
export type ChemicalPumpGroup = {
  /** Só nas bombas escolhidas à mão: id da linha em `VolumeSystem.chemicalPumps`. */
  id?: string;
  material: PumpMaterial;
  pumpId: string;
  /** Comprimento de tubo atendido; 0 nas bombas escolhidas à mão, que não medem tubo. */
  lengthM: number;
  systemCount: number;
  reservoirLitersPerSystem: number;
  hoseLitersPerSystem: number;
  pipeVolumeLiters: number;
  reservoirVolumeLiters: number;
  hoseVolumeLiters: number;
  totalVolumeLiters: number;
};

export type ChemicalVolumeResult = {
  id: string;
  name: string;
  /** `manual` quando o circuito tem `chemicalPumps`; senão as bombas saem do diâmetro. */
  mode: "auto" | "manual";
  groups: ChemicalPumpGroup[];
  /** O que o modo automático escolheria; só vem no modo manual, como referência. */
  autoGroups?: ChemicalPumpGroup[];
  /** Comprimento total de tubo considerado (o mesmo nos dois modos). */
  pipeLengthM: number;
  pipeVolumeLiters: number;
  otherVolumeLiters: number;
  reservoirVolumeLiters: number;
  hoseVolumeLiters: number;
  physicalVolumeLiters: number;
  cycles: number;
  totalVolumeLiters: number;
};

const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 1e6) / 1e6;
const positive = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

export function chemicalPumpForDiameter(diameterMm: number) {
  if (!Number.isFinite(diameterMm) || diameterMm <= 0) return undefined;
  return CHEMICAL_PUMPS.find((pump) => diameterMm <= pump.maxDiameterMm + 1e-9);
}

/** Bombas escolhidas à mão: reservatório e mangueiras de cada uma, sem tubo. */
function manualPumpGroups(choices: ChemicalPumpChoice[]): ChemicalPumpGroup[] {
  return choices.flatMap((choice) => {
    const pump = CHEMICAL_PUMPS.find((item) => item.id === choice.pumpId);
    if (!pump) return [];
    const reservoirVolumeLiters = choice.quantity * pump.reservoirLiters;
    const hoseVolumeLiters = choice.quantity * pump.hoseLiters;
    return [
      {
        id: choice.id,
        material: choice.material,
        pumpId: pump.id,
        lengthM: 0,
        systemCount: choice.quantity,
        reservoirLitersPerSystem: pump.reservoirLiters,
        hoseLitersPerSystem: pump.hoseLiters,
        pipeVolumeLiters: 0,
        reservoirVolumeLiters,
        hoseVolumeLiters,
        totalVolumeLiters: reservoirVolumeLiters + hoseVolumeLiters,
      },
    ];
  });
}

/**
 * CUSTO.Produtos!L65/L68: volume de tubo + sistemas × (reservatório + mangueiras).
 * No modo automático, o agrupamento e o teto de comprimento automatizam a
 * entrada manual L43:L49. Com `system.chemicalPumps` presente, as bombas são as
 * escolhidas pelo usuário (tipo e quantidade) e substituem esse cálculo; o
 * volume do tubo segue o mesmo nos dois modos.
 * Não altera o volume geométrico do cliente, utilizado pelos demais serviços.
 * Recebe o circuito normalizado e previamente associado à limpeza química.
 */
export function calculateChemicalCleaningVolume(
  system: VolumeSystem,
): ChemicalVolumeResult {
  const chemical = (item: DimensioningFields & { included?: boolean }) =>
    item.included !== false &&
    (!system.servicesByItem || item.serviceIds?.includes("limpeza_quimica"));
  const grouped = new Map<string, ChemicalPumpGroup>();
  let pipeVolumeLiters = 0;
  let pipeLengthM = 0;
  for (const pipe of system.pipeSegments.filter(chemical)) {
    const lengthM = positive(pipe.lengthM) * positive(pipe.quantity);
    const fill = Math.min(100, positive(pipe.fillPercent)) / 100;
    const pump = chemicalPumpForDiameter(pipe.internalDiameterMm);
    if (!lengthM || !fill || !pump) continue;
    const liters =
      ((LEC_CHEMICAL_PI * (pipe.internalDiameterMm / 1000) ** 2) / 4) *
      lengthM *
      1000 *
      fill;
    pipeVolumeLiters += liters;
    pipeLengthM += lengthM;
    const material = pipe.material ?? system.material;
    // "Outro" precisa ser corrigido na linha; não presumir uma bomba compatível.
    if (material !== "carbon_steel" && material !== "stainless_steel") continue;
    const key = `${material}:${pump.id}`;
    const group = grouped.get(key) ?? {
      material,
      pumpId: pump.id,
      lengthM: 0,
      systemCount: 0,
      reservoirLitersPerSystem: pump.reservoirLiters,
      hoseLitersPerSystem: pump.hoseLiters,
      pipeVolumeLiters: 0,
      reservoirVolumeLiters: 0,
      hoseVolumeLiters: 0,
      totalVolumeLiters: 0,
    };
    group.lengthM += lengthM;
    group.pipeVolumeLiters += liters;
    grouped.set(key, group);
  }
  const autoGroups = [...grouped.values()].map((group) => {
    const lengthM = round(group.lengthM);
    const systemCount = Math.max(
      1,
      Math.ceil(lengthM / CHEMICAL_SYSTEM_MAX_LENGTH_M),
    );
    const reservoirVolumeLiters = systemCount * group.reservoirLitersPerSystem;
    const hoseVolumeLiters = systemCount * group.hoseLitersPerSystem;
    return {
      ...group,
      lengthM,
      systemCount,
      reservoirVolumeLiters,
      hoseVolumeLiters,
      pipeVolumeLiters: round(group.pipeVolumeLiters),
      totalVolumeLiters: round(
        group.pipeVolumeLiters + reservoirVolumeLiters + hoseVolumeLiters,
      ),
    };
  });
  const manual = system.chemicalPumps !== undefined;
  const groups = manual ? manualPumpGroups(system.chemicalPumps!) : autoGroups;
  let otherVolumeLiters = [
    ...system.equipmentVolumes,
    ...(system.reservoirVolumes || []),
  ]
    .filter(chemical)
    .reduce(
      (sum, item) =>
        sum + positive(item.quantity) * positive(item.volumeLiters),
      0,
    );
  // Dados anteriores ao cadastro de serviços por linha: conservar volumes informados.
  if (!system.servicesByItem) {
    otherVolumeLiters += system.manualVolumes.reduce(
      (sum, item) =>
        sum + positive(item.quantity) * positive(item.volumeLiters),
      0,
    );
    otherVolumeLiters += system.hoseSegments.reduce(
      (sum, item) =>
        sum +
        (((Math.PI * (positive(item.internalDiameterMm) / 1000) ** 2) / 4) *
          positive(item.lengthM) *
          positive(item.quantity) *
          1000 *
          Math.min(100, positive(item.fillPercent))) /
          100,
      0,
    );
  }
  const reservoirVolumeLiters = groups.reduce(
    (sum, group) => sum + group.reservoirVolumeLiters,
    0,
  );
  const hoseVolumeLiters = groups.reduce(
    (sum, group) => sum + group.hoseVolumeLiters,
    0,
  );
  const physicalVolumeLiters =
    pipeVolumeLiters +
    otherVolumeLiters +
    reservoirVolumeLiters +
    hoseVolumeLiters;
  return {
    id: system.id,
    name: system.name,
    mode: manual ? "manual" : "auto",
    groups,
    ...(manual ? { autoGroups } : {}),
    pipeLengthM: round(pipeLengthM),
    pipeVolumeLiters: round(pipeVolumeLiters),
    otherVolumeLiters: round(otherVolumeLiters),
    reservoirVolumeLiters,
    hoseVolumeLiters,
    physicalVolumeLiters: round(physicalVolumeLiters),
    cycles: system.cycles,
    totalVolumeLiters: round(physicalVolumeLiters * system.cycles),
  };
}
