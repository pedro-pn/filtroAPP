import { BrandLoading } from '../brand/BrandLoading';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';

import {
  getProjectRevisions,
  getPlannedScope,
  getProjectDetail,
  setProjectSchedule,
  type CommercialRevision,
  type LaborCollaborator,
  type LaborCollaboratorSource,
  type ProjectSchedulePayload
} from '../../api/acompanhamentoComercial';
import { getActiveCollaborators } from '../../api/acompanhamentoPonto';
import { systemReconciliationPath } from '../../api/systemReconciliation';
import { useToast } from '../ui/ToastContext';
import { HelpTip } from '../ui/HelpTip';
import { RemoveIconButton } from '../ui/RemoveIconButton';
import { Alert, Button, Card, Field, Input, Select, Skeleton } from '../ui/ds';
import { ProjectPlannedScopeEditor, type ScopeEditorHandle } from './ProjectPlannedScopeEditor';
import { ProjectProgressBreakdown } from './ProjectProgressBreakdown';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';
import { ProjectProposalPercentageField } from './ProjectProposalPercentageField';
import { consideredProposalValue, parseProposalPercentage } from '../../utils/proposalPercentage';
import './ProjectScheduleEditor.ds.css';

export interface ScheduleEditorHandle { save: () => void }

function toNum(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
function sumRevisionValue<T>(revisions: T[], getter: (revision: T) => string | number | null | undefined, decimals = 2) {
  let total = 0;
  let seen = false;
  for (const revision of revisions) {
    const n = toNum(getter(revision));
    if (n === null) continue;
    total += n;
    seen = true;
  }
  if (!seen) return null;
  return decimals === 0 ? Math.round(total) : Math.round((total + Number.EPSILON) * 100) / 100;
}
function toDateInput(iso?: string | null) {
  return iso ? iso.slice(0, 10) : '';
}
function formatDatePt(value: string) {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}
function addDays(dateInput: string, days: number) {
  const d = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setTime(d.getTime() + days * 86400000);
  return d.toISOString().slice(0, 10);
}
function daysBetween(fromInput: string, to: Date) {
  const from = new Date(`${fromInput}T00:00:00`);
  if (Number.isNaN(from.getTime())) return null;
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}
function isoOrNull(dateInput: string) {
  return dateInput ? new Date(`${dateInput}T00:00:00`).toISOString() : null;
}

type LaborSleepMode = 'HOME' | 'AWAY';
const LABOR_SOURCE_LABELS: Record<LaborCollaboratorSource, string> = {
  LEADER: 'Líder',
  RDO: 'RDO',
  MANUAL: 'Manual'
};

function normalizeSleepModeMap(value?: Record<string, LaborSleepMode> | null): Record<string, LaborSleepMode> {
  const result: Record<string, LaborSleepMode> = {};
  if (!value) return result;
  for (const [collaboratorId, mode] of Object.entries(value)) {
    if (mode === 'HOME') result[collaboratorId] = mode;
  }
  return result;
}

function sleepModeMapKey(value: Record<string, LaborSleepMode>) {
  return Object.entries(normalizeSleepModeMap(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([collaboratorId, mode]) => `${collaboratorId}:${mode}`)
    .join('|');
}

function normalizeCollaboratorIds(value?: string[] | null) {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of value ?? []) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function collaboratorIdListKey(value: string[]) {
  return normalizeCollaboratorIds(value).sort((a, b) => a.localeCompare(b)).join('|');
}

// Cronograma do projeto, gerido no módulo Acompanhamento (datas de aprovação e início real),
// junto do resumo do previsto. A escolha da revisão fica no card do projeto (aba Projetos).
export const ProjectScheduleEditor = forwardRef<ScheduleEditorHandle, {
  projectId: string;
  canManage?: boolean;
  canManageProposal?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}>(function ProjectScheduleEditor({ projectId, canManage = true, canManageProposal = canManage, onDirtyChange }, ref) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const showToast = useToast();
  const queryKey = ['commercial-revisions', projectId];

  const { data, isLoading } = useQuery({ queryKey, queryFn: () => getProjectRevisions(projectId) });
  const { data: plannedScope } = useQuery({ queryKey: ['planned-scope', projectId], queryFn: () => getPlannedScope(projectId), ...acompanhamentoRefreshQueryOptions });
  const { data: projectDetail } = useQuery({ queryKey: ['project-detail', projectId, ''], queryFn: () => getProjectDetail(projectId) });
  const activeCollaboratorsQuery = useQuery({
    queryKey: ['ponto-collaborators-active'],
    queryFn: getActiveCollaborators,
    enabled: canManage
  });
  const [approvalEdit, setApprovalEdit] = useState<string | null>(null);
  const [startEdit, setStartEdit] = useState<string | null>(null);
  const [mobEdit, setMobEdit] = useState<string | null>(null);
  const [demobEdit, setDemobEdit] = useState<string | null>(null);
  const [manualEdit, setManualEdit] = useState<string | null>(null);
  const [proposalPercentageEdit, setProposalPercentageEdit] = useState<string | null>(null);
  const [offshoreEdit, setOffshoreEdit] = useState<boolean | null>(null);
  const [sleepModeEdit, setSleepModeEdit] = useState<Record<string, LaborSleepMode> | null>(null);
  const [manualLaborIdsEdit, setManualLaborIdsEdit] = useState<string[] | null>(null);
  const [manualLaborAddId, setManualLaborAddId] = useState('');
  const [scopeDirty, setScopeDirty] = useState(false);
  const [scopeSaving, setScopeSaving] = useState(false);
  const scopeRef = useRef<ScopeEditorHandle>(null);

  const scheduleMutation = useMutation({
    mutationFn: (payload: ProjectSchedulePayload) => setProjectSchedule(projectId, payload),
    onSuccess: () => {
      showToast('Cronograma atualizado.');
      setApprovalEdit(null);
      setStartEdit(null);
      setMobEdit(null);
      setDemobEdit(null);
      setManualEdit(null);
      setProposalPercentageEdit(null);
      setOffshoreEdit(null);
      setSleepModeEdit(null);
      setManualLaborIdsEdit(null);
      setManualLaborAddId('');
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['project-cards'] });
      queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] });
      queryClient.invalidateQueries({ queryKey: ['mission-group-detail'] });
      queryClient.invalidateQueries({ queryKey: ['planned-scope', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-progress', projectId] });
      queryClient.invalidateQueries({ queryKey: ['ponto-colaboradores'] });
      queryClient.invalidateQueries({ queryKey: ['efetivo-planning-missions'] });
      queryClient.invalidateQueries({ queryKey: ['efetivo-planning-missions-pending'] });
    },
    onError: () => showToast('Não foi possível atualizar o cronograma.')
  });

  // Valores/dirty calculados no topo (antes dos early returns) p/ o modal saber quando há mudança.
  const approvalValue = approvalEdit ?? toDateInput(data?.approvedAt);
  const startValue = startEdit ?? toDateInput(data?.startDate);
  const mobValue = mobEdit ?? toDateInput(data?.mobilizationDate);
  const demobValue = demobEdit ?? toDateInput(data?.demobilizationDate);
  const baseManual = data?.manualProgressPct == null ? '' : String(data.manualProgressPct);
  const manualValue = manualEdit ?? baseManual;
  const baseProposalPercentage = String(data?.proposalPercentage ?? 100);
  const proposalPercentageValue = proposalPercentageEdit ?? baseProposalPercentage;
  const proposalPercentage = parseProposalPercentage(proposalPercentageValue);
  const baseOffshore = data?.offshore ?? false;
  const offshoreValue = offshoreEdit ?? baseOffshore;
  const baseSleepModeMap = normalizeSleepModeMap(data?.laborSleepModeByCollaborator);
  const sleepModeValue = sleepModeEdit ?? baseSleepModeMap;
  const baseManualLaborIds = normalizeCollaboratorIds(data?.laborCollaboratorIds);
  const manualLaborIdsValue = manualLaborIdsEdit ?? baseManualLaborIds;
  const scheduleDirty = approvalValue !== toDateInput(data?.approvedAt)
    || startValue !== toDateInput(data?.startDate)
    || mobValue !== toDateInput(data?.mobilizationDate)
    || demobValue !== toDateInput(data?.demobilizationDate)
    || manualValue !== baseManual
    || proposalPercentageValue !== baseProposalPercentage
    || offshoreValue !== baseOffshore
    || sleepModeMapKey(sleepModeValue) !== sleepModeMapKey(baseSleepModeMap)
    || collaboratorIdListKey(manualLaborIdsValue) !== collaboratorIdListKey(baseManualLaborIds);
  const dirty = scheduleDirty || scopeDirty;
  const reconciliationBlocked = dirty || scopeSaving || scheduleMutation.isPending;

  function setCollaboratorSleepMode(collaboratorId: string, mode: LaborSleepMode) {
    const next = { ...sleepModeValue };
    if (mode === 'HOME') next[collaboratorId] = 'HOME';
    else delete next[collaboratorId];
    setSleepModeEdit(next);
  }

  function addManualLaborCollaborator() {
    if (!manualLaborAddId) return;
    setManualLaborIdsEdit(prev => normalizeCollaboratorIds([...(prev ?? baseManualLaborIds), manualLaborAddId]));
    setManualLaborAddId('');
  }

  function removeManualLaborCollaborator(collaboratorId: string) {
    setManualLaborIdsEdit(prev => normalizeCollaboratorIds((prev ?? baseManualLaborIds).filter(id => id !== collaboratorId)));
    const next = { ...sleepModeValue };
    delete next[collaboratorId];
    setSleepModeEdit(next);
  }

  // Salvar único: grava o cronograma (se mudou) e o escopo (se mudou), via ref do editor de escopo.
  const runSave = useRef<() => void>(() => {});
  runSave.current = () => {
    if (proposalPercentage == null) {
      showToast('Informe um percentual da proposta de 0% a 100%, com no máximo duas casas decimais.');
      return;
    }
    if (scheduleDirty) {
      const manualNum = manualValue.trim() === '' ? null : Number(manualValue.replace(',', '.'));
      const payload: ProjectSchedulePayload = {};
      if (approvalValue !== toDateInput(data?.approvedAt)) payload.approvedAt = isoOrNull(approvalValue);
      if (startValue !== toDateInput(data?.startDate)) payload.startDate = isoOrNull(startValue);
      if (mobValue !== toDateInput(data?.mobilizationDate)) payload.mobilizationDate = isoOrNull(mobValue);
      if (demobValue !== toDateInput(data?.demobilizationDate)) payload.demobilizationDate = isoOrNull(demobValue);
      if (manualValue !== baseManual) payload.manualProgressPct = manualNum != null && Number.isFinite(manualNum) ? Math.min(100, Math.max(0, manualNum)) : null;
      if (canManageProposal && proposalPercentageValue !== baseProposalPercentage) payload.proposalPercentage = proposalPercentage;
      if (offshoreValue !== baseOffshore) payload.offshore = offshoreValue;
      if (sleepModeMapKey(sleepModeValue) !== sleepModeMapKey(baseSleepModeMap)) payload.laborSleepModeByCollaborator = normalizeSleepModeMap(sleepModeValue);
      if (collaboratorIdListKey(manualLaborIdsValue) !== collaboratorIdListKey(baseManualLaborIds)) payload.laborCollaboratorIds = manualLaborIdsValue;
      scheduleMutation.mutate(payload);
    }
    if (scopeDirty) scopeRef.current?.save();
  };
  useImperativeHandle(ref, () => ({ save: () => runSave.current() }), []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  if (isLoading) return <Skeleton variant="text" lines={5} label="Carregando cronograma" />;

  const percentageField = <ProjectProposalPercentageField projectId={projectId}
    value={proposalPercentageValue} canManage={canManageProposal && !scheduleMutation.isPending}
    onChange={setProposalPercentageEdit} rows={[
      { label: 'Custo', value: projectDetail?.consumo.previstoIntegral ?? null, unit: 'BRL' },
      { label: 'Receita', value: toNum(projectDetail?.faturamento.previstoIntegral), unit: 'BRL' },
      { label: 'Dias corridos', value: projectDetail?.fullPlannedDays ?? null, unit: 'dias' },
      { label: 'Dias trabalhados', value: projectDetail?.fullWorkedDays ?? null, unit: 'dias' },
      { label: 'Horas normais', value: plannedScope ? sumRevisionValue(plannedScope.normalHours, row => row.hours) : null, unit: 'h' },
      { label: 'Horas extras', value: plannedScope ? sumRevisionValue(plannedScope.overtime, row => row.hours) : null, unit: 'h' }
    ]} />;

  const current = data?.currentCodBd ?? null;
  const revisions = data?.revisions ?? [];
  const currentRevision: CommercialRevision | undefined = revisions.find(r => r.codBd === current) ?? undefined;

  if (current == null || !currentRevision) {
    return <div className="acp-schedule-ds">
      {percentageField}
      <Alert tone="info">Aguardando seleção da proposta aprovada pela gestão. A previsão manual permanece disponível.</Alert>
      <ProjectPlannedScopeEditor ref={scopeRef} projectId={projectId} canManage={canManage}
        onDirtyChange={setScopeDirty} onSavingChange={setScopeSaving} />
    </div>;
  }

  const leadDays = consideredProposalValue(data?.mobilizationLeadDays ?? null, proposalPercentage ?? 100);
  const deadline = approvalValue && leadDays != null ? addDays(approvalValue, leadDays) : '';
  const late = Boolean(startValue && deadline && startValue > deadline);
  const additionalRevisions = (data?.additionalProposals ?? [])
    .map(group => group.revisions.find(revision => revision.codBd === group.currentCodBd))
    .filter((revision): revision is CommercialRevision => Boolean(revision));
  const commercialRevisions = [currentRevision, ...additionalRevisions];
  const plannedDays = consideredProposalValue(sumRevisionValue(commercialRevisions, revision => revision.plannedDays, 0), proposalPercentage ?? 100);
  const plannedWorkedDays = consideredProposalValue(sumRevisionValue(commercialRevisions, revision => revision.workedDays, 0), proposalPercentage ?? 100);
  const consumed = startValue && plannedDays ? daysBetween(startValue, new Date()) : null;
  const consumedPct = consumed != null && plannedDays ? Math.round((consumed / plannedDays) * 100) : null;
  const activeCollaborators = activeCollaboratorsQuery.data ?? [];
  const activeById = new Map(activeCollaborators.map(collaborator => [collaborator.id, collaborator]));
  const laborRowsById = new Map<string, LaborCollaborator>();
  const laborRows: LaborCollaborator[] = [];
  const pushLaborRow = (collaborator: LaborCollaborator, fallbackSources: LaborCollaboratorSource[] = ['MANUAL']) => {
    const existing = laborRowsById.get(collaborator.id);
    const sources = collaborator.sources?.length ? collaborator.sources : fallbackSources;
    if (existing) {
      for (const source of sources) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
      }
      return;
    }
    const row = { ...collaborator, role: collaborator.role ?? null, sources: [...sources] };
    laborRowsById.set(row.id, row);
    laborRows.push(row);
  };
  for (const collaborator of data?.laborCollaborators ?? []) pushLaborRow(collaborator);
  for (const collaboratorId of manualLaborIdsValue) {
    const active = activeById.get(collaboratorId);
    if (active) pushLaborRow({ id: active.id, name: active.name, role: active.role, sources: ['MANUAL'] });
  }
  const visibleLaborIds = new Set(laborRows.map(collaborator => collaborator.id));
  const manualLaborOptions = activeCollaborators
    .filter(collaborator => !visibleLaborIds.has(collaborator.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const manualLaborIdSet = new Set(manualLaborIdsValue);
  const collaboratorSleepSection = canManage ? (
    <>
      <h3 className="acp-schedule-ds__section-title">Colaboradores e hospedagem</h3>
      {!offshoreValue ? (
        <p className="acp-schedule-ds__muted">
          Dorme em casa: recebe produtividade, sem adicional de transferência. Dorme fora: recebe adicional de transferência, sem produtividade.
        </p>
      ) : null}
      <div className="acp-sleep-add">
        <Field id={`acp-labor-add-${projectId}`} label="Adicionar colaborador manualmente" optionalText="">
          <Select
            value={manualLaborAddId}
            disabled={activeCollaboratorsQuery.isLoading || manualLaborOptions.length === 0}
            onChange={e => setManualLaborAddId(e.target.value)}
          >
            <option value="">
              {activeCollaboratorsQuery.isLoading
                ? 'Carregando colaboradores...'
                : manualLaborOptions.length === 0 ? 'Nenhum colaborador disponível' : 'Selecione'}
            </option>
            {manualLaborOptions.map(collaborator => (
              <option key={collaborator.id} value={collaborator.id}>
                {collaborator.name}{collaborator.role ? ` — ${collaborator.role}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="secondary" size="sm" onClick={addManualLaborCollaborator} disabled={!manualLaborAddId}>
          Adicionar
        </Button>
      </div>
      {activeCollaboratorsQuery.isLoading && laborRows.length === 0 ? (
        <p className="acp-schedule-ds__muted"><BrandLoading label="Carregando colaboradores" inline size="sm" /></p>
      ) : laborRows.length === 0 ? (
        <p className="acp-schedule-ds__muted">Nenhum colaborador encontrado nos RDOs deste projeto.</p>
      ) : (
        <div className="acp-sleep-list">
          {laborRows.map(collaborator => {
            const mode = sleepModeValue[collaborator.id] ?? 'AWAY';
            const canRemoveManual = manualLaborIdSet.has(collaborator.id);
            return (
              <div className="acp-sleep-row" key={collaborator.id}>
                <span className="acp-sleep-name">
                  <strong>{collaborator.name}</strong>
                  {collaborator.role ? <small>{collaborator.role}</small> : null}
                  <small className="acp-sleep-source">
                    {collaborator.sources.map(source => LABOR_SOURCE_LABELS[source]).join(' · ')}
                  </small>
                </span>
                <div className="acp-sleep-controls">
                  <Select size="sm"
                    id={`acp-sleep-${projectId}-${collaborator.id}`}
                    value={mode}
                    onChange={e => setCollaboratorSleepMode(collaborator.id, e.target.value as LaborSleepMode)}
                    aria-label={`Hospedagem de ${collaborator.name}`}
                  >
                    <option value="AWAY">Dorme fora</option>
                    <option value="HOME">Dorme em casa</option>
                  </Select>
                  {canRemoveManual ? (
                    <RemoveIconButton className="acp-sleep-remove"
                      onClick={() => removeManualLaborCollaborator(collaborator.id)}
                      label={`Remover inclusão manual de ${collaborator.name}`}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  ) : null;

  const reconciliationContent = <>
    <span className="acp-reconciliation-icon" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7" />
      </svg>
    </span>
    <span className="acp-reconciliation-copy">
      <strong>Conciliar sistemas</strong>
      <span>{reconciliationBlocked
        ? 'Salve as alterações do cronograma e do escopo antes de abrir a conciliação.'
        : 'Vincule as medições dos relatórios aos sistemas previstos.'}</span>
    </span>
    <svg className="acp-reconciliation-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  </>;

  return (
    <div className="acp-schedule-ds">
      {plannedScope?.hoursPlan?.pending ? <Alert tone="warning">
        Há uma pendência nas horas previstas. <a href="#planned-hours-review">Conferir horas manuais e comerciais</a>
      </Alert> : null}
      {percentageField}
      <Card variant="flat" padding="md" title="Prazo e equipe previstos" className="acp-schedule-ds__summary">
        <div className="acp-schedule-ds__facts">
          <div><span>Dias corridos</span><strong>{plannedDays ?? '—'}</strong></div>
          <div><span>Dias trabalhados</span><strong>{plannedWorkedDays ?? '—'}</strong></div>
        </div>
        <p className="acp-schedule-ds__muted">{currentRevision.numOperators ?? '—'} operadores / {currentRevision.numSupervisors ?? '—'} encarregados · {currentRevision.numPerDay ?? '—'} dia / {currentRevision.numPerNight ?? '—'} noite</p>
      </Card>

      <section aria-label="Datas e avanço do projeto" className="acp-schedule-ds__section">
      <h3 className="acp-schedule-ds__section-title">Datas e avanço</h3>
      <div className="acp-schedule-ds__fields">
        <Field id={`acp-aprov-${projectId}`} label={<>Aprovação da proposta <HelpTip icon help="Data em que a proposta foi aprovada pelo cliente. Base para o prazo de mobilização." /></>} optionalText="">
          <Input type="date" value={approvalValue} onChange={e => setApprovalEdit(e.target.value)} />
        </Field>
        <Field id={`acp-mob-${projectId}`} label={<>Mobilização <HelpTip icon help="Data em que a equipe/equipamento foram mobilizados para a obra. Exibida no rodapé do dashboard do projeto." /></>} optionalText="">
          <Input type="date" value={mobValue} onChange={e => setMobEdit(e.target.value)} />
        </Field>
        <Field id={`acp-desmob-${projectId}`} label={<>Desmobilização <HelpTip icon help="Data em que a equipe deixou a obra. Preencha só depois do fato. Com mobilização e desmobilização preenchidas, os dias de ponto da equipe que não têm etiqueta do Ponto Mais nem RDO passam a ser alocados automaticamente nesta missão. Enquanto ficar vazia, esses dias continuam indo para as pendências." /></>} optionalText="">
          <Input
            type="date"
            value={demobValue}
            min={mobValue || undefined}
            onChange={e => setDemobEdit(e.target.value)}
          />
        </Field>
        <Field id={`acp-inicio-${projectId}`} label={<>Início real <HelpTip icon help="Data em que a execução começou de fato. Ponto de partida dos dias corridos e da previsão de término." /></>} optionalText="">
          <Input type="date" value={startValue} onChange={e => setStartEdit(e.target.value)} />
        </Field>
        <Field id={`acp-manual-progress-${projectId}`} label={<>Avanço manual <HelpTip icon help="Avanço informado à mão, em %. É usado só como fallback quando o projeto NÃO tem escopo previsto cadastrado (aí o avanço não pode vir dos RDOs). Se houver escopo, este valor é ignorado." /></>} optionalText="">
            <Input id={`acp-manual-progress-${projectId}`} suffix="%"
              type="number" min="0" max="100" step="1" inputMode="numeric" placeholder="—"
              value={manualValue}
              onChange={e => setManualEdit(e.target.value)}
            />
        </Field>
        <Field id={`acp-offshore-${projectId}`} label={<>Projeto offshore <HelpTip icon help="Projetos offshore usam a modalidade OFFSHORE do motor de mão de obra para os colaboradores alocados, com periculosidade integral e confinamento." /></>} optionalText="">
          <label className="acp-checkbox-inline">
            <input
              id={`acp-offshore-${projectId}-control`}
              type="checkbox"
              checked={offshoreValue}
              onChange={e => setOffshoreEdit(e.target.checked)}
            />
            <span>{offshoreValue ? 'Sim' : 'Não'}</span>
          </label>
        </Field>
      </div>
      <p className="acp-schedule-ds__deadline"><strong>Mobilização / prazo: </strong>
          {leadDays != null ? `${leadDays} dia(s) p/ iniciar${deadline ? ` · até ${formatDatePt(deadline)}` : ''}` : 'Sem prazo de mobilização'}
          {late ? <strong className="acp-schedule-ds__late"> · mobilização atrasada</strong> : null}
          {consumedPct != null ? ` · prazo consumido ${consumedPct}%` : ''}
      </p>
      </section>

      {reconciliationBlocked ? (
        <button type="button" className="acp-reconciliation-shortcut" disabled>{reconciliationContent}</button>
      ) : (
        <Link className="acp-reconciliation-shortcut" to={systemReconciliationPath(projectId)} state={{ scheduleReturnSearch: location.search }}>{reconciliationContent}</Link>
      )}
      <section aria-label="Avanço físico" className="acp-schedule-ds__section">
        <h3 className="acp-schedule-ds__section-title">Avanço físico (RDO × previsto)</h3>
        <ProjectProgressBreakdown projectId={projectId} canManage={canManage} appearance="design-system" collapsibleDetails />
      </section>

      <ProjectPlannedScopeEditor
        ref={scopeRef}
        projectId={projectId}
        canManage={canManage}
        resolutionDisabled={scheduleDirty || scheduleMutation.isPending}
        onDirtyChange={setScopeDirty}
        onSavingChange={setScopeSaving}
        beforeOvertime={collaboratorSleepSection}
      />

    </div>
  );
});
