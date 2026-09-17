import type { DimensioningFields } from "./dimensioning.js";
import type { VolumeSystem } from "./cost-model.js";

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
  material: PumpMaterial;
  pumpId: string;
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
  groups: ChemicalPumpGroup[];
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

/**
 * CUSTO.Produtos!L65/L68: volume de tubo + sistemas × (reservatório + mangueiras).
 * O agrupamento e o teto de comprimento automatizam a entrada manual L43:L49.
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
  const groups = [...grouped.values()].map((group) => {
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
    groups,
    pipeVolumeLiters: round(pipeVolumeLiters),
    otherVolumeLiters: round(otherVolumeLiters),
    reservoirVolumeLiters,
    hoseVolumeLiters,
    physicalVolumeLiters: round(physicalVolumeLiters),
    cycles: system.cycles,
    totalVolumeLiters: round(physicalVolumeLiters * system.cycles),
  };
}
