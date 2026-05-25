import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import {
  createRomaneioCatalogItem,
  downloadRomaneioFile,
  listRomaneioCatalog,
  listRomaneioDrafts,
  listRomaneioProjects,
  listRomaneioRecipients,
  listRomaneios,
  removeRomaneioCatalogItem,
  removeRomaneioDraft,
  removeRomaneioRecipient,
  renameRomaneioCatalogCategory,
  saveRomaneioRecipient,
  updateRomaneioCatalogItem,
  type RomaneioCatalogItem,
  type RomaneioCatalogPayload,
  type RomaneioMeasureType
} from '../../api/romaneio';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { downloadBlob } from '../../utils/download';

type Tab = 'romaneios' | 'equipamentos' | 'notificacoes';
const NEW_CATEGORY_VALUE = '__new_category__';

const measureLabels: Record<RomaneioMeasureType, string> = {
  UNIT: 'unidade',
  LENGTH: 'm',
  WEIGHT: 'kg'
};

function formatDate(value: string) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function draftDateLabel(draft: { reportDate?: string | null; payload?: Record<string, unknown> }) {
  const payloadDate = asString(draft.payload?.reportDate);
  return draft.reportDate || payloadDate || 'Sem data';
}

function draftItemCount(draft: { payload?: Record<string, unknown> }) {
  const items = draft.payload?.selectedItems;
  return Array.isArray(items) ? items.length : 0;
}

function catalogEmpty(): RomaneioCatalogPayload {
  return {
    code: '',
    name: '',
    categoryName: '',
    kind: 'EQUIPMENT',
    measureType: 'UNIT',
    defaultUnitLabel: 'unidade',
    isSerialized: true,
    isActive: true
  };
}

export function RomaneioPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const isManager = user?.moduleRoles?.includes('romaneio:manager');
  const [tab, setTab] = useState<Tab>('romaneios');
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [catalogForm, setCatalogForm] = useState<RomaneioCatalogPayload>(catalogEmpty());
  const [catalogCategoryMode, setCatalogCategoryMode] = useState<'existing' | 'new'>('existing');
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [editCatalogForm, setEditCatalogForm] = useState<RomaneioCatalogPayload>(catalogEmpty());
  const [editCategoryMode, setEditCategoryMode] = useState<'existing' | 'new'>('existing');
  const [editingCategory, setEditingCategory] = useState('');
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [expandedCatalogCategories, setExpandedCatalogCategories] = useState<Set<string>>(() => new Set());
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');

  const projectsQuery = useQuery({ queryKey: ['romaneio-projects'], queryFn: () => listRomaneioProjects(true) });
  const romaneiosQuery = useQuery({
    queryKey: ['romaneios', { search, projectId }],
    queryFn: () => listRomaneios({ search: search || undefined, projectId: projectId || undefined })
  });
  const catalogQuery = useQuery({ queryKey: ['romaneio-catalog'], queryFn: listRomaneioCatalog, enabled: isManager || tab !== 'notificacoes' });
  const draftsQuery = useQuery({ queryKey: ['romaneio-drafts'], queryFn: listRomaneioDrafts });
  const recipientsQuery = useQuery({ queryKey: ['romaneio-recipients'], queryFn: listRomaneioRecipients, enabled: isManager && tab === 'notificacoes' });

  const saveCatalogMutation = useMutation({
    mutationFn: () => createRomaneioCatalogItem(catalogForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['romaneio-catalog'] });
      setCatalogForm(catalogEmpty());
      setCatalogCategoryMode('existing');
      showToast('Item salvo.');
    },
    onError: () => showToast('Não foi possível salvar o item.')
  });

  const updateCatalogMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: RomaneioCatalogPayload }) => updateRomaneioCatalogItem(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['romaneio-catalog'] });
      setEditingCatalogId(null);
      setEditCatalogForm(catalogEmpty());
      setEditCategoryMode('existing');
      showToast('Item atualizado.');
    },
    onError: () => showToast('Não foi possível atualizar o item.')
  });

  const removeCatalogMutation = useMutation({
    mutationFn: removeRomaneioCatalogItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['romaneio-catalog'] });
      showToast('Item removido.');
    },
    onError: () => showToast('Não foi possível remover o item.')
  });

  const renameCategoryMutation = useMutation({
    mutationFn: renameRomaneioCatalogCategory,
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['romaneio-catalog'] });
      setCatalogForm(current => current.categoryName === variables.currentName ? { ...current, categoryName: variables.newName } : current);
      setEditCatalogForm(current => current.categoryName === variables.currentName ? { ...current, categoryName: variables.newName } : current);
      setExpandedCatalogCategories(current => {
        const next = new Set(current);
        if (next.delete(variables.currentName)) next.add(variables.newName);
        return next;
      });
      setEditingCategory('');
      setEditingCategoryName('');
      showToast('Categoria atualizada.');
    },
    onError: () => showToast('Não foi possível atualizar a categoria.')
  });

  const saveRecipientMutation = useMutation({
    mutationFn: () => saveRomaneioRecipient({ name: recipientName || null, email: recipientEmail, isActive: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['romaneio-recipients'] });
      setRecipientEmail('');
      setRecipientName('');
      showToast('Destinatário salvo.');
    },
    onError: () => showToast('Não foi possível salvar o destinatário.')
  });

  const removeRecipientMutation = useMutation({
    mutationFn: removeRomaneioRecipient,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['romaneio-recipients'] }),
    onError: () => showToast('Não foi possível remover o destinatário.')
  });

  const removeDraftMutation = useMutation({
    mutationFn: removeRomaneioDraft,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['romaneio-drafts'] });
      showToast('Rascunho excluído.');
    },
    onError: () => showToast('Não foi possível excluir o rascunho.')
  });

  const groupedRomaneios = useMemo(() => {
    const map = new Map<string, NonNullable<typeof romaneiosQuery.data>>();
    (romaneiosQuery.data || []).forEach(item => {
      const key = item.project ? `Missão ${item.project.code} - ${item.project.name}` : 'Sem projeto';
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(item);
    });
    return Array.from(map.entries());
  }, [romaneiosQuery.data]);

  const groupedCatalog = useMemo(() => {
    const map = new Map<string, RomaneioCatalogItem[]>();
    (catalogQuery.data || []).forEach(item => {
      if (!map.has(item.categoryName)) map.set(item.categoryName, []);
      map.get(item.categoryName)?.push(item);
    });
    return Array.from(map.entries());
  }, [catalogQuery.data]);

  const catalogCategories = useMemo(() => {
    return Array.from(new Set((catalogQuery.data || []).map(item => item.categoryName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [catalogQuery.data]);

  function handleCatalogCategoryChange(value: string) {
    if (value === NEW_CATEGORY_VALUE) {
      setCatalogCategoryMode('new');
      setCatalogForm(current => ({ ...current, categoryName: '' }));
      return;
    }
    setCatalogCategoryMode('existing');
    setCatalogForm(current => ({ ...current, categoryName: value }));
  }

  function handleEditCategoryChange(value: string) {
    if (value === NEW_CATEGORY_VALUE) {
      setEditCategoryMode('new');
      setEditCatalogForm(current => ({ ...current, categoryName: '' }));
      return;
    }
    setEditCategoryMode('existing');
    setEditCatalogForm(current => ({ ...current, categoryName: value }));
  }

  function submitCatalog(event: FormEvent) {
    event.preventDefault();
    saveCatalogMutation.mutate();
  }

  function editCatalog(item: RomaneioCatalogItem) {
    setEditingCatalogId(item.id);
    setEditCatalogForm({
      code: item.code || '',
      name: item.name,
      categoryName: item.categoryName,
      kind: item.kind,
      measureType: item.measureType,
      defaultUnitLabel: item.defaultUnitLabel,
      isSerialized: item.isSerialized,
      isActive: item.isActive
    });
    setEditCategoryMode('existing');
    setTab('equipamentos');
  }

  function submitCatalogEdit(event: FormEvent, itemId: string) {
    event.preventDefault();
    updateCatalogMutation.mutate({ id: itemId, payload: editCatalogForm });
  }

  async function downloadFile(id: string, format: 'pdf' | 'docx', sourceUrl?: string | null) {
    try {
      const blob = await downloadRomaneioFile(id, format);
      const fileName = decodeURIComponent(sourceUrl?.split('/').pop() || `romaneio.${format}`);
      downloadBlob(blob, fileName);
    } catch {
      showToast('Não foi possível baixar o arquivo.');
    }
  }

  function toggleCatalogCategory(category: string) {
    setExpandedCatalogCategories(current => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  function startEditCategory(category: string) {
    setEditingCategory(category);
    setEditingCategoryName(category);
    setExpandedCatalogCategories(current => new Set(current).add(category));
  }

  function submitCategoryEdit(event: FormEvent) {
    event.preventDefault();
    const newName = editingCategoryName.trim();
    if (!editingCategory || !newName) return;
    renameCategoryMutation.mutate({ currentName: editingCategory, newName });
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <Shell>
      <TopBar
        title="Romaneio"
        subtitle="Equipamentos por projeto"
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta')}>
              Conta
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />
      <main className="page-scroll">
        <section className="page-card romaneio-panel">
          <div className="admin-toolbar">
            <div className="sec">Romaneios</div>
            <button className="primary-button" type="button" onClick={() => navigate('/romaneio/novo')}>
              Criar romaneio
            </button>
          </div>
          <div className="filter-tabs" role="tablist" aria-label="Áreas do romaneio">
            <button className={`filter-tab ${tab === 'romaneios' ? 'active' : ''}`} type="button" onClick={() => setTab('romaneios')}>Romaneios</button>
            {isManager && <button className={`filter-tab ${tab === 'equipamentos' ? 'active' : ''}`} type="button" onClick={() => setTab('equipamentos')}>Equipamentos</button>}
            {isManager && <button className={`filter-tab ${tab === 'notificacoes' ? 'active' : ''}`} type="button" onClick={() => setTab('notificacoes')}>E-mails</button>}
          </div>
        </section>

        {tab === 'romaneios' && (
          <>
            {!!(draftsQuery.data || []).length && (
              <section className="page-card romaneio-panel">
                <div className="admin-section-head">
                  <div>
                    <div className="sec">Rascunhos</div>
                    <div className="rel-meta">{draftsQuery.data?.length || 0} romaneio(s) em andamento</div>
                  </div>
                </div>
                <div className="romaneio-list">
                  {(draftsQuery.data || []).map(draft => (
                    <article className="report-card" key={draft.id}>
                      <div className="report-card-head">
                        <div>
                          <div className="report-title">{draft.title || 'Romaneio em andamento'}</div>
                          <div className="report-subtitle">
                            {draft.project?.code || draft.projectId || 'Projeto'} · {draftDateLabel(draft)} · {draftItemCount(draft)} item(ns)
                          </div>
                          {draft.updatedAt && <div className="rel-meta">Salvo em {formatDate(draft.updatedAt)}</div>}
                        </div>
                        <div className="report-card-actions">
                          <button className="mini-btn alt" type="button" onClick={() => navigate(`/romaneio/novo?draft=${draft.id}`)}>
                            Continuar
                          </button>
                          <button className="mini-btn danger" type="button" onClick={() => removeDraftMutation.mutate(draft.id)}>
                            Excluir
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="page-card romaneio-panel">
              <div className="admin-form-grid manager-header-grid">
                <label className="field-group">
                  <span>Pesquisa</span>
                  <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Projeto, placa, motorista ou item" />
                </label>
                <label className="field-group">
                  <span>Projeto</span>
                  <select value={projectId} onChange={event => setProjectId(event.target.value)}>
                    <option value="">Todos</option>
                    {(projectsQuery.data || []).map(project => (
                      <option key={project.id} value={project.id}>Missão {project.code} - {project.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            {romaneiosQuery.isLoading && <section className="page-card romaneio-panel">Carregando romaneios...</section>}
            {!romaneiosQuery.isLoading && !groupedRomaneios.length && <section className="page-card romaneio-panel">Nenhum romaneio encontrado.</section>}
            {groupedRomaneios.map(([projectName, items]) => (
              <section className="page-card romaneio-panel" key={projectName}>
                <div className="admin-section-head">
                  <div>
                    <div className="sec">{projectName}</div>
                    <div className="rel-meta">{items.length} romaneio(s)</div>
                  </div>
                </div>
                <div className="romaneio-list">
                  {items.map(item => (
                    <article className="report-card" key={item.id}>
                      <div className="report-card-head">
                        <div>
                          <div className="report-title">{formatDate(item.romaneioDate)} · {item.vehiclePlate}</div>
                          <div className="report-subtitle">{item.driverName} · {item.items.length} item(ns)</div>
                          {item.emailStatus && <div className="rel-meta">E-mail: {item.emailStatus}{item.emailError ? ` (${item.emailError})` : ''}</div>}
                        </div>
                        <div className="report-download-actions">
                          {item.pdfUrl && <button className="secondary-button" type="button" onClick={() => downloadFile(item.id, 'pdf', item.pdfUrl)}>PDF</button>}
                          {item.docxUrl && <button className="secondary-button" type="button" onClick={() => downloadFile(item.id, 'docx', item.docxUrl)}>DOCX</button>}
                        </div>
                      </div>
                      <div className="rel-meta">{item.items.slice(0, 4).map(part => [part.itemCode, part.itemName].filter(Boolean).join(' - ')).join(' · ')}</div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}

        {tab === 'equipamentos' && isManager && (
          <>
            <section className="page-card romaneio-panel">
              <form className="admin-form-grid manager-header-grid" onSubmit={submitCatalog}>
                <label className="field-group">
                  <span>Código</span>
                  <input value={catalogForm.code || ''} onChange={event => setCatalogForm({ ...catalogForm, code: event.target.value })} placeholder="Opcional" />
                </label>
                <label className="field-group">
                  <span>Item</span>
                  <input value={catalogForm.name} onChange={event => setCatalogForm({ ...catalogForm, name: event.target.value })} required />
                </label>
                <label className="field-group">
                  <span>Categoria</span>
                  <select
                    value={catalogCategoryMode === 'new' ? NEW_CATEGORY_VALUE : catalogForm.categoryName}
                    onChange={event => handleCatalogCategoryChange(event.target.value)}
                    required
                  >
                    <option value="">Selecione</option>
                    {catalogCategories.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                    <option value={NEW_CATEGORY_VALUE}>Adicionar categoria</option>
                  </select>
                  {catalogCategoryMode === 'new' ? (
                    <input
                      value={catalogForm.categoryName}
                      onChange={event => setCatalogForm({ ...catalogForm, categoryName: event.target.value })}
                      placeholder="Nova categoria"
                      required
                    />
                  ) : null}
                </label>
                <label className="field-group">
                  <span>Tipo</span>
                  <select value={catalogForm.kind} onChange={event => setCatalogForm({ ...catalogForm, kind: event.target.value as RomaneioCatalogPayload['kind'] })}>
                    <option value="EQUIPMENT">Equipamento</option>
                    <option value="CONNECTION">Conexão</option>
                  </select>
                </label>
                <label className="field-group">
                  <span>Unidade</span>
                  <select value={catalogForm.measureType} onChange={event => {
                    const measureType = event.target.value as RomaneioMeasureType;
                    setCatalogForm({ ...catalogForm, measureType, defaultUnitLabel: measureLabels[measureType] });
                  }}>
                    <option value="UNIT">Unidade</option>
                    <option value="LENGTH">Comprimento</option>
                    <option value="WEIGHT">Peso</option>
                  </select>
                </label>
                <label className="checkbox-line">
                  <input type="checkbox" checked={catalogForm.isSerialized} onChange={event => setCatalogForm({ ...catalogForm, isSerialized: event.target.checked })} />
                  item único
                </label>
                <div className="admin-form-actions field-group-wide">
                  <button className="primary-button" type="submit" disabled={saveCatalogMutation.isPending}>Adicionar item</button>
                </div>
              </form>
            </section>
            <section className="page-card romaneio-panel">
              <div className="romaneio-accordion-list">
                {groupedCatalog.map(([category, items]) => {
                  const expanded = expandedCatalogCategories.has(category);
                  return (
                    <div className="romaneio-accordion" key={category}>
                      <button
                        className="romaneio-accordion-head"
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => toggleCatalogCategory(category)}
                      >
                        <span className="romaneio-accordion-title">{category}</span>
                        <span className="romaneio-accordion-count">{items.length}</span>
                        <span className="romaneio-accordion-icon" aria-hidden="true">{expanded ? '-' : '+'}</span>
                      </button>
                      {expanded && (
                        <div className="romaneio-catalog-list">
                          <div className="romaneio-category-actions">
                            <button className="mini-btn alt" type="button" onClick={() => startEditCategory(category)}>
                              Editar categoria
                            </button>
                          </div>
                          {editingCategory === category ? (
                            <form className="admin-inline-form romaneio-category-edit" onSubmit={submitCategoryEdit}>
                              <div className="admin-form-grid manager-header-grid">
                                <label className="field-group">
                                  <span>Nome da categoria</span>
                                  <input value={editingCategoryName} onChange={event => setEditingCategoryName(event.target.value)} required />
                                </label>
                                <div className="admin-form-actions field-group-wide">
                                  <button className="primary-button" type="submit" disabled={renameCategoryMutation.isPending}>Salvar categoria</button>
                                  <button className="secondary-button" type="button" onClick={() => { setEditingCategory(''); setEditingCategoryName(''); }}>Cancelar</button>
                                </div>
                              </div>
                            </form>
                          ) : null}
                          {items.map(item => (
                            <div className="romaneio-catalog-row" key={item.id}>
                              <div className="romaneio-catalog-row-main">
                                <div>
                                  <strong>{[item.code, item.name].filter(Boolean).join(' - ')}</strong>
                                  <div className="rel-meta">{item.kind === 'CONNECTION' ? 'Conexão' : 'Equipamento'} · {item.defaultUnitLabel}</div>
                                </div>
                                <div className="report-card-actions">
                                  <button className="mini-btn alt" type="button" onClick={() => editCatalog(item)}>Editar</button>
                                  <button className="mini-btn danger" type="button" onClick={() => removeCatalogMutation.mutate(item.id)}>Remover</button>
                                </div>
                              </div>
                              {editingCatalogId === item.id && (
                                <form className="admin-inline-form romaneio-inline-edit" onSubmit={event => submitCatalogEdit(event, item.id)}>
                                  <div className="admin-form-grid manager-header-grid">
                                    <label className="field-group">
                                      <span>Código</span>
                                      <input value={editCatalogForm.code || ''} onChange={event => setEditCatalogForm({ ...editCatalogForm, code: event.target.value })} placeholder="Opcional" />
                                    </label>
                                    <label className="field-group">
                                      <span>Item</span>
                                      <input value={editCatalogForm.name} onChange={event => setEditCatalogForm({ ...editCatalogForm, name: event.target.value })} required />
                                    </label>
                                    <label className="field-group">
                                      <span>Categoria</span>
                                      <select
                                        value={editCategoryMode === 'new' ? NEW_CATEGORY_VALUE : editCatalogForm.categoryName}
                                        onChange={event => handleEditCategoryChange(event.target.value)}
                                        required
                                      >
                                        <option value="">Selecione</option>
                                        {catalogCategories.map(categoryOption => (
                                          <option key={categoryOption} value={categoryOption}>{categoryOption}</option>
                                        ))}
                                        <option value={NEW_CATEGORY_VALUE}>Adicionar categoria</option>
                                      </select>
                                      {editCategoryMode === 'new' ? (
                                        <input
                                          value={editCatalogForm.categoryName}
                                          onChange={event => setEditCatalogForm({ ...editCatalogForm, categoryName: event.target.value })}
                                          placeholder="Nova categoria"
                                          required
                                        />
                                      ) : null}
                                    </label>
                                    <label className="field-group">
                                      <span>Tipo</span>
                                      <select value={editCatalogForm.kind} onChange={event => setEditCatalogForm({ ...editCatalogForm, kind: event.target.value as RomaneioCatalogPayload['kind'] })}>
                                        <option value="EQUIPMENT">Equipamento</option>
                                        <option value="CONNECTION">Conexão</option>
                                      </select>
                                    </label>
                                    <label className="field-group">
                                      <span>Unidade</span>
                                      <select value={editCatalogForm.measureType} onChange={event => {
                                        const measureType = event.target.value as RomaneioMeasureType;
                                        setEditCatalogForm({ ...editCatalogForm, measureType, defaultUnitLabel: measureLabels[measureType] });
                                      }}>
                                        <option value="UNIT">Unidade</option>
                                        <option value="LENGTH">Comprimento</option>
                                        <option value="WEIGHT">Peso</option>
                                      </select>
                                    </label>
                                    <label className="checkbox-line">
                                      <input type="checkbox" checked={editCatalogForm.isSerialized} onChange={event => setEditCatalogForm({ ...editCatalogForm, isSerialized: event.target.checked })} />
                                      item único
                                    </label>
                                    <div className="admin-form-actions field-group-wide">
                                      <button className="primary-button" type="submit" disabled={updateCatalogMutation.isPending}>Salvar edição</button>
                                      <button className="secondary-button" type="button" onClick={() => { setEditingCatalogId(null); setEditCatalogForm(catalogEmpty()); setEditCategoryMode('existing'); }}>Cancelar</button>
                                    </div>
                                  </div>
                                </form>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!catalogQuery.isLoading && !groupedCatalog.length && (
                  <div className="rel-meta">Nenhum item cadastrado.</div>
                )}
                {catalogQuery.isLoading && (
                  <div className="rel-meta">Carregando equipamentos...</div>
                )}
                </div>
              </section>
          </>
        )}

        {tab === 'notificacoes' && isManager && (
          <section className="page-card romaneio-panel">
            <form className="admin-form-grid manager-header-grid" onSubmit={event => { event.preventDefault(); saveRecipientMutation.mutate(); }}>
              <label className="field-group">
                <span>Nome</span>
                <input value={recipientName} onChange={event => setRecipientName(event.target.value)} />
              </label>
              <label className="field-group">
                <span>E-mail</span>
                <input type="email" value={recipientEmail} onChange={event => setRecipientEmail(event.target.value)} required />
              </label>
              <div className="admin-form-actions field-group-wide">
                <button className="primary-button" type="submit" disabled={saveRecipientMutation.isPending}>Salvar destinatário</button>
              </div>
            </form>
            <div className="romaneio-catalog-list">
              {(recipientsQuery.data || []).map(item => (
                <div className="romaneio-catalog-row" key={item.id}>
                  <div>
                    <strong>{item.name || item.email}</strong>
                    <div className="rel-meta">{item.email} · {item.isActive ? 'ativo' : 'inativo'}</div>
                  </div>
                  <button className="mini-btn danger" type="button" onClick={() => removeRecipientMutation.mutate(item.id)}>Remover</button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </Shell>
  );
}
