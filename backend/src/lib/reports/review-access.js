import { canReviewRdoReports } from '../../../../shared/modules/rdo-permissions.js';

// Revisor = gestor (ADMIN) ou conta interna com a permissão adicional REVIEW_REPORTS.
export function requireRdoReviewer(req, res, next) {
  if (!req.auth || !canReviewRdoReports(req.auth.user)) {
    return res.status(403).json({ error: 'Acesso restrito a quem pode revisar relatórios.' });
  }

  next();
}

// O gestor alcança qualquer relatório. Um revisor com a permissão adicional
// continua limitado ao que a conta dele já enxerga — em especial, projetos
// managerOnly seguem restritos ao gestor. Quem chama já validou que o
// relatório existe e está disponível.
export function assertReviewerReachesReport(req, res, report) {
  if (req.auth.user.role === 'MANAGER' || !report?.project?.managerOnly) return true;
  res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  return false;
}
