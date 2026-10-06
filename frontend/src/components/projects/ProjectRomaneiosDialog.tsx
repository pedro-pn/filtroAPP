import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getMissionGroupRomaneios, getProjectRomaneios, type ProjectRomaneio } from '../../api/acompanhamentoComercial';
import { getEfetivoProjectRomaneios } from '../../api/projectWorkflow';
import { Modal } from '../ui/Modal';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Skeleton } from '../ui/ds';
import './ProjectRomaneiosDialog.ds.css';

type RomaneioItem = ProjectRomaneio['items'][number];

function formatDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Data não informada';
}

function formatQuantity(value: string | number) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : String(value);
}

export function RomaneioItemsCard({ romaneio }: { romaneio: ProjectRomaneio }) {
  return <Card variant="flat"
    title={`${romaneio.type === 'OUTBOUND' ? 'Saída' : 'Entrada'} · ${formatDate(romaneio.romaneioDate)}`}
    actions={romaneio.vehiclePlate ? <Badge tone="neutral">Placa {romaneio.vehiclePlate}</Badge> : undefined}>
    <p className="acp-romaneios-ds__mission">Missão {romaneio.project.code}{romaneio.project.name ? ` — ${romaneio.project.name}` : ''}</p>
    <DataTable<RomaneioItem>
      rows={romaneio.items}
      getRowId={item => item.id}
      ariaLabel={`Itens da missão ${romaneio.project.code}, ${romaneio.type === 'OUTBOUND' ? 'saída' : 'entrada'} em ${formatDate(romaneio.romaneioDate)}`}
      density="compact"
      mobileBreakpoint="md"
      emptyState={<EmptyState title="Este romaneio não possui itens" />}
      columns={[
        { key: 'code', header: 'Código', render: item => item.itemCode || '—' },
        { key: 'name', sortValue: item => item.itemName, header: 'Item', rowHeader: true, render: item => <span className="acp-romaneios-ds__item-name">{item.itemName}{item.isCustom ? <small>Item personalizado</small> : null}{item.isExtra ? <small>Entrada extra</small> : null}</span> },
        { key: 'category', header: 'Categoria', render: item => item.categoryName || '—' },
        { key: 'quantity', sortValue: item => Number(item.quantity), header: 'Quantidade', align: 'right', render: item => `${formatQuantity(item.quantity)} ${item.unitLabel}` }
      ]}
      mobile={{ renderItem: item => ({
        title: item.itemName,
        value: `${formatQuantity(item.quantity)} ${item.unitLabel}`,
        subtitle: item.itemCode || undefined,
        metadata: [
          { label: 'Categoria', value: item.categoryName || '—' },
          ...(item.isCustom ? [{ label: 'Tipo', value: 'Item personalizado' }] : []),
          ...(item.isExtra ? [{ label: 'Origem', value: 'Entrada extra' }] : [])
        ]
      }) }}
    />
  </Card>;
}

export function ProjectRomaneiosDialog({ projectId, groupId, missionLabel, source = 'acompanhamento', showOnlyWhenAvailable = false }: {
  projectId?: string;
  groupId?: string;
  missionLabel: string;
  source?: 'acompanhamento' | 'efetivo';
  showOnlyWhenAvailable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const query = useQuery({
    queryKey: ['project-romaneios', source, groupId ? 'group' : 'project', groupId || projectId],
    queryFn: () => source === 'efetivo'
      ? getEfetivoProjectRomaneios(projectId!)
      : groupId ? getMissionGroupRomaneios(groupId) : getProjectRomaneios(projectId!),
    enabled: (open || showOnlyWhenAvailable) && Boolean(groupId || projectId),
    staleTime: 0
  });
  const romaneios = query.data?.romaneios ?? [];
  const itemCount = romaneios.reduce((total, romaneio) => total + romaneio.items.length, 0);

  if (showOnlyWhenAvailable && !open && (query.isPending || (query.isSuccess && romaneios.length === 0))) return null;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setOpen(true); if (showOnlyWhenAvailable) void query.refetch(); }} aria-haspopup="dialog">
        {source === 'efetivo' ? `Ver romaneios${query.isSuccess ? ` (${romaneios.length})` : ''}` : 'Ver itens dos romaneios'}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        appearance="design-system"
        title="Itens dos romaneios"
        size="lg"
        panelClassName="acp-romaneios-ds-modal"
        ariaDescribedBy={descriptionId}
        footer={<Button variant="secondary" onClick={() => setOpen(false)}>Fechar</Button>}
      >
        <div className="acp-romaneios-ds">
          <p id={descriptionId} className="acp-romaneios-ds__context">
            {missionLabel} · Itens separados por romaneio de saída ou entrada.
          </p>
          {query.isLoading ? <Skeleton variant="text" lines={6} label="Carregando romaneios" />
            : query.isError ? <Alert tone="danger" title="Não foi possível carregar os romaneios"
              action={<Button size="sm" variant="secondary" loading={query.isFetching}
                onClick={() => void query.refetch()}>Tentar novamente</Button>} />
            : romaneios.length === 0 ? <EmptyState title="Nenhum romaneio registrado"
              description={groupId ? 'Não há romaneios para as missões deste grupo.' : 'Não há romaneios para este projeto.'} />
            : <>
              <div className="acp-romaneios-ds__summary" role="status">
                <Badge tone="brand">{romaneios.length} romaneio{romaneios.length === 1 ? '' : 's'}</Badge>
                <span>{itemCount} ite{itemCount === 1 ? 'm listado' : 'ns listados'}</span>
              </div>
              {romaneios.map(romaneio => <RomaneioItemsCard key={romaneio.id} romaneio={romaneio} />)}
            </>}
        </div>
      </Modal>
    </>
  );
}
