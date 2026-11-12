import { lazy, Suspense, useState } from 'react';

import { AppIcon } from '../../components/icons/AppIcon';
import { Button } from '../../components/ui/ds';
import { DS_ICONS } from '../../components/ui/ds/icons';
import type { Project } from '../../types/domain';
import { Modal } from '../../components/ui/Modal';
import { BrandLoading } from '../../components/brand/BrandLoading';
const PhysicalSignatureBatchDialog = lazy(() => import('./PhysicalSignatureBatchDialog').then(module => ({ default: module.PhysicalSignatureBatchDialog })));
import type { PhysicalSignatureUpload } from './physicalSignatureBatch';

export function PhysicalSignatureBatchAction({ projects, upload }: {
  projects: Project[];
  upload: (payload: PhysicalSignatureUpload) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="primary" disabled={!projects.length} iconLeft={<AppIcon icon={DS_ICONS.upload} size="sm" />} onClick={() => setOpen(true)}>
      Enviar assinados em lote
    </Button>
    {open ? <Suspense fallback={<Modal open appearance="design-system" title="Enviar assinados em lote" onClose={() => setOpen(false)}><BrandLoading label="Carregando formulário…" /></Modal>}><PhysicalSignatureBatchDialog projects={projects} onClose={() => setOpen(false)} upload={upload} /></Suspense> : null}
  </>;
}
