import { randomUUID } from 'node:crypto';
export const rawHours = (normal, overtime = 0) => ({ hh_total: normal + overtime, hh_util_diurno: normal, hh_util_noturno: 0,
  hh_util_extra_diurno: overtime, hh_util_extra_noturno: 0, hh_sab_diurno: 0, hh_sab_noturno: 0, hh_dom_diurno: 0, hh_dom_noturno: 0 });
export function additionalPayload(projectId, parent, code, revisionNumber = 0, salePrice = 20_000) {
  return {
    contractVersion: 3, source: 'COMERCIAL_APP', proposalKind: 'ADDITIONAL',
    eventId: randomUUID(), proposalId: `revision-${code}-${revisionNumber}`, proposalCode: String(code), revisionNumber,
    additionalProposalId: `additional-${code}`, parentProposalCode: String(parent),
    sourceProposalId: `mother-${parent}-0`, sourceRevisionNumber: 0,
    contributionKey: `COMERCIAL_APP:${code}`, budgetOperation: 'UPSERT_ADDITIONAL_CONTRIBUTION',
    projectId, prismaProjectId: `prisma-${projectId}`, nectarOpportunityId: null, approvedAt: new Date().toISOString(),
    client: { name: 'Cliente QA', cnpj: '12345678000190', contact: '', email: '' }, title: 'Extra escopo', site: 'Sede',
    salePrice, plannedTotalCost: salePrice * 0.6, expectedMargin: 40,
    scope: [{ id: 'escopo-levantamento-teste_hidrostatico', title: 'Teste de pressão' }],
    costBreakdown: {
      volumeSystems: [{ id: 'circuit-1', name: 'Mesmo equipamento', enabled: true,
        pipeSegments: [{ id: 'pipe-1', description: 'Mesmo sistema', quantity: 1, lengthM: salePrice / 1000,
          internalDiameterMm: 50.8, diameterUnit: 'in' }] }],
      circuitServices: [{ systemId: 'circuit-1', itemId: 'pipe-1', itemType: 'pipes', serviceId: 'teste_hidrostatico' }]
    }, proposalSnapshot: { technicalServices: [{ serviceId: 'teste_hidrostatico' }] },
    estimateSummary: { schemaVersion: 1, hours: { normal: salePrice / 100, overtime: 0, total: salePrice / 100 },
      workload: { personDays: 1, peakHeadcount: 1, phases: [] },
      costs: { labor: salePrice * 0.6, indirect: 0, materials: 0, inputs: 0, filters: 0, effluent: 0,
        mobilization: 0, demobilization: 0, referralBonus: 0, direct: salePrice * 0.6, overhead: 0,
        total: salePrice * 0.6, taxesAtEstimatePrice: 0, commissionAtEstimatePrice: 0,
        representativeCommissionAtEstimatePrice: 0, commercialExpenseAtEstimatePrice: 0 } },
    documentsReference: { proposalCode: String(code), revisionNumber },
    documents: ['COMERCIAL', 'TECNICA'].map(kind => ({ id: `${code}-${revisionNumber}-${kind}`, kind, format: 'PDF',
      byteSize: 100, fileName: `${code}-${revisionNumber}-${kind}.pdf` }))
  };
}
