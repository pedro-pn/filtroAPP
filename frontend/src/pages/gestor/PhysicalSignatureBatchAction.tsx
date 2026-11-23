import { lazy, Suspense, useMemo, useState } from 'react';

import { AppIcon } from '../../components/icons/AppIcon';
import { Button } from '../../components/ui/ds';
import { DS_ICONS } from '../../components/ui/ds/icons';
import type { Project } from '../../types/domain';
import { Modal } from '../../components/ui/Modal';
import { BrandLoading } from '../../components/brand/BrandLoading';
import { useGestorBootstrap } from '../../hooks/useBootstrap';
import { sortProjects } from '../../utils/projectSort';
import { projectRegistrationPending } from './projectPendingReview';
const PhysicalSignatureBatchDialog = lazy(() => import('./PhysicalSignatureBatchDialog').then(module => ({ default: module.PhysicalSignatureBatchDialog })));
import type { PhysicalSignatureUpload } from './physicalSignatureBatch';

export function PhysicalSignatureBatchAction({ upload }: {
  upload: (payload: PhysicalSignatureUpload) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const projectsQuery = useGestorBootstrap(open, 'relatorios');
  const projects = useMemo(() => {
    const byId = new Map<string, Project>();
    [...(projectsQuery.data?.activeProjects || []), ...(projectsQuery.data?.archivedProjects || [])]
      .filter(project => !projectRegistrationPending(project))
      .forEach(project => byId.set(project.id, project));
    return sortProjects(Array.from(byId.values()), 'asc');
  }, [projectsQuery.data]);
  return <>
    <Button variant="primary" iconLeft={<AppIcon icon={DS_ICONS.upload} size="sm" />} onClick={() => setOpen(true)}>
      Enviar assinados em lote
    </Button>
    {open ? <Suspense fallback={<Modal open appearance="design-system" title="Enviar assinados em lote" onClose={() => setOpen(false)}><BrandLoading label="Carregando formulário…" /></Modal>}><PhysicalSignatureBatchDialog projects={projects} projectsLoading={projectsQuery.isPending} projectsError={projectsQuery.isError} onRetryProjects={() => void projectsQuery.refetch()} onClose={() => setOpen(false)} upload={upload} /></Suspense> : null}
  </>;
}
