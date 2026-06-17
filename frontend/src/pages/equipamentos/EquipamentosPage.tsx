import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type { CompanyEquipment, EquipmentCategory, EquipmentCategoryPayload, EquipmentPayload } from '../../api/equipamentos';
import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { useToast } from '../../components/ui/Toast';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useEquipamentoMutations, useEquipamentos, useEquipmentCategories } from '../../hooks/useEquipamentos';
import { CategoryFormModal } from './CategoryFormModal';
import { CategoryManager } from './CategoryManager';
import { EquipmentDashboard } from './EquipmentDashboard';
import { EquipmentFormModal } from './EquipmentFormModal';
import { RdoSlotsConfig } from './RdoSlotsConfig';
import { calibrationStatus, formatDate, statusLabel } from './equipmentStatus';

type ActiveTab = { kind: 'category'; id: string } | { kind: 'dashboard' } | { kind: 'config' };

function StatusBadge({ item }: { item: CompanyEquipment }) {
  const status = calibrationStatus(item);
  if (status === 'none') return null;
  return <span className={`equip-badge equip-badge-${status}`}>{statusLabel[status]}</span>;
}

export function EquipamentosPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const showToast = useToast();
  const isManager = user?.accountType === 'ADMIN' || Boolean(user?.moduleRoles?.includes('equipamentos:manager'));

  const categoriesQuery = useEquipmentCategories();
  const equipmentQuery = useEquipamentos();
  const mutations = useEquipamentoMutations();

  const categories = useMemo(
    () => [...(categoriesQuery.data || [])].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [categoriesQuery.data]
  );
  const equipment = equipmentQuery.data || [];

  const [activeTab, setActiveTab] = useState<ActiveTab>({ kind: 'dashboard' });
  const [equipmentForm, setEquipmentForm] = useState<{ category: EquipmentCategory; item: CompanyEquipment | null } | null>(null);
  const [categoryForm, setCategoryForm] = useState<{ open: boolean; category: EquipmentCategory | null }>({ open: false, category: null });
  const [categorySearch, setCategorySearch] = useState('');

  const selectedCategory = activeTab.kind === 'category' ? categories.find(c => c.id === activeTab.id) || null : null;
  const activeTabKey = activeTab.kind === 'category' ? activeTab.id : activeTab.kind;
  // Limpa a busca ao trocar de aba/categoria.
  useEffect(() => { setCategorySearch(''); }, [activeTabKey]);
  const allCategoryEquipment = selectedCategory ? equipment.filter(item => item.categoryId === selectedCategory.id) : [];
  const categoryEquipment = (() => {
    const query = categorySearch.trim().toLowerCase();
    if (!query) return allCategoryEquipment;
    return allCategoryEquipment.filter(item => {
      const haystack = [item.code, item.name, ...Object.values(item.attributes || {}).map(value => String(value ?? ''))]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  })();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  function handleEquipmentSubmit(payload: EquipmentPayload) {
    const onDone = () => {
      showToast('Equipamento salvo.', 'success');
      setEquipmentForm(null);
    };
    const onError = (error: unknown) => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error');
    if (equipmentForm?.item) {
      mutations.updateEquipment.mutate({ id: equipmentForm.item.id, payload }, { onSuccess: onDone, onError });
    } else {
      mutations.createEquipment.mutate(payload, { onSuccess: onDone, onError });
    }
  }

  function handleCategorySubmit(payload: EquipmentCategoryPayload) {
    const close = () => setCategoryForm({ open: false, category: null });
    const onError = (error: unknown) => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error');
    if (categoryForm.category) {
      mutations.updateCategory.mutate({ id: categoryForm.category.id, payload }, {
        onSuccess: () => { showToast('Categoria salva.', 'success'); close(); },
        onError
      });
    } else {
      mutations.createCategory.mutate({ ...payload, order: categories.length }, {
        onSuccess: created => {
          const imported = created.importedFromRomaneio || 0;
          showToast(imported > 0 ? `Categoria criada. ${imported} equipamento(s) importado(s) do romaneio.` : 'Categoria salva.', 'success');
          close();
        },
        onError
      });
    }
  }

  function handleRemoveEquipment(item: CompanyEquipment) {
    if (!window.confirm(`Remover o equipamento "${item.code}"?`)) return;
    mutations.removeEquipment.mutate(item.id, {
      onSuccess: () => showToast('Equipamento removido.', 'success'),
      onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível remover.', 'error')
    });
  }

  function handleRemoveCategory(category: EquipmentCategory) {
    if (!window.confirm(`Remover a categoria "${category.name}"?`)) return;
    mutations.removeCategory.mutate(category.id, {
      onSuccess: () => showToast('Categoria removida.', 'success'),
      onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível remover.', 'error')
    });
  }

  const savingEquipment = mutations.createEquipment.isPending || mutations.updateEquipment.isPending;
  const savingCategory = mutations.createCategory.isPending || mutations.updateCategory.isPending;

  return (
    <Shell>
      <TopBar
        title="Equipamentos"
        subtitle="Cadastro, calibração e documentação técnica"
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta', { state: accountPageStateFromPath(location.pathname) })}>Conta</button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>Sair</button>
          </>
        }
      />
      <main className="page-scroll equip-page">
        <div className="equip-layout">
          <nav className="equip-nav" aria-label="Áreas de Equipamentos">
            <button className={`equip-nav-item ${activeTab.kind === 'dashboard' ? 'active' : ''}`} type="button" aria-current={activeTab.kind === 'dashboard'} onClick={() => setActiveTab({ kind: 'dashboard' })}>
              <span className="equip-nav-ico" aria-hidden="true">◧</span>
              <span className="equip-nav-label">Dashboard</span>
            </button>
            {categories.length > 0 && <div className="equip-nav-group">Categorias</div>}
            {categories.map(category => {
              const selected = activeTab.kind === 'category' && activeTab.id === category.id;
              const count = equipment.filter(item => item.categoryId === category.id).length;
              return (
                <button
                  key={category.id}
                  className={`equip-nav-item ${selected ? 'active' : ''}`}
                  type="button"
                  aria-current={selected}
                  onClick={() => setActiveTab({ kind: 'category', id: category.id })}
                >
                  <span className="equip-nav-label">{category.name}</span>
                  <span className="equip-nav-count">{count}</span>
                </button>
              );
            })}
            {isManager && (
              <button className={`equip-nav-item equip-nav-config ${activeTab.kind === 'config' ? 'active' : ''}`} type="button" aria-current={activeTab.kind === 'config'} onClick={() => setActiveTab({ kind: 'config' })}>
                <span className="equip-nav-ico" aria-hidden="true">⚙</span>
                <span className="equip-nav-label">Configurações</span>
              </button>
            )}
          </nav>

          <div className="equip-main">
        {(categoriesQuery.isLoading || equipmentQuery.isLoading) && (
          <section className="page-card"><p>Carregando…</p></section>
        )}

        {activeTab.kind === 'dashboard' && (
          <EquipmentDashboard categories={categories} equipment={equipment} />
        )}

        {activeTab.kind === 'category' && selectedCategory && (
          <section className="page-card">
            <div className="admin-toolbar">
              <div className="sec">{selectedCategory.name}</div>
              {isManager && (
                <button className="mini-btn" type="button" onClick={() => setEquipmentForm({ category: selectedCategory, item: null })}>+ Novo equipamento</button>
              )}
            </div>
            {allCategoryEquipment.length > 0 && (
              <div className="equip-search">
                <input
                  type="search"
                  value={categorySearch}
                  placeholder={`Buscar em ${selectedCategory.name}… (código, nome, nº de série)`}
                  onChange={event => setCategorySearch(event.target.value)}
                  aria-label={`Buscar equipamento em ${selectedCategory.name}`}
                />
                {categorySearch.trim() && (
                  <span className="equip-search-count">{categoryEquipment.length} de {allCategoryEquipment.length}</span>
                )}
              </div>
            )}
            {allCategoryEquipment.length === 0 && <p className="rel-meta">Nenhum equipamento nesta categoria.</p>}
            {allCategoryEquipment.length > 0 && categoryEquipment.length === 0 && <p className="rel-meta">Nenhum equipamento encontrado para “{categorySearch.trim()}”.</p>}
            <div className="equip-grid">
              {categoryEquipment.map(item => (
                <article className="report-card equip-card" key={item.id}>
                  <div className="equip-card-head">
                    <strong>{item.code}</strong>
                    <StatusBadge item={item} />
                  </div>
                  <div className="equip-card-name">{item.name}</div>
                  <dl className="equip-attrs">
                    {selectedCategory.fieldSchema.map(field => (
                      <div key={field.key}>
                        <dt>{field.label}</dt>
                        <dd>{String(item.attributes?.[field.key] ?? '—') || '—'}</dd>
                      </div>
                    ))}
                    {item.hasCalibration && (
                      <>
                        <div><dt>Calibração</dt><dd>{formatDate(item.calibratedAt)}</dd></div>
                        <div><dt>Vencimento</dt><dd>{formatDate(item.expiresAt)}</dd></div>
                      </>
                    )}
                  </dl>
                  <div className="equip-card-links">
                    {item.calibrationCertificate && (
                      <a className="equip-link" href={item.calibrationCertificate.publicUrl} target="_blank" rel="noreferrer">Certificado</a>
                    )}
                    {item.technicalDoc && (
                      <a className="equip-link" href={item.technicalDoc.publicUrl} target="_blank" rel="noreferrer">Doc. técnica</a>
                    )}
                  </div>
                  {isManager && (
                    <div className="report-card-actions">
                      <button className="mini-btn alt" type="button" onClick={() => setEquipmentForm({ category: selectedCategory, item })}>Editar</button>
                      <button className="mini-btn danger" type="button" onClick={() => handleRemoveEquipment(item)}>Remover</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab.kind === 'config' && isManager && (
          <>
          <CategoryManager
            categories={categories}
            onAdd={() => setCategoryForm({ open: true, category: null })}
            onEdit={category => setCategoryForm({ open: true, category })}
            onRemove={handleRemoveCategory}
          />
          <RdoSlotsConfig categories={categories} />
          </>
        )}
          </div>
        </div>
      </main>

      {equipmentForm && (
        <EquipmentFormModal
          open
          category={equipmentForm.category}
          equipment={equipmentForm.item}
          saving={savingEquipment}
          onClose={() => setEquipmentForm(null)}
          onSubmit={handleEquipmentSubmit}
        />
      )}

      {categoryForm.open && (
        <CategoryFormModal
          open
          category={categoryForm.category}
          saving={savingCategory}
          onClose={() => setCategoryForm({ open: false, category: null })}
          onSubmit={handleCategorySubmit}
        />
      )}
    </Shell>
  );
}
