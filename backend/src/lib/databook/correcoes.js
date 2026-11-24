import { Prisma } from '@prisma/client';

import { isServiceFinalized } from '../acompanhamento/avanco.js';
import { correctedExtraData } from '../acompanhamento/service-report-corrections.js';
import { MANUAL_SERVICE_EDIT_KEY, projectServiceReportCorrections } from '../reports/service-report-corrections.js';

/** Projeta a edição vigente do técnico sobre o RDO assinado, sem gravar nos originais. */
export async function corrigirRelatoriosDatabook(client, projetoId, rdosAvanco, rdos, derivados) {
  if (!rdosAvanco.some(report => report.status === 'SIGNED')) return { rdosAvanco, rdos, derivados };
  // A data da correção pode ser posterior ao intervalo de execução, inclusive
  // quando o RDO só participa do acumulado inicial do Data Book.
  const correcoes = await client.report.findMany({
    where: {
      projectId: projetoId, deletedAt: null, reportType: { in: ['RLQ', 'RCPU', 'RTP', 'RLM'] },
      status: { in: ['APPROVED', 'SIGNED'] },
      specialConditions: { path: [MANUAL_SERVICE_EDIT_KEY, 'editedAt'], not: Prisma.AnyNull }
    },
    include: { services: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }
  });
  const projetar = reports => projectServiceReportCorrections(reports, correcoes, {
    isServiceFinalized,
    isManualUploadedReport: report => report.specialConditions?.source === 'MANUAL_UPLOAD'
      || Boolean(report.specialConditions?.__manualUpload?.uploadedAt),
    replaceService: (source, corrected) => {
      const extraData = correctedExtraData(source, corrected);
      // As chaves pertencem ao serviço do RDO, mesmo quando a edição recria o técnico.
      for (const key of ['__ongoingKey', '__serviceLinkKey', '__sourceServiceId', 'serviceId']) {
        if (Object.hasOwn(source.extraData || {}, key)) extraData[key] = source.extraData[key];
      }
      const out = { ...source, finalized: true, extraData };
      // A reconciliação anterior descreve a medição do RDO, não a corrigida.
      delete out.reconciledMeasurements;
      for (const field of ['equipmentId', 'system', 'material']) {
        if (Object.hasOwn(corrected, field)) out[field] = corrected[field];
      }
      return out;
    }
  });
  const atuais = projetar(rdos);
  const usados = new Set(atuais.flatMap(report => report.services || []).map(service => service.correction?.reportId).filter(Boolean));
  return {
    rdosAvanco: projetar(rdosAvanco), rdos: atuais,
    derivados: [...new Map([...derivados, ...correcoes.filter(report => usados.has(report.id))].map(report => [report.id, report])).values()]
  };
}
