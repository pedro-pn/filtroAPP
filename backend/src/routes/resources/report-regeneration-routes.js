import asyncHandler from '../../lib/async-handler.js';
import {
  ensureInternalSignatureRound,
  invalidateUnsignedInternalSignatureRound,
  issuePendingSignatureTokens,
  signatureEvidenceFromRequest
} from '../../lib/internal-report-signatures.js';
import { createReportRegenerator } from '../../lib/reports/regeneration.js';
import { RDO_ACCESS_ROLES, requireAuth, requireHubAdmin, requireModuleRole } from '../../middleware/auth.js';

export async function recreateReportSignatureRound(tx, report, saved, hash, { userId, evidence }, shouldCreateRound) {
  await invalidateUnsignedInternalSignatureRound(tx, {
    reportId: report.id,
    userId,
    evidence,
    description: 'Rodada de assinatura cancelada pela reemissão administrativa do relatório.'
  });
  if (!shouldCreateRound(report)) return null;
  const version = await ensureInternalSignatureRound(tx, {
    report,
    sourcePdfUrl: saved.publicUrl,
    sourceDocumentHash: hash,
    createdByUserId: userId,
    evidence
  });
  const tokens = await issuePendingSignatureTokens(tx, version);
  return { report, tokens };
}

export function registerReportRegenerationRoutes(router, { shouldCreateSignatureRound, ...options }) {
  const regenerate = createReportRegenerator({
    ...options,
    replaceSignatureRound: (...args) => recreateReportSignatureRound(...args, shouldCreateSignatureRound)
  });
  router.post('/:id/regenerate', requireAuth, requireHubAdmin, requireModuleRole(...RDO_ACCESS_ROLES), asyncHandler(async (req, res) => {
    res.json(await regenerate(req.params.id, {
      userId: req.auth.user.id,
      evidence: signatureEvidenceFromRequest(req)
    }));
  }));
}
