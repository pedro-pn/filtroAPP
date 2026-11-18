import { Archive, Check, CheckCheck, Pencil, RotateCcw, Unlink, X } from 'lucide-react';
import type { MissionGroupLaborAllocationMode, ProjectCardItem } from '../../api/acompanhamentoComercial';
import { AppIcon } from '../icons/AppIcon';
import { Badge, Button, Card, Field, IconButton, Input, Select, StatusPill } from '../ui/ds';
import { formatDate, isGroupCard, pct } from './projectCardFormatting';
import { ProjectOverviewMetrics } from './ProjectOverviewMetrics';
export function ProjectOverviewCard({
  card,
  selected = false,
  canSelect = false,
  canManageGroups = false,
  renaming = false,
  renameValue = '',
  renameError = null,
  renameSaving = false,
  onOpen,
  onToggleSelect,
  onStartRename,
  onRenameValueChange,
  onSubmitRename,
  onCancelRename,
  onDissolve,
  laborPolicySaving = false,
  onLaborPolicyChange,
  canManage = false,
  trackingSaving = false,
  onArchive,
  onReview,
  recentlyFinalized = false
}: {
  card: ProjectCardItem;
  selected?: boolean;
  canSelect?: boolean;
  canManageGroups?: boolean;
  renaming?: boolean;
  renameValue?: string;
  renameError?: string | null;
  renameSaving?: boolean;
  onOpen: () => void;
  onToggleSelect?: () => void;
  onStartRename?: () => void;
  onRenameValueChange?: (value: string) => void;
  onSubmitRename?: () => void;
  onCancelRename?: () => void;
  onDissolve?: () => void;
  laborPolicySaving?: boolean;
  onLaborPolicyChange?: (mode: MissionGroupLaborAllocationMode, primaryProjectId: string | null) => void;
  canManage?: boolean;
  trackingSaving?: boolean;
  onArchive?: () => void;
  onReview?: () => void;
  recentlyFinalized?: boolean;
}) {
  const grouped = isGroupCard(card);
  const handleOpen = () => {
    if (canSelect && !grouped) { onToggleSelect?.(); return; }
    onOpen();
  };
  const title = grouped ? card.name || card.code : `${card.code} — ${card.name || 'Sem nome'}`;
  const statusLabel = { TRABALHADO: 'Último dia trabalhado', PARADO: 'Parado (standby)', SEM_RDO: 'Sem RDO' }[card.lastDay.status];
  return (
    <Card padding="sm" selected={selected} className="acp-project" data-acp-project={grouped ? `group-${card.groupId}` : card.projectId}
      surfaceAction={renaming ? undefined : {
        label: canSelect && !grouped ? `Alternar seleção da missão ${card.code}` : `Abrir projeto ${card.code}`,
        onClick: handleOpen,
        pressed: canSelect && !grouped ? selected : undefined
      }}
      header={
        <div className="acp-project__heading">
          {canSelect && !grouped ? <label className="fv-listing-checkbox">
            <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Selecionar missão ${card.code}`} />
          </label> : null}
          <div className="acp-project__identity">
            {renaming ? <form className="acp-project__rename" onSubmit={event => { event.preventDefault(); onSubmitRename?.(); }}>
              <Field id={`rename-${grouped ? card.groupId : card.projectId}`} label="Nome do card" optionalText="" errorText={renameError}>
                <Input size="sm" maxLength={120} value={renameValue} disabled={renameSaving} autoFocus required
                  onFocus={event => event.currentTarget.select()} onChange={event => onRenameValueChange?.(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onCancelRename?.(); } }} />
              </Field>
              <div className="acp-project__inline-actions">
                <IconButton type="submit" icon={Check} label="Salvar nome" size="sm" disabled={renameSaving} />
                <IconButton icon={X} label="Cancelar edição" size="sm" disabled={renameSaving} onClick={onCancelRename} />
              </div>
            </form> : <h2>{title}</h2>}
            {card.clientName ? <p className="acp-project__secondary">{card.clientName}</p> : null}
          </div>
        </div>
      }
      footer={canManage || canManageGroups ? <div className="acp-project__actions" data-acp-tracking-action={canManage || undefined}>
        <div className="acp-project__inline-actions">
          {grouped && canManageGroups && !renaming ? <IconButton icon={Pencil} size="sm" label={`Editar nome do card: ${card.code}`}
            title="Editar nome do card" data-acp-group-rename-start onClick={onStartRename} /> : null}
          {grouped && canManageGroups ? <IconButton icon={Unlink} size="sm" label={`Desmesclar missões: ${card.code}`}
            title="Desmesclar missões" onClick={onDissolve} disabled={laborPolicySaving || renameSaving || trackingSaving} /> : null}
          {canManage && card.archived ? <IconButton icon={card.reviewed ? CheckCheck : Check} size="sm"
            label={`${card.reviewed ? 'Desmarcar conferência' : 'Marcar como conferido'}: ${card.code}`}
            title={card.reviewed ? 'Desmarcar conferência' : 'Marcar como conferido'}
            data-acp-review-action disabled={trackingSaving} onClick={onReview} /> : null}
          {canManage && (!card.archived || card.archivedInAcompanhamento) ? <Button
            variant="secondary" size="sm" disabled={trackingSaving}
            iconLeft={<AppIcon icon={card.archived ? RotateCcw : Archive} size="sm" />}
            aria-label={`${card.archived ? 'Restaurar' : 'Arquivar'} no acompanhamento: ${card.code}`}
            title={card.archived ? 'Restaurar no acompanhamento' : 'Arquivar no acompanhamento'} onClick={onArchive}>
            {card.archived ? 'Restaurar' : 'Arquivar'}
          </Button> : null}
        </div>
      </div> : undefined}
    >
      <div className="acp-project__body">
        <div className="acp-project__statuses">
          {grouped ? <Badge tone="info">Grupo · {card.members.length} missões</Badge> : null}
          <StatusPill status={card.lastDay.status} label={statusLabel} />
          {card.lastDay.date ? <span className="acp-project__secondary">{formatDate(card.lastDay.date)}</span> : null}
          {card.reviewed ? <StatusPill status="conferido" label="Conferido" title={card.reviewedAt ? `Conferido em ${formatDate(card.reviewedAt)}` : 'Conferido'} /> : null}
        </div>
        {recentlyFinalized || card.alerts.length ? <div className="acp-project__statuses" aria-label="Avisos do projeto">
          {recentlyFinalized ? <Badge tone="info" dot multiline data-acp-finalized-notice>Missão finalizada recentemente</Badge> : null}
          {card.alerts.map((alert, index) => <Badge key={index} dot multiline tone={alert.level === 'danger' ? 'danger' : 'warning'}>{alert.label}</Badge>)}
        </div> : null}
        {grouped ? <ul className="acp-project__members" aria-label="Missões unificadas">
          {card.members.map(member => <li key={member.projectId}>
            <span><strong>{member.code}</strong> — {member.name || member.clientName || 'Missão'}</span>
            {member.progressPct != null ? <strong>{pct(member.progressPct)}</strong> : null}
          </li>)}
        </ul> : null}
        <ProjectOverviewMetrics card={card} />
        <dl className="acp-project__pair acp-project__section">
          <div><dt>Início</dt><dd>{formatDate(card.startDate)}</dd></div>
          <div><dt>Previsão de término</dt><dd>{formatDate(card.expectedEndDate)}</dd></div>
        </dl>
        {grouped && canManageGroups ? <div className="acp-project__section" data-acp-labor-policy>
          <Field id={`group-labor-mode-${card.groupId}`} label="Apropriação da mão de obra" optionalText=""
            helperText={card.laborAllocationMode === 'SHARED_EXECUTION'
              ? 'Cada RDO confirmado recebe a jornada integral do Ponto Mais; a folha mensal continua única.'
              : card.laborAllocationMode === 'CONSOLIDATE_PRIMARY'
                ? 'Os RDOs deste grupo são apropriados uma única vez na missão principal.'
                : 'O agrupamento não altera a regra de apropriação da jornada.'}>
            <Select size="sm" value={card.laborAllocationMode || 'VISUAL_ONLY'} disabled={laborPolicySaving}
              onChange={event => {
                const mode = event.target.value as MissionGroupLaborAllocationMode;
                onLaborPolicyChange?.(mode, mode === 'CONSOLIDATE_PRIMARY' ? card.primaryLaborProjectId || card.members[0]?.projectId || null : null);
              }}>
              <option value="VISUAL_ONLY">Somente mesclar o card</option>
              <option value="SHARED_EXECUTION">Repetir jornada em cada missão</option>
              <option value="CONSOLIDATE_PRIMARY">Consolidar em uma missão principal</option>
            </Select>
          </Field>
          {card.laborAllocationMode === 'CONSOLIDATE_PRIMARY' ? <Field id={`group-labor-primary-${card.groupId}`} label="Missão principal" optionalText="">
            <Select size="sm" value={card.primaryLaborProjectId || card.members[0]?.projectId || ''} disabled={laborPolicySaving}
              onChange={event => onLaborPolicyChange?.('CONSOLIDATE_PRIMARY', event.target.value || null)}>
              {card.members.map(member => <option key={member.projectId} value={member.projectId}>{member.code} — {member.name || member.clientName || 'Missão'}</option>)}
            </Select>
          </Field> : null}
        </div> : null}
      </div>
    </Card>
  );
}
