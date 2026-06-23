import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';

import type { CompanyEquipment, EquipmentCategory, EquipmentCategoryPayload, EquipmentPayload, ImageUpload } from '../../api/equipamentos';
import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { useToast } from '../../components/ui/Toast';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useEquipamentoMutations, useEquipamentos, useEquipmentCategories, useRdoSlots, useUnitsCatalog } from '../../hooks/useEquipamentos';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CategoryFormModal } from './CategoryFormModal';
import { CategoryManager } from './CategoryManager';
import { EquipmentCard } from './EquipmentCard';
import { EquipmentDashboard } from './EquipmentDashboard';
import { SearchBar } from '../../components/ui/SearchBar';
import { EquipmentFormModal } from './EquipmentFormModal';
import { TechnicalDataModal } from './TechnicalDataModal';
import { NotificationsConfig } from './NotificationsConfig';
import { RdoSlotsConfig } from './RdoSlotsConfig';
import { ProjectSortButton, type ProjectSortDirection } from '../../utils/projectSort';

type ActiveTab = { kind: 'category'; id: string } | { kind: 'dashboard' } | { kind: 'config' } | { kind: 'notifications' };

const EQUIPMENT_TUTORIAL_STORAGE_KEY_PREFIX = 'filtrovali-equipment-tutorial-done';

function normalizeTutorialIdentity(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function equipmentTutorialUserKey(user: ReturnType<typeof useAuth>['user'], isManager: boolean) {
  const identity = normalizeTutorialIdentity(user?.email)
    || normalizeTutorialIdentity(user?.username)
    || normalizeTutorialIdentity(user?.id);
  return identity ? `${isManager ? 'manager' : 'viewer'}:${identity}` : '';
}

function equipmentTutorialStorageKey(identity: string) {
  return `${EQUIPMENT_TUTORIAL_STORAGE_KEY_PREFIX}:${identity}`;
}

function hasDoneEquipmentTutorial(identity: string) {
  try {
    return localStorage.getItem(equipmentTutorialStorageKey(identity)) === '1';
  } catch {
    return false;
  }
}

function markEquipmentTutorialDone(identity: string) {
  try {
    localStorage.setItem(equipmentTutorialStorageKey(identity), '1');
  } catch {
    // Ignore unavailable localStorage; the in-memory guard still avoids repeated auto-starts.
  }
}

function escapeCssSelectorValue(value: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

export function EquipamentosPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const showToast = useToast();
  const isManager = user?.accountType === 'ADMIN' || Boolean(user?.moduleRoles?.includes('equipamentos:manager'));

  const categoriesQuery = useEquipmentCategories();
  const equipmentQuery = useEquipamentos();
  const rdoSlotsQuery = useRdoSlots(isManager);
  const unitsCatalogQuery = useUnitsCatalog();
  const mutations = useEquipamentoMutations();

  const categories = useMemo(
    () => [...(categoriesQuery.data || [])].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [categoriesQuery.data]
  );
  const equipment = equipmentQuery.data || [];
  // Categorias atualmente vinculadas a algum slot de relatório (override ou padrão).
  const rdoLinkedCategoryIds = useMemo(
    () => new Set((rdoSlotsQuery.data || []).flatMap(slot => slot.categoryIds)),
    [rdoSlotsQuery.data]
  );

  const [activeTab, setActiveTab] = useState<ActiveTab>({ kind: 'dashboard' });
  const [equipmentForm, setEquipmentForm] = useState<{ category: EquipmentCategory; item: CompanyEquipment | null } | null>(null);
  const [technicalForm, setTechnicalForm] = useState<{ category: EquipmentCategory; item: CompanyEquipment } | null>(null);
  const [categoryForm, setCategoryForm] = useState<{ open: boolean; category: EquipmentCategory | null }>({ open: false, category: null });
  const [categorySearch, setCategorySearch] = useState('');
  const [equipmentSort, setEquipmentSort] = useState<ProjectSortDirection>('asc');
  const [confirm, setConfirm] = useState<{ title: string; description?: string; highlight?: string; onConfirm: () => void } | null>(null);
  const tutorialStartedRef = useRef(false);

  const selectedCategory = activeTab.kind === 'category' ? categories.find(c => c.id === activeTab.id) || null : null;
  const activeTabKey = activeTab.kind === 'category' ? activeTab.id : activeTab.kind;
  // Limpa a busca ao trocar de aba/categoria.
  useEffect(() => { setCategorySearch(''); }, [activeTabKey]);
  const allCategoryEquipment = selectedCategory ? equipment.filter(item => item.categoryId === selectedCategory.id) : [];
  const categoryEquipment = (() => {
    const query = categorySearch.trim().toLowerCase();
    const filtered = !query ? allCategoryEquipment : allCategoryEquipment.filter(item => {
      const haystack = [item.code, item.name, ...Object.values(item.attributes || {}).map(value => String(value ?? ''))]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
    const dir = equipmentSort === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { sensitivity: 'base' }) * dir);
  })();
  const tutorialTarget = useMemo(() => {
    const candidates = categories.map(category => {
      const items = equipment.filter(item => item.categoryId === category.id);
      const certificateItem = items.find(item => item.calibrationCertificate) || null;
      const generatedTechnicalItem = category.technicalDocEnabled
        ? items.find(item => item.technicalDocGenerated || item.technicalDoc) || null
        : null;
      const technicalItem = category.technicalDocEnabled
        ? generatedTechnicalItem || items[0] || null
        : null;
      const score = (items.length ? 1 : 0)
        + (certificateItem ? 8 : 0)
        + (technicalItem ? 4 : 0)
        + (generatedTechnicalItem ? 2 : 0)
        + (category.technicalSchema?.length ? 1 : 0);
      return { category, items, certificateItem, technicalItem, generatedTechnicalItem, score };
    });
    return candidates
      .filter(candidate => candidate.items.length > 0 || categories.length === 1)
      .sort((a, b) => b.score - a.score || a.category.order - b.category.order || a.category.name.localeCompare(b.category.name))[0] || null;
  }, [categories, equipment]);
  const tutorialReady = !categoriesQuery.isLoading && !equipmentQuery.isLoading;
  const tutorialUserKey = equipmentTutorialUserKey(user, isManager);

  const startEquipmentTutorial = useCallback(() => {
    if (!tutorialUserKey) return;
    if (document.body.classList.contains('driver-active')) return;

    tutorialStartedRef.current = true;
    markEquipmentTutorialDone(tutorialUserKey);
    setTechnicalForm(null);
    setActiveTab({ kind: 'dashboard' });

    const target = tutorialTarget;
    const category = target?.category || null;
    const navSelector = window.matchMedia('(max-width: 900px)').matches ? '[data-equip-mobile-nav]' : '[data-equip-nav]';
    const steps: DriveStep[] = [
      {
        element: '[data-equip-dashboard]',
        popover: {
          title: 'Dashboard de equipamentos',
          description:
            'Esta visão reúne os equipamentos cadastrados e resume a situação de calibração: data calibrada, vencimento e status.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '[data-equip-dashboard-filters]',
        popover: {
          title: 'Filtros do dashboard',
          description:
            'Use a busca, o filtro de categoria e o filtro de status para localizar equipamentos vencidos, a vencer, calibrados ou sem calibração.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '[data-equip-dashboard-table]',
        popover: {
          title: 'Informações exibidas',
          description:
            'A tabela mostra código, nome, categoria, data de calibração, vencimento e status. O CSV exporta exatamente a lista filtrada.',
          side: 'top',
          align: 'start'
        }
      },
      {
        element: navSelector,
        popover: {
          title: 'Menu do módulo',
          description:
            'Use este menu para alternar entre o Dashboard e as categorias de equipamentos. Gestores também veem Configurações e Notificações.',
          side: 'right',
          align: 'start',
          onNextClick: (_element, _step, { driver: driverObj }) => {
            if (!category) {
              driverObj.moveNext();
              return;
            }
            setActiveTab({ kind: 'category', id: category.id });
            window.setTimeout(() => driverObj.moveNext(), 180);
          }
        }
      }
    ];

    if (category) {
      steps.push({
        element: '[data-equip-category-section]',
        popover: {
          title: `Categoria ${category.name}`,
          description:
            'Ao abrir uma categoria, os cards mostram os equipamentos daquela família, seus atributos principais e os documentos disponíveis.',
          side: 'top',
          align: 'start'
        }
      });
    }

    if (target?.certificateItem) {
      steps.push({
        element: `[data-equip-item-id="${escapeCssSelectorValue(target.certificateItem.id)}"] [data-equip-cert-link]`,
        popover: {
          title: 'Certificado de calibração',
          description:
            'Quando o equipamento possui certificado, este link abre o PDF de calibração em uma nova aba.',
          side: 'top',
          align: 'start'
        }
      });
    }

    if (target?.technicalItem && (target.technicalItem.technicalDocGenerated || target.technicalItem.technicalDoc)) {
      steps.push({
        element: `[data-equip-item-id="${escapeCssSelectorValue(target.technicalItem.id)}"] [data-equip-technical-doc-link]`,
        popover: {
          title: 'PDF dos dados técnicos',
          description:
            'Quando o datasheet já foi gerado, este botão baixa diretamente o PDF dos dados técnicos do equipamento.',
          side: 'top',
          align: 'start'
        }
      });
    }

    if (target?.technicalItem && category) {
      steps.push({
        element: `[data-equip-item-id="${escapeCssSelectorValue(target.technicalItem.id)}"] [data-equip-technical-button]`,
        popover: {
          title: 'Dados técnicos',
          description:
            'Este botão abre os dados técnicos do equipamento. Quando houver datasheet gerado, ele também pode ser baixado em PDF.',
          side: 'top',
          align: 'start',
          onNextClick: (_element, _step, { driver: driverObj }) => {
            setTechnicalForm({ category, item: target.technicalItem as CompanyEquipment });
            window.setTimeout(() => driverObj.moveNext(), 180);
          }
        }
      });
      steps.push({
        element: '[data-equip-technical-modal]',
        popover: {
          title: 'Janela de dados técnicos',
          description:
            isManager
              ? 'Aqui o gestor revisa e atualiza os campos técnicos que alimentam o datasheet do equipamento.'
              : 'Aqui o visualizador consulta os dados técnicos cadastrados para o equipamento.',
          side: 'left',
          align: 'start'
        }
      });
      if (target.generatedTechnicalItem || target.technicalItem.technicalDocGenerated || target.technicalItem.technicalDoc || isManager) {
        steps.push({
          element: '[data-equip-technical-doc-bar]',
          popover: {
            title: 'Datasheet em PDF',
            description:
              isManager
                ? 'Neste bloco o gestor baixa o datasheet existente ou gera uma nova versão quando alterar informações.'
                : 'Quando disponível, use este bloco para baixar o datasheet técnico do equipamento em PDF.',
            side: 'top',
            align: 'start'
          }
        });
      }
      if (isManager) {
        if (category.technicalSchema?.length) {
          steps.push({
            element: '[data-equip-technical-edit-fields]',
            popover: {
              title: 'Editar dados técnicos',
              description:
                'Gestores podem alterar valores, unidades, campos aplicáveis e fotos técnicas diretamente nestas seções.',
              side: 'right',
              align: 'start'
            }
          });
        }
        steps.push({
          element: '[data-equip-technical-save]',
          popover: {
            title: 'Salvar alterações',
            description:
              'Após revisar os campos, salve os dados técnicos. Se precisar de uma nova revisão, marque a opção de incrementar revisão antes de salvar.',
            side: 'top',
            align: 'end'
          }
        });
      }
    }

    const driverObj = driver({
      showProgress: true,
      progressText: '{{current}} de {{total}}',
      nextBtnText: 'Próximo →',
      prevBtnText: '← Anterior',
      doneBtnText: 'Concluir',
      allowClose: true,
      animate: true,
      smoothScroll: true,
      overlayOpacity: 0.6,
      onDestroyed: () => {
        setTechnicalForm(null);
      },
      steps
    });

    window.setTimeout(() => driverObj.drive(), 250);
  }, [isManager, tutorialTarget, tutorialUserKey]);

  useEffect(() => {
    if (!tutorialReady || !tutorialUserKey || tutorialStartedRef.current) return;
    if (hasDoneEquipmentTutorial(tutorialUserKey)) return;
    const timer = window.setTimeout(startEquipmentTutorial, 600);
    return () => window.clearTimeout(timer);
  }, [startEquipmentTutorial, tutorialReady, tutorialUserKey]);

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

  function handleTechnicalSubmit(
    technicalData: Record<string, unknown>,
    technicalFieldOverrides: Record<string, boolean>,
    photos: { add: ImageUpload[]; removeIds: string[] },
    bumpRevision: boolean
  ) {
    if (!technicalForm) return;
    mutations.updateEquipment.mutate(
      {
        id: technicalForm.item.id,
        payload: {
          technicalData,
          technicalFieldOverrides,
          ...(bumpRevision ? { bumpRevision: true } : {}),
          ...(photos.add.length ? { technicalPhotos: photos.add } : {}),
          ...(photos.removeIds.length ? { removeTechnicalPhotoIds: photos.removeIds } : {})
        }
      },
      {
        onSuccess: () => { showToast('Dados técnicos salvos.', 'success'); setTechnicalForm(null); },
        onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
      }
    );
  }

  function handleGenerateDatasheet() {
    if (!technicalForm) return;
    mutations.generateDatasheet.mutate(technicalForm.item.id, {
      onSuccess: attachment => {
        showToast('Datasheet gerado.', 'success');
        setTechnicalForm(prev => (prev
          ? { ...prev, item: { ...prev.item, technicalDocGenerated: attachment, technicalDocGeneratedOutdated: false } }
          : prev));
      },
      onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível gerar o datasheet.', 'error')
    });
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
    setConfirm({
      title: 'Remover equipamento',
      description: 'O equipamento será removido do módulo.',
      highlight: [item.code, item.name].filter(Boolean).join(' — '),
      onConfirm: () => mutations.removeEquipment.mutate(item.id, {
        onSuccess: () => showToast('Equipamento removido.', 'success'),
        onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível remover.', 'error')
      })
    });
  }

  function handleRemoveCategory(category: EquipmentCategory) {
    setConfirm({
      title: 'Remover categoria',
      description: 'A categoria será removida do módulo.',
      highlight: category.name,
      onConfirm: () => mutations.removeCategory.mutate(category.id, {
        onSuccess: () => showToast('Categoria removida.', 'success'),
        onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível remover.', 'error')
      })
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
            <button className="topbar-chip" type="button" onClick={startEquipmentTutorial}>Ver tutorial</button>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta', { state: accountPageStateFromPath(location.pathname) })}>Conta</button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>Sair</button>
          </>
        }
      />
      <main className="page-scroll equip-page">
        <div className="equip-layout">
          <nav className="equip-nav" aria-label="Áreas de Equipamentos" data-equip-nav>
            <button className={`equip-nav-item ${activeTab.kind === 'dashboard' ? 'active' : ''}`} type="button" aria-current={activeTab.kind === 'dashboard'} onClick={() => setActiveTab({ kind: 'dashboard' })} data-equip-nav-dashboard>
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
                  data-equip-category-nav
                  data-equip-category-id={category.id}
                  onClick={() => setActiveTab({ kind: 'category', id: category.id })}
                >
                  <span className="equip-nav-label">{category.name}</span>
                  <span className="equip-nav-count">{count}</span>
                </button>
              );
            })}
            {isManager && (
              <>
                <button className={`equip-nav-item equip-nav-config ${activeTab.kind === 'config' ? 'active' : ''}`} type="button" aria-current={activeTab.kind === 'config'} onClick={() => setActiveTab({ kind: 'config' })}>
                  <span className="equip-nav-ico" aria-hidden="true">⚙</span>
                  <span className="equip-nav-label">Configurações</span>
                </button>
                <button className={`equip-nav-item ${activeTab.kind === 'notifications' ? 'active' : ''}`} type="button" aria-current={activeTab.kind === 'notifications'} onClick={() => setActiveTab({ kind: 'notifications' })}>
                  <span className="equip-nav-ico" aria-hidden="true">✉</span>
                  <span className="equip-nav-label">Notificações</span>
                </button>
              </>
            )}
          </nav>

          <div className="equip-mobile-nav" data-equip-mobile-nav>
            <label className="equip-mobile-nav-label" htmlFor="equip-section-select">Seção do módulo</label>
            <select
              id="equip-section-select"
              className="equip-nav-select"
              value={activeTab.kind === 'category' ? `cat:${activeTab.id}` : activeTab.kind}
              onChange={event => {
                const value = event.target.value;
                if (value === 'dashboard') setActiveTab({ kind: 'dashboard' });
                else if (value === 'config') setActiveTab({ kind: 'config' });
                else if (value === 'notifications') setActiveTab({ kind: 'notifications' });
                else if (value.startsWith('cat:')) setActiveTab({ kind: 'category', id: value.slice(4) });
              }}
            >
              <option value="dashboard">Dashboard</option>
              {categories.length > 0 && (
                <optgroup label="Categorias">
                  {categories.map(category => {
                    const count = equipment.filter(item => item.categoryId === category.id).length;
                    return <option key={category.id} value={`cat:${category.id}`}>{category.name} ({count})</option>;
                  })}
                </optgroup>
              )}
              {isManager && (
                <optgroup label="Gestão">
                  <option value="config">Configurações</option>
                  <option value="notifications">Notificações</option>
                </optgroup>
              )}
            </select>
          </div>

          <div className="equip-main">
        {(categoriesQuery.isLoading || equipmentQuery.isLoading) && (
          <section className="page-card"><p>Carregando…</p></section>
        )}

        {activeTab.kind === 'dashboard' && (
          <EquipmentDashboard categories={categories} equipment={equipment} />
        )}

        {activeTab.kind === 'category' && selectedCategory && (
          <section className="page-card" data-equip-category-section>
            <div className="admin-toolbar">
              <div className="sec">{selectedCategory.name}</div>
              <div className="equip-cat-tools">
                <ProjectSortButton direction={equipmentSort} onToggle={() => setEquipmentSort(equipmentSort === 'asc' ? 'desc' : 'asc')} />
                {isManager && (
                  <button className="mini-btn" type="button" onClick={() => setEquipmentForm({ category: selectedCategory, item: null })}>+ Novo equipamento</button>
                )}
              </div>
            </div>
            {allCategoryEquipment.length > 0 && (
              <SearchBar
                value={categorySearch}
                onChange={setCategorySearch}
                placeholder={`Buscar em ${selectedCategory.name}… (código, nome, nº de série)`}
                ariaLabel={`Buscar equipamento em ${selectedCategory.name}`}
                count={{ shown: categoryEquipment.length, total: allCategoryEquipment.length }}
              />
            )}
            {allCategoryEquipment.length === 0 && <p className="rel-meta">Nenhum equipamento nesta categoria.</p>}
            {allCategoryEquipment.length > 0 && categoryEquipment.length === 0 && <p className="rel-meta">Nenhum equipamento encontrado para “{categorySearch.trim()}”.</p>}
            <div className="equip-grid">
              {categoryEquipment.map(item => (
                <EquipmentCard
                  key={item.id}
                  item={item}
                  category={selectedCategory}
                  isManager={isManager}
                  onEdit={() => setEquipmentForm({ category: selectedCategory, item })}
                  onRemove={() => handleRemoveEquipment(item)}
                  onOpenTechnical={() => setTechnicalForm({ category: selectedCategory, item })}
                />
              ))}
            </div>
          </section>
        )}

        {activeTab.kind === 'config' && isManager && (
          <>
          <CategoryManager
            categories={categories}
            rdoLinkedCategoryIds={rdoLinkedCategoryIds}
            onAdd={() => setCategoryForm({ open: true, category: null })}
            onEdit={category => setCategoryForm({ open: true, category })}
            onRemove={handleRemoveCategory}
          />
          <RdoSlotsConfig categories={categories} />
          </>
        )}

        {activeTab.kind === 'notifications' && isManager && (
          <NotificationsConfig />
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

      {technicalForm && (
        <TechnicalDataModal
          open
          category={technicalForm.category}
          equipment={technicalForm.item}
          unitsCatalog={unitsCatalogQuery.data || []}
          saving={mutations.updateEquipment.isPending}
          isManager={isManager}
          onClose={() => setTechnicalForm(null)}
          onSubmit={handleTechnicalSubmit}
          onGenerate={handleGenerateDatasheet}
          generating={mutations.generateDatasheet.isPending}
        />
      )}

      {categoryForm.open && (
        <CategoryFormModal
          open
          category={categoryForm.category}
          saving={savingCategory}
          unitsCatalog={unitsCatalogQuery.data || []}
          onClose={() => setCategoryForm({ open: false, category: null })}
          onSubmit={handleCategorySubmit}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ''}
        description={confirm?.description}
        highlight={confirm?.highlight}
        onConfirm={() => { confirm?.onConfirm(); setConfirm(null); }}
        onCancel={() => setConfirm(null)}
      />
    </Shell>
  );
}
