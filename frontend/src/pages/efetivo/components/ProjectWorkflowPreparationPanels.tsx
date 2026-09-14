import { useEffect, useState } from 'react';

import type {
  ProjectWorkflow,
  ProjectWorkflowClientReleases,
  ProjectWorkflowPatch
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { todayDateOnly } from '../../../utils/calendarGrid';
import { ProjectWorkflowCategory } from './ProjectWorkflowCategory';

function sectionProgress(workflow: ProjectWorkflow, key: 'D15_TEAM' | 'D15_CLIENT') {
  return workflow.preparationReadiness.sections.find(section => section.key === key)
    || { completed: 0, total: 0, percentage: 0 };
}

export function ProjectWorkflowDefinitiveTeam({ workflow, saving, onPatch, onOpenTeamProgramming }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
  onOpenTeamProgramming: () => void;
}) {
  const progress = sectionProgress(workflow, 'D15_TEAM');
  const members = workflow.teamPreparation.members;
  const complete = members.length > 0 && progress.percentage === 100;
  return (
    <ProjectWorkflowCategory
      title="Equipe definitiva"
      description="Acompanhe a preparação individual de cada colaborador selecionado."
      status={members.length ? `${progress.completed}/${progress.total}` : 'Pendente'}
      complete={complete}
      className="project-workflow-definitive-team"
      data-project-workflow-definitive-team
    >
      {!members.length ? (
        <div className="project-workflow-empty-team">
          <div><strong>Aguardando definição da equipe</strong><p>Defina os nomes que participarão do primeiro ciclo da obra.</p></div>
          <Button type="button" variant="secondary" onClick={onOpenTeamProgramming}>Definir equipe inicial</Button>
        </div>
      ) : (
        <>
          <div className="project-workflow-team-heading">
            <p>{members.length} colaborador(es) definido(s) para o primeiro ciclo.</p>
            <Button type="button" variant="secondary" onClick={onOpenTeamProgramming}>Editar equipe inicial</Button>
          </div>
          <div className="project-workflow-team-members">
            {members.map(member => (
              <article className="project-workflow-team-member" key={member.collaboratorId}>
                <header><div><strong>{member.name}</strong><span>{member.role}</span></div><span>{member.checks.filter(check => check.status === 'DONE').length}/{member.checks.length}</span></header>
                <div className="project-workflow-team-member-checks">
                  {member.checks.map(check => (
                    <label className={`project-workflow-member-check${check.status === 'DONE' ? ' is-done' : ''}`} key={check.key}>
                      <input
                        type="checkbox"
                        checked={check.status === 'DONE'}
                        disabled={saving || !check.canEdit}
                        onChange={event => onPatch({
                          action: 'team_member_check',
                          version: workflow.version,
                          collaboratorId: member.collaboratorId,
                          key: check.key,
                          status: event.target.checked ? 'DONE' : 'PENDING'
                        })}
                      />
                      <span>{check.label}</span>
                      {check.source === 'EXTERNAL' ? <small>Sincronizado</small> : null}
                    </label>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <small className="project-workflow-integration-note">Exames e treinamentos estão em confirmação manual. A origem de cada item já está preparada para a futura integração externa.</small>
        </>
      )}
    </ProjectWorkflowCategory>
  );
}

type ReleaseItem = ProjectWorkflowClientReleases['items'][number];

function ClientReleaseItem({ workflow, item, saving, onPatch }: {
  workflow: ProjectWorkflow;
  item: ReleaseItem;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const [values, setValues] = useState({
    requested: item.requested,
    requestedAt: item.requestedAt || '',
    requestedTo: item.requestedTo || '',
    completed: item.completed,
    completedAt: item.completedAt || ''
  });
  useEffect(() => setValues({
    requested: item.requested,
    requestedAt: item.requestedAt || '',
    requestedTo: item.requestedTo || '',
    completed: item.completed,
    completedAt: item.completedAt || ''
  }), [item.completed, item.completedAt, item.requested, item.requestedAt, item.requestedTo]);

  const save = (next: typeof values) => {
    setValues(next);
    onPatch({
      action: 'client_release',
      version: workflow.version,
      key: item.key,
      requested: next.requested,
      requestedAt: next.requestedAt || null,
      requestedTo: next.requestedTo.trim() || null,
      completed: next.completed,
      completedAt: next.completedAt || null
    });
  };
  const requestComplete = values.requested && Boolean(values.requestedAt && values.requestedTo.trim());
  const complete = requestComplete && values.completed && Boolean(values.completedAt);
  const disabled = saving || !item.canEdit;
  return (
    <article className={`project-workflow-client-release${complete ? ' is-complete' : ''}`}>
      <header><strong>{item.label}</strong><span>{complete ? 'Concluído' : values.requested ? 'Em andamento' : 'Pendente'}</span></header>
      <label className="project-workflow-release-toggle">
        <input
          type="checkbox"
          checked={values.requested}
          disabled={disabled}
          onChange={event => {
            const requested = event.target.checked;
            save({
              ...values,
              requested,
              requestedAt: requested ? values.requestedAt || todayDateOnly() : '',
              completed: requested ? values.completed : false,
              completedAt: requested ? values.completedAt : ''
            });
          }}
        />
        <span>Solicitado</span>
      </label>
      {values.requested ? (
        <div className="project-workflow-client-release-fields">
          <div className="field-group"><label htmlFor={`client-release-date-${item.key}`}>Data da solicitação</label><input id={`client-release-date-${item.key}`} type="date" value={values.requestedAt} disabled={disabled} onChange={event => save({ ...values, requestedAt: event.target.value })} /></div>
          <div className="field-group"><label htmlFor={`client-release-to-${item.key}`}>Solicitado para quem</label><input id={`client-release-to-${item.key}`} value={values.requestedTo} disabled={disabled} placeholder="Nome ou setor responsável" onChange={event => setValues(current => ({ ...current, requestedTo: event.target.value }))} onBlur={event => {
            const card = event.currentTarget.closest('.project-workflow-client-release');
            const nextTarget = event.relatedTarget;
            if (nextTarget instanceof Node && card?.contains(nextTarget)) return;
            if (values.requestedTo !== (item.requestedTo || '')) save(values);
          }} /></div>
          <label className="project-workflow-release-toggle">
            <input
              type="checkbox"
              checked={values.completed}
              disabled={disabled}
              onChange={event => {
                const completed = event.target.checked;
                save({ ...values, completed, completedAt: completed ? values.completedAt || todayDateOnly() : '' });
              }}
            />
            <span>Concluído</span>
          </label>
          {values.completed ? <div className="field-group"><label htmlFor={`client-release-completed-${item.key}`}>Data da conclusão</label><input id={`client-release-completed-${item.key}`} type="date" min={values.requestedAt || undefined} value={values.completedAt} disabled={disabled} onChange={event => save({ ...values, completedAt: event.target.value })} /></div> : null}
        </div>
      ) : null}
      {item.source === 'EXTERNAL' ? <small className="project-workflow-integration-note">Dados sincronizados pela integração externa.</small> : null}
    </article>
  );
}

export function ProjectWorkflowClientReleasesPanel({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const attendance = workflow.clientReleases.attendance;
  const [attendanceDate, setAttendanceDate] = useState(attendance.date || '');
  useEffect(() => setAttendanceDate(attendance.date || ''), [attendance.date]);
  const progress = sectionProgress(workflow, 'D15_CLIENT');
  const complete = progress.total > 0 && progress.percentage === 100;
  const attendanceChanged = attendanceDate !== (attendance.date || '');
  return (
    <ProjectWorkflowCategory
      title="Cliente e liberações"
      description="Confirme o atendimento e acompanhe as solicitações enviadas ao cliente."
      status={`${progress.completed}/${progress.total}`}
      complete={complete}
      className="project-workflow-client-releases"
      data-project-workflow-client-releases
    >
      <article className={`project-workflow-client-attendance${attendance.confirmed && !attendanceChanged ? ' is-complete' : ''}`}>
        <header><div><strong>Confirmação do atendimento</strong><span>A previsão comercial de início já aparece preenchida e pode ser ajustada antes da confirmação.</span></div><span>{attendance.confirmed && !attendanceChanged ? 'Confirmado' : 'Pendente'}</span></header>
        <div className="project-workflow-client-attendance-fields">
          <div className="field-group"><label htmlFor="project-workflow-attendance-date">Data do atendimento</label><input id="project-workflow-attendance-date" type="date" value={attendanceDate} disabled={saving || !attendance.canEdit} onChange={event => setAttendanceDate(event.target.value)} /></div>
          <Button type="button" variant="secondary" disabled={saving || !attendance.canEdit || !attendanceDate || (attendance.confirmed && !attendanceChanged)} onClick={() => onPatch({ action: 'client_attendance', version: workflow.version, attendanceDate })}>{attendance.confirmed ? 'Confirmar nova data' : 'Confirmar atendimento'}</Button>
        </div>
      </article>
      <div className="project-workflow-client-release-list">
        {workflow.clientReleases.items.map(item => <ClientReleaseItem workflow={workflow} item={item} saving={saving} onPatch={onPatch} key={item.key} />)}
      </div>
    </ProjectWorkflowCategory>
  );
}
