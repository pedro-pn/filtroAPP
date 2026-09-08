import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createStockItem,
  listStockCategories,
  listStockItems,
  removeStockItem,
  setStockItemActive,
  type StockItem,
  type StockItemPayload,
  type StockItemType,
  type StockItemUpdatePayload,
  updateStockItem
} from '../../api/estoque';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SearchBar } from '../../components/ui/SearchBar';
import { useToast } from '../../components/ui/ToastContext';
import { StockItemDocumentsModal } from './StockItemDocumentsModal';
import { StockItemFormModal } from './StockItemFormModal';

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

function itemSubtitle(item: StockItem) {
  if (item.type === 'FILTRO') {
    return [item.filterModel, item.filterKind, item.filterMicron ? `${item.filterMicron} micra` : '']
      .filter(Boolean)
      .join(' · ');
  }
  return [
    item.unNumber ? `ONU ${item.unNumber}` : '',
    item.casNumber ? `CAS ${item.casNumber}` : ''
  ]
    .filter(Boolean)
    .join(' · ');
}

export function StockItemsTab({ isManager }: Props) {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [type, setType] = useState<StockItemType | ''>('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [formItem, setFormItem] = useState<StockItem | null | undefined>(undefined);
  const [documentsItemId, setDocumentsItemId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const itemsQuery = useQuery({
    queryKey: ['estoque', 'itens', { search, type, includeInactive }],
    queryFn: () => listStockItems({ search, type: type || undefined, includeInactive })
  });
  const categoriesQuery = useQuery({
    queryKey: ['estoque', 'categorias', { includeInactive: true }],
    queryFn: () => listStockCategories({ includeInactive: true })
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['estoque', 'itens'] });
    queryClient.invalidateQueries({ queryKey: ['estoque', 'categorias'] });
    queryClient.invalidateQueries({ queryKey: ['estoque', 'resumo'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: StockItemPayload) => createStockItem(payload),
    onSuccess: () => {
      invalidate();
      setFormItem(undefined);
      showToast('Item cadastrado.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível cadastrar.', 'error')
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: StockItemUpdatePayload }) => updateStockItem(id, payload),
    onSuccess: () => {
      invalidate();
      setFormItem(undefined);
      showToast('Item salvo.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
  });
  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setStockItemActive(id, isActive),
    onSuccess: () => {
      invalidate();
      showToast('Status atualizado.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível atualizar.', 'error')
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => removeStockItem(id),
    onSuccess: () => {
      invalidate();
      showToast('Item removido.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível remover.', 'error')
  });

  const items = useMemo(() => itemsQuery.data || [], [itemsQuery.data]);
  const categories = useMemo(() => categoriesQuery.data || [], [categoriesQuery.data]);
  const documentsItem = items.find(item => item.id === documentsItemId) || null;
  const saving = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(payload: StockItemPayload | StockItemUpdatePayload) {
    if (formItem) {
      updateMutation.mutate({ id: formItem.id, payload: payload as StockItemUpdatePayload });
    } else {
      createMutation.mutate(payload as StockItemPayload);
    }
  }

  function confirmActive(item: StockItem, isActive: boolean) {
    setConfirm({
      title: isActive ? 'Reativar item' : 'Inativar item',
      description: isActive ? 'O item voltará a aparecer em novas movimentações.' : 'O item não aparecerá em novas movimentações.',
      highlight: `${item.code} — ${item.name}`,
      confirmLabel: isActive ? 'Reativar' : 'Inativar',
      onConfirm: () => activeMutation.mutate({ id: item.id, isActive })
    });
  }

  function confirmRemove(item: StockItem) {
    setConfirm({
      title: 'Remover item',
      description: 'A remoção só é permitida para itens sem movimentações.',
      highlight: `${item.code} — ${item.name}`,
      confirmLabel: 'Remover',
      onConfirm: () => removeMutation.mutate(item.id)
    });
  }

  return (
    <section className="page-card">
      <div className="admin-toolbar">
        <div className="sec">Itens</div>
        {isManager ? (
          <button className="mini-btn" type="button" onClick={() => setFormItem(null)}>Novo item</button>
        ) : null}
      </div>

      <div className="nps-tab-toolbar">
        <div className="nps-tab-toolbar-left">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Buscar por código, nome, ONU ou CAS"
            ariaLabel="Buscar item de estoque"
            count={{ shown: items.length, total: items.length }}
          />
        </div>
        <div className="nps-tab-toolbar-right">
          <select aria-label="Filtrar tipo de item" value={type} onChange={event => setType(event.target.value as StockItemType | '')}>
            <option value="">Todos os tipos</option>
            <option value="FILTRO">Filtros</option>
            <option value="PRODUTO_QUIMICO">Produtos químicos</option>
          </select>
          <label className="equip-toggle">
            <input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} />
            <span>Inativos</span>
          </label>
        </div>
      </div>

      {itemsQuery.isLoading ? <p className="placeholder-copy">Carregando itens...</p> : null}
      {itemsQuery.isError ? <p className="equip-form-error">Não foi possível carregar os itens.</p> : null}
      {!itemsQuery.isLoading && !items.length ? <p className="placeholder-copy">Nenhum item encontrado.</p> : null}

      <div className="equip-grid">
        {items.map(item => (
          <article className="card" key={item.id}>
            <div className="admin-toolbar">
              <div>
                <div className="sec">{item.code}</div>
                <strong>{item.name}</strong>
                <p className="rel-meta">{itemSubtitle(item) || typeLabel(item.type)}</p>
              </div>
              <span className="badge">{item.category?.name || typeLabel(item.type)}</span>
            </div>
            <p className="rel-meta">
              Unidade: <strong>{item.unitLabel}</strong>
              {item.minQuantity ? <> · Mínimo: <strong>{item.minQuantity}</strong></> : null}
              {item.location ? <> · Local: <strong>{item.location}</strong></> : null}
            </p>
            {!item.isActive ? <span className="badge danger">Inativo</span> : null}
            {item.documents.length ? (
              <div className="upload-list stock-item-document-list" aria-label={`Documentos de ${item.name}`}>
                {item.documents.map(document => (
                  <div className="upload-list-item" key={document.id}>
                    <a className="upload-list-name" href={document.publicUrl} target="_blank" rel="noreferrer">
                      {document.fileName}
                    </a>
                  </div>
                ))}
              </div>
            ) : <p className="rel-meta">Nenhum documento anexado.</p>}
            {isManager ? (
              <div className="admin-form-actions">
                <button className="mini-btn alt" type="button" onClick={() => setDocumentsItemId(item.id)}>
                  Documentos ({item.documents.length})
                </button>
                <button className="mini-btn alt" type="button" onClick={() => setFormItem(item)}>Editar</button>
                <button className="mini-btn alt" type="button" onClick={() => confirmActive(item, !item.isActive)}>
                  {item.isActive ? 'Inativar' : 'Reativar'}
                </button>
                <button className="danger-button" type="button" onClick={() => confirmRemove(item)}>Excluir</button>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {formItem !== undefined ? (
        <StockItemFormModal
          open
          item={formItem}
          categories={categories}
          saving={saving}
          onClose={() => setFormItem(undefined)}
          onSubmit={handleSubmit}
        />
      ) : null}

      {documentsItem ? (
        <StockItemDocumentsModal
          open
          item={documentsItem}
          onClose={() => setDocumentsItemId(null)}
          onChanged={invalidate}
        />
      ) : null}

      <ConfirmDialog
        open={!!confirm}
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
