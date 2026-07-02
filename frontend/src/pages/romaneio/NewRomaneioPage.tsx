import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  createRomaneio,
  createRomaneioDraft,
  getRomaneio,
  listRomaneioCatalog,
  listRomaneioDrafts,
  listRomaneioProjects,
  listRomaneioReturnItems,
  removeRomaneioDraft,
  updateRomaneio,
  updateRomaneioDraft,
  type Romaneio,
  type RomaneioCatalogItem,
  type RomaneioCreatePayload,
  type RomaneioDraftPayload,
  type RomaneioItemKind,
  type RomaneioMeasureType,
  type RomaneioReturnItem,
  type RomaneioType
} from '../../api/romaneio';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { useToast } from '../../components/ui/ToastContext';
import { Modal } from '../../components/ui/Modal';
import { SearchBar } from '../../components/ui/SearchBar';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { autosaveDraftTargetId } from '../../utils/draftAutosave';
import { defaultRomaneioUnit, romaneioMeasureLabel, romaneioUsesVariableQuantity } from '../../utils/romaneioMeasure';

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
  returnMaxQuantity?: number;
}

const today = new Date().toISOString().slice(0, 10);
const MANUAL_PROJECT_OPTION = '__manual_project__';

function itemLabel(item: RomaneioCatalogItem) {
  return [item.code, item.name].filter(Boolean).join(' - ');
}

function projectLabel(project: { code: string; name?: string | null }) {
  const name = String(project.name || '').trim();
  return name ? `Missão ${project.code} - ${name}` : `Missão ${project.code}`;
}

function numericProjectCode(value: string) {
  return value.replace(/\D/g, '');
}

function returnKeyPart(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

function selectedItemReturnKey(item: Pick<SelectedItem, 'catalogItemId' | 'itemCode' | 'itemName' | 'categoryName' | 'kind' | 'measureType' | 'unitLabel'>) {
  if (item.catalogItemId) return `catalog:${item.catalogItemId}`;
  return [
    'snapshot',
    returnKeyPart(item.itemCode),
    returnKeyPart(item.itemName),
    returnKeyPart(item.categoryName),
    item.kind || 'EQUIPMENT',
    item.measureType || 'UNIT',
    returnKeyPart(item.unitLabel)
  ].join('|');
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

function returnItemsToSelectedItems(items: RomaneioReturnItem[]): SelectedItem[] {
  return (items || []).map(item => {
    const maxQuantity = Number(item.maxQuantity);
    return {
      key: item.key,
      catalogItemId: item.catalogItemId || null,
      itemCode: item.itemCode || null,
      itemName: item.itemName,
      categoryName: item.categoryName,
      kind: item.kind,
      measureType: item.measureType,
      quantity: Number.isFinite(maxQuantity) ? maxQuantity : Number(item.quantity),
      unitLabel: item.unitLabel,
      isCustom: item.isCustom,
      returnMaxQuantity: Number.isFinite(maxQuantity) ? maxQuantity : Number(item.quantity)
    };
  });
}

function romaneioTypeLabel(type: RomaneioType) {
  return type === 'INBOUND' ? 'Entrada' : 'Saída';
}

function draftProjectDateKey(draft: { projectId?: string | null; reportDate?: string | null; payload?: Record<string, unknown> }) {
  const payload = draft.payload || {};
  const draftProjectId = draft.projectId || (typeof payload.projectId === 'string' ? payload.projectId : '');
  const draftProjectCode = typeof payload.projectCode === 'string' ? numericProjectCode(payload.projectCode) : '';
  const draftReportDate = draft.reportDate || (typeof payload.reportDate === 'string' ? payload.reportDate : '');
  const draftType = payload.romaneioType === 'INBOUND' ? 'INBOUND' : 'OUTBOUND';
  const projectKey = draftProjectId || (draftProjectCode ? `code:${draftProjectCode}` : '');
  return projectKey && draftReportDate ? `${draftType}|${projectKey}|${draftReportDate.slice(0, 10)}` : '';
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
  const hydratedReturnItemsKeyRef = useRef('');
  const isSubmittingRef = useRef(false);
  const [romaneioType, setRomaneioType] = useState<RomaneioType>('OUTBOUND');
  const [projectId, setProjectId] = useState('');
  const [manualProjectMode, setManualProjectMode] = useState(false);
  const [manualProjectCode, setManualProjectCode] = useState('');
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
  const catalogQuery = useQuery({ queryKey: ['romaneio-catalog'], queryFn: listRomaneioCatalog, enabled: romaneioType === 'OUTBOUND' });
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
  const typedProjectCode = manualProjectCode.trim();
  const projectSelectValue = projectId || (manualProjectMode ? MANUAL_PROJECT_OPTION : '');
  const projectReferenceLabel = selectedProject
    ? projectLabel(selectedProject)
    : typedProjectCode
      ? `Missão ${typedProjectCode}`
      : '-';
  const returnItemsQuery = useQuery({
    queryKey: ['romaneio-return-items', { projectId, projectCode: typedProjectCode, editId }],
    queryFn: () => listRomaneioReturnItems({
      projectId: projectId || null,
      projectCode: typedProjectCode || null,
      excludeRomaneioId: editId || null
    }),
    enabled: romaneioType === 'INBOUND' && Boolean(projectId || typedProjectCode)
  });

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

  function clearSelectedItemsForContextChange() {
    setSelectedItems([]);
    setQuantities({});
    hydratedReturnItemsKeyRef.current = '';
  }

  function handleRomaneioTypeChange(nextType: RomaneioType) {
    if (nextType === romaneioType) return;
    setRomaneioType(nextType);
    clearSelectedItemsForContextChange();
  }

  function updateSelectedItemQuantity(key: string, quantityText: string) {
    const quantity = Number(quantityText);
    setSelectedItems(current => current.map(item => {
      if (item.key !== key) return item;
      return {
        ...item,
        quantity: Number.isFinite(quantity) ? quantity : 0
      };
    }));
  }

  function addCatalogItem(item: RomaneioCatalogItem) {
    const variableQuantity = romaneioUsesVariableQuantity(item.measureType);
    const quantity = Number(quantities[item.id] || (variableQuantity ? '' : item.isSerialized ? 1 : ''));
    if (!quantity || quantity <= 0) {
      showToast('Informe a quantidade do item.');
      return;
    }
    if (!variableQuantity && item.isSerialized && selectedItems.some(selected => selected.catalogItemId === item.id)) {
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
      unitLabel: item.defaultUnitLabel || defaultRomaneioUnit(item.measureType),
      isCustom: false
    };
    setSelectedItems(current => {
      const existing = current.find(selected => selected.catalogItemId === item.id);
      if (!existing) return [...current, next];
      return current.map(selected => selected.catalogItemId === item.id
        ? { ...selected, quantity, unitLabel: item.defaultUnitLabel || defaultRomaneioUnit(item.measureType) }
        : selected
      );
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
      unitLabel: custom.unitLabel || defaultRomaneioUnit(custom.measureType),
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

  const currentDraftKey = useCallback(() => {
    const projectKey = projectId || (typedProjectCode ? `code:${typedProjectCode.toUpperCase()}` : '');
    return projectKey && romaneioDate ? `${romaneioType}|${projectKey}|${romaneioDate.slice(0, 10)}` : '';
  }, [projectId, romaneioDate, romaneioType, typedProjectCode]);

  const matchingDraftIds = useCallback(() => {
    const key = currentDraftKey();
    if (!key) return [];
    return (draftsQuery.data || []).filter(draft => draftProjectDateKey(draft) === key).map(draft => draft.id);
  }, [currentDraftKey, draftsQuery.data]);

  const buildDraftPayload = useCallback((): RomaneioDraftPayload => {
    return {
      projectId: projectId || null,
      projectCode: typedProjectCode || null,
      reportDate: romaneioDate,
      title: selectedProject
        ? `Romaneio de ${romaneioTypeLabel(romaneioType).toLowerCase()} - ${projectLabel(selectedProject)}`
        : typedProjectCode
          ? `Romaneio de ${romaneioTypeLabel(romaneioType).toLowerCase()} - ${typedProjectCode}`
          : 'Romaneio em andamento',
      payload: {
        __module: 'romaneio',
        romaneioType,
        projectId,
        projectCode: typedProjectCode,
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
  }, [
    cargoWeight,
    cargoWeightUnit,
    custom,
    driverName,
    projectId,
    quantities,
    romaneioDate,
    romaneioType,
    selectedItems,
    selectedProject,
    typedProjectCode,
    vehiclePlate
  ]);

  const hydrateDraft = useCallback((draft: { id: string; projectId?: string | null; reportDate?: string | null; payload?: Record<string, unknown> }) => {
    const payload = draft.payload || {};
    const nextProjectId = typeof payload.projectId === 'string' ? payload.projectId : draft.projectId || '';
    const nextProjectCode = typeof payload.projectCode === 'string' ? numericProjectCode(payload.projectCode) : '';
    const nextDate = typeof payload.romaneioDate === 'string'
      ? payload.romaneioDate
      : typeof payload.reportDate === 'string'
        ? payload.reportDate
        : draft.reportDate || today;

    setDraftId(draft.id);
    const nextType = payload.romaneioType === 'INBOUND' ? 'INBOUND' : 'OUTBOUND';
    setRomaneioType(nextType);
    setProjectId(nextProjectId);
    setManualProjectMode(!nextProjectId && Boolean(nextProjectCode));
    setManualProjectCode(nextProjectId ? '' : nextProjectCode);
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
    const nextProjectKey = nextProjectId || (nextProjectCode.trim() ? `code:${nextProjectCode.trim().toUpperCase()}` : '');
    hydratedDraftKeyRef.current = nextProjectKey && nextDate ? `${nextType}|${nextProjectKey}|${nextDate.slice(0, 10)}` : '';
  }, []);

  useEffect(() => {
    if (isEditing || !draftParam || !draftsQuery.data?.length) return;
    if (draftId === draftParam) return;
    const draft = draftsQuery.data.find(item => item.id === draftParam);
    if (!draft) return;
    hydrateDraft(draft);
    showToast('Rascunho carregado.');
  }, [isEditing, draftParam, draftsQuery.data, draftId, hydrateDraft, showToast]);

  useEffect(() => {
    const romaneio = editQuery.data;
    if (!romaneio || !isEditing) return;
    setRomaneioType(romaneio.type || 'OUTBOUND');
    setProjectId(romaneio.projectId);
    setManualProjectMode(false);
    setManualProjectCode('');
    setRomaneioDate(romaneio.romaneioDate.slice(0, 10));
    setDriverName(romaneio.driverName || '');
    setVehiclePlate(romaneio.vehiclePlate || '');
    setCargoWeight(romaneio.cargoWeight == null ? '' : String(romaneio.cargoWeight));
    setCargoWeightUnit(romaneio.cargoWeightUnit === 'ton' ? 'ton' : 'kg');
    setSelectedItems(romaneioItemsToSelectedItems(romaneio));
    setDraftId(null);
  }, [editQuery.data, isEditing]);

  useEffect(() => {
    if (romaneioType !== 'INBOUND') return;
    const returnItems = returnItemsQuery.data?.items || [];
    const hydrationKey = [
      projectId || '',
      typedProjectCode || '',
      editId || '',
      returnItems.map(item => `${item.key}:${item.maxQuantity}`).join(',')
    ].join('|');
    if (!returnItemsQuery.data || hydratedReturnItemsKeyRef.current === hydrationKey) return;
    hydratedReturnItemsKeyRef.current = hydrationKey;

    if (isEditing) {
      const maxByKey = new Map(returnItems.map(item => [item.key, Number(item.maxQuantity)]));
      setSelectedItems(current => current.map(item => {
        const maxQuantity = maxByKey.get(selectedItemReturnKey(item));
        return maxQuantity == null ? item : { ...item, returnMaxQuantity: maxQuantity };
      }));
      return;
    }

    setSelectedItems(returnItemsToSelectedItems(returnItems));
    setQuantities({});
  }, [romaneioType, returnItemsQuery.data, projectId, typedProjectCode, editId, isEditing]);

  useEffect(() => {
    if (isEditing || draftParam || draftId) return;
    const key = currentDraftKey();
    if (!key || hydratedDraftKeyRef.current === key) return;
    const draft = (draftsQuery.data || []).find(item => draftProjectDateKey(item) === key);
    hydratedDraftKeyRef.current = key;
    if (!draft) return;

    hydrateDraft(draft);
    showToast('Rascunho carregado.');
  }, [isEditing, romaneioType, projectId, manualProjectCode, romaneioDate, draftsQuery.data, draftParam, draftId, currentDraftKey, hydrateDraft, showToast]);

  useEffect(() => {
    if (isEditing) return;
    if (isSubmittingRef.current) return;
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);

    if ((!projectId && !typedProjectCode) || !romaneioDate) {
      return;
    }

    draftSaveTimerRef.current = window.setTimeout(() => {
      const payload = buildDraftPayload();
      const sameProjectDateIds = matchingDraftIds();
      const targetId = autosaveDraftTargetId(draftId, sameProjectDateIds);
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
    romaneioType,
    manualProjectCode,
    typedProjectCode,
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
    buildDraftPayload,
    matchingDraftIds,
    queryClient,
    isEditing
  ]);

  function selectedItemsPayload() {
    return selectedItems.filter(item => Number(item.quantity) > 0).map(item => ({
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
    if (!projectId && !typedProjectCode) {
      showToast('Selecione o projeto ou informe o código da missão.');
      return false;
    }
    if (!romaneioDate || !driverName.trim() || !vehiclePlate.trim()) {
      showToast('Preencha os dados do cabeçalho.');
      return false;
    }
    if (cargoWeight && Number(cargoWeight) <= 0) {
      showToast('Informe um peso de carga válido.');
      return false;
    }
    const payloadItems = selectedItemsPayload();
    if (!payloadItems.length) {
      showToast('Adicione ao menos um item.');
      return false;
    }
    if (romaneioType === 'INBOUND') {
      if (returnItemsQuery.isFetching) {
        showToast('Aguarde carregar os itens da saída.');
        return false;
      }
      const invalidItem = selectedItems.find(item => {
        const maxQuantity = item.returnMaxQuantity;
        return maxQuantity != null && Number(item.quantity) - maxQuantity > 0.0005;
      });
      if (invalidItem) {
        showToast('A quantidade de entrada não pode ser maior que a saída.');
        return false;
      }
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
        projectId: projectId || null,
        projectCode: typedProjectCode || null,
        type: romaneioType,
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
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
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
        title={isEditing ? `Editar romaneio de ${romaneioTypeLabel(romaneioType).toLowerCase()}` : `Novo romaneio de ${romaneioTypeLabel(romaneioType).toLowerCase()}`}
        subtitle={romaneioType === 'INBOUND' ? 'Retorno de equipamentos e consumíveis' : 'Formulário de equipamentos'}
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
            <label className="field-group">
              <span>Tipo</span>
              <select value={romaneioType} onChange={event => handleRomaneioTypeChange(event.target.value as RomaneioType)}>
                <option value="OUTBOUND">Saída</option>
                <option value="INBOUND">Entrada</option>
              </select>
            </label>
            <label className="field-group field-group-wide">
              <span>Projeto</span>
              <select value={projectSelectValue} onChange={event => {
                const value = event.target.value;
                if (value === MANUAL_PROJECT_OPTION) {
                  setProjectId('');
                  setManualProjectMode(true);
                  if (romaneioType === 'INBOUND') clearSelectedItemsForContextChange();
                  return;
                }
                setProjectId(value);
                setManualProjectMode(false);
                setManualProjectCode('');
                if (romaneioType === 'INBOUND') clearSelectedItemsForContextChange();
              }}>
                <option value="">Selecione</option>
                {projectOptions.map(project => (
                  <option key={project.id} value={project.id}>{projectLabel(project)}</option>
                ))}
                <option value={MANUAL_PROJECT_OPTION}>Não encontrei a missão na lista</option>
              </select>
            </label>
            {manualProjectMode ? (
              <label className="field-group">
                <span>Código da missão</span>
                <input
                  value={manualProjectCode}
                  onChange={event => {
                    const nextCode = numericProjectCode(event.target.value);
                    setManualProjectCode(nextCode);
                    if (nextCode) setProjectId('');
                    if (romaneioType === 'INBOUND') clearSelectedItemsForContextChange();
                  }}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Digite apenas números"
                />
                {romaneioType === 'OUTBOUND' && (
                  <small className="form-hint">
                    Ao enviar, a missão será criada como cadastro pendente para revisão do gestor.
                  </small>
                )}
              </label>
            ) : null}
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
              <div className="sec">{romaneioType === 'INBOUND' ? 'Itens retornando' : 'Itens selecionados'}</div>
              <div className="rel-meta">{selectedItems.length} item(ns)</div>
            </div>
          </div>
          {!selectedItems.length && (
            <div className="rel-meta">
              {romaneioType === 'INBOUND'
                ? (returnItemsQuery.isLoading ? 'Carregando itens da saída...' : 'Nenhum item de saída disponível para retorno.')
                : 'Nenhum item adicionado.'}
            </div>
          )}
          <div className="romaneio-selected-list">
            {selectedItems.map(item => (
              <div className="romaneio-selected-row" key={item.key}>
                <div>
                  <strong>{[item.itemCode, item.itemName].filter(Boolean).join(' - ')}</strong>
                  <div className="rel-meta">
                    {item.categoryName} · {item.quantity} {item.unitLabel}
                    {romaneioType === 'INBOUND' && item.returnMaxQuantity != null ? ` de ${item.returnMaxQuantity} ${item.unitLabel}` : ''}
                  </div>
                </div>
                <div className="romaneio-selected-actions">
                  {romaneioType === 'INBOUND' && (
                    <input
                      type="number"
                      min="0"
                      max={item.returnMaxQuantity}
                      step={romaneioUsesVariableQuantity(item.measureType) ? '0.1' : '1'}
                      value={item.quantity}
                      onChange={event => updateSelectedItemQuantity(item.key, event.target.value)}
                    />
                  )}
                  <button className="mini-btn danger" type="button" onClick={() => setSelectedItems(current => current.filter(selected => selected.key !== item.key))}>Remover</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {romaneioType === 'OUTBOUND' && <section className="page-card romaneio-panel">
          <div className="admin-toolbar">
            <div className="sec">Materiais disponíveis</div>
          </div>
          <label className="field-group">
            <span>Pesquisar item</span>
            <SearchBar value={catalogSearch} onChange={setCatalogSearch} placeholder="Código, item ou categoria" />
          </label>
        </section>}

        {romaneioType === 'OUTBOUND' && catalogQuery.isLoading && <section className="page-card romaneio-panel">Carregando catálogo...</section>}
        {romaneioType === 'OUTBOUND' && !catalogQuery.isLoading && !groupedCatalog.length && (
          <section className="page-card romaneio-panel">Nenhum item encontrado.</section>
        )}
        {romaneioType === 'OUTBOUND' && !!groupedCatalog.length && (
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
                          const variableQuantity = romaneioUsesVariableQuantity(item.measureType);
                          const disabled = !variableQuantity && item.isSerialized && selectedItems.some(selected => selected.catalogItemId === item.id);
                          const showQuantityInput = variableQuantity || !item.isSerialized;
                          return (
                            <div className="romaneio-catalog-row" key={item.id}>
                              <div>
                                <strong>{itemLabel(item)}</strong>
                                <div className="rel-meta">{item.kind === 'CONNECTION' ? 'Conexão' : 'Equipamento'} · {romaneioMeasureLabel(item.measureType)}</div>
                              </div>
                              <div className="romaneio-add-control">
                                {showQuantityInput && (
                                  <input
                                    type="number"
                                    min="0"
                                    step={variableQuantity ? '0.1' : '1'}
                                    value={quantities[item.id] || ''}
                                    onChange={event => setQuantities(current => ({ ...current, [item.id]: event.target.value }))}
                                    placeholder={item.defaultUnitLabel || defaultRomaneioUnit(item.measureType)}
                                  />
                                )}
                                {showQuantityInput ? (
                                  <span className="rel-meta">{item.defaultUnitLabel || defaultRomaneioUnit(item.measureType)}</span>
                                ) : null}
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

        {romaneioType === 'OUTBOUND' && <section className="page-card romaneio-panel">
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
                setCustom({ ...custom, measureType, unitLabel: defaultRomaneioUnit(measureType) });
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
        </section>}

        <section className="bottom-bar-react">
          <button className="primary-button" type="submit" disabled={saveMutation.isPending || (isEditing && editQuery.isLoading)}>
            {isEditing ? 'Salvar alterações' : `Enviar ${romaneioTypeLabel(romaneioType).toLowerCase()}`}
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
        <div className="section-title" id="romaneio-review-title">Revisar romaneio de {romaneioTypeLabel(romaneioType).toLowerCase()}</div>
        <p className="placeholder-copy" id="romaneio-review-description">
          Confira os itens adicionados antes de confirmar o envio.
        </p>
        <div className="det-section">
          <div className="det-row">
            <span className="det-label">Projeto</span>
            <span className="det-val">{projectReferenceLabel}</span>
          </div>
          <div className="det-row"><span className="det-label">Tipo</span><span className="det-val">{romaneioTypeLabel(romaneioType)}</span></div>
          <div className="det-row"><span className="det-label">Data</span><span className="det-val">{romaneioDate}</span></div>
          <div className="det-row"><span className="det-label">Motorista</span><span className="det-val">{driverName || '-'}</span></div>
          <div className="det-row"><span className="det-label">Placa</span><span className="det-val">{vehiclePlate || '-'}</span></div>
          <div className="det-row"><span className="det-label">Peso da carga</span><span className="det-val">{cargoWeight ? `${cargoWeight} ${cargoWeightUnit}` : '-'}</span></div>
        </div>
        <div className="romaneio-review-list" aria-label="Itens adicionados ao romaneio">
          {selectedItems.filter(item => Number(item.quantity) > 0).map(item => (
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
            {isEditing ? 'Confirmar alterações' : `Confirmar ${romaneioTypeLabel(romaneioType).toLowerCase()}`}
          </button>
        </div>
      </Modal>
    </Shell>
  );
}
