import { Prisma } from '@prisma/client';

export function validateProposalPercentage(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error('Informe um percentual de 0% a 100%.');
  }
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
    throw new Error('Use no máximo duas casas decimais.');
  }
  return value;
}

export function scaleProposalValue(value, percentage = 100) {
  if (value == null) return null;
  const pct = validateProposalPercentage(Number(percentage ?? 100));
  return new Prisma.Decimal(value).mul(pct).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

// Sempre parte do previsto integral, sem alterar os dados importados ou acumular reduções.
export function applyProposalPercentage(fullPlannedTotalCost, percentage = 100) {
  const proposalPercentage = validateProposalPercentage(Number(percentage ?? 100));
  return {
    fullPlannedTotalCost,
    proposalPercentage,
    plannedTotalCost: scaleProposalValue(fullPlannedTotalCost, proposalPercentage)
  };
}

export function consideredPlannedServices(services, percentage = 100) {
  if (Number(percentage ?? 100) === 100) return services;
  return services.map(service => ({ ...service, systems: service.systems.map(system => ({
    ...system, quantity: scaleProposalValue(system.quantity, percentage)
  })) }));
}
