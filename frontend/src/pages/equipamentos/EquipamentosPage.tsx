import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';

import type { CompanyEquipment, EquipmentCategory, EquipmentCategoryPayload, EquipmentPayload, ImageUpload } from '../../api/equipamentos';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import { Button } from '../../components/ui/ds';
import { PageHeader } from '../../layout/PageHeader';
import { useEquipamentoMutations, useEquipamentos, useEquipmentCategories, useRdoSlots, useUnitsCatalog } from '../../hooks/useEquipamentos';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CategoryFormModal } from './CategoryFormModal';
import { CategoryManager } from './CategoryManager';
import { EquipmentCategorySection } from './EquipmentCategorySection';
import { EquipmentDashboard } from './EquipmentDashboard';
import { SearchBar } from '../../components/ui/SearchBar';
import { EquipmentFormModal } from './EquipmentFormModal';
import { TechnicalDataModal } from './TechnicalDataModal';
import { NotificationsConfig } from './NotificationsConfig';
import { RdoSlotsConfig } from './RdoSlotsConfig';
import { type ProjectSortDirection } from '../../utils/projectSort';
import { useUrlParamState } from '../../hooks/useUrlParamState';
import { MaintenanceConfigPanel } from './MaintenanceConfigPanel';
import { MaintenanceHistoryModal } from './MaintenanceHistoryModal';
import { OperationalModuleAppShell } from '../OperationalModuleAppShell';
import { equipmentTabFromParam, filterAndSortEquipment, parseEquipmentTabParam, type EquipmentTab } from './equipmentCategoryView';
import './EquipamentosPage.ds.css';

type ActiveTab = { kind: EquipmentTab };

const EQUIPMENT_TUTORIAL_STORAGE_KEY_PREFIX = 'filtrovali-equipment-tutorial-done';

function normalizeTutorialIdentity(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function equipmentTutorialUserKey(user: ReturnType<typeof useAuth>['user'], isManager: boolean) {
  const identity = normalizeTutorialIdentity(user?.email) || normalizeTutorialIdentity(user?.username) || normalizeTutorialIdentity(user?.id);
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
  const { user } = useAuth();
  const showToast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const isManager = user?.accountType === 'ADMIN' || Boolean(user?.moduleRoles?.includes('equipamentos:manager'));

  const categoriesQuery = useEquipmentCategories();
  const equipmentQuery = useEquipamentos();
  const rdoSlotsQuery = useRdoSlots(isManager);
  const unitsCatalogQuery = useUnitsCatalog();
  const mutations = useEquipamentoMutations();

  const categories = useMemo(() => [...(categoriesQuery.data || [])].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)), [categoriesQuery.data]);
  const equipment = useMemo(() => equipmentQuery.data || [], [equipmentQuery.data]);
  // Categorias atualmente vinculadas a algum slot de relatório (override ou padrão).
  const rdoLinkedCategoryIds = useMemo(() => new Set((rdoSlotsQuery.data || []).flatMap(slot => slot.categoryIds)), [rdoSlotsQuery.data]);

  const [activeTabUrl, setActiveTabUrl] = useUrlParamState<string>({
    param: 'tab',
    defaultValue: 'dashboard',
    parse: parseEquipmentTabParam
  });
  const activeTab: ActiveTab = { kind: equipmentTabFromParam(activeTabUrl) };
  const linkedCategoryId = activeTabUrl.startsWith('cat:') ? activeTabUrl.slice(4) : null;
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(linkedCategoryId);
  const categoryMenuRef = useRef<HTMLDetailsElement>(null);
  const openCategoryMenuOnMountRef = useRef(false);
  const smoothCategoryScrollRef = useRef<string | null>(null);
  const subNavigation = [
    { id: 'dashboard', label: 'Visão geral', href: '/equipamentos?tab=dashboard', active: activeTab.kind === 'dashboard' },
    {
      id: 'categories', label: 'Categorias', href: '/equipamentos?tab=categories', badge: equipment.length,
      active: activeTab.kind === 'categories', onSelect: openCategoriesMenu,
      children: categories.map(category => ({
        id: `cat:${category.id}`,
        label: category.name,
        href: `/equipamentos?tab=${encodeURIComponent(`cat:${category.id}`)}`,
        badge: equipment.filter(item => item.categoryId === category.id).length,
        active: activeTab.kind === 'categories' && activeCategoryId === category.id,
        onSelect: () => goToCategory(category.id)
      }))
    },
    ...(isManager ? [
      { id: 'config', label: 'Configurações', href: '/equipamentos?tab=config', active: activeTab.kind === 'config' },
      { id: 'maintenance', label: 'Manutenção', href: '/equipamentos?tab=maintenance', active: activeTab.kind === 'maintenance' },
      { id: 'notifications', label: 'Notificações', href: '/equipamentos?tab=notifications', active: activeTab.kind === 'notifications' }
    ] : [])
  ];
  const sectionLabel = { dashboard: 'Visão geral', categories: 'Categorias', config: 'Configurações', maintenance: 'Manutenção', notifications: 'Notificações' }[activeTab.kind];
  const setActiveTab = useCallback(
    (nextTab: ActiveTab) => {
      setActiveTabUrl(nextTab.kind);
    },
    [setActiveTabUrl]
  );
  const [equipmentForm, setEquipmentForm] = useState<{
    category: EquipmentCategory;
    item: CompanyEquipment | null;
  } | null>(null);
  const [technicalForm, setTechnicalForm] = useState<{
    category: EquipmentCategory;
    item: CompanyEquipment;
  } | null>(null);
  const [categoryForm, setCategoryForm] = useState<{
    open: boolean;
    category: EquipmentCategory | null;
  }>({ open: false, category: null });
  const [categorySearch, setCategorySearch] = useState('');
  const [equipmentSort, setEquipmentSort] = useState<ProjectSortDirection>('asc');
  const [confirm, setConfirm] = useState<{
    title: string;
    description?: string;
    highlight?: string;
    onConfirm: () => void;
  } | null>(null);
  const tutorialStartedRef = useRef(false);

  function openCategoriesMenu() {
    if (activeTab.kind !== 'categories') {
      openCategoryMenuOnMountRef.current = true;
      setActiveTab({ kind: 'categories' });
    } else if (categoryMenuRef.current) {
      categoryMenuRef.current.open = !categoryMenuRef.current.open;
    }
  }

  function goToCategory(categoryId: string) {
    setActiveCategoryId(categoryId);
    setCategorySearch('');
    if (categoryMenuRef.current) categoryMenuRef.current.open = false;
    smoothCategoryScrollRef.current = categoryId;
    setActiveTabUrl(`cat:${categoryId}`);
    if (activeTab.kind === 'categories' && !categorySearch.trim()) {
      const section = document.querySelector(`[data-equip-category-id="${escapeCssSelectorValue(categoryId)}"]`);
      if (section) {
        section.scrollIntoView({ block: 'start', behavior: 'smooth' });
        smoothCategoryScrollRef.current = null;
      }
    }
  }

  useEffect(() => {
    if (!isManager && (activeTab.kind === 'config' || activeTab.kind === 'maintenance' || activeTab.kind === 'notifications')) {
      setActiveTab({ kind: 'dashboard' });
    }
  }, [activeTab.kind, isManager, setActiveTab]);
  // Links antigos para uma categoria continuam abrindo a seção correspondente.
  useEffect(() => {
    if (!linkedCategoryId || categoriesQuery.isLoading || activeTab.kind !== 'categories' || categorySearch.trim()) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(`[data-equip-category-id="${escapeCssSelectorValue(linkedCategoryId)}"]`)
        ?.scrollIntoView({ block: 'start', behavior: smoothCategoryScrollRef.current === linkedCategoryId ? 'smooth' : 'auto' });
      smoothCategoryScrollRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab.kind, categoriesQuery.isLoading, linkedCategoryId, categories, categorySearch]);
  useEffect(() => {
    if (activeTab.kind !== 'categories' || !openCategoryMenuOnMountRef.current) return;
    openCategoryMenuOnMountRef.current = false;
    if (categoryMenuRef.current) categoryMenuRef.current.open = true;
  }, [activeTab.kind]);
  // Limpa a busca ao trocar de aba.
  useEffect(() => {
    setCategorySearch('');
  }, [activeTab.kind]);
  const visibleEquipment = useMemo(
    () => filterAndSortEquipment(equipment, categories, categorySearch, equipmentSort),
    [categories, categorySearch, equipment, equipmentSort]
  );
  const visibleCategories = useMemo(
    () => categories.filter(category => !categorySearch.trim() || visibleEquipment.some(item => item.categoryId === category.id)),
    [categories, categorySearch, visibleEquipment]
  );
  const activeCategoryName = categories.find(category => category.id === activeCategoryId)?.name || 'Escolher categoria';
  useEffect(() => {
    if (activeTab.kind !== 'categories') return;
    let frame = 0;
    const updateActiveCategory = () => {
      frame = 0;
      const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-equip-category-section]'));
      if (!sections.length) return;
      const marker = (window.innerWidth < 768 ? 56 : 64) + Math.min(160, window.innerHeight * 0.22);
      let current = sections[0].dataset.equipCategoryId || null;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= marker) current = section.dataset.equipCategoryId || current;
        else break;
      }
      if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 8) {
        current = sections[sections.length - 1].dataset.equipCategoryId || current;
      }
      setActiveCategoryId(previous => previous === current ? previous : current);
    };
    const scheduleUpdate = () => { if (!frame) frame = window.requestAnimationFrame(updateActiveCategory); };
    scheduleUpdate();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      window.cancelAnimationFrame(frame);
    };
  }, [activeTab.kind, visibleCategories]);
  const tutorialTarget = useMemo(() => {
    const candidates = categories.map(category => {
      const items = equipment.filter(item => item.categoryId === category.id);
      const certificateItem = items.find(item => item.calibrationCertificate) || null;
      const generatedTechnicalItem = category.technicalDocEnabled ? items.find(item => item.technicalDocGenerated || item.technicalDoc) || null : null;
      const technicalItem = category.technicalDocEnabled ? generatedTechnicalItem || items[0] || null : null;
      const score = (items.length ? 1 : 0) + (certificateItem ? 8 : 0) + (technicalItem ? 4 : 0) + (generatedTechnicalItem ? 2 : 0) + (category.technicalSchema?.length ? 1 : 0);
      return {
        category,
        items,
        certificateItem,
        technicalItem,
        generatedTechnicalItem,
        score
      };
    });
    return candidates.filter(candidate => candidate.items.length > 0 || categories.length === 1).sort((a, b) => b.score - a.score || a.category.order - b.category.order || a.category.name.localeCompare(b.category.name))[0] || null;
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
    const navSelector = window.matchMedia('(max-width: 767.98px)').matches
      ? '.fv-bottom-bar'
      : window.matchMedia('(max-width: 1023.98px)').matches
        ? '[data-equip-nav]'
        : '.fv-sidebar__navigation';
    const steps: DriveStep[] = [
      {
        element: '[data-equip-dashboard]',
        popover: {
          title: 'Dashboard de equipamentos',
          description: 'Esta visão reúne os equipamentos cadastrados e resume a situação de calibração: data calibrada, vencimento e status.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '[data-equip-dashboard-filters]',
        popover: {
          title: 'Filtros do dashboard',
          description: 'Use a busca, o filtro de categoria e o filtro de status para localizar equipamentos vencidos, a vencer, calibrados ou sem calibração.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '[data-equip-dashboard-table]',
        popover: {
          title: 'Informações exibidas',
          description: 'A tabela mostra código, nome, categoria, data de calibração, vencimento e status. O CSV exporta exatamente a lista filtrada.',
          side: 'top',
          align: 'start'
        }
      },
      {
        element: navSelector,
        popover: {
          title: 'Menu do módulo',
          description: 'Use este menu para alternar entre a visão geral e a lista de categorias. Gestores também veem Configurações e Notificações.',
          side: 'right',
          align: 'start',
          onNextClick: (_element, _step, { driver: driverObj }) => {
            if (!category) {
              driverObj.moveNext();
              return;
            }
            setActiveTab({ kind: 'categories' });
            window.setTimeout(() => driverObj.moveNext(), 180);
          }
        }
      }
    ];

    if (category) {
      steps.push({
        element: `[data-equip-category-id="${escapeCssSelectorValue(category.id)}"]`,
        popover: {
          title: `Categoria ${category.name}`,
          description: 'Cada categoria reúne seus equipamentos em tabela. Em telas menores, a lista aparece em cards com as mesmas ações.',
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
          description: 'Quando o equipamento possui certificado, este link abre o PDF de calibração em uma nova aba.',
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
          description: 'Quando o datasheet já foi gerado, este botão baixa diretamente o PDF dos dados técnicos do equipamento.',
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
          description: 'Este botão abre os dados técnicos do equipamento. Quando houver datasheet gerado, ele também pode ser baixado em PDF.',
          side: 'top',
          align: 'start',
          onNextClick: (_element, _step, { driver: driverObj }) => {
            setTechnicalForm({
              category,
              item: target.technicalItem as CompanyEquipment
            });
            window.setTimeout(() => driverObj.moveNext(), 180);
          }
        }
      });
      steps.push({
        element: '[data-equip-technical-modal]',
        popover: {
          title: 'Janela de dados técnicos',
          description: isManager ? 'Aqui o gestor revisa e atualiza os campos técnicos que alimentam o datasheet do equipamento.' : 'Aqui o visualizador consulta os dados técnicos cadastrados para o equipamento.',
          side: 'left',
          align: 'start'
        }
      });
      if (isManager) {
        if (category.technicalSchema?.length) {
          steps.push({
            element: '[data-equip-technical-edit-fields]',
            popover: {
              title: 'Editar dados técnicos',
              description: 'Gestores podem alterar valores, unidades, campos aplicáveis e fotos técnicas diretamente nestas seções.',
              side: 'right',
              align: 'start'
            }
          });
        }
        steps.push({
          element: '[data-equip-technical-save]',
          popover: {
            title: 'Salvar alterações',
            description: 'Após revisar os campos, salve os dados técnicos. Sempre que algo muda, uma nova revisão é gerada automaticamente e o PDF da revisão anterior fica arquivado no histórico.',
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
  }, [isManager, setActiveTab, tutorialTarget, tutorialUserKey]);

  useEffect(() => {
    if (!tutorialReady || !tutorialUserKey || tutorialStartedRef.current) return;
    if (hasDoneEquipmentTutorial(tutorialUserKey)) return;
    const timer = window.setTimeout(startEquipmentTutorial, 600);
    return () => window.clearTimeout(timer);
  }, [startEquipmentTutorial, tutorialReady, tutorialUserKey]);

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

  function handleTechnicalSubmit(technicalData: Record<string, unknown>, technicalFieldOverrides: Record<string, boolean>, photos: { add: ImageUpload[]; removeIds: string[] }, bumpRevision: boolean) {
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
        onSuccess: () => {
          showToast('Dados técnicos salvos.', 'success');
          setTechnicalForm(null);
        },
        onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
      }
    );
  }

  function handleCategorySubmit(payload: EquipmentCategoryPayload) {
    const close = () => setCategoryForm({ open: false, category: null });
    const onError = (error: unknown) => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error');
    if (categoryForm.category) {
      mutations.updateCategory.mutate(
        { id: categoryForm.category.id, payload },
        {
          onSuccess: () => {
            showToast('Categoria salva.', 'success');
            close();
          },
          onError
        }
      );
    } else {
      mutations.createCategory.mutate(
        { ...payload, order: categories.length },
        {
          onSuccess: created => {
            const imported = created.importedFromRomaneio || 0;
            showToast(imported > 0 ? `Categoria criada. ${imported} equipamento(s) importado(s) do romaneio.` : 'Categoria salva.', 'success');
            close();
          },
          onError
        }
      );
    }
  }

  function handleRemoveEquipment(item: CompanyEquipment) {
    setConfirm({
      title: 'Remover equipamento',
      description: 'O equipamento será removido do módulo.',
      highlight: [item.code, item.name].filter(Boolean).join(' — '),
      onConfirm: () =>
        mutations.removeEquipment.mutate(item.id, {
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
      onConfirm: () =>
        mutations.removeCategory.mutate(category.id, {
          onSuccess: () => showToast('Categoria removida.', 'success'),
          onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível remover.', 'error')
        })
    });
  }

  const savingEquipment = mutations.createEquipment.isPending || mutations.updateEquipment.isPending;
  const savingCategory = mutations.createCategory.isPending || mutations.updateCategory.isPending;

  return (
    <OperationalModuleAppShell
      moduleId="equipamentos"
      title="Equipamentos"
      sectionLabel={sectionLabel}
      subNavigation={subNavigation}
    >
      <main className="fv-ds equip-page equip-page-v2">
        <PageHeader
          title={sectionLabel}
          description="Cadastro, calibração e documentação técnica dos equipamentos."
          actions={<Button variant="secondary" size="sm" onClick={startEquipmentTutorial}>Ver tutorial</Button>}
        />
        <div className="equip-layout">
          <nav className="equip-nav" aria-label="Áreas de Equipamentos" data-equip-nav>
            <button className={`equip-nav-item ${activeTab.kind === 'dashboard' ? 'active' : ''}`} type="button" aria-current={activeTab.kind === 'dashboard'} onClick={() => setActiveTab({ kind: 'dashboard' })} data-equip-nav-dashboard>
              <span className="equip-nav-ico" aria-hidden="true">
                ◧
              </span>
              <span className="equip-nav-label">Dashboard</span>
            </button>
            <button className={`equip-nav-item ${activeTab.kind === 'categories' ? 'active' : ''}`} type="button" aria-current={activeTab.kind === 'categories'} onClick={openCategoriesMenu} data-equip-category-nav>
              <span className="equip-nav-label">Categorias</span>
              <span className="equip-nav-count">{equipment.length}</span>
            </button>
            {isManager && (
              <>
                <button className={`equip-nav-item equip-nav-config ${activeTab.kind === 'config' ? 'active' : ''}`} type="button" aria-current={activeTab.kind === 'config'} onClick={() => setActiveTab({ kind: 'config' })}>
                  <span className="equip-nav-ico" aria-hidden="true">
                    ⚙
                  </span>
                  <span className="equip-nav-label">Configurações</span>
                </button>
                <button className={`equip-nav-item ${activeTab.kind === 'maintenance' ? 'active' : ''}`} type="button" aria-current={activeTab.kind === 'maintenance'} onClick={() => setActiveTab({ kind: 'maintenance' })}>
                  <span className="equip-nav-ico" aria-hidden="true">
                    🔧
                  </span>
                  <span className="equip-nav-label">Manutenção</span>
                </button>
                <button className={`equip-nav-item ${activeTab.kind === 'notifications' ? 'active' : ''}`} type="button" aria-current={activeTab.kind === 'notifications'} onClick={() => setActiveTab({ kind: 'notifications' })}>
                  <span className="equip-nav-ico" aria-hidden="true">
                    ✉
                  </span>
                  <span className="equip-nav-label">Notificações</span>
                </button>
              </>
            )}
          </nav>

          <div className="equip-main">
            {(categoriesQuery.isLoading || equipmentQuery.isLoading) && (
              <section className="page-card">
                <p>Carregando…</p>
              </section>
            )}

            {activeTab.kind === 'dashboard' && <EquipmentDashboard categories={categories} equipment={equipment} />}

            {activeTab.kind === 'categories' && (
              <div className="equip-categories" data-equip-categories>
                <details ref={categoryMenuRef} className="equip-category-jump" data-equip-category-jump>
                  <summary>
                    <span>Ir para categoria</span>
                    <strong>{activeCategoryName}</strong>
                    <span aria-hidden="true">⌄</span>
                  </summary>
                  <div className="equip-category-jump__menu" role="group" aria-label="Categorias de equipamentos">
                    {categories.map(category => (
                      <button key={category.id} type="button" className={activeCategoryId === category.id ? 'is-active' : ''}
                        aria-current={activeCategoryId === category.id ? 'location' : undefined}
                        onClick={() => goToCategory(category.id)}>
                        <span>{category.name}</span>
                        <span>{equipment.filter(item => item.categoryId === category.id).length}</span>
                      </button>
                    ))}
                  </div>
                </details>
                <div className="page-card equip-categories__toolbar">
                  <SearchBar
                    value={categorySearch}
                    onChange={setCategorySearch}
                    placeholder="Buscar por categoria, código, nome ou atributo"
                    ariaLabel="Buscar equipamentos em todas as categorias"
                    count={{ shown: visibleEquipment.length, total: equipment.length }}
                  />
                  <Button variant="secondary" size="sm" aria-label="Alternar ordem dos equipamentos" onClick={() => setEquipmentSort(equipmentSort === 'asc' ? 'desc' : 'asc')}>
                    {equipmentSort === 'asc' ? 'A→Z' : 'Z→A'}
                  </Button>
                </div>
                {categories.length === 0 && !categoriesQuery.isLoading ? (
                  <div className="page-card equip-categories__empty">Nenhuma categoria cadastrada.</div>
                ) : null}
                {categorySearch.trim() && visibleEquipment.length === 0 ? (
                  <div className="page-card equip-categories__empty">Nenhum equipamento encontrado para “{categorySearch.trim()}”.</div>
                ) : null}
                {visibleCategories.map(category => (
                  <EquipmentCategorySection
                    key={category.id}
                    category={category}
                    items={visibleEquipment.filter(item => item.categoryId === category.id)}
                    total={equipment.filter(item => item.categoryId === category.id).length}
                    isManager={isManager}
                    onAdd={() => setEquipmentForm({ category, item: null })}
                    onEdit={item => setEquipmentForm({ category, item })}
                    onRemove={handleRemoveEquipment}
                    onOpenTechnical={item => setTechnicalForm({ category, item })}
                    onOpenMaintenanceHistory={item => {
                      const next = new URLSearchParams(searchParams);
                      next.set('equipamento', item.id);
                      setSearchParams(next, { replace: true });
                    }}
                  />
                ))}
              </div>
            )}

            {activeTab.kind === 'config' && isManager && (
              <>
                <CategoryManager categories={categories} rdoLinkedCategoryIds={rdoLinkedCategoryIds} onAdd={() => setCategoryForm({ open: true, category: null })} onEdit={category => setCategoryForm({ open: true, category })} onRemove={handleRemoveCategory} />
                <RdoSlotsConfig categories={categories} />
              </>
            )}

            {activeTab.kind === 'notifications' && isManager && <NotificationsConfig />}

            {activeTab.kind === 'maintenance' && isManager && (
              <MaintenanceConfigPanel
                equipment={equipment}
                categories={categories}
              />
            )}
          </div>
        </div>
      </main>

      {equipmentForm && <EquipmentFormModal open category={equipmentForm.category} equipment={equipmentForm.item} saving={savingEquipment} isManager={isManager} onClose={() => setEquipmentForm(null)} onSubmit={handleEquipmentSubmit} />}

      {technicalForm && <TechnicalDataModal open category={technicalForm.category} equipment={technicalForm.item} unitsCatalog={unitsCatalogQuery.data || []} saving={mutations.updateEquipment.isPending} isManager={isManager} onClose={() => setTechnicalForm(null)} onSubmit={handleTechnicalSubmit} />}

      {categoryForm.open && <CategoryFormModal open category={categoryForm.category} saving={savingCategory} unitsCatalog={unitsCatalogQuery.data || []} onClose={() => setCategoryForm({ open: false, category: null })} onSubmit={handleCategorySubmit} />}

      <MaintenanceHistoryModal
        equipmentId={searchParams.get('equipamento')}
        onClose={() => {
          const next = new URLSearchParams(searchParams);
          next.delete('equipamento');
          setSearchParams(next, { replace: true });
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ''}
        description={confirm?.description}
        highlight={confirm?.highlight}
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </OperationalModuleAppShell>
  );
}
