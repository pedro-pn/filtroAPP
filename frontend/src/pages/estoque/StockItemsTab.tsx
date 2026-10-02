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
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { SearchBar } from '../../components/ui/SearchBar';
import { Badge, DataTable, Select, type DataTableColumn } from '../../components/ui/ds';
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

  function renderDocuments(item: StockItem) {
    if (!item.documents.length) return <span className="stock-table-muted">Nenhum</span>;
    const links = item.documents.map(document => <a key={document.id} href={document.publicUrl} target="_blank" rel="noreferrer">{document.fileName}</a>);
    return item.documents.length === 1 ? links[0] : <details className="stock-table-documents"><summary>{item.documents.length} documentos</summary><div>{links}</div></details>;
  }

  const columns: DataTableColumn<StockItem>[] = [
    { key: 'item', header: 'Item', rowHeader: true, render: item => <div className="stock-table-identity"><strong>{item.code} · {item.name}</strong><small>{itemSubtitle(item) || typeLabel(item.type)}</small></div> },
    { key: 'category', header: 'Categoria', render: item => item.category?.name || 'Sem categoria' },
    { key: 'unit', header: 'Unidade / mínimo', render: item => <><strong>{item.unitLabel}</strong>{item.minQuantity ? <small className="stock-table-muted">Mín. {item.minQuantity}</small> : null}</> },
    { key: 'location', header: 'Local', render: item => item.location || '—' },
    { key: 'documents', header: 'Documentos', render: renderDocuments },
    { key: 'status', header: 'Situação', render: item => <Badge tone={item.isActive ? 'success' : 'danger'}>{item.isActive ? 'Ativo' : 'Inativo'}</Badge> }
  ];
  const renderActions = (item: StockItem) => isManager ? <div className="stock-table-actions">
    <button className="mini-btn alt" type="button" onClick={() => setDocumentsItemId(item.id)}>Documentos</button>
    <button className="mini-btn alt" type="button" onClick={() => setFormItem(item)}>Editar</button>
    <button className="mini-btn alt" type="button" onClick={() => confirmActive(item, !item.isActive)}>{item.isActive ? 'Inativar' : 'Reativar'}</button>
    <RemoveIconButton label={`Remover item ${item.code} — ${item.name}`} disabled={removeMutation.isPending} onClick={() => confirmRemove(item)} />
  </div> : null;

  return (
    <section className="page-card stock-panel">
      <div className="admin-toolbar stock-panel-header">
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
          <Select aria-label="Filtrar tipo de item" value={type} onChange={event => setType(event.target.value as StockItemType | '')}>
            <option value="">Todos os tipos</option>
            <option value="FILTRO">Filtros</option>
            <option value="PRODUTO_QUIMICO">Produtos químicos</option>
          </Select>
          <label className="equip-toggle">
            <input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} />
            <span>Inativos</span>
          </label>
        </div>
      </div>

      {itemsQuery.isLoading ? <p className="placeholder-copy">Carregando itens...</p> : null}
      {itemsQuery.isError ? <p className="equip-form-error">Não foi possível carregar os itens.</p> : null}
      {!itemsQuery.isLoading && !items.length ? <p className="placeholder-copy">Nenhum item encontrado.</p> : null}

      {items.length ? <DataTable
        className="stock-entity-table"
        rows={items}
        columns={columns}
        getRowId={item => item.id}
        ariaLabel="Itens do estoque"
        density="compact"
        mobileBreakpoint="md"
        rowActions={isManager ? renderActions : undefined}
        mobile={{ renderItem: item => ({
          title: `${item.code} · ${item.name}`,
          subtitle: itemSubtitle(item) || typeLabel(item.type),
          status: <Badge tone={item.isActive ? 'success' : 'danger'}>{item.isActive ? 'Ativo' : 'Inativo'}</Badge>,
          metadata: [{ label: 'Categoria', value: item.category?.name || 'Sem categoria' }, { label: 'Unidade', value: item.unitLabel }, { label: 'Mínimo', value: item.minQuantity || '—' }, { label: 'Local', value: item.location || '—' }],
          details: <div className="stock-table-mobile-documents"><strong>Documentos</strong>{renderDocuments(item)}</div>
        }) }}
      /> : null}

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
