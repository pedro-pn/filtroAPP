import { useMemo, useState, type ReactNode } from 'react';

import { BrandLogo } from '../components/brand/BrandLogo';
import { AppIcon } from '../components/icons/AppIcon';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  IconButton,
  Pagination,
  SearchInput,
  Select,
  StatusPill
} from '../components/ui/ds';
import { DS_ICONS } from '../components/ui/ds/icons';
import { ThemeToggle } from '../theme/ThemeToggle';

type DemoStatus = 'aprovado' | 'pendente' | 'em revisão' | 'rejeitado';

type DemoRow = {
  id: string;
  code: string;
  mission: string;
  customer: string;
  owner: string;
  status: DemoStatus;
  issuedAt: string;
  dueAt: string;
  amount: number;
  documentCount: number;
};

type DemoSort = {
  key: string;
  direction: 'asc' | 'desc';
};

type DemoColumn = {
  key: string;
  header: string;
  render?: (row: DemoRow) => ReactNode;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  numeric?: boolean;
  rowHeader?: boolean;
};

const demoRows: DemoRow[] = [
  {
    id: 'listing-001',
    code: 'FV-5800',
    mission: 'Inspeção dos filtros principais',
    customer: 'Companhia Hidrelétrica Aurora',
    owner: 'Marina Costa',
    status: 'aprovado',
    issuedAt: '2026-08-01',
    dueAt: '2026-08-28',
    amount: 18450,
    documentCount: 8
  },
  {
    id: 'listing-002',
    code: 'FV-5794',
    mission: 'Manutenção preventiva da unidade dois',
    customer: 'Saneamento Vale Verde',
    owner: 'Rafael Lima',
    status: 'pendente',
    issuedAt: '2026-08-03',
    dueAt: '2026-08-24',
    amount: 9320.5,
    documentCount: 4
  },
  {
    id: 'listing-003',
    code: 'FV-5787',
    mission: 'Comissionamento do sistema auxiliar',
    customer: 'Energia Serra Azul',
    owner: 'Bianca Souza',
    status: 'em revisão',
    issuedAt: '2026-07-28',
    dueAt: '2026-08-22',
    amount: 24780,
    documentCount: 12
  },
  {
    id: 'listing-004',
    code: 'FV-5775',
    mission: 'Avaliação técnica de elementos filtrantes',
    customer: 'Indústrias Horizonte',
    owner: 'Carlos Moreira',
    status: 'rejeitado',
    issuedAt: '2026-07-21',
    dueAt: '2026-08-18',
    amount: 6150.75,
    documentCount: 3
  },
  {
    id: 'listing-005',
    code: 'FV-5768',
    mission: 'Substituição programada de mangas',
    customer: 'Mineração Campo Alto',
    owner: 'Ana Martins',
    status: 'aprovado',
    issuedAt: '2026-07-18',
    dueAt: '2026-08-30',
    amount: 31200,
    documentCount: 16
  },
  {
    id: 'listing-006',
    code: 'FV-5759',
    mission: 'Diagnóstico de perda de carga',
    customer: 'Papel e Celulose Central',
    owner: 'Diego Alves',
    status: 'pendente',
    issuedAt: '2026-07-14',
    dueAt: '2026-08-26',
    amount: 11890,
    documentCount: 6
  },
  {
    id: 'listing-007',
    code: 'FV-5751',
    mission: 'Inspeção de recebimento em campo',
    customer: 'Usina Santa Clara',
    owner: 'Júlia Ferreira',
    status: 'em revisão',
    issuedAt: '2026-07-10',
    dueAt: '2026-08-19',
    amount: 7690,
    documentCount: 5
  },
  {
    id: 'listing-008',
    code: 'FV-5740',
    mission: 'Levantamento dimensional do conjunto',
    customer: 'Cimentos Parque Norte',
    owner: 'Lucas Ribeiro',
    status: 'aprovado',
    issuedAt: '2026-07-04',
    dueAt: '2026-08-16',
    amount: 14200,
    documentCount: 9
  }
];

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });
const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

const wideColumns: DemoColumn[] = [
  { key: 'code', header: 'Código', sortable: true, rowHeader: true },
  { key: 'mission', header: 'Missão', sortable: true },
  { key: 'customer', header: 'Cliente', sortable: true },
  { key: 'owner', header: 'Responsável', sortable: true },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <StatusPill status={row.status} />
  },
  {
    key: 'issuedAt',
    header: 'Emissão',
    render: (row) => formatDate(row.issuedAt),
    sortable: true
  },
  {
    key: 'dueAt',
    header: 'Prazo',
    render: (row) => formatDate(row.dueAt),
    sortable: true
  },
  {
    key: 'documentCount',
    header: 'Documentos',
    align: 'right',
    numeric: true,
    sortable: true
  },
  {
    key: 'amount',
    header: 'Valor',
    render: (row) => moneyFormatter.format(row.amount),
    align: 'right',
    numeric: true,
    sortable: true
  }
];

const smallColumns: DemoColumn[] = [
  { key: 'code', header: 'Código', rowHeader: true },
  { key: 'mission', header: 'Missão' },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <StatusPill status={row.status} />
  }
];

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function rowValue(row: DemoRow, key: string) {
  switch (key) {
    case 'amount':
    case 'documentCount':
      return row[key];
    case 'issuedAt':
    case 'dueAt':
      return new Date(`${row[key]}T00:00:00Z`).getTime();
    case 'code':
    case 'mission':
    case 'customer':
    case 'owner':
    case 'status':
      return row[key].toLocaleLowerCase('pt-BR');
    default:
      return '';
  }
}

function compareRows(left: DemoRow, right: DemoRow, sort: DemoSort) {
  const leftValue = rowValue(left, sort.key);
  const rightValue = rowValue(right, sort.key);
  const comparison =
    typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), 'pt-BR');

  return sort.direction === 'asc' ? comparison : -comparison;
}

function rowActions(row: DemoRow) {
  return (
    <div className="listings-demo-row-actions">
      <IconButton
        icon={DS_ICONS.settings}
        label={`Abrir ações de ${row.code}`}
        size="sm"
      />
      <IconButton
        icon={DS_ICONS.trash}
        label={`Excluir ${row.code}`}
        size="sm"
        variant="danger"
      />
    </div>
  );
}

function mobileItem(row: DemoRow) {
  return {
    title: `${row.code} · ${row.mission}`,
    subtitle: row.customer,
    metadata: [
      { label: 'Responsável', value: row.owner },
      { label: 'Emissão', value: formatDate(row.issuedAt) },
      { label: 'Prazo', value: formatDate(row.dueAt) },
      { label: 'Documentos', value: String(row.documentCount) }
    ],
    status: <StatusPill status={row.status} />,
    value: moneyFormatter.format(row.amount),
    actions: rowActions(row)
  };
}

function Section({
  id,
  title,
  description,
  children
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="listings-demo-section" aria-labelledby={`${id}-title`}>
      <div className="listings-demo-section__heading">
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

export function ListingsDesignSystemPage() {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<DemoSort>({
    key: 'issuedAt',
    direction: 'desc'
  });
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [updating, setUpdating] = useState(false);
  const [disabled, setDisabled] = useState(false);

  const filteredRows = useMemo(() => {
    const normalizedQuery = appliedQuery.trim().toLocaleLowerCase('pt-BR');
    return demoRows
      .filter((row) => status === 'all' || row.status === status)
      .filter((row) => {
        if (!normalizedQuery) return true;
        return [row.code, row.mission, row.customer, row.owner].some((value) =>
          value.toLocaleLowerCase('pt-BR').includes(normalizedQuery)
        );
      })
      .sort((left, right) => compareRows(left, right, sort));
  }, [appliedQuery, sort, status]);

  const paginatedRows = filteredRows.slice(
    (page - 1) * pageSize,
    page * pageSize
  );
  const activeFilters = [
    ...(query
      ? [
          {
            id: 'query',
            label: `Busca: ${query}`,
            onRemove: () => {
              setQuery('');
              setAppliedQuery('');
              setPage(1);
            }
          }
        ]
      : []),
    ...(status !== 'all'
      ? [
          {
            id: 'status',
            label: `Status: ${status}`,
            onRemove: () => {
              setStatus('all');
              setPage(1);
            }
          }
        ]
      : [])
  ];

  function clearFilters() {
    setQuery('');
    setAppliedQuery('');
    setStatus('all');
    setPage(1);
  }

  function simulateUpdate() {
    setUpdating(true);
    window.setTimeout(() => setUpdating(false), 900);
  }

  const pagination = (
    <Pagination
      page={page}
      total={filteredRows.length}
      pageSize={pageSize}
      onPageChange={setPage}
      pageSizeOptions={[3, 5, 10]}
      onPageSizeChange={(nextPageSize) => {
        setPageSize(nextPageSize);
        setPage(1);
      }}
      showFirstLast
    />
  );

  return (
    <div className="fv-ds listings-demo-page">
      <header className="listings-demo-header">
        <BrandLogo variant="adaptive" className="listings-demo-logo" />
        <div className="listings-demo-header__copy">
          <span className="listings-demo-eyebrow">Ambiente interno</span>
          <h1>Infraestrutura de listagens</h1>
          <p>Filtrovali DS · Fase 5 · sem migração de módulos</p>
        </div>
        <ThemeToggle data-testid="theme-toggle" />
      </header>

      <main className="listings-demo-main">
        <Section
          id="small-table"
          title="Tabela pequena"
          description="Configuração mínima, células customizadas e representação equivalente em mobile."
        >
          <Card padding="sm" elevation="none">
            <DataTable<DemoRow>
              rows={demoRows.slice(0, 3)}
              columns={smallColumns}
              getRowId={(row) => row.id}
              ariaLabel="Exemplo de tabela pequena"
              mobile={{ renderItem: mobileItem }}
              density="comfortable"
            />
          </Card>
        </Section>

        <Section
          id="complete-listing"
          title="Listagem completa"
          description="Busca, filtros, ordenação controlada, seleção, ações, paginação e muitas colunas."
        >
          <DataTable<DemoRow>
            rows={paginatedRows}
            columns={wideColumns}
            getRowId={(row) => row.id}
            ariaLabel="Missões de demonstração"
            sort={sort}
            onSortChange={setSort}
            selection={{
              selectedRowIds,
              onSelectionChange: (rowIds) =>
                setSelectedRowIds(rowIds.map(String)),
              getRowLabel: (row) => `${row.code} — ${row.mission}`
            }}
            rowActions={rowActions}
            mobile={{ renderItem: mobileItem }}
            updating={updating}
            disabled={disabled}
            toolbar={
              <FilterBar
                search={
                  <SearchInput
                    value={query}
                    onChange={(value) => {
                      setQuery(value);
                      setPage(1);
                    }}
                    onDebouncedChange={setAppliedQuery}
                    debounceMs={300}
                    label="Buscar missões"
                    loading={updating}
                    placeholder="Código, missão, cliente ou responsável"
                  />
                }
                activeFilters={activeFilters}
                onClear={clearFilters}
                actions={
                  <Button variant="secondary" onClick={simulateUpdate}>
                    Atualizar
                  </Button>
                }
              >
                <Select
                  aria-label="Filtrar por status"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(1);
                  }}
                  options={[
                    { value: 'all', label: 'Todos os status' },
                    { value: 'aprovado', label: 'Aprovado' },
                    { value: 'pendente', label: 'Pendente' },
                    { value: 'em revisão', label: 'Em revisão' },
                    { value: 'rejeitado', label: 'Rejeitado' }
                  ]}
                />
              </FilterBar>
            }
            auxiliary={
              <div className="listings-demo-auxiliary" aria-live="polite">
                <span>
                  {filteredRows.length} de {demoRows.length} itens
                </span>
                {selectedRowIds.length ? (
                  <Badge tone="brand">
                    {selectedRowIds.length} selecionados
                  </Badge>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDisabled((current) => !current)}
                >
                  {disabled ? 'Habilitar listagem' : 'Desabilitar listagem'}
                </Button>
              </div>
            }
            pagination={pagination}
            emptyState={
              <EmptyState
                variant="search"
                title="Nenhum resultado encontrado"
                description="Tente remover um filtro ou buscar por outro termo."
                action={{ label: 'Limpar filtros', onClick: clearFilters }}
              />
            }
            density="compact"
          />
        </Section>

        <Section
          id="states"
          title="Estados da listagem"
          description="Loading, vazio e erro usam os mesmos componentes de feedback da Fase 2."
        >
          <div className="listings-demo-state-grid">
            <Card title="Loading" padding="sm" elevation="none">
              <DataTable<DemoRow>
                rows={[]}
                columns={smallColumns}
                getRowId={(row) => row.id}
                ariaLabel="Tabela em carregamento"
                mobile={{ renderItem: mobileItem }}
                loading
              />
            </Card>
            <Card title="Empty" padding="sm" elevation="none">
              <DataTable<DemoRow>
                rows={[]}
                columns={smallColumns}
                getRowId={(row) => row.id}
                ariaLabel="Tabela sem itens"
                mobile={{ renderItem: mobileItem }}
                emptyState={
                  <EmptyState
                    title="Nenhum item cadastrado"
                    description="O próximo item aparecerá nesta listagem."
                    variant="default"
                  />
                }
              />
            </Card>
            <Card title="Erro" padding="sm" elevation="none">
              <DataTable<DemoRow>
                rows={[]}
                columns={smallColumns}
                getRowId={(row) => row.id}
                ariaLabel="Tabela com erro"
                mobile={{ renderItem: mobileItem }}
                error="Não foi possível carregar os itens."
                onRetry={() => undefined}
              />
            </Card>
          </div>
        </Section>

        <aside className="listings-demo-note">
          <AppIcon icon={DS_ICONS.alertInfo} size="sm" />
          <span>
            Os registros acima são fixtures exclusivas deste harness e não são
            usados pelo aplicativo.
          </span>
        </aside>
      </main>
    </div>
  );
}
