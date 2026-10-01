import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createStockCategory,
  listStockCategories,
  removeStockCategory,
  setStockCategoryActive,
  type StockCategory,
  type StockCategoryPayload,
  type StockCategoryUpdatePayload,
  type StockItemType,
  updateStockCategory
} from '../../api/estoque';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { SearchBar } from '../../components/ui/SearchBar';
import { Badge, Select } from '../../components/ui/ds';
import { useToast } from '../../components/ui/ToastContext';
import { StockCategoryFormModal } from './StockCategoryFormModal';

interface Props {
  isManager: boolean;
}

type ConfirmState = {
  title: string;
  description?: string;
  highlight?: string;
  confirmLabel?: string;
  onConfirm: () => void;
};

function typeLabel(type: StockItemType) {
  return type === 'FILTRO' ? 'Filtro' : 'Produto químico';
}

export function StockCategoriesTab({ isManager }: Props) {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [type, setType] = useState<StockItemType | ''>('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [formCategory, setFormCategory] = useState<StockCategory | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['estoque', 'categorias', { type, includeInactive }],
    queryFn: () => listStockCategories({ type: type || undefined, includeInactive })
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['estoque', 'categorias'] });
    queryClient.invalidateQueries({ queryKey: ['estoque', 'itens'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: StockCategoryPayload) => createStockCategory(payload),
    onSuccess: () => {
      invalidate();
      setFormCategory(undefined);
      showToast('Categoria cadastrada.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível cadastrar.', 'error')
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: StockCategoryUpdatePayload }) => updateStockCategory(id, payload),
    onSuccess: () => {
      invalidate();
      setFormCategory(undefined);
      showToast('Categoria salva.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setStockCategoryActive(id, isActive),
    onSuccess: () => {
      invalidate();
      showToast('Status atualizado.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível atualizar.', 'error')
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeStockCategory(id),
    onSuccess: () => {
      invalidate();
      showToast('Categoria removida.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível remover.', 'error')
  });

  const categories = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = categoriesQuery.data || [];
    if (!query) return rows;
    return rows.filter(category => `${category.name} ${typeLabel(category.type)}`.toLowerCase().includes(query));
  }, [categoriesQuery.data, search]);
  const saving = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(payload: StockCategoryPayload | StockCategoryUpdatePayload) {
    if (formCategory) {
      updateMutation.mutate({ id: formCategory.id, payload: payload as StockCategoryUpdatePayload });
    } else {
      createMutation.mutate(payload as StockCategoryPayload);
    }
  }

  function confirmActive(category: StockCategory, isActive: boolean) {
    setConfirm({
      title: isActive ? 'Reativar categoria' : 'Inativar categoria',
      description: isActive ? 'A categoria voltará a ficar disponível para novos itens.' : 'Itens vinculados permanecem cadastrados, mas novos vínculos não usarão esta categoria.',
      highlight: `${typeLabel(category.type)} — ${category.name}`,
      confirmLabel: isActive ? 'Reativar' : 'Inativar',
      onConfirm: () => activeMutation.mutate({ id: category.id, isActive })
    });
  }

  function confirmRemove(category: StockCategory) {
    setConfirm({
      title: 'Remover categoria',
      description: 'A remoção só é permitida para categorias sem itens vinculados.',
      highlight: `${typeLabel(category.type)} — ${category.name}`,
      confirmLabel: 'Remover',
      onConfirm: () => removeMutation.mutate(category.id)
    });
  }

  return (
    <section className="page-card stock-panel">
      <div className="admin-toolbar stock-panel-header">
        <div className="sec">Categorias do estoque</div>
        {isManager ? (
          <button className="mini-btn" type="button" onClick={() => setFormCategory(null)}>Nova categoria</button>
        ) : null}
      </div>

      <div className="nps-tab-toolbar">
        <div className="nps-tab-toolbar-left">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Buscar categoria"
            ariaLabel="Buscar categoria de estoque"
            count={{ shown: categories.length, total: categories.length }}
          />
        </div>
        <div className="nps-tab-toolbar-right">
          <Select aria-label="Filtrar tipo de categoria" value={type} onChange={event => setType(event.target.value as StockItemType | '')}>
            <option value="">Todos os tipos</option>
            <option value="FILTRO">Filtros</option>
            <option value="PRODUTO_QUIMICO">Produtos químicos</option>
          </Select>
          <label className="equip-toggle">
            <input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} />
            <span>Inativas</span>
          </label>
        </div>
      </div>

      {categoriesQuery.isLoading ? <p className="placeholder-copy">Carregando categorias...</p> : null}
      {categoriesQuery.isError ? <p className="equip-form-error">Não foi possível carregar as categorias.</p> : null}
      {!categoriesQuery.isLoading && !categories.length ? <p className="placeholder-copy">Nenhuma categoria encontrada.</p> : null}

      <div className="equip-grid stock-entity-grid">
        {categories.map(category => (
          <article className="card stock-entity-card" key={category.id}>
            <div className="admin-toolbar">
              <div>
                <div className="sec">{category.name}</div>
                <p className="rel-meta">{typeLabel(category.type)} · {category.itemCount} item(ns)</p>
              </div>
              <Badge tone={category.checklistEnabled ? 'success' : 'neutral'}>{category.checklistEnabled ? 'Checklist' : 'Sem checklist'}</Badge>
            </div>
            {category.checklistEnabled ? (
              <p className="rel-meta">{category.checklistItems.length} ponto(s) de checagem</p>
            ) : (
              <p className="rel-meta">Itens vinculados não geram checklist enquanto a categoria estiver sem checklist.</p>
            )}
            {!category.isActive ? <Badge tone="danger">Inativa</Badge> : null}
            {isManager ? (
              <div className="admin-form-actions">
                <button className="mini-btn alt" type="button" onClick={() => setFormCategory(category)}>Editar</button>
                <button className="mini-btn alt" type="button" onClick={() => confirmActive(category, !category.isActive)}>
                  {category.isActive ? 'Inativar' : 'Reativar'}
                </button>
                <RemoveIconButton label={`Remover categoria ${category.name}`} disabled={removeMutation.isPending} onClick={() => confirmRemove(category)} />
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {formCategory !== undefined ? (
        <StockCategoryFormModal
          open
          category={formCategory}
          saving={saving}
          onClose={() => setFormCategory(undefined)}
          onSubmit={handleSubmit}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        appearance="design-system"
        title={confirm?.title || ''}
        description={confirm?.description}
        highlight={confirm?.highlight}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
