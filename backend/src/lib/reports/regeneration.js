import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

import { REPORT_FILE_SUFFIX } from '../report-filename.js';
import { projectWorkLocations, reportWorkLocation } from '../../../../shared/modules/rdo-project-context.js';

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

export function assertReportCanRegenerate(report) {
  if (['RDO_MAINTENANCE', 'RDO_PRODUCTION'].includes(report.reportType)) {
    throw Object.assign(new Error('Use o fluxo próprio de relatórios internos.'), { statusCode: 400 });
  }
  if (report.specialConditions?.__manualUpload?.uploadedAt) {
    throw conflict('PDF enviado manualmente deve ser atualizado pela opção Editar manual.');
  }
  if (report.status === 'SIGNED' || report.physicalSignedAt || report.zapsignSignedAt
    || report.reportSignatures?.some(signature => signature.status === 'SIGNED')
    || report.versions?.some(version => version.finalPdfUrl)) {
    throw conflict('Relatórios com assinatura registrada não podem ser gerados novamente.');
  }
  if (report.zapsignDocToken || report.zapsignDocUrl) {
    throw conflict('Este relatório possui uma solicitação de assinatura externa.');
  }
}

function contentToken(report) {
  return JSON.stringify([report.updatedAt, report.project?.updatedAt, report.project?.code, report.project?.name,
    report.project?.location, report.project?.additionalWorkLocations]);
}

// Renderiza em arquivos separados antes de publicar. Assim, uma assinatura ou
// edição feita durante a conversão não sobrescreve o PDF que já estava em uso.
export function createReportRegenerator({ database, include, isUnavailable, generatePdf, writeMetadata, pdfTarget, replaceSignatureRound, notifySignatureRound }) {
  let running = false;

  return async function regenerateReport(id, context = {}) {
    if (running) {
      throw Object.assign(new Error('Outra geração de relatório está em andamento. Tente novamente em alguns segundos.'), { statusCode: 503 });
    }
    running = true;
    let saved;
    let published = false;
    try {
      const report = await database.report.findUniqueOrThrow({ where: { id }, include });
      if (isUnavailable(report)) {
        throw Object.assign(new Error('Relatório não encontrado.'), { statusCode: 404 });
      }
      assertReportCanRegenerate(report);
      const refreshLocation = report.reportType === 'RDO' && projectWorkLocations(report.project).length === 1
        && report.specialConditions?.workLocation !== reportWorkLocation(report.project, report.specialConditions?.workLocation);
      const prepared = refreshLocation ? { ...report, specialConditions: {
        ...report.specialConditions, workLocation: reportWorkLocation(report.project, report.specialConditions?.workLocation)
      } } : report;
      saved = await generatePdf({ ...prepared, [REPORT_FILE_SUFFIX]: `atualizado-${randomUUID()}` });
      const hash = createHash('sha256').update(await fs.readFile(saved.targetPath)).digest('hex');
      await writeMetadata(saved.targetPath, prepared);

      const signatureRound = await database.$transaction(async tx => {
        // Usa a mesma trava das assinaturas internas antes de trocar o PDF-base.
        await tx.$queryRawUnsafe(`
          WITH advisory_lock AS (SELECT pg_advisory_xact_lock(hashtext($1), 0))
          SELECT 1::int AS locked FROM advisory_lock
        `, String(id));
        // A assinatura pública atualiza as linhas diretamente. Trava essas
        // linhas também para detectar assinaturas concluídas durante a geração.
        await tx.$queryRawUnsafe('SELECT id FROM "ReportSignature" WHERE "reportId" = $1 FOR UPDATE', String(id));
        await tx.$queryRawUnsafe('SELECT id FROM "Report" WHERE id = $1 FOR UPDATE', String(id));
        let current = await tx.report.findUniqueOrThrow({ where: { id }, include });
        if (isUnavailable(current)) {
          throw Object.assign(new Error('Relatório não encontrado.'), { statusCode: 404 });
        }
        assertReportCanRegenerate(current);
        if (contentToken(current) !== contentToken(report)) {
          throw conflict('O relatório ou projeto foi alterado durante a geração. Tente novamente.');
        }
        if (refreshLocation) {
          current = await tx.report.update({ where: { id }, data: { specialConditions: prepared.specialConditions }, include });
          await writeMetadata(saved.targetPath, current);
        }
        const nextRound = await replaceSignatureRound(tx, current, saved, hash, context);
        if (!nextRound) {
          const target = pdfTarget(current);
          await fs.rename(saved.targetPath, target.targetPath);
          await fs.rename(`${saved.targetPath}.meta.json`, `${target.targetPath}.meta.json`);
          await fs.rename(saved.targetPath.replace(/\.pdf$/i, '.docx'), target.targetPath.replace(/\.pdf$/i, '.docx'));
        }
        return nextRound;
      });
      published = true;
      const delivery = signatureRound ? await notifySignatureRound(signatureRound) : null;
      return { id, ...(delivery?.ok === false ? { warning: 'Relatório reemitido, mas não foi possível enviar os novos links de assinatura.' } : {}) };
    } finally {
      running = false;
      if (saved && !published) {
        await Promise.all([
          saved.targetPath,
          `${saved.targetPath}.meta.json`,
          saved.targetPath.replace(/\.pdf$/i, '.docx')
        ].map(file => fs.unlink(file).catch(() => {})));
      }
    }
  };
}
