import type { ReactNode, RefObject } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/ds';
import type { Project } from '../../types/domain';
import { projectRegistrationPending, projectTitle } from './projectPendingReview';

export function ProjectEditDialog({ project, saving, onClose, initialFocusRef, children }: {
  project: Project | null;
  saving: boolean;
  onClose: () => void;
  initialFocusRef: RefObject<HTMLInputElement | null>;
  children: ReactNode;
}) {
  const review = Boolean(project && projectRegistrationPending(project));
  return (
    <Modal
      open
      onClose={onClose}
      closeOnEscape={!saving}
      showCloseButton={!saving}
      appearance="design-system"
      size="md"
      backdropClassName="rdo-manager-projects-page rdo-project-edit-dialog-backdrop"
      panelClassName="rdo-project-edit-dialog rdo-ds-actions"
      fullscreenOnMobile={false}
      initialFocusRef={initialFocusRef}
      preventInitialFocusScroll
      title={<h2>{project ? review ? 'Revisar cadastro' : 'Editar projeto' : 'Novo projeto'}</h2>}
      footer={!review ? (
        <>
          <Button variant="secondary" size="md" type="button" disabled={saving} onClick={onClose}>
            {project ? 'Cancelar edição' : 'Cancelar'}
          </Button>
          <Button variant="primary" size="md" type="submit" form={project ? 'project-edit-form' : 'project-create-form'} loading={saving} loadingLabel={project ? 'Salvando projeto…' : 'Criando projeto…'}>
            {project ? 'Salvar projeto' : 'Criar projeto'}
          </Button>
        </>
      ) : undefined}
    >
      {project ? <p className="rdo-project-edit-dialog__context">{projectTitle(project)}</p> : null}
      <div
        id={project ? `project-edit-${project.id}` : 'project-create'}
        ref={element => {
          if (review) {
            initialFocusRef.current = element?.querySelector<HTMLInputElement>('input:not([readonly])') ?? null;
          }
        }}
      >
        {children}
      </div>
    </Modal>
  );
}
