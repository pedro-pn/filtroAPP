import { lazy, Suspense, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { Button } from '../ui/ds';
import type { DatabookProject } from './ProjectDatabookDialog';

const ProjectDatabookDialog = lazy(() => import('./ProjectDatabookDialog').then(m => ({ default: m.ProjectDatabookDialog })));

interface ProjectDatabookButtonProps {
  project: DatabookProject;
  /** Total de relatórios do projeto, quando a listagem já sabe: sem relatório o botão fica desabilitado. */
  reportCount?: number;
}

/** "Gerar Data Book" nas listas de projetos (gestor: Projetos/Arquivados; coordenador). */
export function ProjectDatabookButton({ project, reportCount }: ProjectDatabookButtonProps) {
  const { user } = useAuth();
  const [aberto, setAberto] = useState(false);
  const semRelatorio = reportCount === 0;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        data-databook-button=""
        disabled={semRelatorio}
        title={semRelatorio ? 'O projeto ainda não tem RDO.' : undefined}
        onClick={() => setAberto(true)}
      >
        Gerar Data Book
      </Button>
      {aberto ? (
        <Suspense fallback={null}>
          <ProjectDatabookDialog project={project} userId={user?.id} onClose={() => setAberto(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
