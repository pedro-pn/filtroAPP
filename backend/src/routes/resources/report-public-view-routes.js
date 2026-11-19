import asyncHandler from '../../lib/async-handler.js';
import { reportClientAccessStatus } from '../../lib/reports/client-access.js';
import { signatureTokenHash } from '../../lib/signature-token.js';
import { defineRoute } from '../../lib/api-contract/registry.js';
import { rdoRoute, jsonObjectSchema, FILE } from '../../lib/api-contract/domains/rdo.js';

export function registerReportPublicViewRoutes(router, {
  database, reportInclude, limiter, getReportPdfDownload, sendDownloadBuffer,
  projectEmailRecipients, hasActiveClientRejection
}) {
  async function accessFromToken(token) {
    if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
    return database.reportClientAccess.findUnique({
      where: { tokenHash: signatureTokenHash(token) },
      include: { report: { include: reportInclude } }
    });
  }

  function accessStatus(access) {
    const status = reportClientAccessStatus(access);
    if (status !== 'ACTIVE') return status;
    if (hasActiveClientRejection(access.report)) return 'UNAVAILABLE';
    if (!projectEmailRecipients(access.report.project).recipients.includes(access.recipientEmail)) return 'UNAVAILABLE';
    return status;
  }

  defineRoute(router, rdoRoute('GET /public-view/:token', { summary: 'Ver o relatório pelo link público de leitura', auth: 'publicToken', responses: { 200: jsonObjectSchema }, errors: [404, 410, 429] }), limiter, asyncHandler(async (req, res) => {
    const access = await accessFromToken(req.params.token);
    const status = accessStatus(access);
    res.setHeader('Cache-Control', 'no-store');
    if (status !== 'ACTIVE') return res.json({ status });
    const report = access.report;
    res.json({
      status,
      expiresAt: access.expiresAt,
      report: {
        id: report.id,
        reportType: report.reportType,
        sequenceNumber: report.sequenceNumber,
        reportDate: report.reportDate,
        status: report.status,
        project: {
          code: report.project.code,
          name: report.project.name,
          clientName: report.project.clientName
        }
      }
    });
  }));

  defineRoute(router, rdoRoute('GET /public-view/:token/pdf', { summary: 'PDF pelo link público de leitura', auth: 'publicToken', responses: { 200: FILE }, errors: [404, 410, 429] }), limiter, asyncHandler(async (req, res) => {
    const access = await accessFromToken(req.params.token);
    const status = accessStatus(access);
    if (status !== 'ACTIVE') {
      return res.status(status === 'INVALID' ? 404 : 410).json({ error: 'Link de consulta indisponível.', status });
    }
    const download = await getReportPdfDownload(access.report);
    sendDownloadBuffer(res, { contentType: 'application/pdf', ...download });
  }));
}
