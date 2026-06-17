import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import {
  archiveEpiRecords,
  createEpiCatalogItem,
  createEpiRecord,
  downloadEpiCollaboratorPdf,
  listEpiCatalog,
  listEpiCollaborators,
  removeEpiCatalogItem,
  removeEpiRecord,
  requestEpiSignature,
  updateEpiCatalogItem,
  updateEpiCollaboratorProfile,
  updateEpiRecord,
  type EpiCatalogItem,
  type EpiCollaborator,
  type EpiRecord,
  type EpiRecordPayload
} from '../../api/epi';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { Modal } from '../../components/ui/Modal';
import { SearchBar } from '../../components/ui/SearchBar';
import { useToast } from '../../components/ui/Toast';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { downloadBlob } from '../../utils/download';

type Tab = 'collaborators' | 'catalog';
type RecordTab = 'active' | 'archived';
type RemoveDialogState =
  | { kind: 'record'; id: string; title: string; description: string }
  | { kind: 'catalog'; id: string; title: string; description: string };

const emptyRecord: EpiRecordPayload = {
  catalogItemId: null,
  epiName: '',
  ca: '',
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
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const isTechnician = user?.accountType === 'ADMIN' || user?.moduleRoles?.includes('epi:technician');
  const [tab, setTab] = useState<Tab>('collaborators');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({ cpf: '', registrationNumber: '', admissionDate: '' });
  const [recordForm, setRecordForm] = useState<EpiRecordPayload>(emptyRecord);
  const [recordTab, setRecordTab] = useState<RecordTab>('active');
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(() => new Set());
  const [selectedArchivedRecordIds, setSelectedArchivedRecordIds] = useState<Set<string>>(() => new Set());
  const [lastSignUrl, setLastSignUrl] = useState('');
  const [catalogForm, setCatalogForm] = useState({ name: '', ca: '' });
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [editCatalogForm, setEditCatalogForm] = useState({ name: '', ca: '' });
  const [removeDialog, setRemoveDialog] = useState<RemoveDialogState | null>(null);

  const collaboratorsQuery = useQuery({ queryKey: ['epi-collaborators'], queryFn: listEpiCollaborators });
  const catalogQuery = useQuery({ queryKey: ['epi-catalog'], queryFn: listEpiCatalog });

  const expandedCollaborator = useMemo(
    () => (collaboratorsQuery.data || []).find(item => item.id === expandedId) || null,
    [collaboratorsQuery.data, expandedId]
  );

  const visibleCollaborators = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (collaboratorsQuery.data || []).filter(item => {
      if (!query) return true;
      return [item.name, item.code, item.role, item.cpf, item.registrationNumber]
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
      admissionDate: inputDateToPtBr(profileForm.admissionDate)
    }),
    onSuccess: () => {
      invalidate();
      setEditingProfileId(null);
      showToast('Dados do colaborador atualizados.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
  });

  const createRecordMutation = useMutation({
    mutationFn: ({ collaboratorId, payload }: { collaboratorId: string; payload: EpiRecordPayload }) => createEpiRecord(collaboratorId, payload),
    onSuccess: () => {
      invalidate();
      setRecordForm(emptyRecord);
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
    mutationFn: () => createEpiCatalogItem({ ...catalogForm, isActive: true }),
    onSuccess: () => {
      invalidate();
      setCatalogForm({ name: '', ca: '' });
      showToast('EPI salvo no catálogo.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar o EPI.', 'error')
  });

  const updateCatalogMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name: string; ca: string } }) => updateEpiCatalogItem(id, payload),
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
        admissionDate: dateInput(collaborator.admissionDate)
      });
      setRecordForm(emptyRecord);
    }
  }

  function selectCatalog(id: string) {
    const item = (catalogQuery.data || []).find(catalog => catalog.id === id);
    setRecordForm(current => ({
      ...current,
      catalogItemId: item?.id || null,
      epiName: item?.name || current.epiName,
      ca: item?.ca || current.ca
    }));
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
      admissionDate: dateInput(collaborator.admissionDate)
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
    const payload = {
      ...recordForm,
      catalogItemId: recordForm.catalogItemId || null,
      epiName: recordForm.epiName.trim(),
      ca: String(recordForm.ca || '').trim(),
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
    setEditCatalogForm({ name: item.name, ca: item.ca || '' });
  }

  function confirmRemoveRecord(record: EpiRecord) {
    const description = `${record.epiName} (${caLabel(record.ca)})`;
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

  function confirmArchiveRecords(collaborator: EpiCollaborator, records: EpiRecord[], archived = true) {
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
    const action = archived ? 'Arquivar' : 'Restaurar';
    if (!window.confirm(`${action} ${selected.length} EPI(s) de ${collaborator.name}?`)) return;
    archiveRecordsMutation.mutate({
      collaboratorId: collaborator.id,
      recordIds: selected.map(record => record.id),
      archived
    });
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <Shell>
      <TopBar
        title="EPI"
        subtitle="Fichas de controle por colaborador"
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
      <main className="page-scroll epi-page">
        <section className="page-card epi-panel">
          <div className="admin-toolbar">
            <div className="sec">Controle de EPIs</div>
          </div>
          <div className="filter-tabs" role="tablist" aria-label="Áreas de EPI">
            <button className={`filter-tab ${tab === 'collaborators' ? 'active' : ''}`} type="button" onClick={() => setTab('collaborators')}>Colaboradores</button>
            <button className={`filter-tab ${tab === 'catalog' ? 'active' : ''}`} type="button" onClick={() => setTab('catalog')}>Gerenciar EPIs</button>
          </div>
        </section>

        {tab === 'collaborators' ? (
          <>
            <section className="page-card epi-panel">
              <div className="field-group">
                <label htmlFor="epi-search">Buscar colaborador</label>
                <SearchBar
                  id="epi-search"
                  value={search}
                  onChange={setSearch}
                  placeholder="Nome, código ou função"
                  count={{ shown: visibleCollaborators.length, total: (collaboratorsQuery.data || []).length }}
                />
              </div>
            </section>

            {visibleCollaborators.map(collaborator => {
              const isOpen = expandedId === collaborator.id;
              const activeRecords = collaborator.epiRecords.filter(record => !record.archivedAt && !record.pendingReturn);
              const archivedRecords = collaborator.epiRecords.filter(record => record.archivedAt);
              const visibleRecords = recordTab === 'archived' ? archivedRecords : activeRecords;
              const selectedActiveRecords = activeRecords.filter(record => selectedRecordIds.has(record.id));
              const selectedArchivedRecords = archivedRecords.filter(record => selectedArchivedRecordIds.has(record.id));
              const hasSelectedSigned = selectedActiveRecords.some(record => record.signedAt);
              const hasSelectedArchivedSigned = selectedArchivedRecords.some(record => record.signedAt);
              const unsigned = activeRecords.filter(record => !record.signedAt).length;
              return (
                <section className="page-card epi-collaborator-card" key={collaborator.id}>
                  <button className="epi-card-head" type="button" onClick={() => openCollaborator(collaborator)}>
                    <span>
                      <strong>{collaborator.name}</strong>
                      <small>{collaborator.code} · {collaborator.role}</small>
                    </span>
                    <span className="epi-card-count">{activeRecords.length} ativo(s) · {archivedRecords.length} arquivado(s) · {unsigned} pendente(s)</span>
                  </button>

                  {isOpen ? (
                    <div className="epi-card-body">
                      {editingProfileId === collaborator.id ? (
                        <div className="epi-profile-grid">
                          <div className="field-group epi-profile-cpf">
                            <label>CPF</label>
                            <input
                              inputMode="numeric"
                              maxLength={14}
                              placeholder="000.000.000-00"
                              value={profileForm.cpf}
                              onChange={event => setProfileForm(current => ({ ...current, cpf: formatCpfInput(event.target.value) }))}
                              disabled={!isTechnician}
                            />
                          </div>
                          <div className="field-group epi-profile-registration">
                            <label>Matrícula</label>
                            <input value={profileForm.registrationNumber} onChange={event => setProfileForm(current => ({ ...current, registrationNumber: event.target.value }))} disabled={!isTechnician} />
                          </div>
                          <div className="field-group epi-profile-admission">
                            <label>Data de admissão</label>
                            <input type="date" value={profileForm.admissionDate} onChange={event => setProfileForm(current => ({ ...current, admissionDate: event.target.value }))} disabled={!isTechnician} />
                          </div>
                          {isTechnician ? (
                            <>
                              <button className="primary-button epi-profile-save" type="button" onClick={() => saveProfile(collaborator.id)}>
                                Salvar dados
                              </button>
                              <button className="secondary-button epi-profile-cancel" type="button" onClick={() => setEditingProfileId(null)}>
                                Cancelar
                              </button>
                            </>
                          ) : null}
                        </div>
                      ) : (
                        <div className="epi-profile-summary">
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
                            <button className="secondary-button" type="button" onClick={() => startProfileEdit(collaborator)}>
                              Editar
                            </button>
                          ) : null}
                        </div>
                      )}

                      {isTechnician ? (
                        <form className="epi-record-form" onSubmit={submitRecord}>
                          <div className="field-group">
                            <label>EPI cadastrado</label>
                            <select value={recordForm.catalogItemId || ''} onChange={event => selectCatalog(event.target.value)}>
                              <option value="">Novo EPI</option>
                              {(catalogQuery.data || []).map(item => (
                                <option key={item.id} value={item.id}>{item.name} · {caLabel(item.ca)}</option>
                              ))}
                            </select>
                          </div>
                          <div className="field-group">
                            <label>Nome do EPI</label>
                            <input value={recordForm.epiName} onChange={event => setRecordForm(current => ({ ...current, epiName: event.target.value, catalogItemId: null }))} required />
                          </div>
                          <div className="field-group">
                            <label>C.A</label>
                            <input value={recordForm.ca || ''} onChange={event => setRecordForm(current => ({ ...current, ca: event.target.value, catalogItemId: null }))} />
                          </div>
                          <div className="field-group">
                            <label>Quantidade</label>
                            <input type="number" min="1" value={recordForm.quantity} onChange={event => setRecordForm(current => ({ ...current, quantity: Number(event.target.value) }))} required />
                          </div>
                          <div className="field-group">
                            <label>Fornecimento</label>
                            <input type="date" value={recordForm.lendDate} onChange={event => setRecordForm(current => ({ ...current, lendDate: event.target.value }))} required />
                          </div>
                          <div className="field-group">
                            <label>Devolução</label>
                            <input type="date" value={recordForm.devolutionDate || ''} onChange={event => setRecordForm(current => ({ ...current, devolutionDate: event.target.value }))} />
                          </div>
                          <button className="primary-button" type="submit" disabled={createRecordMutation.isPending}>Adicionar EPI</button>
                        </form>
                      ) : null}

                      <div className="filter-tabs epi-record-tabs" role="tablist" aria-label="Fichas de EPI do colaborador">
                        <button className={`filter-tab ${recordTab === 'active' ? 'active' : ''}`} type="button" onClick={() => setRecordTab('active')}>
                          Ativos ({activeRecords.length})
                        </button>
                        <button className={`filter-tab ${recordTab === 'archived' ? 'active' : ''}`} type="button" onClick={() => setRecordTab('archived')}>
                          Arquivados ({archivedRecords.length})
                        </button>
                      </div>

                      <div className="epi-record-actions">
                        <button className="secondary-button" type="button" onClick={() => downloadPdf(collaborator, recordTab === 'archived')}>
                          {recordTab === 'archived' ? 'Baixar PDF arquivados' : 'Baixar PDF'}
                        </button>
                        {isTechnician && recordTab === 'active' ? (
                          <>
                            <button
                              className="secondary-button"
                              type="button"
                              disabled={!selectedRecordIds.size || archiveRecordsMutation.isPending}
                              onClick={() => confirmArchiveRecords(collaborator, activeRecords, true)}
                            >
                              Arquivar selecionados
                            </button>
                            <button
                              className="primary-button"
                              type="button"
                              disabled={!selectedRecordIds.size || hasSelectedSigned || requestSignatureMutation.isPending}
                              onClick={() => requestSignatureMutation.mutate(collaborator.id)}
                            >
                              Solicitar assinatura
                            </button>
                          </>
                        ) : null}
                        {isTechnician && recordTab === 'archived' ? (
                          <button
                            className="secondary-button epi-restore-button"
                            type="button"
                            disabled={!selectedArchivedRecordIds.size || hasSelectedArchivedSigned || archiveRecordsMutation.isPending}
                            onClick={() => confirmArchiveRecords(collaborator, archivedRecords, false)}
                          >
                            Restaurar selecionados
                          </button>
                        ) : null}
                      </div>
                      {lastSignUrl ? (
                        <div className="epi-sign-link">
                          <span>{lastSignUrl}</span>
                          <button className="mini-btn" type="button" onClick={() => navigator.clipboard?.writeText(lastSignUrl)}>Copiar</button>
                        </div>
                      ) : null}

                      <div className="epi-record-list">
                        {visibleRecords.length ? visibleRecords.map(record => (
                          <div className="epi-record-row" key={record.id}>
                            {isTechnician && recordTab === 'active' ? (
                              <input type="checkbox" checked={selectedRecordIds.has(record.id)} onChange={() => toggleRecord(record.id)} aria-label={`Selecionar ${record.epiName}`} />
                            ) : isTechnician && recordTab === 'archived' ? (
                              <input type="checkbox" checked={selectedArchivedRecordIds.has(record.id)} onChange={() => toggleArchivedRecord(record.id)} aria-label={`Selecionar ${record.epiName}`} />
                            ) : <span />}
                            <div>
                              <strong>{record.epiName}</strong>
                              <small>{caLabel(record.ca)} · Qtd. {record.quantity} · Forn. {formatDate(record.lendDate)} · Dev. {formatDate(record.devolutionDate)}{record.archivedAt ? ` · Arq. ${formatDate(record.archivedAt)}` : ''}</small>
                            </div>
                            <span className={`epi-status ${record.signedAt ? 'signed' : ''}`}>{signedLabel(record)}</span>
                            {isTechnician ? (
                              <div className="epi-row-buttons">
                                {recordTab === 'active' && !record.devolutionDate ? (
                                  <button
                                    className="mini-btn"
                                    type="button"
                                    disabled={returnRecordMutation.isPending}
                                    onClick={() => returnRecordMutation.mutate({ collaboratorId: collaborator.id, id: record.id })}
                                  >
                                    Devolver
                                  </button>
                                ) : null}
                                {!hasSignatureEvidence(record) ? (
                                  <button className="mini-btn danger" type="button" onClick={() => confirmRemoveRecord(record)}>
                                    Remover
                                  </button>
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
              <form className="epi-catalog-form" onSubmit={event => { event.preventDefault(); saveCatalogMutation.mutate(); }}>
                <div className="field-group">
                  <label>Nome do EPI</label>
                  <input value={catalogForm.name} onChange={event => setCatalogForm(current => ({ ...current, name: event.target.value }))} required />
                </div>
                <div className="field-group">
                  <label>C.A</label>
                  <input value={catalogForm.ca} onChange={event => setCatalogForm(current => ({ ...current, ca: event.target.value }))} />
                </div>
                <button className="primary-button" type="submit">Adicionar</button>
              </form>
            ) : null}

            <div className="epi-catalog-list">
              {(catalogQuery.data || []).map(item => (
                <div className="epi-catalog-row" key={item.id}>
                  <div className="epi-catalog-row-main">
                    <div>
                      <strong>{item.name}</strong>
                      <small>{caLabel(item.ca)}</small>
                    </div>
                    {isTechnician ? (
                      <div className="epi-row-buttons">
                        <button className="mini-btn" type="button" onClick={() => editCatalog(item)}>Editar</button>
                        <button className="mini-btn danger" type="button" onClick={() => confirmRemoveCatalog(item)}>Remover</button>
                      </div>
                    ) : null}
                  </div>
                  {editingCatalogId === item.id ? (
                    <div className="epi-catalog-edit-form">
                      <input value={editCatalogForm.name} onChange={event => setEditCatalogForm(current => ({ ...current, name: event.target.value }))} />
                      <input value={editCatalogForm.ca} onChange={event => setEditCatalogForm(current => ({ ...current, ca: event.target.value }))} />
                      <button className="mini-btn" type="button" onClick={() => updateCatalogMutation.mutate({ id: item.id, payload: editCatalogForm })}>Salvar</button>
                      <button className="mini-btn alt" type="button" onClick={() => setEditingCatalogId(null)}>Cancelar</button>
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
        ariaLabelledBy="epi-remove-dialog-title"
        ariaDescribedBy="epi-remove-dialog-description"
        panelClassName="modal-card epi-remove-dialog"
      >
        <div className="section-title" id="epi-remove-dialog-title">{removeDialog?.title || 'Remover EPI'}</div>
        <p className="placeholder-copy" id="epi-remove-dialog-description">{removeDialogDescription()}</p>
        <div className="epi-remove-dialog-item">
          <strong>{removeDialog?.description}</strong>
        </div>
        <div className="admin-form-actions epi-remove-dialog-actions">
          <button className="secondary-button" type="button" onClick={() => setRemoveDialog(null)}>
            Cancelar
          </button>
          <button className="danger-button" type="button" onClick={confirmRemoveDialog}>
            Remover
          </button>
        </div>
      </Modal>
    </Shell>
  );
}
