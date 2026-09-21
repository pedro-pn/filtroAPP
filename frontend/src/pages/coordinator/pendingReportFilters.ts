import { canReviewRdoReports } from '../../../../shared/modules/rdo-permissions.js';
import type { AuthUser } from '../../types/auth';

interface PendingFilterOptions {
  search: string;
  projectSort: 'asc' | 'desc';
  pageSize: number;
}

// Sem a permissão de revisão, a aba Pendentes do coordenador lista só os relatórios
// criados por ele — é tudo o que ele pode editar. Com a permissão, passa a ser a mesma
// fila de revisão do gestor (pendentes, devolvidos e rejeitados pelo cliente em aberto);
// o backend ainda restringe o resultado aos projetos que a conta enxerga.
export function coordinatorPendingReportFilters(user: AuthUser | null | undefined, options: PendingFilterOptions) {
  const base = {
    summary: true,
    projectActive: true,
    search: options.search,
    projectSort: options.projectSort,
    pageSize: options.pageSize
  };
  return canReviewRdoReports(user)
    ? { ...base, reviewQueue: true }
    : { ...base, statuses: ['PENDING', 'RETURNED'], createdByUserId: user?.id || '' };
}

export function coordinatorPendingCountQuery(user: AuthUser | null | undefined) {
  return canReviewRdoReports(user)
    ? { reviewQueue: true, projectActive: true }
    : { statuses: ['PENDING', 'RETURNED'], projectActive: true, createdByUserId: user?.id || '' };
}
