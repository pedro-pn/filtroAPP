import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
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
  type EpiRecordPayload
} from '../../api/epi';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { downloadBlob } from '../../utils/download';

type Tab = 'collaborators' | 'catalog';

const emptyRecord: EpiRecordPayload = {
  catalogItemId: null,
  epiName: '',
  ca: '',
  quantity: 1,
  lendDate: new Date().toISOString().slice(0, 10),
  devolutionDate: ''
};

function dateInput(value?: string | null) {
  return value ? String(value).slice(0, 10) : '';
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function signedLabel(record: { signedAt?: string | null; signatureRequest?: { status: string } | null }) {
  if (record.signedAt) return 'Assinado';
  if (record.signatureRequest?.status === 'PENDING') return 'Solicitado';
  return 'Pendente';
}

export function EpiPage() {
  const { user } = useAuth();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const isTechnician = user?.accountType === 'ADMIN' || user?.moduleRoles?.includes('epi:technician');
  const [tab, setTab] = useState<Tab>('collaborators');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({ cpf: '', registrationNumber: '', admissionDate: '' });
  const [recordForm, setRecordForm] = useState<EpiRecordPayload>(emptyRecord);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(() => new Set());
  const [lastSignUrl, setLastSignUrl] = useState('');
  const [catalogForm, setCatalogForm] = useState({ name: '', ca: '' });
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [editCatalogForm, setEditCatalogForm] = useState({ name: '', ca: '' });

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
    mutationFn: (collaboratorId: string) => updateEpiCollaboratorProfile(collaboratorId, profileForm),
    onSuccess: () => {
      invalidate();
      showToast('Dados do colaborador atualizados.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
  });

  const createRecordMutation = useMutation({
    mutationFn: (collaboratorId: string) => createEpiRecord(collaboratorId, recordForm),
    onSuccess: () => {
      invalidate();
      setRecordForm(emptyRecord);
      showToast('EPI adicionado.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível adicionar o EPI.', 'error')
  });

  const updateRecordMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<EpiRecordPayload> }) => updateEpiRecord(id, payload),
    onSuccess: () => {
      invalidate();
      showToast('EPI atualizado.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível atualizar o EPI.', 'error')
  });

  const removeRecordMutation = useMutation({
    mutationFn: removeEpiRecord,
    onSuccess: () => {
      invalidate();
      showToast('EPI removido.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível remover o EPI.', 'error')
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
    setLastSignUrl('');
    setSelectedRecordIds(new Set());
    if (!isSame) {
      setProfileForm({
        cpf: collaborator.cpf || '',
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

  function toggleRecord(recordId: string) {
    setSelectedRecordIds(current => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  function submitRecord(event: FormEvent) {
    event.preventDefault();
    if (!expandedCollaborator) return;
    createRecordMutation.mutate(expandedCollaborator.id);
  }

  async function downloadPdf(collaborator: EpiCollaborator) {
    try {
      const blob = await downloadEpiCollaboratorPdf(collaborator.id);
      downloadBlob(blob, `Ficha de Controle de EPIs - ${collaborator.name}.pdf`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível baixar o PDF.', 'error');
    }
  }

  function editCatalog(item: EpiCatalogItem) {
    setEditingCatalogId(item.id);
    setEditCatalogForm({ name: item.name, ca: item.ca });
  }

  return (
    <Shell>
      <TopBar title="EPI" subtitle="Fichas de controle por colaborador" />
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
                <input id="epi-search" type="text" value={search} onChange={event => setSearch(event.target.value)} />
              </div>
            </section>

            {visibleCollaborators.map(collaborator => {
              const isOpen = expandedId === collaborator.id;
              const unsigned = collaborator.epiRecords.filter(record => !record.signedAt).length;
              return (
                <section className="page-card epi-collaborator-card" key={collaborator.id}>
                  <button className="epi-card-head" type="button" onClick={() => openCollaborator(collaborator)}>
                    <span>
                      <strong>{collaborator.name}</strong>
                      <small>{collaborator.code} · {collaborator.role}</small>
                    </span>
                    <span className="epi-card-count">{collaborator.epiRecords.length} EPI(s) · {unsigned} pendente(s)</span>
                  </button>

                  {isOpen ? (
                    <div className="epi-card-body">
                      <div className="epi-profile-grid">
                        <div className="field-group">
                          <label>CPF</label>
                          <input value={profileForm.cpf} onChange={event => setProfileForm(current => ({ ...current, cpf: event.target.value }))} disabled={!isTechnician} />
                        </div>
                        <div className="field-group">
                          <label>Matrícula</label>
                          <input value={profileForm.registrationNumber} onChange={event => setProfileForm(current => ({ ...current, registrationNumber: event.target.value }))} disabled={!isTechnician} />
                        </div>
                        <div className="field-group">
                          <label>Data de admissão</label>
                          <input type="date" value={profileForm.admissionDate} onChange={event => setProfileForm(current => ({ ...current, admissionDate: event.target.value }))} disabled={!isTechnician} />
                        </div>
                        {isTechnician ? (
                          <button className="primary-button" type="button" onClick={() => saveProfileMutation.mutate(collaborator.id)}>
                            Salvar dados
                          </button>
                        ) : null}
                      </div>

                      {isTechnician ? (
                        <form className="epi-record-form" onSubmit={submitRecord}>
                          <div className="field-group">
                            <label>EPI cadastrado</label>
                            <select value={recordForm.catalogItemId || ''} onChange={event => selectCatalog(event.target.value)}>
                              <option value="">Novo EPI</option>
                              {(catalogQuery.data || []).map(item => (
                                <option key={item.id} value={item.id}>{item.name} · C.A {item.ca}</option>
                              ))}
                            </select>
                          </div>
                          <div className="field-group">
                            <label>Nome do EPI</label>
                            <input value={recordForm.epiName} onChange={event => setRecordForm(current => ({ ...current, epiName: event.target.value, catalogItemId: null }))} required />
                          </div>
                          <div className="field-group">
                            <label>C.A</label>
                            <input value={recordForm.ca} onChange={event => setRecordForm(current => ({ ...current, ca: event.target.value, catalogItemId: null }))} required />
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

                      <div className="epi-record-actions">
                        <button className="secondary-button" type="button" onClick={() => downloadPdf(collaborator)}>Baixar PDF</button>
                        {isTechnician ? (
                          <button
                            className="primary-button"
                            type="button"
                            disabled={!selectedRecordIds.size || requestSignatureMutation.isPending}
                            onClick={() => requestSignatureMutation.mutate(collaborator.id)}
                          >
                            Solicitar assinatura
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
                        {collaborator.epiRecords.length ? collaborator.epiRecords.map(record => (
                          <div className="epi-record-row" key={record.id}>
                            {isTechnician && !record.signedAt ? (
                              <input type="checkbox" checked={selectedRecordIds.has(record.id)} onChange={() => toggleRecord(record.id)} aria-label={`Selecionar ${record.epiName}`} />
                            ) : <span />}
                            <div>
                              <strong>{record.epiName}</strong>
                              <small>C.A {record.ca} · Qtd. {record.quantity} · Forn. {formatDate(record.lendDate)} · Dev. {formatDate(record.devolutionDate)}</small>
                            </div>
                            <span className={`epi-status ${record.signedAt ? 'signed' : ''}`}>{signedLabel(record)}</span>
                            {isTechnician ? (
                              <div className="epi-row-buttons">
                                {!record.devolutionDate ? (
                                  <button className="mini-btn" type="button" onClick={() => updateRecordMutation.mutate({ id: record.id, payload: { devolutionDate: new Date().toISOString().slice(0, 10) } })}>
                                    Devolver
                                  </button>
                                ) : null}
                                <button className="mini-btn danger" type="button" onClick={() => removeRecordMutation.mutate(record.id)}>
                                  Remover
                                </button>
                              </div>
                            ) : null}
                          </div>
                        )) : (
                          <p className="placeholder-copy">Nenhum EPI cadastrado para este colaborador.</p>
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
                  <input value={catalogForm.ca} onChange={event => setCatalogForm(current => ({ ...current, ca: event.target.value }))} required />
                </div>
                <button className="primary-button" type="submit">Adicionar</button>
              </form>
            ) : null}

            <div className="epi-catalog-list">
              {(catalogQuery.data || []).map(item => (
                <div className="epi-catalog-row" key={item.id}>
                  {editingCatalogId === item.id ? (
                    <>
                      <input value={editCatalogForm.name} onChange={event => setEditCatalogForm(current => ({ ...current, name: event.target.value }))} />
                      <input value={editCatalogForm.ca} onChange={event => setEditCatalogForm(current => ({ ...current, ca: event.target.value }))} />
                      <button className="mini-btn" type="button" onClick={() => updateCatalogMutation.mutate({ id: item.id, payload: editCatalogForm })}>Salvar</button>
                      <button className="mini-btn alt" type="button" onClick={() => setEditingCatalogId(null)}>Cancelar</button>
                    </>
                  ) : (
                    <>
                      <div>
                        <strong>{item.name}</strong>
                        <small>C.A {item.ca}</small>
                      </div>
                      {isTechnician ? (
                        <div className="epi-row-buttons">
                          <button className="mini-btn" type="button" onClick={() => editCatalog(item)}>Editar</button>
                          <button className="mini-btn danger" type="button" onClick={() => removeCatalogMutation.mutate(item.id)}>Remover</button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </Shell>
  );
}
