import type { MissionGroupMemberSummary, ProgressHistoryPoint } from '../../api/acompanhamentoComercial';
import type { WeeklyTargetOwner } from '../../api/weeklyProgressTargets';
import { MissionWeeklyProgressPanel } from './MissionWeeklyProgressPanel';
import { WeeklyTargetSpotlight, WeeklyTargetSummaryLine } from './WeeklyTargetSpotlight';
import './project-weekly-targets.css';

/** Cada projeto usa suas próprias metas e medições, inclusive dentro de uma mesclagem. */
export function ProjectWeeklyTargets({ owner, members = [], progressHistory, view, canManage = false, onOpenHistory = () => {} }: {
  owner: WeeklyTargetOwner;
  members?: MissionGroupMemberSummary[];
  progressHistory?: ProgressHistoryPoint[];
  view: 'summary' | 'spotlight' | 'history';
  canManage?: boolean;
  onOpenHistory?: () => void;
}) {
  const contexts: { owner: WeeklyTargetOwner; label?: string; progressHistory?: ProgressHistoryPoint[] }[] = [
    { owner, progressHistory, label: owner.groupId ? 'Agrupamento' : undefined }
  ];
  if (owner.groupId) {
    for (const member of members.filter(member => member.visible !== false)) {
      contexts.push({
        owner: { area: 'acompanhamento', projectId: member.projectId },
        // Sem histórico agregado: a consulta carrega o avanço do próprio projeto.
        label: `Projeto ${member.code}${member.name ? ` · ${member.name}` : ''}`
      });
    }
  }
  const content = (context: typeof contexts[number]) => {
    if (view === 'summary') return <>
      {context.label ? <strong className="project-weekly-targets__label">{context.label}</strong> : null}
      <WeeklyTargetSummaryLine owner={context.owner} progressHistory={context.progressHistory} />
    </>;
    if (view === 'history') return <MissionWeeklyProgressPanel owner={context.owner} progressHistory={context.progressHistory}
      canManage={canManage} contextLabel={context.label} />;
    return <WeeklyTargetSpotlight owner={context.owner} progressHistory={context.progressHistory}
      canManage={canManage} contextLabel={context.label} onOpenHistory={onOpenHistory} />;
  };
  if (!owner.groupId) return content(contexts[0]);
  // O resumo fica dentro do botão do indicador e precisa usar apenas elementos de frase.
  if (view === 'summary') return <span className="project-weekly-targets project-weekly-targets--summary">
    {contexts.map(context => <span key={context.owner.projectId ?? context.owner.groupId} className="project-weekly-targets__summary">
      {content(context)}
    </span>)}
  </span>;
  return <div className="project-weekly-targets">
    {contexts.map(context => <div key={context.owner.projectId ?? context.owner.groupId}>{content(context)}</div>)}
  </div>;
}
