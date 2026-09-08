import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getProjectRevisions,
  setProjectSchedule,
  type CommercialRevision,
  type LaborCollaborator,
  type LaborCollaboratorSource,
  type ProjectSchedulePayload
} from '../../api/acompanhamentoComercial';
import { getActiveCollaborators } from '../../api/acompanhamentoPonto';
import { useToast } from '../ui/ToastContext';
import { HelpTip } from '../ui/HelpTip';
import { ProjectPlannedScopeEditor, type ScopeEditorHandle } from './ProjectPlannedScopeEditor';
import { ProjectProgressBreakdown } from './ProjectProgressBreakdown';
import { RealizedCategoryBreakdown } from './RealizedCategoryBreakdown';

export interface ScheduleEditorHandle { save: () => void }

function toNum(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
function brl(value?: string | number | null) {
  const n = toNum(value);
  return n === null ? '—' : n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
function pct(value?: string | number | null) {
  const n = toNum(value);
  return n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}
function sumRevisionValue(revisions: CommercialRevision[], getter: (revision: CommercialRevision) => string | number | null | undefined, decimals = 2) {
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
function expectedMarginFrom(revisions: CommercialRevision[]) {
  const sale = sumRevisionValue(revisions, revision => revision.salePrice);
  const profit = sumRevisionValue(revisions, revision => revision.expectedProfit);
  if (sale === null || sale <= 0 || profit === null) return revisions[0]?.expectedMargin ?? null;
  return Math.round(((profit / sale) * 100 + Number.EPSILON) * 100) / 100;
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
  d.setDate(d.getDate() + days);
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
  onDirtyChange?: (dirty: boolean) => void;
}>(function ProjectScheduleEditor({ projectId, canManage = true, onDirtyChange }, ref) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const queryKey = ['commercial-revisions', projectId];

  const { data, isLoading } = useQuery({ queryKey, queryFn: () => getProjectRevisions(projectId) });
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
  const [offshoreEdit, setOffshoreEdit] = useState<boolean | null>(null);
  const [sleepModeEdit, setSleepModeEdit] = useState<Record<string, LaborSleepMode> | null>(null);
  const [manualLaborIdsEdit, setManualLaborIdsEdit] = useState<string[] | null>(null);
  const [manualLaborAddId, setManualLaborAddId] = useState('');
  const [scopeDirty, setScopeDirty] = useState(false);
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
      setOffshoreEdit(null);
      setSleepModeEdit(null);
      setManualLaborIdsEdit(null);
      setManualLaborAddId('');
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['project-cards'] });
      queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] });
      queryClient.invalidateQueries({ queryKey: ['mission-group-detail'] });
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
    || offshoreValue !== baseOffshore
    || sleepModeMapKey(sleepModeValue) !== sleepModeMapKey(baseSleepModeMap)
    || collaboratorIdListKey(manualLaborIdsValue) !== collaboratorIdListKey(baseManualLaborIds);
  const dirty = scheduleDirty || scopeDirty;

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
    if (scheduleDirty) {
      const manualNum = manualValue.trim() === '' ? null : Number(manualValue.replace(',', '.'));
      scheduleMutation.mutate({
        approvedAt: isoOrNull(approvalValue),
        startDate: isoOrNull(startValue),
        mobilizationDate: isoOrNull(mobValue),
        demobilizationDate: isoOrNull(demobValue),
        manualProgressPct: manualNum != null && Number.isFinite(manualNum) ? Math.min(100, Math.max(0, manualNum)) : null,
        offshore: offshoreValue,
        laborSleepModeByCollaborator: normalizeSleepModeMap(sleepModeValue),
        laborCollaboratorIds: manualLaborIdsValue
      });
    }
    if (scopeDirty) scopeRef.current?.save();
  };
  useImperativeHandle(ref, () => ({ save: () => runSave.current() }), []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  if (isLoading) return <div className="placeholder-copy">Carregando…</div>;

  const current = data?.currentCodBd ?? null;
  const revisions = data?.revisions ?? [];
  const currentRevision: CommercialRevision | undefined = revisions.find(r => r.codBd === current) ?? undefined;

  if (current == null || !currentRevision) {
    return <div className="placeholder-copy">Aguardando seleção da proposta aprovada pela gestão.</div>;
  }

  const leadDays = data?.mobilizationLeadDays ?? null;
  const deadline = approvalValue && leadDays != null ? addDays(approvalValue, leadDays) : '';
  const late = Boolean(startValue && deadline && startValue > deadline);
  const additionalRevisions = (data?.additionalProposals ?? [])
    .map(group => group.revisions.find(revision => revision.codBd === group.currentCodBd))
    .filter((revision): revision is CommercialRevision => Boolean(revision));
  const commercialRevisions = [currentRevision, ...additionalRevisions];
  const additionalSalePrice = sumRevisionValue(additionalRevisions, revision => revision.salePrice);
  const additionalPlannedCost = sumRevisionValue(additionalRevisions, revision => revision.plannedCost);
  const plannedSalePrice = sumRevisionValue(commercialRevisions, revision => revision.salePrice);
  const plannedCost = sumRevisionValue(commercialRevisions, revision => revision.plannedCost);
  const expectedMargin = expectedMarginFrom(commercialRevisions);
  const plannedDays = sumRevisionValue(commercialRevisions, revision => revision.plannedDays, 0);
  const plannedWorkedDays = sumRevisionValue(commercialRevisions, revision => revision.workedDays, 0);
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
      <div className="acp-scope-divider" />
      <div className="sec" style={{ marginTop: 4 }}>Colaboradores e hospedagem</div>
      <div className="acp-sleep-add">
        <div className="field-group">
          <label htmlFor={`acp-labor-add-${projectId}`}>Adicionar colaborador manualmente</label>
          <select
            id={`acp-labor-add-${projectId}`}
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
          </select>
        </div>
        <button type="button" className="mini-btn" onClick={addManualLaborCollaborator} disabled={!manualLaborAddId}>
          Adicionar
        </button>
      </div>
      {activeCollaboratorsQuery.isLoading && laborRows.length === 0 ? (
        <div className="placeholder-copy">Carregando colaboradores…</div>
      ) : laborRows.length === 0 ? (
        <div className="placeholder-copy">Nenhum colaborador encontrado nos RDOs deste projeto.</div>
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
                  <select
                    id={`acp-sleep-${projectId}-${collaborator.id}`}
                    value={mode}
                    onChange={e => setCollaboratorSleepMode(collaborator.id, e.target.value as LaborSleepMode)}
                    aria-label={`Hospedagem de ${collaborator.name}`}
                  >
                    <option value="AWAY">Dorme fora</option>
                    <option value="HOME">Dorme em casa</option>
                  </select>
                  {canRemoveManual ? (
                    <button
                      type="button"
                      className="mini-btn alt acp-sleep-remove"
                      onClick={() => removeManualLaborCollaborator(collaborator.id)}
                      aria-label={`Remover inclusão manual de ${collaborator.name}`}
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  ) : null;

  return (
    <div className="det-section">
      <div className="det-row"><span className="det-label">Previsto (comercial)</span>
        <span className="det-val acp-budget-value">
          <span>Venda {brl(plannedSalePrice)} · Custo {brl(plannedCost)} · Margem {pct(expectedMargin)}</span>
          {additionalRevisions.length > 0 ? (
            <small className="acp-budget-split">Original {brl(currentRevision.salePrice)} / {brl(currentRevision.plannedCost)} · Adicional {brl(additionalSalePrice)} / {brl(additionalPlannedCost)}</small>
          ) : null}
        </span>
      </div>
      <div className="det-row"><span className="det-label">Dias / equipe</span>
        <span className="det-val">{plannedDays ?? '—'} corridos · {plannedWorkedDays ?? '—'} trab. · {currentRevision.numOperators ?? '—'} op / {currentRevision.numSupervisors ?? '—'} enc · {currentRevision.numPerDay ?? '—'} d / {currentRevision.numPerNight ?? '—'} n</span>
      </div>

      <div className="admin-inline-grid" style={{ marginTop: 8 }}>
        <div className="field-group">
          <label htmlFor={`acp-aprov-${projectId}`}>Aprovação da proposta <HelpTip icon help="Data em que a proposta foi aprovada pelo cliente. Base para o prazo de mobilização." /></label>
          <input id={`acp-aprov-${projectId}`} type="date" value={approvalValue} onChange={e => setApprovalEdit(e.target.value)} />
        </div>
        <div className="field-group">
          <label htmlFor={`acp-mob-${projectId}`}>Mobilização <HelpTip icon help="Data em que a equipe/equipamento foram mobilizados para a obra. Exibida no rodapé do dashboard do projeto." /></label>
          <input id={`acp-mob-${projectId}`} type="date" value={mobValue} onChange={e => setMobEdit(e.target.value)} />
        </div>
        <div className="field-group">
          <label htmlFor={`acp-desmob-${projectId}`}>Desmobilização <HelpTip icon help="Data em que a equipe deixou a obra. Preencha só depois do fato. Com mobilização e desmobilização preenchidas, os dias de ponto da equipe que não têm etiqueta do Ponto Mais nem RDO passam a ser alocados automaticamente nesta missão. Enquanto ficar vazia, esses dias continuam indo para as pendências." /></label>
          <input
            id={`acp-desmob-${projectId}`}
            type="date"
            value={demobValue}
            min={mobValue || undefined}
            onChange={e => setDemobEdit(e.target.value)}
          />
        </div>
        <div className="field-group">
          <label htmlFor={`acp-inicio-${projectId}`}>Início real <HelpTip icon help="Data em que a execução começou de fato. Ponto de partida dos dias corridos e da previsão de término." /></label>
          <input id={`acp-inicio-${projectId}`} type="date" value={startValue} onChange={e => setStartEdit(e.target.value)} />
        </div>
      </div>
      <div className="admin-inline-grid" style={{ marginTop: 8 }}>
        <div className="field-group acp-svc-weight-fg">
          <label htmlFor={`acp-manual-progress-${projectId}`}>Avanço manual <HelpTip icon help="Avanço informado à mão, em %. É usado só como fallback quando o projeto NÃO tem escopo previsto cadastrado (aí o avanço não pode vir dos RDOs). Se houver escopo, este valor é ignorado." /></label>
          <div className="acp-pct-field">
            <input
              id={`acp-manual-progress-${projectId}`}
              type="number" min="0" max="100" step="1" inputMode="numeric" placeholder="—"
              value={manualValue}
              onChange={e => setManualEdit(e.target.value)}
            />
            <span className="acp-pct-suffix">%</span>
          </div>
        </div>
        <div className="field-group">
          <label htmlFor={`acp-offshore-${projectId}`}>Projeto offshore <HelpTip icon help="Projetos offshore usam a modalidade OFFSHORE do motor de mão de obra para os colaboradores alocados, com periculosidade integral e confinamento." /></label>
          <label className="acp-checkbox-inline">
            <input
              id={`acp-offshore-${projectId}`}
              type="checkbox"
              checked={offshoreValue}
              onChange={e => setOffshoreEdit(e.target.checked)}
            />
            <span>{offshoreValue ? 'Sim' : 'Não'}</span>
          </label>
        </div>
      </div>
      <div className="det-row" style={{ marginTop: 8 }}><span className="det-label">Mobilização / prazo</span>
        <span className="det-val">
          {leadDays != null ? `${leadDays} dia(s) p/ iniciar${deadline ? ` · até ${formatDatePt(deadline)}` : ''}` : 'Sem prazo de mobilização'}
          {late ? <strong style={{ color: '#b00020' }}> · ⚠ mobilização atrasada</strong> : null}
          {consumedPct != null ? ` · prazo consumido ${consumedPct}%` : ''}
        </span>
      </div>

      <div className="acp-scope-divider" />
      <div className="sec" style={{ marginTop: 4 }}>Avanço físico (RDO × previsto)</div>
      <ProjectProgressBreakdown projectId={projectId} />

      <div className="acp-scope-divider" />
      <ProjectPlannedScopeEditor
        ref={scopeRef}
        projectId={projectId}
        onDirtyChange={setScopeDirty}
        beforeOvertime={collaboratorSleepSection}
      />

      <div className="sec" style={{ marginTop: 16 }}>Realizado por categoria (Omie)</div>
      <RealizedCategoryBreakdown projectId={projectId} limit={10} />
    </div>
  );
});
