import type { ReactNode, RefObject } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/ds';
import type { Project } from '../../types/domain';
import { projectRegistrationPending, projectTitle } from './projectPendingReview';

export function ProjectEditDialog({ project, saving, onClose, initialFocusRef, children }: {
  project: Project;
  saving: boolean;
  onClose: () => void;
  initialFocusRef: RefObject<HTMLInputElement | null>;
  children: ReactNode;
}) {
  const review = projectRegistrationPending(project);
  return (
    <Modal
      open
      onClose={onClose}
      closeOnEscape={!saving}
      appearance="design-system"
      size="md"
      backdropClassName="rdo-manager-projects-page rdo-project-edit-dialog-backdrop"
      panelClassName="rdo-project-edit-dialog rdo-ds-actions"
      fullscreenOnMobile={false}
      initialFocusRef={initialFocusRef}
      preventInitialFocusScroll
      title={<h2>{review ? 'Revisar cadastro' : 'Editar projeto'}</h2>}
      footer={!review ? (
        <>
          <Button variant="secondary" size="md" type="button" disabled={saving} onClick={onClose}>
            Cancelar edição
          </Button>
          <Button variant="primary" size="md" type="submit" form="project-edit-form" loading={saving} loadingLabel="Salvando projeto…">
            Salvar projeto
          </Button>
        </>
      ) : undefined}
    >
      <p className="rdo-project-edit-dialog__context">{projectTitle(project)}</p>
      <div
        id={`project-edit-${project.id}`}
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
