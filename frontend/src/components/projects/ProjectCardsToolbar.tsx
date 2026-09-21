import { Button, Field, SearchInput, Select } from '../ui/ds';
import type { CardsView } from './projectCardViews';

const PROJECT_CARD_VIEWS: { id: CardsView; label: string }[] = [
  { id: 'andamento', label: 'Em andamento' }, { id: 'futuros', label: 'Futuros' },
  { id: 'arquivados', label: 'Arquivados' }, { id: 'conferidas', label: 'Conferidas' }
];

export function ProjectCardsToolbar({ view, counts, search, onSearch, onView, canManageGroups,
  selectionMode, selectedCount, busy, loading = false, onStartSelection, onConfirm, onCancel
}: {
  view: CardsView;
  counts: Record<CardsView, number>;
  search: string;
  onSearch: (value: string) => void;
  onView: (view: CardsView) => void;
  canManageGroups: boolean;
  selectionMode: boolean;
  selectedCount: number;
  busy: boolean;
  loading?: boolean;
  onStartSelection: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return <div className="acp-projects__toolbar">
    <div data-acp-cards-seg>
      <nav className="acp-projects__views" aria-label="Situação dos projetos">
        {PROJECT_CARD_VIEWS.map(item => <Button key={item.id} size="sm" variant={view === item.id ? 'primary' : 'secondary'}
          aria-pressed={view === item.id} disabled={busy} onClick={() => onView(item.id)} counter={loading ? '—' : counts[item.id]}>
          {item.label}
        </Button>)}
      </nav>
      <div className="acp-projects__mobile-view">
        <Field id="acp-cards-view" label="Situação dos projetos" optionalText="">
          <Select size="sm" value={view} disabled={busy} onChange={event => onView(event.target.value as CardsView)}>
            {PROJECT_CARD_VIEWS.map(item => <option key={item.id} value={item.id}>{item.label} ({loading ? '—' : counts[item.id]})</option>)}
          </Select>
        </Field>
      </div>
    </div>
    <div className="acp-projects__search-actions">
      <SearchInput size="sm" label="Buscar projetos" placeholder="Código, missão, cliente ou CNPJ" value={search} onChange={onSearch} disabled={busy} />
      {canManageGroups ? <div className="acp-projects__selection-actions" aria-label="Ações de unificação" data-acp-group-toolbar>
        {!selectionMode ? <Button size="sm" variant="primary" data-acp-group-start onClick={onStartSelection} disabled={loading || busy}>Unificar projetos</Button> : <>
          <Button size="sm" variant="primary" data-acp-group-confirm disabled={selectedCount < 2 || busy} onClick={onConfirm}>
            {busy ? 'Unificando…' : `Confirmar (${selectedCount})`}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>Cancelar</Button>
        </>}
      </div> : null}
    </div>
    {selectionMode ? <p className="acp-projects__description" role="status">{selectedCount} selecionado(s). Selecione pelo menos duas missões; a seleção é mantida ao filtrar.</p> : null}
  </div>;
}
