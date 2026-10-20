import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProjectDetail, type ProjectDetail } from '../../api/acompanhamentoComercial';
import { Modal } from '../ui/Modal';
import { Alert, EmptyState, Skeleton } from '../ui/ds';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';
import { PlannedScopeView, RequiredWeeklyProgressCard } from './ProjectDetailVisuals';
import { ProjectProposalScopes } from './ProjectProposalScopes';

interface ScopeProject { projectId: string; code: string; name?: string }
type ScopeSummary = Pick<ProjectDetail, 'plannedScope' | 'requiredWeeklyProgress'>;

function ScopeProjects({ projects, canManage, summary }: {
  projects: ScopeProject[];
  canManage: boolean;
  summary?: ScopeSummary;
}) {
  const [selectedId, setSelectedId] = useState(projects[0]?.projectId || '');
  const [editing, setEditing] = useState(false);
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const id = useId();
  const project = projects.find(item => item.projectId === selectedId) || projects[0];
  const detail = useQuery({
    queryKey: ['project-detail', project?.projectId],
    queryFn: () => getProjectDetail(project!.projectId),
    enabled: Boolean(project),
    ...acompanhamentoRefreshQueryOptions
  });

  function selectByKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (editing) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? projects.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % projects.length
      : event.key === 'ArrowLeft' ? (index + projects.length - 1) % projects.length : null;
    if (next == null) return;
    event.preventDefault();
    setSelectedId(projects[next].projectId);
    tabs.current.get(projects[next].projectId)?.focus();
  }

  if (!project) return <EmptyState title="Nenhum projeto neste agrupamento" />;
  return <div className="project-scope-dialog">
    {projects.length > 1 ? <>
      <p className="project-scope-dialog__hint">Cada projeto mantém seu escopo e os vínculos dos seus serviços. Selecione um projeto para conferir.</p>
      <div className="project-scope-dialog__tabs" role="tablist" aria-label="Projetos do escopo">
        {projects.map((item, index) => <button key={item.projectId} type="button" role="tab"
          ref={element => { if (element) tabs.current.set(item.projectId, element); else tabs.current.delete(item.projectId); }}
          className="project-scope-dialog__tab" id={id + '-tab-' + item.projectId}
          aria-controls={id + '-panel'} aria-selected={item.projectId === project.projectId}
          tabIndex={item.projectId === project.projectId ? 0 : -1} disabled={editing && item.projectId !== project.projectId}
          onKeyDown={event => selectByKeyboard(event, index)} onClick={() => setSelectedId(item.projectId)}>
          <strong>Projeto {item.code}</strong>{item.name ? <span>{item.name}</span> : null}
        </button>)}
      </div>
      {editing ? <p className="project-scope-dialog__hint" role="status">Salve ou cancele o vínculo em edição para trocar de projeto.</p> : null}
    </> : null}
    <div className="project-scope-dialog__panel" id={id + '-panel'}
      role={projects.length > 1 ? 'tabpanel' : undefined}
      aria-labelledby={projects.length > 1 ? id + '-tab-' + project.projectId : undefined}>
      <header className="project-scope-dialog__project"><h3>Projeto {project.code}</h3>
        {project.name ? <p>{project.name}</p> : null}</header>
      <ProjectProposalScopes key={project.projectId} projectId={project.projectId} canManage={canManage} onEditingChange={setEditing} />
      <div className="project-scope-dialog__planned">
        {detail.isLoading ? <Skeleton variant="text" lines={3} label="Carregando escopo previsto do projeto" />
          : detail.isError ? <Alert tone="danger" title="Não foi possível carregar o escopo previsto."
            action={{ label: 'Tentar novamente', onClick: () => void detail.refetch() }} />
          : <><PlannedScopeView scope={detail.data?.plannedScope} />
            <RequiredWeeklyProgressCard target={detail.data?.requiredWeeklyProgress} /></>}
      </div>
    </div>
    {summary && projects.length > 1 ? <details><summary className="acp-detail-summary">Escopo consolidado do grupo</summary>
      <div className="project-scope-dialog__planned"><PlannedScopeView scope={summary.plannedScope} />
        <RequiredWeeklyProgressCard target={summary.requiredWeeklyProgress} /></div>
    </details> : null}
  </div>;
}

export function ProjectScopeDialog({ open, onClose, projects, canManage = false, summary }: {
  open: boolean;
  onClose: () => void;
  projects: ScopeProject[];
  canManage?: boolean;
  summary?: ScopeSummary;
}) {
  return <Modal open={open} onClose={onClose} title="Escopo do projeto" appearance="design-system" size="lg">
    <div className="fv-ds"><ScopeProjects projects={projects} canManage={canManage} summary={summary} /></div>
  </Modal>;
}
