import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { Alert, Badge, Button, EmptyState, Input, Select, Skeleton, Switch } from '../../components/ui/ds';
import { PageHeader } from '../../layout/PageHeader';
import { OperationalModuleAppShell } from '../OperationalModuleAppShell';

import {
  archiveEpiRecords,
  createEpiCatalogItem,
  createEpiRecord,
  downloadEpiCollaboratorPdf,
  effectiveEpiRole,
  listEpiCatalog,
  listEpiCollaborators,
  listEpiJobRoles,
  removeEpiCatalogItem,
  removeEpiRecord,
  requestEpiSignature,
  updateEpiCatalogItem,
  updateEpiCollaboratorProfile,
  updateEpiRecord,
  type CreateEpiRecordPayload,
  type EpiCatalogItem,
  type EpiCollaborator,
  type EpiRecord,
  type EpiRecordPayload
} from '../../api/epi';

import { useAuth } from '../../auth/AuthContext';
import { Modal } from '../../components/ui/Modal';
import { SearchBar } from '../../components/ui/SearchBar';
import { SearchCombobox } from '../../components/ui/SearchCombobox';
import { useToast } from '../../components/ui/ToastContext';
import { useConfirmDialog } from '../../components/ui/useConfirmDialog';
import { downloadBlob } from '../../utils/download';
import { useUrlParamState } from '../../hooks/useUrlParamState';
import './EpiPage.ds.css';

type Tab = 'collaborators' | 'catalog';
type RecordTab = 'active' | 'archived';
const TABS: Tab[] = ['collaborators', 'catalog'];
const DEFAULT_EPI_SIZES = ['P', 'M', 'G', 'GG', 'XG', 'Especial'];
type CatalogSizeSettings = { hasSizes: boolean; sizes: string[] };
type CatalogForm = CatalogSizeSettings & { name: string; ca: string };

function emptyCatalogSizes(): CatalogSizeSettings {
  return { hasSizes: false, sizes: [...DEFAULT_EPI_SIZES] };
}

function emptyCatalogForm(): CatalogForm {
  return { name: '', ca: '', ...emptyCatalogSizes() };
}

function CatalogSizesToggle<T extends CatalogSizeSettings>({ value, onChange }: {
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <Switch
      containerClassName="epi-catalog-size-toggle"
      label="Este EPI possui tamanhos"
      checked={value.hasSizes}
      onChange={event => onChange({ ...value, hasSizes: event.target.checked, sizes: value.sizes.length ? value.sizes : [...DEFAULT_EPI_SIZES] })}
    />
  );
}

function CatalogSizes<T extends CatalogSizeSettings>({ id, value, onChange }: {
  id: string;
  value: T;
  onChange: (next: T) => void;
}) {
  const [newSize, setNewSize] = useState('');
  const [error, setError] = useState('');

  function addSize() {
    const size = newSize.trim();
    if (!size) {
      setError('Informe o tamanho para acrescentar.');
      return;
    }
    if (value.sizes.some(option => option.toLocaleLowerCase('pt-BR') === size.toLocaleLowerCase('pt-BR'))) {
      setError('Este tamanho já está na lista.');
      return;
    }
    onChange({ ...value, sizes: [...value.sizes, size] });
    setNewSize('');
    setError('');
  }

  if (!value.hasSizes) return null;

  return (
    <div className="epi-catalog-sizes">
      <fieldset className="epi-size-options">
        <legend>Tamanhos disponíveis</legend>
        <small>Ao lançar este item na ficha, será obrigatório escolher um tamanho.</small>
        <div className="epi-size-chips">
          {value.sizes.map(size => (
            <span className="epi-size-chip" key={size}>
              {size}
              <button type="button" aria-label={`Remover tamanho ${size}`} onClick={() => onChange({ ...value, sizes: value.sizes.filter(option => option !== size) })}>×</button>
            </span>
          ))}
        </div>
        {!value.sizes.length ? <small>Acrescente ao menos um tamanho antes de salvar.</small> : null}
        <div className="epi-size-add">
          <div className="field-group">
            <label htmlFor={`${id}-new-size`}>Novo tamanho</label>
            <Input
              id={`${id}-new-size`}
              size="sm"
              value={newSize}
              maxLength={40}
              placeholder="Ex.: 42, Único, XXG"
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-size-error` : undefined}
              onChange={event => { setNewSize(event.target.value); setError(''); }}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); addSize(); }
              }}
            />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={addSize}>Acrescentar tamanho</Button>
        </div>
        {error ? <small id={`${id}-size-error`} role="alert">{error}</small> : null}
      </fieldset>
    </div>
  );
}

function parseEpiTab(value: string | null): Tab {
  return TABS.includes(value as Tab) ? value as Tab : 'collaborators';
}

type RemoveDialogState =
  | { kind: 'record'; id: string; title: string; description: string }
  | { kind: 'catalog'; id: string; title: string; description: string };

const emptyRecord: EpiRecordPayload = {
  catalogItemId: null,
  epiName: '',
  ca: '',
  size: null,
  quantity: 1,
  lendDate: todayInputDate(),
  devolutionDate: ''
};

function dateInput(value?: string | null) {
  if (!value) return '';
  const text = String(value);
  const ptBr = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ptBr) return `${ptBr[3]}-${ptBr[2]}-${ptBr[1]}`;
  return text.slice(0, 10);
}

function inputDateToPtBr(value?: string | null) {
  if (!value) return null;
  const text = String(value);
  const input = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (input) return `${input[3]}/${input[2]}/${input[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return text;
  return text;
}

function todayInputDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const input = dateInput(value);
  const ptBr = inputDateToPtBr(input);
  return ptBr || '-';
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function formatCpfInput(value: string) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function isValidCpf(value: string) {
  const digits = onlyDigits(value);
  if (!digits) return true;
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const numbers = digits.split('').map(Number);
  const calc = (length: number) => {
    const sum = numbers.slice(0, length).reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  return calc(9) === numbers[9] && calc(10) === numbers[10];
}

function caLabel(ca?: string | null) {
  const value = String(ca || '').trim();
  return value ? `C.A ${value}` : 'C.A não informado';
}

function signedLabel(record: { signedAt?: string | null; signatureRequest?: { status: string } | null }) {
  if (record.signedAt) return 'Assinado';
  if (record.signatureRequest?.status === 'PENDING') return 'Solicitado';
  return 'Pendente';
}

function hasSignatureEvidence(record: { signedAt?: string | null; signatureImageDataUrl?: string | null }) {
  return !!(record.signedAt || record.signatureImageDataUrl);
}

export function EpiPage() {
  const { user } = useAuth();
  const showToast = useToast();
  const { confirm, confirmDialog } = useConfirmDialog('design-system');
  const queryClient = useQueryClient();
  const isTechnician = user?.accountType === 'ADMIN' || user?.moduleRoles?.includes('epi:technician');
  const [tab, setTab] = useUrlParamState<Tab>({
    param: 'tab',
    defaultValue: 'collaborators',
    parse: parseEpiTab
  });
  const subNavigation = useMemo(() => [
    { id: 'collaborators', label: 'Colaboradores', href: '/epi?tab=collaborators', active: tab === 'collaborators', onSelect: () => setTab('collaborators') },
    { id: 'catalog', label: 'Catálogo', href: '/epi?tab=catalog', active: tab === 'catalog', onSelect: () => setTab('catalog') }
  ], [setTab, tab]);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({ cpf: '', registrationNumber: '', admissionDate: '', roleOverrideJobRoleId: '' });
  const [recordForm, setRecordForm] = useState<EpiRecordPayload>(emptyRecord);
  const [newRecordSizes, setNewRecordSizes] = useState<CatalogSizeSettings>(emptyCatalogSizes);
  const [recordTab, setRecordTab] = useState<RecordTab>('active');
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(() => new Set());
  const [selectedArchivedRecordIds, setSelectedArchivedRecordIds] = useState<Set<string>>(() => new Set());
  const [lastSignUrl, setLastSignUrl] = useState('');
  const [catalogForm, setCatalogForm] = useState<CatalogForm>(emptyCatalogForm);
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [editCatalogForm, setEditCatalogForm] = useState<CatalogForm>(emptyCatalogForm);
  const [removeDialog, setRemoveDialog] = useState<RemoveDialogState | null>(null);

  const collaboratorsQuery = useQuery({ queryKey: ['epi-collaborators'], queryFn: listEpiCollaborators });
  const catalogQuery = useQuery({ queryKey: ['epi-catalog'], queryFn: listEpiCatalog });
  const catalogOptions = useMemo(() => [
    { value: '', label: 'Novo EPI' },
    ...(catalogQuery.data || []).map(item => ({ value: item.id, label: `${item.name} · ${caLabel(item.ca)}` }))
  ], [catalogQuery.data]);
  const selectedCatalogItem = (catalogQuery.data || []).find(item => item.id === recordForm.catalogItemId);
  const recordSizeSettings = selectedCatalogItem || newRecordSizes;
  const jobRolesQuery = useQuery({
    queryKey: ['epi-job-roles'],
    queryFn: listEpiJobRoles,
    enabled: isTechnician
  });

  const expandedCollaborator = useMemo(
    () => (collaboratorsQuery.data || []).find(item => item.id === expandedId) || null,
    [collaboratorsQuery.data, expandedId]
  );

  const visibleCollaborators = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (collaboratorsQuery.data || []).filter(item => {
      if (!query) return true;
      return [item.name, item.code, effectiveEpiRole(item), item.cpf, item.registrationNumber]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query));
    });
  }, [collaboratorsQuery.data, search]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['epi-collaborators'] });
    queryClient.invalidateQueries({ queryKey: ['epi-catalog'] });
  }

  const saveProfileMutation = useMutation({
    mutationFn: (collaboratorId: string) => updateEpiCollaboratorProfile(collaboratorId, {
      ...profileForm,
      admissionDate: inputDateToPtBr(profileForm.admissionDate),
      roleOverrideJobRoleId: profileForm.roleOverrideJobRoleId || null
    }),
    onSuccess: () => {
      invalidate();
      setEditingProfileId(null);
      showToast('Dados do colaborador atualizados.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
  });

  const createRecordMutation = useMutation({
    mutationFn: ({ collaboratorId, payload }: { collaboratorId: string; payload: CreateEpiRecordPayload }) => createEpiRecord(collaboratorId, payload),
    onSuccess: () => {
      invalidate();
      setRecordForm(emptyRecord);
      setNewRecordSizes(emptyCatalogSizes());
      showToast('EPI adicionado.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível adicionar o EPI.', 'error')
  });

  const returnRecordMutation = useMutation({
    mutationFn: async ({ id }: { collaboratorId: string; id: string }) => {
      const result = await updateEpiRecord(id, { devolutionDate: inputDateToPtBr(todayInputDate()) });
      if ('signUrl' in result) return result;
      return requestEpiSignature(result.collaboratorId, [result.id]);
    },
    onSuccess: data => {
      invalidate();
      setSelectedRecordIds(new Set());
      setLastSignUrl(data.signUrl);
      showToast('Devolução registrada. Link de assinatura gerado.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível registrar a devolução.', 'error')
  });

  const removeRecordMutation = useMutation({
    mutationFn: removeEpiRecord,
    onSuccess: () => {
      invalidate();
      showToast('EPI removido.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível remover o EPI.', 'error')
  });

  const archiveRecordsMutation = useMutation({
    mutationFn: ({ collaboratorId, recordIds, archived }: { collaboratorId: string; recordIds: string[]; archived: boolean }) => archiveEpiRecords(collaboratorId, recordIds, archived),
    onSuccess: (_data, variables) => {
      invalidate();
      setSelectedRecordIds(new Set());
      setSelectedArchivedRecordIds(new Set());
      showToast(variables.archived ? 'EPI(s) arquivado(s).' : 'EPI(s) restaurado(s).', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível arquivar o(s) EPI(s).', 'error')
  });

  const requestSignatureMutation = useMutation({
    mutationFn: (collaboratorId: string) => requestEpiSignature(collaboratorId, Array.from(selectedRecordIds)),
    onSuccess: data => {
      invalidate();
      setLastSignUrl(data.signUrl);
      setSelectedRecordIds(new Set());
      navigator.clipboard?.writeText(data.signUrl).catch(() => {});
      showToast('Link de assinatura gerado.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível solicitar assinatura.', 'error')
  });

  const saveCatalogMutation = useMutation({
    mutationFn: () => createEpiCatalogItem({ ...catalogForm, sizes: catalogForm.hasSizes ? catalogForm.sizes : [], isActive: true }),
    onSuccess: () => {
      invalidate();
      setCatalogForm(emptyCatalogForm());
      showToast('EPI salvo no catálogo.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar o EPI.', 'error')
  });

  const updateCatalogMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CatalogForm }) => updateEpiCatalogItem(id, { ...payload, sizes: payload.hasSizes ? payload.sizes : [] }),
    onSuccess: () => {
      invalidate();
      setEditingCatalogId(null);
      showToast('EPI atualizado.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível atualizar o EPI.', 'error')
  });

  const removeCatalogMutation = useMutation({
    mutationFn: removeEpiCatalogItem,
    onSuccess: () => {
      invalidate();
      showToast('EPI removido.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível remover o EPI.', 'error')
  });

  function openCollaborator(collaborator: EpiCollaborator) {
    const isSame = expandedId === collaborator.id;
    setExpandedId(isSame ? null : collaborator.id);
    setEditingProfileId(null);
    setLastSignUrl('');
    setSelectedRecordIds(new Set());
    setSelectedArchivedRecordIds(new Set());
    if (!isSame) {
      setRecordTab('active');
      setProfileForm({
        cpf: formatCpfInput(collaborator.cpf || ''),
        registrationNumber: collaborator.registrationNumber || '',
        admissionDate: dateInput(collaborator.admissionDate),
        roleOverrideJobRoleId: collaborator.roleOverrideJobRole?.id || ''
      });
      setRecordForm(emptyRecord);
      setNewRecordSizes(emptyCatalogSizes());
    }
  }

  function selectCatalog(id: string) {
    setNewRecordSizes(emptyCatalogSizes());
    const item = (catalogQuery.data || []).find(catalog => catalog.id === id);
    setRecordForm(current => ({
      ...current,
      catalogItemId: item?.id || null,
      epiName: item?.name || current.epiName,
      ca: item ? item.ca || '' : current.ca,
      size: null
    }));
  }

  function changeRecordIdentity(field: 'epiName' | 'ca', value: string) {
    if (recordForm.catalogItemId) setNewRecordSizes(emptyCatalogSizes());
    setRecordForm(current => ({ ...current, [field]: value, catalogItemId: null, size: null }));
  }

  function changeNewRecordSizes(next: CatalogSizeSettings) {
    setNewRecordSizes(next);
    setRecordForm(current => ({ ...current, size: next.hasSizes && next.sizes.includes(current.size || '') ? current.size : null }));
  }

  function saveProfile(collaboratorId: string) {
    if (!isValidCpf(profileForm.cpf)) {
      showToast('CPF inválido.', 'error');
      return;
    }
    saveProfileMutation.mutate(collaboratorId);
  }

  function startProfileEdit(collaborator: EpiCollaborator) {
    setProfileForm({
      cpf: formatCpfInput(collaborator.cpf || ''),
      registrationNumber: collaborator.registrationNumber || '',
      admissionDate: dateInput(collaborator.admissionDate),
      roleOverrideJobRoleId: collaborator.roleOverrideJobRole?.id || ''
    });
    setEditingProfileId(collaborator.id);
  }

  function toggleRecord(recordId: string) {
    setSelectedRecordIds(current => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  function toggleArchivedRecord(recordId: string) {
    setSelectedArchivedRecordIds(current => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  function submitRecord(event: FormEvent) {
    event.preventDefault();
    if (!expandedCollaborator) return;
    if (!recordForm.catalogItemId && !validateCatalogSizes(newRecordSizes)) return;
    if (recordSizeSettings.hasSizes && !recordSizeSettings.sizes.includes(recordForm.size || '')) {
      showToast('Selecione um tamanho disponível para este EPI.', 'error');
      return;
    }
    const payload = {
      ...recordForm,
      catalogItemId: recordForm.catalogItemId || null,
      epiName: recordForm.epiName.trim(),
      ca: String(recordForm.ca || '').trim(),
      size: recordSizeSettings.hasSizes ? recordForm.size : null,
      ...(!recordForm.catalogItemId ? { newCatalogItem: {
        hasSizes: newRecordSizes.hasSizes,
        sizes: newRecordSizes.hasSizes ? newRecordSizes.sizes : []
      } } : {}),
      quantity: Number(recordForm.quantity) || 1,
      lendDate: inputDateToPtBr(recordForm.lendDate) || '',
      devolutionDate: inputDateToPtBr(recordForm.devolutionDate)
    };
    if (!payload.epiName) {
      showToast('Informe o nome do EPI.', 'error');
      return;
    }
    createRecordMutation.mutate({ collaboratorId: expandedCollaborator.id, payload });
  }

  async function downloadPdf(collaborator: EpiCollaborator, archived = false) {
    try {
      const blob = await downloadEpiCollaboratorPdf(collaborator.id, { archived });
      const suffix = archived ? ' - Arquivados' : '';
      downloadBlob(blob, `Ficha de Controle de EPIs${suffix} - ${collaborator.name}.pdf`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível baixar o PDF.', 'error');
    }
  }

  function editCatalog(item: EpiCatalogItem) {
    setEditingCatalogId(item.id);
    setEditCatalogForm({ name: item.name, ca: item.ca || '', hasSizes: !!item.hasSizes, sizes: item.sizes?.length ? [...item.sizes] : [...DEFAULT_EPI_SIZES] });
  }

  function validateCatalogSizes(form: CatalogSizeSettings) {
    if (form.hasSizes && !form.sizes.length) {
      showToast('Acrescente ao menos um tamanho disponível.', 'error');
      return false;
    }
    return true;
  }

  function confirmRemoveRecord(record: EpiRecord) {
    const description = `${record.epiName} (${caLabel(record.ca)}${record.size ? ` · Tam. ${record.size}` : ''})`;
    setRemoveDialog({
      kind: 'record',
      id: record.id,
      title: 'Remover EPI da ficha',
      description
    });
  }

  function confirmRemoveCatalog(item: EpiCatalogItem) {
    const description = `${item.name} (${caLabel(item.ca)})`;
    setRemoveDialog({
      kind: 'catalog',
      id: item.id,
      title: 'Remover EPI do catálogo',
      description
    });
  }

  function removeDialogDescription() {
    if (!removeDialog) return '';
    if (removeDialog.kind === 'record') return 'Este EPI será removido da ficha do colaborador.';
    return 'Este EPI deixará de aparecer no catálogo para novos lançamentos.';
  }

  function confirmRemoveDialog() {
    if (!removeDialog) return;
    const current = removeDialog;
    setRemoveDialog(null);
    if (current.kind === 'record') removeRecordMutation.mutate(current.id);
    else removeCatalogMutation.mutate(current.id);
  }

  async function confirmArchiveRecords(collaborator: EpiCollaborator, records: EpiRecord[], archived = true) {
    const selectedIds = archived ? selectedRecordIds : selectedArchivedRecordIds;
    const selected = records.filter(record => selectedIds.has(record.id));
    if (!selected.length) {
      showToast('Selecione ao menos um EPI.', 'error');
      return;
    }
    if (!archived && selected.some(record => record.signedAt)) {
      showToast('EPI assinado não pode ser restaurado.', 'error');
      return;
    }
    const confirmed = await confirm({
      title: archived ? 'Arquivar EPIs selecionados?' : 'Restaurar EPIs selecionados?',
      description: archived
        ? 'Os registros saem da ficha ativa do colaborador e passam a aparecer apenas entre os arquivados.'
        : 'Os registros voltam a aparecer na ficha ativa do colaborador.',
      highlight: `${selected.length} EPI(s) · ${collaborator.name}`,
      confirmLabel: archived ? 'Arquivar' : 'Restaurar',
      danger: archived
    });
    if (!confirmed) return;
    archiveRecordsMutation.mutate({
      collaboratorId: collaborator.id,
      recordIds: selected.map(record => record.id),
      archived
    });
  }

  return (
    <OperationalModuleAppShell moduleId="epi" title="EPI" sectionLabel={tab === 'catalog' ? 'Catálogo' : 'Colaboradores'} subNavigation={subNavigation}>
      <main className="epi-page-v2 fv-ds">
        <PageHeader title={tab === 'catalog' ? 'Catálogo de EPIs' : 'Fichas por colaborador'} description={tab === 'catalog' ? 'Gerencie os equipamentos de proteção disponíveis.' : 'Consulte entregas, devoluções e assinaturas das fichas.'} />

        {tab === 'collaborators' ? (
          <>
            <section className="page-card epi-panel">
              <div className="field-group">
                <label htmlFor="epi-search">Buscar colaborador</label>
                <SearchBar
                  id="epi-search"
                  value={search}
                  onChange={setSearch}
                  placeholder="Nome, código ou cargo"
                  count={{ shown: visibleCollaborators.length, total: (collaboratorsQuery.data || []).length }}
                />
              </div>
            </section>

            {collaboratorsQuery.isLoading ? <Skeleton variant="card" label="Carregando colaboradores…" /> : null}
            {collaboratorsQuery.isError ? <Alert tone="danger" action={{ label: 'Tentar novamente', onClick: () => void collaboratorsQuery.refetch() }}>Não foi possível carregar os colaboradores.</Alert> : null}
            {!collaboratorsQuery.isLoading && !collaboratorsQuery.isError && !visibleCollaborators.length ? <EmptyState variant={search ? 'search' : 'default'} title={search ? 'Nenhum colaborador encontrado.' : 'Nenhum colaborador disponível.'} description={search ? 'Tente outro nome, código ou cargo.' : 'As fichas aparecerão quando houver colaboradores cadastrados.'} /> : null}

            {visibleCollaborators.map(collaborator => {
              const isOpen = expandedId === collaborator.id;
              const epiRoleOverrideIsInactive = Boolean(collaborator.roleOverrideJobRole)
                && !(jobRolesQuery.data || []).some(role => role.id === collaborator.roleOverrideJobRole?.id);
              const activeRecords = collaborator.epiRecords.filter(record => !record.archivedAt && !record.pendingReturn);
              const archivedRecords = collaborator.epiRecords.filter(record => record.archivedAt);
              const visibleRecords = recordTab === 'archived' ? archivedRecords : activeRecords;
              const selectedActiveRecords = activeRecords.filter(record => selectedRecordIds.has(record.id));
              const selectedArchivedRecords = archivedRecords.filter(record => selectedArchivedRecordIds.has(record.id));
              const selectedVisibleRecords = recordTab === 'archived' ? selectedArchivedRecords : selectedActiveRecords;
              const allVisibleRecordsSelected = visibleRecords.length > 0 && selectedVisibleRecords.length === visibleRecords.length;
              const hasSelectedSigned = selectedActiveRecords.some(record => record.signedAt);
              const hasSelectedActiveRequest = selectedActiveRecords.some(record =>
                record.signatureRequest?.status === 'PENDING'
                && new Date(record.signatureRequest.expiresAt).getTime() > Date.now()
              );
              const hasSelectedArchivedSigned = selectedArchivedRecords.some(record => record.signedAt);
              const unsigned = activeRecords.filter(record => !record.signedAt).length;
              return (
                <section className="page-card epi-collaborator-card" key={collaborator.id}>
                  <button className="epi-card-head" type="button" aria-expanded={isOpen} aria-controls={isOpen ? `epi-collaborator-${collaborator.id}` : undefined} onClick={() => openCollaborator(collaborator)}>
                    <span>
                      <strong>{collaborator.name}</strong>
                      <small>{collaborator.code} · {effectiveEpiRole(collaborator)}</small>
                    </span>
                    <span className="epi-card-count">{activeRecords.length} ativo(s) · {archivedRecords.length} arquivado(s) · {unsigned} pendente(s)</span>
                  </button>

                  {isOpen ? (
                    <div className="epi-card-body" id={`epi-collaborator-${collaborator.id}`}>
                      {editingProfileId === collaborator.id ? (
                        <div className="epi-profile-grid">
                          <div className="field-group epi-profile-role">
                            <label htmlFor={`epi-profile-role-${collaborator.id}`}>Cargo usado no EPI</label>
                            <Select
                              id={`epi-profile-role-${collaborator.id}`}
                              value={profileForm.roleOverrideJobRoleId}
                              onChange={event => setProfileForm(current => ({ ...current, roleOverrideJobRoleId: event.target.value }))}
                              disabled={!isTechnician || jobRolesQuery.isLoading}
                            >
                              <option value="">Usar cargo atual do APP — {collaborator.currentJobRole.name}</option>
                              {epiRoleOverrideIsInactive ? (
                                <option value={collaborator.roleOverrideJobRole?.id || ''}>{collaborator.roleOverrideJobRole?.name} (inativo)</option>
                              ) : null}
                              {(jobRolesQuery.data || []).map(role => (
                                <option key={role.id} value={role.id}>{role.name}{role.isActive ? '' : ' (inativo)'}</option>
                              ))}
                            </Select>
                            <small>O cargo escolhido vale para o EPI. O cargo atual no APP permanece {collaborator.currentJobRole.name}.</small>
                          </div>
                          <div className="field-group epi-profile-cpf">
                            <label htmlFor={`epi-profile-cpf-${collaborator.id}`}>CPF</label>
                            <Input
                              id={`epi-profile-cpf-${collaborator.id}`}
                              inputMode="numeric"
                              maxLength={14}
                              placeholder="000.000.000-00"
                              value={profileForm.cpf}
                              onChange={event => setProfileForm(current => ({ ...current, cpf: formatCpfInput(event.target.value) }))}
                              disabled={!isTechnician}
                            />
                          </div>
                          <div className="field-group epi-profile-registration">
                            <label htmlFor={`epi-profile-registration-${collaborator.id}`}>Matrícula</label>
                            <Input id={`epi-profile-registration-${collaborator.id}`} value={profileForm.registrationNumber} onChange={event => setProfileForm(current => ({ ...current, registrationNumber: event.target.value }))} disabled={!isTechnician} />
                          </div>
                          <div className="field-group epi-profile-admission">
                            <label htmlFor={`epi-profile-admission-${collaborator.id}`}>Data de admissão</label>
                            <Input id={`epi-profile-admission-${collaborator.id}`} type="date" value={profileForm.admissionDate} onChange={event => setProfileForm(current => ({ ...current, admissionDate: event.target.value }))} disabled={!isTechnician} />
                          </div>
                          {isTechnician ? (
                            <>
                              <Button variant="primary" className="epi-profile-save" onClick={() => saveProfile(collaborator.id)}>
                                Salvar dados
                              </Button>
                              <Button variant="secondary" className="epi-profile-cancel" onClick={() => setEditingProfileId(null)}>
                                Cancelar
                              </Button>
                            </>
                          ) : null}
                        </div>
                      ) : (
                        <div className="epi-profile-summary">
                          <div>
                            <span>Cargo no EPI <em className="epi-profile-role-status">{collaborator.roleOverrideJobRole ? 'Específico' : 'Sincronizado'}</em></span>
                            <strong>{effectiveEpiRole(collaborator)}</strong>
                            <small>{collaborator.roleOverrideJobRole ? `Cargo temporário para EPI · no APP: ${collaborator.currentJobRole.name}` : 'Usa o cargo atual do APP'}</small>
                          </div>
                          <div>
                            <span>CPF</span>
                            <strong>{collaborator.cpf || 'Não informado'}</strong>
                          </div>
                          <div>
                            <span>Matrícula</span>
                            <strong>{collaborator.registrationNumber || 'Não informado'}</strong>
                          </div>
                          <div>
                            <span>Admissão</span>
                            <strong>{formatDate(collaborator.admissionDate)}</strong>
                          </div>
                          {isTechnician ? (
                            <Button variant="secondary" size="sm" className="epi-profile-edit" onClick={() => startProfileEdit(collaborator)}>
                              Editar
                            </Button>
                          ) : null}
                        </div>
                      )}

                      {isTechnician ? (
                        <form className="epi-record-form" onSubmit={submitRecord}>
                          <SearchCombobox
                            id={`epi-record-catalog-${collaborator.id}`}
                            label="EPI cadastrado"
                            value={recordForm.catalogItemId || ''}
                            options={catalogOptions}
                            onChange={selectCatalog}
                            placeholder="Pesquise pelo nome ou CA"
                            emptyText="Nenhum EPI encontrado."
                            loading={catalogQuery.isLoading}
                            variant="select"
                            clearOnFocus
                            portal
                          />
                          <div className="field-group">
                            <label htmlFor={`epi-record-name-${collaborator.id}`}>Nome do EPI</label>
                            <Input id={`epi-record-name-${collaborator.id}`} value={recordForm.epiName} onChange={event => changeRecordIdentity('epiName', event.target.value)} required />
                          </div>
                          <div className="field-group">
                            <label htmlFor={`epi-record-ca-${collaborator.id}`}>C.A</label>
                            <Input id={`epi-record-ca-${collaborator.id}`} value={recordForm.ca || ''} onChange={event => changeRecordIdentity('ca', event.target.value)} />
                          </div>
                          {!recordForm.catalogItemId ? (
                            <div className="epi-record-catalog-options">
                              <CatalogSizesToggle value={newRecordSizes} onChange={changeNewRecordSizes} />
                              {newRecordSizes.hasSizes ? <CatalogSizes id={`epi-record-${collaborator.id}`} value={newRecordSizes} onChange={changeNewRecordSizes} /> : null}
                            </div>
                          ) : null}
                          {recordSizeSettings.hasSizes ? (
                            <div className="field-group epi-record-size">
                              <label htmlFor={`epi-record-size-${collaborator.id}`}>Tamanho</label>
                              <Select id={`epi-record-size-${collaborator.id}`} value={recordForm.size || ''} onChange={event => setRecordForm(current => ({ ...current, size: event.target.value || null }))} required>
                                <option value="">Selecione o tamanho</option>
                                {recordSizeSettings.sizes.map(size => <option key={size} value={size}>{size}</option>)}
                              </Select>
                            </div>
                          ) : null}
                          <div className="field-group">
                            <label htmlFor={`epi-record-quantity-${collaborator.id}`}>Quantidade</label>
                            <Input id={`epi-record-quantity-${collaborator.id}`} type="number" min="1" value={recordForm.quantity} onChange={event => setRecordForm(current => ({ ...current, quantity: Number(event.target.value) }))} required />
                          </div>
                          <div className="field-group">
                            <label htmlFor={`epi-record-lend-${collaborator.id}`}>Fornecimento</label>
                            <Input id={`epi-record-lend-${collaborator.id}`} type="date" value={recordForm.lendDate} onChange={event => setRecordForm(current => ({ ...current, lendDate: event.target.value }))} required />
                          </div>
                          <div className="field-group">
                            <label htmlFor={`epi-record-return-${collaborator.id}`}>Devolução</label>
                            <Input id={`epi-record-return-${collaborator.id}`} type="date" value={recordForm.devolutionDate || ''} onChange={event => setRecordForm(current => ({ ...current, devolutionDate: event.target.value }))} />
                          </div>
                          <Button variant="primary" type="submit" loading={createRecordMutation.isPending}>Adicionar EPI</Button>
                        </form>
                      ) : null}

                      <div className="filter-tabs epi-record-tabs" role="group" aria-label="Fichas de EPI do colaborador">
                        <button className={`filter-tab ${recordTab === 'active' ? 'active' : ''}`} type="button" aria-pressed={recordTab === 'active'} onClick={() => setRecordTab('active')}>
                          Ativos ({activeRecords.length})
                        </button>
                        <button className={`filter-tab ${recordTab === 'archived' ? 'active' : ''}`} type="button" aria-pressed={recordTab === 'archived'} onClick={() => setRecordTab('archived')}>
                          Arquivados ({archivedRecords.length})
                        </button>
                      </div>

                      <div className="epi-record-actions">
                        {isTechnician ? (
                          <label className="epi-select-all">
                            <input
                              type="checkbox"
                              checked={allVisibleRecordsSelected}
                              ref={element => { if (element) element.indeterminate = selectedVisibleRecords.length > 0 && !allVisibleRecordsSelected; }}
                              disabled={!visibleRecords.length}
                              onChange={event => {
                                const setSelected = recordTab === 'archived' ? setSelectedArchivedRecordIds : setSelectedRecordIds;
                                setSelected(event.target.checked ? new Set(visibleRecords.map(record => record.id)) : new Set());
                              }}
                            />
                            Selecionar todos
                          </label>
                        ) : null}
                        <Button variant="secondary" size="sm" onClick={() => downloadPdf(collaborator, recordTab === 'archived')}>
                          {recordTab === 'archived' ? 'Baixar PDF arquivados' : 'Baixar PDF'}
                        </Button>
                        {isTechnician && recordTab === 'active' ? (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!selectedRecordIds.size || archiveRecordsMutation.isPending}
                              onClick={() => void confirmArchiveRecords(collaborator, activeRecords, true)}
                            >
                              Arquivar selecionados
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={!selectedRecordIds.size || hasSelectedSigned || requestSignatureMutation.isPending}
                              onClick={() => requestSignatureMutation.mutate(collaborator.id)}
                            >
                              {hasSelectedActiveRequest ? 'Solicitar novamente' : 'Solicitar assinatura'}
                            </Button>
                          </>
                        ) : null}
                        {isTechnician && recordTab === 'archived' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="epi-restore-button"
                            disabled={!selectedArchivedRecordIds.size || hasSelectedArchivedSigned || archiveRecordsMutation.isPending}
                            onClick={() => void confirmArchiveRecords(collaborator, archivedRecords, false)}
                          >
                            Restaurar selecionados
                          </Button>
                        ) : null}
                      </div>
                      {lastSignUrl ? (
                        <div className="epi-sign-link">
                          <span>{lastSignUrl}</span>
                          <Button variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(lastSignUrl)}>Copiar</Button>
                        </div>
                      ) : null}

                      <div className="epi-record-list">
                        {visibleRecords.length ? visibleRecords.map(record => (
                          <div className="epi-record-row" key={record.id}>
                            {isTechnician && recordTab === 'active' ? (
                              <input type="checkbox" checked={selectedRecordIds.has(record.id)} onChange={() => toggleRecord(record.id)} aria-label={`Selecionar ${record.epiName}${record.size ? ` tamanho ${record.size}` : ''}`} />
                            ) : isTechnician && recordTab === 'archived' ? (
                              <input type="checkbox" checked={selectedArchivedRecordIds.has(record.id)} onChange={() => toggleArchivedRecord(record.id)} aria-label={`Selecionar ${record.epiName}${record.size ? ` tamanho ${record.size}` : ''}`} />
                            ) : <span />}
                            <div>
                              <strong>{record.epiName}</strong>
                              <small>{caLabel(record.ca)}{record.size ? ` · Tam. ${record.size}` : ''} · Qtd. {record.quantity} · Forn. {formatDate(record.lendDate)} · Dev. {formatDate(record.devolutionDate)}{record.archivedAt ? ` · Arq. ${formatDate(record.archivedAt)}` : ''}</small>
                            </div>
                            <Badge tone={record.signedAt ? 'success' : record.signatureRequest?.status === 'PENDING' ? 'warning' : 'neutral'}>{signedLabel(record)}</Badge>
                            {isTechnician ? (
                              <div className="epi-row-buttons">
                                {recordTab === 'active' && !record.devolutionDate ? (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={returnRecordMutation.isPending}
                                    onClick={() => returnRecordMutation.mutate({ collaboratorId: collaborator.id, id: record.id })}
                                  >
                                    Devolver
                                  </Button>
                                ) : null}
                                {!hasSignatureEvidence(record) ? (
                                  <RemoveIconButton label={`Remover EPI ${record.epiName}`} onClick={() => confirmRemoveRecord(record)} />
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        )) : (
                          <p className="placeholder-copy">{recordTab === 'archived' ? 'Nenhum EPI arquivado para este colaborador.' : 'Nenhum EPI cadastrado para este colaborador.'}</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </>
        ) : (
          <section className="page-card epi-panel">
            {isTechnician ? (
              <form className="epi-catalog-form" onSubmit={event => { event.preventDefault(); if (validateCatalogSizes(catalogForm)) saveCatalogMutation.mutate(); }}>
                <div className="field-group">
                  <label htmlFor="epi-catalog-name">Nome do EPI</label>
                  <Input id="epi-catalog-name" value={catalogForm.name} onChange={event => setCatalogForm(current => ({ ...current, name: event.target.value }))} required />
                </div>
                <div className="epi-catalog-options">
                  <div className="field-group epi-catalog-ca">
                    <label htmlFor="epi-catalog-ca">C.A</label>
                    <Input id="epi-catalog-ca" value={catalogForm.ca} onChange={event => setCatalogForm(current => ({ ...current, ca: event.target.value }))} />
                  </div>
                  <CatalogSizesToggle value={catalogForm} onChange={setCatalogForm} />
                </div>
                <Button variant="primary" type="submit" loading={saveCatalogMutation.isPending}>Adicionar</Button>
                <CatalogSizes id="epi-catalog" value={catalogForm} onChange={setCatalogForm} />
              </form>
            ) : null}

            {catalogQuery.isLoading ? <Skeleton variant="card" label="Carregando catálogo de EPIs…" /> : null}
            {catalogQuery.isError ? <Alert tone="danger" action={{ label: 'Tentar novamente', onClick: () => void catalogQuery.refetch() }}>Não foi possível carregar o catálogo de EPIs.</Alert> : null}
            {!catalogQuery.isLoading && !catalogQuery.isError && !(catalogQuery.data || []).length ? <EmptyState variant="default" title="Nenhum EPI no catálogo." description={isTechnician ? 'Cadastre o primeiro equipamento acima.' : 'Os equipamentos aparecerão aqui quando forem cadastrados.'} /> : null}

            <div className="epi-catalog-list">
              {(catalogQuery.data || []).map(item => (
                <div className="epi-catalog-row" key={item.id}>
                  <div className="epi-catalog-row-main">
                    <div>
                      <strong>{item.name}</strong>
                      <small>{caLabel(item.ca)}{item.hasSizes ? ` · Tamanhos: ${item.sizes.join(', ')}` : ''}</small>
                    </div>
                    {isTechnician ? (
                      <div className="epi-row-buttons">
                        <Button variant="secondary" size="sm" onClick={() => editCatalog(item)}>Editar</Button>
                        <RemoveIconButton label={`Remover item ${item.name}`} onClick={() => confirmRemoveCatalog(item)} />
                      </div>
                    ) : null}
                  </div>
                  {editingCatalogId === item.id ? (
                    <div className="epi-catalog-edit-form">
                      <Input containerClassName="epi-catalog-name" aria-label={`Nome de ${item.name}`} value={editCatalogForm.name} onChange={event => setEditCatalogForm(current => ({ ...current, name: event.target.value }))} />
                      <div className="epi-catalog-options">
                        <Input containerClassName="epi-catalog-ca" aria-label={`C.A de ${item.name}`} value={editCatalogForm.ca} onChange={event => setEditCatalogForm(current => ({ ...current, ca: event.target.value }))} />
                        <CatalogSizesToggle value={editCatalogForm} onChange={setEditCatalogForm} />
                      </div>
                      <div className="epi-catalog-actions">
                        <Button variant="primary" size="sm" loading={updateCatalogMutation.isPending} onClick={() => { if (validateCatalogSizes(editCatalogForm)) updateCatalogMutation.mutate({ id: item.id, payload: editCatalogForm }); }}>Salvar</Button>
                        <Button variant="secondary" size="sm" onClick={() => setEditingCatalogId(null)}>Cancelar</Button>
                      </div>
                      <CatalogSizes id={`epi-catalog-edit-${item.id}`} value={editCatalogForm} onChange={setEditCatalogForm} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      <Modal
        open={!!removeDialog}
        onClose={() => setRemoveDialog(null)}
        appearance="design-system"
        size="sm"
        title={removeDialog?.title || 'Remover EPI'}
        ariaDescribedBy="epi-remove-dialog-description"
        panelClassName="epi-remove-dialog"
      >
        <p className="placeholder-copy" id="epi-remove-dialog-description">{removeDialogDescription()}</p>
        <div className="epi-remove-dialog-item">
          <strong>{removeDialog?.description}</strong>
        </div>
        <div className="admin-form-actions epi-remove-dialog-actions">
          <Button variant="secondary" onClick={() => setRemoveDialog(null)}>
            Cancelar
          </Button>
          <RemoveIconButton label={removeDialog?.title || 'Remover EPI'} onClick={confirmRemoveDialog} />
        </div>
      </Modal>
      {confirmDialog}
    </OperationalModuleAppShell>
  );
}
