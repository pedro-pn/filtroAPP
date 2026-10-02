import { useEffect, useMemo, useState } from 'react';

import type {
  ProjectWorkflow,
  ProjectWorkflowPatch,
  ProjectWorkflowSupplyPlanItem,
  ProjectWorkflowSupplyType
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { DateInput } from '../../../components/ui/DateInput';
import { displayDateOnly, todayDateOnly } from '../../../utils/calendarGrid';
import { ProjectWorkflowBooleanChoice } from './ProjectWorkflowBooleanChoice';
import { ProjectWorkflowCategory } from './ProjectWorkflowCategory';
import { ProjectWorkflowStatusToggle } from './ProjectWorkflowStatusToggle';

type PatchHandler = (payload: ProjectWorkflowPatch) => void;
type SupplyDraftItem = Pick<ProjectWorkflowSupplyPlanItem, 'id' | 'stockItemId' | 'type' | 'name' | 'unitLabel' | 'requiredQuantity' | 'requestedAt' | 'purchasedAt' | 'reservationExceptionReason'>;
type LogisticsDraft = Omit<ProjectWorkflow['resourcePlanning']['logistics'], 'complete' | 'issues' | 'warnings'>;

const SUPPLY_GROUPS: Array<{ type: ProjectWorkflowSupplyType; label: string }> = [
  { type: 'PRODUTO_QUIMICO', label: 'Produtos químicos' },
  { type: 'FILTRO', label: 'Filtros' }
];

function choiceStatus(value: boolean | null, completeLabel: string, notNeededLabel: string, optional = false) {
  // "Não" é uma resposta completa (não é necessário), diferente de ainda não ter respondido.
  if (value === true) return completeLabel;
  if (value === false) return notNeededLabel;
  // Na Sede o item é opcional: pode ficar sem resposta.
  return optional ? 'Opcional' : 'Pendente · selecione Sim ou Não';
}

function supplyPayload(item: SupplyDraftItem) {
  return {
    id: item.id,
    stockItemId: item.stockItemId,
    type: item.type,
    name: item.name,
    unitLabel: item.unitLabel,
    requiredQuantity: item.requiredQuantity,
    requestedAt: item.requestedAt || null,
    purchasedAt: item.purchasedAt || null,
    reservationExceptionReason: item.reservationExceptionReason || null
  };
}

function newCustomSupplyId() {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ProjectWorkflowSupplyPlanningCard({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: PatchHandler;
}) {
  const planning = workflow.resourcePlanning.supplies;
  const persistedDraft = useMemo<SupplyDraftItem[]>(() => planning.items.map(supplyPayload), [planning.items]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SupplyDraftItem[]>(persistedDraft);
  const [expandedTypes, setExpandedTypes] = useState<ProjectWorkflowSupplyType[]>([]);
  const [customType, setCustomType] = useState<ProjectWorkflowSupplyType>('PRODUTO_QUIMICO');
  const [customName, setCustomName] = useState('');
  const [customUnit, setCustomUnit] = useState('un');
  const [customQuantity, setCustomQuantity] = useState(1);
  useEffect(() => setDraft(persistedDraft), [persistedDraft]);
  const catalogById = useMemo(() => new Map(planning.catalog.map(item => [item.id, item])), [planning.catalog]);
  const selectedStockIds = new Set(draft.map(item => item.stockItemId).filter(Boolean));

  const toggleType = (type: ProjectWorkflowSupplyType) => {
    setExpandedTypes(current => current.includes(type) ? current.filter(item => item !== type) : [...current, type]);
  };
  const toggleStockItem = (stockItemId: string, selected: boolean) => {
    const item = catalogById.get(stockItemId);
    if (!item) return;
    setDraft(current => selected
      ? [...current, { id: `stock-${item.id}`, stockItemId: item.id, type: item.type, name: item.name, unitLabel: item.unitLabel, requiredQuantity: 1, requestedAt: null, purchasedAt: null, reservationExceptionReason: null }]
      : current.filter(entry => entry.stockItemId !== stockItemId));
  };
  const updateItem = (id: string, changes: Partial<SupplyDraftItem>) => {
    setDraft(current => current.map(item => item.id === id ? { ...item, ...changes } : item));
  };
  const addCustom = () => {
    const name = customName.trim();
    const unitLabel = customUnit.trim();
    if (!name || !unitLabel || customQuantity <= 0) return;
    setDraft(current => [...current, {
      id: newCustomSupplyId(),
      stockItemId: null,
      type: customType,
      name,
      unitLabel,
      requiredQuantity: customQuantity,
      requestedAt: null,
      purchasedAt: null,
      reservationExceptionReason: null
    }]);
    setCustomName('');
    setCustomUnit('un');
    setCustomQuantity(1);
  };
  const selectNo = () => {
    setEditing(false);
    setDraft([]);
    setExpandedTypes([]);
    if (planning.defined !== false || planning.items.length) {
      onPatch({ action: 'supply_plan', version: workflow.version, defined: false, items: [] });
    }
  };
  const confirm = () => {
    if (!draft.length || draft.some(item => item.requiredQuantity <= 0 || (item.purchasedAt && (!item.requestedAt || item.purchasedAt < item.requestedAt)))) return;
    setEditing(false);
    onPatch({ action: 'supply_plan', version: workflow.version, defined: true, items: draft.map(supplyPayload) });
  };

  return <ProjectWorkflowCategory
    title="Materiais e insumos"
    description="Selecione filtros e produtos químicos do Estoque e acompanhe eventuais compras."
    area="Suprimentos"
    tone={planning.purchasePendingCount ? 'warn' : undefined}
    status={choiceStatus(planning.defined, planning.purchasePendingCount ? `${planning.purchasePendingCount} compra(s) pendente(s)` : `${planning.items.length} insumo(s)`, 'Insumos não necessários', workflow.executedAtHeadquarters === true)}
    complete={planning.defined === false || (planning.defined === true && planning.items.length > 0)}
    className="project-workflow-resource-card"
    data-project-workflow-supply-plan
  >
    <div className="project-workflow-resource-question">
      <div><strong>Esta obra vai precisar de insumos próprios?</strong><p>Se a obra não precisar de insumos próprios, marque “Não”.</p></div>
      <ProjectWorkflowBooleanChoice value={editing ? true : planning.defined} label="Esta obra vai precisar de insumos próprios?" disabled={saving || !workflow.permissions.canEditSupplyPlanning} onSelect={value => value ? setEditing(true) : selectNo()} />
    </div>
    {editing ? <div className="project-workflow-resource-editor">
      <fieldset className="project-workflow-equipment-categories"><legend>Itens disponíveis no Estoque</legend>{SUPPLY_GROUPS.map(group => {
        const expanded = expandedTypes.includes(group.type);
        const catalog = planning.catalog.filter(item => item.type === group.type);
        const selectedCount = catalog.filter(item => selectedStockIds.has(item.id)).length;
        return <section className={`project-workflow-equipment-category${expanded ? ' is-expanded' : ''}`} key={group.type}>
          <button type="button" className="project-workflow-equipment-category-toggle" aria-expanded={expanded} disabled={saving} onClick={() => toggleType(group.type)}>
            <span><strong>{group.label}</strong><small>{catalog.length} item(ns) cadastrado(s) · {selectedCount} selecionado(s)</small></span>
            <span className="project-workflow-equipment-category-chevron" aria-hidden="true">⌄</span>
          </button>
          {expanded ? <div className="project-workflow-equipment-options">{catalog.length ? catalog.map(item => {
            const selected = selectedStockIds.has(item.id);
            return <label className={`project-workflow-equipment-option${selected ? ' is-selected' : ''}${item.availableQuantity > 0 ? ' is-ready' : ' has-warning'}`} key={item.id}>
              <input type="checkbox" checked={selected} disabled={saving} onChange={event => toggleStockItem(item.id, event.target.checked)} />
              <span><strong>{item.code} · {item.name}</strong><small>{item.categoryName || group.label}</small><small className={item.availableQuantity > 0 ? 'is-ready' : 'has-warning'}>Físico: {item.balance} · reservado: {item.reservedQuantity} · disponível: {item.availableQuantity} {item.unitLabel}</small>{item.reservationConflicts.length ? <small className="has-warning">Reservas: {item.reservationConflicts.map(reservation => `${reservation.projectCode} (${reservation.quantity})`).join(', ')}</small> : null}</span>
            </label>;
          }) : <p>Nenhum item ativo desta categoria foi encontrado no Estoque.</p>}</div> : null}
        </section>;
      })}</fieldset>

      <section className="project-workflow-custom-supply">
        <strong>Insumo não cadastrado no Estoque</strong>
        <div className="project-workflow-resource-add project-workflow-supply-add">
          <div className="field-group"><label htmlFor="workflow-supply-custom-type">Tipo</label><select id="workflow-supply-custom-type" value={customType} disabled={saving} onChange={event => setCustomType(event.target.value as ProjectWorkflowSupplyType)}><option value="PRODUTO_QUIMICO">Produto químico</option><option value="FILTRO">Filtro</option></select></div>
          <div className="field-group"><label htmlFor="workflow-supply-custom-name">Nome</label><input id="workflow-supply-custom-name" value={customName} maxLength={240} disabled={saving} onChange={event => setCustomName(event.target.value)} /></div>
          <div className="field-group"><label htmlFor="workflow-supply-custom-unit">Unidade</label><input id="workflow-supply-custom-unit" value={customUnit} maxLength={30} disabled={saving} onChange={event => setCustomUnit(event.target.value)} /></div>
          <div className="field-group"><label htmlFor="workflow-supply-custom-quantity">Quantidade</label><input id="workflow-supply-custom-quantity" type="number" min="0.001" step="0.001" value={customQuantity} disabled={saving} onChange={event => setCustomQuantity(Math.max(0, Number(event.target.value) || 0))} /></div>
          <Button type="button" variant="secondary" disabled={saving || !customName.trim() || !customUnit.trim() || customQuantity <= 0} onClick={addCustom}>Adicionar</Button>
        </div>
      </section>

      {draft.length ? <div className="project-workflow-supply-draft">{draft.map(item => {
        const stockItem = item.stockItemId ? catalogById.get(item.stockItemId) : null;
        const shortage = stockItem ? Math.max(0, item.requiredQuantity - stockItem.availableQuantity) : item.requiredQuantity;
        const purchaseRequired = !stockItem || shortage > 0 || Boolean(item.requestedAt || item.purchasedAt);
        const invalidDates = Boolean(item.purchasedAt && (!item.requestedAt || item.purchasedAt < item.requestedAt));
        return <article className={purchaseRequired ? 'has-warning' : 'is-ready'} key={item.id}>
          <header><div><strong>{stockItem?.code ? `${stockItem.code} · ` : ''}{item.name}</strong><span>{stockItem ? `Físico: ${stockItem.balance} · reservado: ${stockItem.reservedQuantity} · disponível: ${stockItem.availableQuantity} ${item.unitLabel}` : 'Não cadastrado no Estoque'}</span></div><Button type="button" variant="mini" disabled={saving} onClick={() => setDraft(current => current.filter(entry => entry.id !== item.id))}>Remover</Button></header>
          <div className="project-workflow-supply-fields">
            <div className="field-group"><label htmlFor={`workflow-supply-quantity-${item.id}`}>Quantidade necessária</label><input id={`workflow-supply-quantity-${item.id}`} type="number" min="0.001" step="0.001" value={item.requiredQuantity} disabled={saving} onChange={event => updateItem(item.id, { requiredQuantity: Math.max(0, Number(event.target.value) || 0) })} /></div>
            <div className="field-group"><label>Unidade</label><input value={item.unitLabel} disabled={Boolean(stockItem) || saving} maxLength={30} onChange={event => updateItem(item.id, { unitLabel: event.target.value })} /></div>
          </div>
          {purchaseRequired ? <div className="project-workflow-purchase-tracking"><p>⚠ {stockItem ? `Faltam ${shortage} ${item.unitLabel} após considerar as reservas existentes.` : 'Este item precisa ser adquirido e cadastrado.'}</p><div><ProjectWorkflowStatusToggle checked={Boolean(item.requestedAt)} disabled={saving} label={`Pedido realizado${item.requestedAt ? ` em ${displayDateOnly(item.requestedAt)}` : ''}`} onChange={checked => updateItem(item.id, checked ? { requestedAt: todayDateOnly() } : { requestedAt: null, purchasedAt: null })} /><ProjectWorkflowStatusToggle checked={Boolean(item.purchasedAt)} disabled={saving || !item.requestedAt} label={`Compra concluída${item.purchasedAt ? ` em ${displayDateOnly(item.purchasedAt)}` : ''}`} onChange={checked => updateItem(item.id, { purchasedAt: checked ? todayDateOnly() : null })} /></div>{stockItem?.reservationConflicts.length ? <div className="field-group"><label htmlFor={`workflow-supply-exception-${item.id}`}>Justificativa para manter a reserva</label><textarea id={`workflow-supply-exception-${item.id}`} rows={2} maxLength={1000} value={item.reservationExceptionReason || ''} disabled={saving} placeholder="Registre o motivo da exceção, se aplicável." onChange={event => updateItem(item.id, { reservationExceptionReason: event.target.value || null })} /></div> : null}{invalidDates ? <small>A compra deve ser registrada depois da solicitação.</small> : null}</div> : <p className="project-workflow-stock-ok">✓ Saldo disponível suficiente para a quantidade planejada.</p>}
        </article>;
      })}</div> : <p className="project-workflow-resource-empty">Selecione um item do Estoque ou adicione um insumo ainda não cadastrado.</p>}
      <div className="project-workflow-inline-actions"><Button type="button" variant="secondary" disabled={saving} onClick={() => { setEditing(false); setDraft(persistedDraft); setExpandedTypes([]); }}>Cancelar</Button><Button type="button" disabled={saving || !draft.length || draft.some(item => item.requiredQuantity <= 0 || Boolean(item.purchasedAt && (!item.requestedAt || item.purchasedAt < item.requestedAt)))} onClick={confirm}>Confirmar insumos</Button></div>
    </div> : null}
    {!editing && planning.items.length ? <div className="project-workflow-supply-summary">{SUPPLY_GROUPS.map(group => {
      const items = planning.items.filter(item => item.type === group.type);
      return items.length ? <details key={group.type}><summary><strong>{group.label}</strong><span>{items.length} item(ns)</span><span aria-hidden="true">⌄</span></summary><div>{items.map(item => <article className={item.purchaseRequired && !item.purchasedAt ? 'has-warning' : 'is-ready'} key={item.id}><strong>{item.code ? `${item.code} · ` : ''}{item.name}</strong><span>{item.requiredQuantity} {item.unitLabel} necessário(s) · físico {item.physicalQuantity} · reservado {item.reservedQuantity} · disponível {item.availableQuantity}</span>{item.purchaseRequired ? <small>{item.purchasedAt ? `Compra registrada em ${displayDateOnly(item.purchasedAt)}` : item.requestedAt ? `Pedido registrado em ${displayDateOnly(item.requestedAt)}` : `⚠ Compra necessária: ${item.shortageQuantity} ${item.unitLabel}`}</small> : <small>✓ Saldo disponível suficiente</small>}{item.reservationConflicts.length ? <small>Reservas concorrentes: {item.reservationConflicts.map(reservation => reservation.projectCode).join(', ')}</small> : null}{item.reservationExceptionReason ? <small>Exceção registrada: {item.reservationExceptionReason}</small> : null}</article>)}</div></details> : null;
    })}</div> : null}
  </ProjectWorkflowCategory>;
}

export function ProjectWorkflowLogisticsPlanningCard({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: PatchHandler;
}) {
  const planning = workflow.resourcePlanning.logistics;
  const persisted = useMemo<LogisticsDraft>(() => ({
    vehicleRequired: planning.vehicleRequired,
    vehicleQuantity: planning.vehicleQuantity,
    vehicleType: planning.vehicleType,
    freightRequired: planning.freightRequired,
    lodgingRequired: planning.lodgingRequired,
    lodgingPeopleCount: planning.lodgingPeopleCount,
    lodgingExpectedDate: planning.lodgingExpectedDate,
    lodgingRequested: planning.lodgingRequested,
    lodgingRequestedAt: planning.lodgingRequestedAt,
    lodgingCompletedAt: planning.lodgingCompletedAt
  }), [planning]);
  const [draft, setDraft] = useState<LogisticsDraft>(persisted);
  useEffect(() => setDraft(persisted), [persisted]);
  const save = (next: LogisticsDraft) => {
    setDraft(next);
    onPatch({ action: 'logistics_plan', version: workflow.version, ...next });
  };
  const change = <K extends keyof LogisticsDraft>(key: K, value: LogisticsDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const canEdit = workflow.permissions.canEditLogisticsPlanning && !saving;
  const headquarters = workflow.executedAtHeadquarters === true;

  return <ProjectWorkflowCategory
    title="Logística preliminar"
    description={headquarters ? 'Projeto na Sede: informe as necessidades de veículo e frete (opcional). Cada alteração é salva automaticamente.' : 'Informe as necessidades de veículo, frete e hospedagem. Cada alteração é salva automaticamente.'}
    area="Logística"
    tone={planning.complete && planning.warnings.length ? 'warn' : undefined}
    status={planning.complete ? planning.warnings.length ? `${planning.warnings.length} aviso(s)` : 'Concluído' : headquarters ? 'Opcional' : `${planning.issues.length} pendência(s)`}
    complete={planning.complete}
    className="project-workflow-resource-card project-workflow-logistics-card"
    data-project-workflow-logistics-plan
  >
    <section className="project-workflow-logistics-section">
      <div className="project-workflow-resource-question"><div><strong>Será necessário veículo?</strong><p>Informe os veículos previstos para a mobilização.</p></div><ProjectWorkflowBooleanChoice value={draft.vehicleRequired} label="Necessidade de veículo" disabled={!canEdit} onSelect={value => save({ ...draft, vehicleRequired: value, vehicleQuantity: value ? draft.vehicleQuantity : null, vehicleType: value ? draft.vehicleType : null })} /></div>
      {draft.vehicleRequired === true ? <div className="project-workflow-logistics-fields"><div className="field-group"><label htmlFor="workflow-logistics-vehicle-quantity">Quantidade</label><input id="workflow-logistics-vehicle-quantity" type="number" min="1" max="100" step="1" value={draft.vehicleQuantity ?? ''} disabled={!canEdit} onChange={event => change('vehicleQuantity', event.target.value ? Number(event.target.value) : null)} onBlur={() => save(draft)} /></div><div className="field-group"><label htmlFor="workflow-logistics-vehicle-type">Tipo</label><select id="workflow-logistics-vehicle-type" value={draft.vehicleType || ''} disabled={!canEdit} onChange={event => save({ ...draft, vehicleType: (event.target.value || null) as LogisticsDraft['vehicleType'] })}><option value="">Selecione</option><option value="CARRO">Carro</option><option value="CAMINHAO">Caminhão</option></select></div></div> : null}
    </section>
    <section className="project-workflow-logistics-section">
      <div className="project-workflow-resource-question"><div><strong>Será necessário frete?</strong><p>Esta decisão não exige detalhamento nesta etapa.</p></div><ProjectWorkflowBooleanChoice value={draft.freightRequired} label="Necessidade de frete" disabled={!canEdit} onSelect={value => save({ ...draft, freightRequired: value })} /></div>
    </section>
    {headquarters ? null : <section className="project-workflow-logistics-section">
      <div className="project-workflow-resource-question"><div><strong>Será necessária hospedagem?</strong><p>A data sugerida acompanha a mobilização e pode ser ajustada somente para a hospedagem.</p></div><ProjectWorkflowBooleanChoice value={draft.lodgingRequired} label="Necessidade de hospedagem" disabled={!canEdit} onSelect={value => save({ ...draft, lodgingRequired: value, lodgingPeopleCount: value ? draft.lodgingPeopleCount : null, lodgingExpectedDate: value ? draft.lodgingExpectedDate || workflow.resourcePlanning.targetDate || null : null, lodgingRequested: value ? draft.lodgingRequested : null, lodgingRequestedAt: value ? draft.lodgingRequestedAt : null, lodgingCompletedAt: value ? draft.lodgingCompletedAt : null })} /></div>
      {draft.lodgingRequired === true ? <div className="project-workflow-logistics-details">
        <div className="project-workflow-logistics-fields"><div className="field-group"><label htmlFor="workflow-logistics-lodging-people">Pessoas</label><input id="workflow-logistics-lodging-people" type="number" min="1" max="1000" step="1" value={draft.lodgingPeopleCount ?? ''} disabled={!canEdit} onChange={event => change('lodgingPeopleCount', event.target.value ? Number(event.target.value) : null)} onBlur={() => save(draft)} /></div><div className="field-group"><label htmlFor="workflow-logistics-lodging-date">Data prevista</label><DateInput id="workflow-logistics-lodging-date" value={draft.lodgingExpectedDate || ''} disabled={!canEdit} onCommit={value => save({ ...draft, lodgingExpectedDate: value || null })} /></div></div>
        <div className="project-workflow-resource-question"><div><strong>A hospedagem já foi solicitada?</strong><p>A data da solicitação e a da conclusão são registradas automaticamente.</p></div><ProjectWorkflowBooleanChoice value={draft.lodgingRequested} label="Hospedagem solicitada" disabled={!canEdit} onSelect={value => save({ ...draft, lodgingRequested: value, lodgingRequestedAt: value ? draft.lodgingRequestedAt || todayDateOnly() : null, lodgingCompletedAt: value ? draft.lodgingCompletedAt : null })} /></div>
        {draft.lodgingRequested === true ? <div className="project-workflow-logistics-fields"><ProjectWorkflowStatusToggle checked={Boolean(draft.lodgingCompletedAt)} disabled={!canEdit} label={`Hospedagem concluída${draft.lodgingCompletedAt ? ` em ${displayDateOnly(draft.lodgingCompletedAt)}` : ''}`} onChange={checked => save({ ...draft, lodgingRequestedAt: draft.lodgingRequestedAt || todayDateOnly(), lodgingCompletedAt: checked ? todayDateOnly() : null })} />{draft.lodgingRequestedAt ? <small className="project-workflow-source-detail">Solicitada em {displayDateOnly(draft.lodgingRequestedAt)}</small> : null}</div> : null}
      </div> : null}
    </section>}
    {planning.issues.length ? <ul className="project-workflow-logistics-issues">{planning.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : planning.warnings.length ? <ul className="project-workflow-logistics-issues">{planning.warnings.map(warning => <li key={warning}>⚠ {warning}</li>)}</ul> : <p className="project-workflow-stock-ok">✓ Necessidades de logística preliminar informadas.</p>}
  </ProjectWorkflowCategory>;
}
