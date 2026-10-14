import { useState } from 'react';

import { AppIcon } from '../../components/icons/AppIcon';
import { Button } from '../../components/ui/ds';
import { DS_ICONS } from '../../components/ui/ds/icons';
import type { Project } from '../../types/domain';
import { PhysicalSignatureBatchDialog } from './PhysicalSignatureBatchDialog';
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
    {open ? <PhysicalSignatureBatchDialog projects={projects} onClose={() => setOpen(false)} upload={upload} /> : null}
  </>;
}
