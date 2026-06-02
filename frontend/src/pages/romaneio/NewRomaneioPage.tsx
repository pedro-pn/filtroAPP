import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  createRomaneio,
  createRomaneioDraft,
  getRomaneio,
  listRomaneioCatalog,
  listRomaneioDrafts,
  listRomaneioProjects,
  removeRomaneioDraft,
  updateRomaneio,
  updateRomaneioDraft,
  type Romaneio,
  type RomaneioCatalogItem,
  type RomaneioCreatePayload,
  type RomaneioDraftPayload,
  type RomaneioItemKind,
  type RomaneioMeasureType
} from '../../api/romaneio';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { useToast } from '../../components/ui/Toast';
import { Modal } from '../../components/ui/Modal';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';

interface SelectedItem {
  key: string;
  catalogItemId?: string | null;
  itemCode?: string | null;
  itemName: string;
  categoryName: string;
  kind: RomaneioItemKind;
  measureType: RomaneioMeasureType;
  quantity: number;
  unitLabel: string;
  isCustom: boolean;
}

const today = new Date().toISOString().slice(0, 10);

function defaultUnit(measureType: RomaneioMeasureType) {
  if (measureType === 'WEIGHT') return 'kg';
  if (measureType === 'LENGTH') return 'm';
  return 'unidade';
}

function itemLabel(item: RomaneioCatalogItem) {
  return [item.code, item.name].filter(Boolean).join(' - ');
}

function romaneioItemsToSelectedItems(romaneio: Romaneio): SelectedItem[] {
  return (romaneio.items || []).map(item => ({
    key: item.id,
    catalogItemId: item.catalogItemId || null,
    itemCode: item.itemCode || null,
    itemName: item.itemName,
    categoryName: item.categoryName,
    kind: item.kind,
    measureType: item.measureType,
    quantity: Number(item.quantity),
    unitLabel: item.unitLabel,
    isCustom: item.isCustom
  }));
}

export function NewRomaneioPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { logout } = useAuth();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const draftSaveTimerRef = useRef<number | null>(null);
  const lastAutoSaveSignatureRef = useRef('');
  const hydratedDraftKeyRef = useRef('');
  const isSubmittingRef = useRef(false);
  const [projectId, setProjectId] = useState('');
  const [romaneioDate, setRomaneioDate] = useState(today);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [driverName, setDriverName] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [cargoWeight, setCargoWeight] = useState('');
  const [cargoWeightUnit, setCargoWeightUnit] = useState<'kg' | 'ton'>('kg');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState({
    itemName: '',
    categoryName: 'Itens não listados',
    kind: 'EQUIPMENT' as RomaneioItemKind,
    measureType: 'UNIT' as RomaneioMeasureType,
    quantity: '1',
    unitLabel: 'unidade'
  });

  const draftParam = searchParams.get('draft') || '';
  const editId = searchParams.get('edit') || '';
  const isEditing = Boolean(editId);
  const projectsQuery = useQuery({ queryKey: ['romaneio-projects'], queryFn: () => listRomaneioProjects(true) });
  const catalogQuery = useQuery({ queryKey: ['romaneio-catalog'], queryFn: listRomaneioCatalog });
  const draftsQuery = useQuery({ queryKey: ['romaneio-drafts'], queryFn: listRomaneioDrafts, enabled: !isEditing });
  const editQuery = useQuery({
    queryKey: ['romaneio', editId],
    queryFn: () => getRomaneio(editId),
    enabled: isEditing
  });
  const saveMutation = useMutation({
    mutationFn: (payload: RomaneioCreatePayload) => (
      isEditing ? updateRomaneio(editId, payload) : createRomaneio(payload)
    )
  });

  const projectOptions = useMemo(() => {
    const projects = [...(projectsQuery.data || [])];
    const editProject = editQuery.data?.project;
    if (editProject && !projects.some(project => project.id === editProject.id)) projects.push(editProject);
    return projects;
  }, [editQuery.data?.project, projectsQuery.data]);

  const selectedProject = useMemo(
    () => projectOptions.find(project => project.id === projectId) || null,
    [projectId, projectOptions]
  );

  const activeCatalog = useMemo(() => {
    const needle = catalogSearch.trim().toLowerCase();
    return (catalogQuery.data || [])
      .filter(item => item.isActive)
      .filter(item => !needle || `${item.code || ''} ${item.name} ${item.categoryName}`.toLowerCase().includes(needle));
  }, [catalogQuery.data, catalogSearch]);

  const groupedCatalog = useMemo(() => {
    const map = new Map<string, RomaneioCatalogItem[]>();
    activeCatalog.forEach(item => {
      if (!map.has(item.categoryName)) map.set(item.categoryName, []);
      map.get(item.categoryName)?.push(item);
    });
    return Array.from(map.entries());
  }, [activeCatalog]);

  function addCatalogItem(item: RomaneioCatalogItem) {
    const quantity = Number(quantities[item.id] || (item.isSerialized ? 1 : ''));
    if (!quantity || quantity <= 0) {
      showToast('Informe a quantidade do item.');
      return;
    }
    if (item.isSerialized && selectedItems.some(selected => selected.catalogItemId === item.id)) {
      showToast('Este item único já foi adicionado.');
      return;
    }

    const next: SelectedItem = {
      key: item.id,
      catalogItemId: item.id,
      itemCode: item.code || null,
      itemName: item.name,
      categoryName: item.categoryName,
      kind: item.kind,
      measureType: item.measureType,
      quantity,
      unitLabel: item.defaultUnitLabel,
      isCustom: false
    };
    setSelectedItems(current => {
      const existing = current.find(selected => selected.catalogItemId === item.id);
      if (!existing) return [...current, next];
      return current.map(selected => selected.catalogItemId === item.id ? { ...selected, quantity } : selected);
    });
    setQuantities(current => ({ ...current, [item.id]: '' }));
  }

  function addCustomItem() {
    const quantity = Number(custom.quantity);
    if (!custom.itemName.trim() || !custom.categoryName.trim() || !quantity || quantity <= 0) {
      showToast('Preencha o item não listado.');
      return;
    }
    setSelectedItems(current => [...current, {
      key: `custom-${Date.now()}`,
      itemName: custom.itemName.trim(),
      categoryName: custom.categoryName.trim(),
      kind: custom.kind,
      measureType: custom.measureType,
      quantity,
      unitLabel: custom.unitLabel || defaultUnit(custom.measureType),
      isCustom: true
    }]);
    setCustom({
      itemName: '',
      categoryName: 'Itens não listados',
      kind: 'EQUIPMENT',
      measureType: 'UNIT',
      quantity: '1',
      unitLabel: 'unidade'
    });
  }

  function toggleCategory(category: string) {
    setExpandedCategories(current => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  function draftProjectDateKey(draft: { projectId?: string | null; reportDate?: string | null; payload?: Record<string, unknown> }) {
    const payload = draft.payload || {};
    const draftProjectId = draft.projectId || (typeof payload.projectId === 'string' ? payload.projectId : '');
    const draftReportDate = draft.reportDate || (typeof payload.reportDate === 'string' ? payload.reportDate : '');
    return draftProjectId && draftReportDate ? `${draftProjectId}|${draftReportDate.slice(0, 10)}` : '';
  }

  function currentDraftKey() {
    return projectId && romaneioDate ? `${projectId}|${romaneioDate.slice(0, 10)}` : '';
  }

  function matchingDraftIds() {
    const key = currentDraftKey();
    if (!key) return [];
    return (draftsQuery.data || []).filter(draft => draftProjectDateKey(draft) === key).map(draft => draft.id);
  }

  function buildDraftPayload(): RomaneioDraftPayload {
    return {
      projectId,
      reportDate: romaneioDate,
      title: selectedProject ? `Romaneio - ${selectedProject.code} - ${selectedProject.name}` : 'Romaneio em andamento',
      payload: {
        __module: 'romaneio',
        projectId,
        romaneioDate,
        driverName,
        vehiclePlate,
        cargoWeight,
        cargoWeightUnit,
        selectedItems,
        quantities,
        custom
      }
    };
  }

  function hydrateDraft(draft: { id: string; projectId?: string | null; reportDate?: string | null; payload?: Record<string, unknown> }) {
    const payload = draft.payload || {};
    const nextProjectId = typeof payload.projectId === 'string' ? payload.projectId : draft.projectId || '';
    const nextDate = typeof payload.romaneioDate === 'string'
      ? payload.romaneioDate
      : typeof payload.reportDate === 'string'
        ? payload.reportDate
        : draft.reportDate || today;

    setDraftId(draft.id);
    setProjectId(nextProjectId);
    setRomaneioDate(nextDate.slice(0, 10));
    setDriverName(typeof payload.driverName === 'string' ? payload.driverName : '');
    setVehiclePlate(typeof payload.vehiclePlate === 'string' ? payload.vehiclePlate : '');
    setCargoWeight(typeof payload.cargoWeight === 'string' || typeof payload.cargoWeight === 'number' ? String(payload.cargoWeight) : '');
    setCargoWeightUnit(payload.cargoWeightUnit === 'ton' ? 'ton' : 'kg');
    setSelectedItems(Array.isArray(payload.selectedItems) ? payload.selectedItems as SelectedItem[] : []);
    setQuantities(
      payload.quantities && typeof payload.quantities === 'object' && !Array.isArray(payload.quantities)
        ? payload.quantities as Record<string, string>
        : {}
    );
    setCustom(current => (
      payload.custom && typeof payload.custom === 'object' && !Array.isArray(payload.custom)
        ? { ...current, ...(payload.custom as typeof custom) }
        : current
    ));
    hydratedDraftKeyRef.current = nextProjectId && nextDate ? `${nextProjectId}|${nextDate.slice(0, 10)}` : '';
  }

  useEffect(() => {
    if (isEditing || !draftParam || !draftsQuery.data?.length) return;
    if (draftId === draftParam) return;
    const draft = draftsQuery.data.find(item => item.id === draftParam);
    if (!draft) return;
    hydrateDraft(draft);
    showToast('Rascunho carregado.');
  }, [isEditing, draftParam, draftsQuery.data, draftId]);

  useEffect(() => {
    const romaneio = editQuery.data;
    if (!romaneio || !isEditing) return;
    setProjectId(romaneio.projectId);
    setRomaneioDate(romaneio.romaneioDate.slice(0, 10));
    setDriverName(romaneio.driverName || '');
    setVehiclePlate(romaneio.vehiclePlate || '');
    setCargoWeight(romaneio.cargoWeight == null ? '' : String(romaneio.cargoWeight));
    setCargoWeightUnit(romaneio.cargoWeightUnit === 'ton' ? 'ton' : 'kg');
    setSelectedItems(romaneioItemsToSelectedItems(romaneio));
    setDraftId(null);
  }, [editQuery.data, isEditing]);

  useEffect(() => {
    if (isEditing || draftParam) return;
    const key = currentDraftKey();
    if (!key || hydratedDraftKeyRef.current === key) return;
    const draft = (draftsQuery.data || []).find(item => draftProjectDateKey(item) === key);
    hydratedDraftKeyRef.current = key;
    if (!draft) {
      setDraftId(null);
      return;
    }

    hydrateDraft(draft);
    showToast('Rascunho carregado.');
  }, [isEditing, projectId, romaneioDate, draftsQuery.data, draftParam]);

  useEffect(() => {
    if (isEditing) return;
    if (isSubmittingRef.current) return;
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);

    if (!projectId || !romaneioDate) {
      if (draftId) setDraftId(null);
      return;
    }

    draftSaveTimerRef.current = window.setTimeout(() => {
      const payload = buildDraftPayload();
      const sameProjectDateIds = matchingDraftIds();
      const targetId = draftId && sameProjectDateIds.includes(draftId) ? draftId : sameProjectDateIds[0];
      const signature = JSON.stringify({ targetId: targetId || '', payload });
      if (signature === lastAutoSaveSignatureRef.current) return;
      lastAutoSaveSignatureRef.current = signature;

      void (async () => {
        try {
          const saved = targetId
            ? await updateRomaneioDraft(targetId, payload)
            : await createRomaneioDraft(payload);
          if (draftId !== saved.id) setDraftId(saved.id);
          await Promise.all(
            sameProjectDateIds
              .filter(id => id !== saved.id)
              .map(id => removeRomaneioDraft(id).catch(() => undefined))
          );
          queryClient.invalidateQueries({ queryKey: ['romaneio-drafts'] });
        } catch {
          // Autosave is intentionally silent.
        }
      })();
    }, 400);

    return () => {
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
    };
  }, [
    projectId,
    romaneioDate,
    driverName,
    vehiclePlate,
    cargoWeight,
    cargoWeightUnit,
    selectedItems,
    quantities,
    custom,
    selectedProject,
    draftId,
    draftsQuery.data,
    queryClient,
    isEditing
  ]);

  function selectedItemsPayload() {
    return selectedItems.map(item => ({
      catalogItemId: item.catalogItemId || null,
      itemName: item.itemName,
      itemCode: item.itemCode || null,
      categoryName: item.categoryName,
      kind: item.kind,
      measureType: item.measureType,
      quantity: item.quantity,
      unitLabel: item.unitLabel,
      isCustom: item.isCustom
    }));
  }

  function canSubmitRomaneio() {
    if (!projectId || !romaneioDate || !driverName.trim() || !vehiclePlate.trim()) {
      showToast('Preencha os dados do cabeçalho.');
      return false;
    }
    if (cargoWeight && Number(cargoWeight) <= 0) {
      showToast('Informe um peso de carga válido.');
      return false;
    }
    if (!selectedItems.length) {
      showToast('Adicione ao menos um item.');
      return false;
    }
    return true;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saveMutation.isPending || isSubmittingRef.current) return;
    if (!canSubmitRomaneio()) return;
    setReviewOpen(true);
  }

  async function confirmSubmit() {
    if (saveMutation.isPending || isSubmittingRef.current) return;
    if (!canSubmitRomaneio()) return;
    setReviewOpen(false);
    isSubmittingRef.current = true;
    if (draftSaveTimerRef.current) {
      window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }

    try {
      await saveMutation.mutateAsync({
        projectId,
        romaneioDate,
        driverName,
        vehiclePlate,
        cargoWeight: cargoWeight ? Number(cargoWeight) : null,
        cargoWeightUnit,
        items: selectedItemsPayload()
      });
      if (!isEditing) {
        const draftIdsToRemove = matchingDraftIds();
        if (draftId && !draftIdsToRemove.includes(draftId)) draftIdsToRemove.push(draftId);
        await Promise.all(draftIdsToRemove.map(id => removeRomaneioDraft(id).catch(() => undefined)));
        queryClient.invalidateQueries({ queryKey: ['romaneio-drafts'] });
      }
      queryClient.invalidateQueries({ queryKey: ['romaneios'] });
      if (isEditing) queryClient.invalidateQueries({ queryKey: ['romaneio', editId] });
      setDraftId(null);
      lastAutoSaveSignatureRef.current = '';
      showToast(isEditing ? 'Romaneio atualizado.' : 'Romaneio criado.');
      navigate('/romaneio');
    } catch (error) {
      isSubmittingRef.current = false;
      const message = error instanceof Error
        ? error.message
        : (isEditing ? 'Não foi possível atualizar o romaneio.' : 'Não foi possível criar o romaneio.');
      showToast(message);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <Shell>
      <TopBar
        title={isEditing ? 'Editar romaneio' : 'Novo romaneio'}
        subtitle={isEditing ? 'Atualização de dados e materiais' : 'Formulário de equipamentos'}
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta', { state: accountPageStateFromPath(location.pathname) })}>
              Conta
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />
      <form className="page-scroll" onSubmit={submit}>
        <section className="page-card romaneio-panel">
          <div className="admin-toolbar">
            <div>
              <div className="sec">Cabeçalho</div>
              {!isEditing && draftId && <div className="rel-meta">Rascunho salvo na nuvem</div>}
            </div>
            <button className="secondary-button" type="button" onClick={() => navigate('/romaneio')}>Voltar</button>
          </div>
          <div className="admin-form-grid manager-header-grid">
            <label className="field-group field-group-wide">
              <span>Projeto</span>
              <select value={projectId} onChange={event => setProjectId(event.target.value)} required>
                <option value="">Selecione</option>
                {projectOptions.map(project => (
                  <option key={project.id} value={project.id}>Missão {project.code} - {project.name}</option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span>Data</span>
              <input type="date" value={romaneioDate} onChange={event => setRomaneioDate(event.target.value)} required />
            </label>
            <label className="field-group">
              <span>Motorista</span>
              <input value={driverName} onChange={event => setDriverName(event.target.value)} required />
            </label>
            <label className="field-group">
              <span>Placa do veículo</span>
              <input value={vehiclePlate} onChange={event => setVehiclePlate(event.target.value.toUpperCase())} required />
            </label>
            <div className="romaneio-cargo-weight-field">
              <label className="field-group">
                <span>Peso da carga</span>
                <input type="number" min="0" step="1" value={cargoWeight} onChange={event => setCargoWeight(event.target.value)} />
              </label>
              <label className="field-group romaneio-cargo-unit-field">
                <span>Unidade</span>
                <select value={cargoWeightUnit} onChange={event => setCargoWeightUnit(event.target.value as 'kg' | 'ton')}>
                  <option value="kg">kg</option>
                  <option value="ton">ton</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="page-card romaneio-panel">
          <div className="admin-section-head">
            <div>
              <div className="sec">Itens selecionados</div>
              <div className="rel-meta">{selectedItems.length} item(ns)</div>
            </div>
          </div>
          {!selectedItems.length && <div className="rel-meta">Nenhum item adicionado.</div>}
          <div className="romaneio-selected-list">
            {selectedItems.map(item => (
              <div className="romaneio-selected-row" key={item.key}>
                <div>
                  <strong>{[item.itemCode, item.itemName].filter(Boolean).join(' - ')}</strong>
                  <div className="rel-meta">{item.categoryName} · {item.quantity} {item.unitLabel}</div>
                </div>
                <button className="mini-btn danger" type="button" onClick={() => setSelectedItems(current => current.filter(selected => selected.key !== item.key))}>Remover</button>
              </div>
            ))}
          </div>
        </section>

        <section className="page-card romaneio-panel">
          <div className="admin-toolbar">
            <div className="sec">Materiais disponíveis</div>
          </div>
          <label className="field-group">
            <span>Pesquisar item</span>
            <input value={catalogSearch} onChange={event => setCatalogSearch(event.target.value)} placeholder="Código, item ou categoria" />
          </label>
        </section>

        {catalogQuery.isLoading && <section className="page-card romaneio-panel">Carregando catálogo...</section>}
        {!catalogQuery.isLoading && !groupedCatalog.length && (
          <section className="page-card romaneio-panel">Nenhum item encontrado.</section>
        )}
        {!!groupedCatalog.length && (
          <section className="page-card romaneio-panel">
            <div className="romaneio-accordion-list">
              {groupedCatalog.map(([category, items]) => {
                const expanded = expandedCategories.has(category);
                return (
                  <div className="romaneio-accordion" key={category}>
                    <button
                      className="romaneio-accordion-head"
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => toggleCategory(category)}
                    >
                      <span className="romaneio-accordion-title">{category}</span>
                      <span className="romaneio-accordion-count">{items.length}</span>
                      <span className="romaneio-accordion-icon" aria-hidden="true">{expanded ? '-' : '+'}</span>
                    </button>
                    {expanded && (
                      <div className="romaneio-catalog-list">
                        {items.map(item => {
                          const disabled = item.isSerialized && selectedItems.some(selected => selected.catalogItemId === item.id);
                          return (
                            <div className="romaneio-catalog-row" key={item.id}>
                              <div>
                                <strong>{itemLabel(item)}</strong>
                                <div className="rel-meta">{item.kind === 'CONNECTION' ? 'Conexão' : 'Equipamento'} · {item.defaultUnitLabel}</div>
                              </div>
                              <div className="romaneio-add-control">
                                {!item.isSerialized && (
                                  <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={quantities[item.id] || ''}
                                    onChange={event => setQuantities(current => ({ ...current, [item.id]: event.target.value }))}
                                    placeholder={item.defaultUnitLabel}
                                  />
                                )}
                                <button className="mini-btn" type="button" disabled={disabled} onClick={() => addCatalogItem(item)}>
                                  {disabled ? 'Adicionado' : 'Adicionar'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="page-card romaneio-panel">
          <div className="sec">Item não listado</div>
          <div className="admin-form-grid manager-header-grid">
            <label className="field-group field-group-wide">
              <span>Item</span>
              <input value={custom.itemName} onChange={event => setCustom({ ...custom, itemName: event.target.value })} />
            </label>
            <label className="field-group">
              <span>Categoria</span>
              <input value={custom.categoryName} onChange={event => setCustom({ ...custom, categoryName: event.target.value })} />
            </label>
            <label className="field-group">
              <span>Unidade variável</span>
              <select value={custom.measureType} onChange={event => {
                const measureType = event.target.value as RomaneioMeasureType;
                setCustom({ ...custom, measureType, unitLabel: defaultUnit(measureType) });
              }}>
                <option value="UNIT">Unidade</option>
                <option value="LENGTH">Comprimento</option>
                <option value="WEIGHT">Peso</option>
              </select>
            </label>
            <label className="field-group">
              <span>Quantidade</span>
              <input type="number" min="0" step="1" value={custom.quantity} onChange={event => setCustom({ ...custom, quantity: event.target.value })} />
            </label>
            <label className="field-group">
              <span>Unidade</span>
              <input value={custom.unitLabel} onChange={event => setCustom({ ...custom, unitLabel: event.target.value })} />
            </label>
            <div className="admin-form-actions field-group-wide">
              <button className="secondary-button" type="button" onClick={addCustomItem}>Adicionar item livre</button>
            </div>
          </div>
        </section>

        <section className="bottom-bar-react">
          <button className="primary-button" type="submit" disabled={saveMutation.isPending || (isEditing && editQuery.isLoading)}>
            {isEditing ? 'Salvar alterações' : 'Enviar romaneio'}
          </button>
        </section>
      </form>
      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        ariaLabelledBy="romaneio-review-title"
        ariaDescribedBy="romaneio-review-description"
        panelClassName="modal-card romaneio-review-modal"
      >
        <div className="section-title" id="romaneio-review-title">Revisar itens do romaneio</div>
        <p className="placeholder-copy" id="romaneio-review-description">
          Confira os itens adicionados antes de confirmar o envio.
        </p>
        <div className="det-section">
          <div className="det-row">
            <span className="det-label">Projeto</span>
            <span className="det-val">{selectedProject ? `Missão ${selectedProject.code} - ${selectedProject.name}` : '-'}</span>
          </div>
          <div className="det-row"><span className="det-label">Data</span><span className="det-val">{romaneioDate}</span></div>
          <div className="det-row"><span className="det-label">Motorista</span><span className="det-val">{driverName || '-'}</span></div>
          <div className="det-row"><span className="det-label">Placa</span><span className="det-val">{vehiclePlate || '-'}</span></div>
          <div className="det-row"><span className="det-label">Peso da carga</span><span className="det-val">{cargoWeight ? `${cargoWeight} ${cargoWeightUnit}` : '-'}</span></div>
        </div>
        <div className="romaneio-review-list" aria-label="Itens adicionados ao romaneio">
          {selectedItems.map(item => (
            <div className="romaneio-review-row" key={item.key}>
              <div>
                <strong>{[item.itemCode, item.itemName].filter(Boolean).join(' - ')}</strong>
                <div className="rel-meta">{item.categoryName}</div>
              </div>
              <span>{item.quantity} {item.unitLabel}</span>
            </div>
          ))}
        </div>
        <div className="admin-form-actions">
          <button className="secondary-button" type="button" onClick={() => setReviewOpen(false)}>
            Cancelar
          </button>
          <button className="primary-button" type="button" disabled={saveMutation.isPending} onClick={() => void confirmSubmit()}>
            {isEditing ? 'Confirmar alterações' : 'Confirmar envio'}
          </button>
        </div>
      </Modal>
    </Shell>
  );
}
