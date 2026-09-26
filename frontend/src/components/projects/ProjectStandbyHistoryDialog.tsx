import { useQuery } from '@tanstack/react-query';

import { getProjectStandbyHistory, type ProjectStandbyHistoryEntry } from '../../api/acompanhamentoComercial';
import { Modal } from '../ui/Modal';
import { Alert, Button, DataTable, EmptyState, Skeleton } from '../ui/ds';
import './ProjectStandbyHistoryDialog.ds.css';

type StandbyHistoryProject = {
  projectId: string;
  code: string;
  name?: string | null;
};

function formatDate(date: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
}

function formatMinutes(minutes: number) {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function StandbyHistoryTable({ entries }: { entries: ProjectStandbyHistoryEntry[] }) {
  return <DataTable<ProjectStandbyHistoryEntry>
    rows={entries}
    getRowId={entry => entry.date}
    ariaLabel="Histórico de standby por dia"
    density="compact"
    mobileBreakpoint="md"
    emptyState={<EmptyState title="Nenhum registro de standby" description="Este projeto ainda não possui tempo de standby registrado." />}
    columns={[
      { key: 'date', header: 'Dia', rowHeader: true, render: entry => formatDate(entry.date) },
      { key: 'time', header: 'Horas em standby', align: 'right', render: entry => formatMinutes(entry.standbyMinutes) },
      { key: 'people', header: 'Nº de colaboradores', align: 'right', render: entry => entry.collaboratorCount ?? 'Não informado' },
      { key: 'reason', header: 'Motivo', render: entry => entry.reason || 'Não informado' }
    ]}
    mobile={{ renderItem: entry => ({
      title: formatDate(entry.date),
      value: formatMinutes(entry.standbyMinutes),
      metadata: [
        { label: 'Colaboradores', value: entry.collaboratorCount ?? 'Não informado' },
        { label: 'Motivo', value: entry.reason || 'Não informado' }
      ]
    }) }}
  />;
}

export function ProjectStandbyHistoryDialog({
  project,
  onClose
}: {
  project: StandbyHistoryProject | null;
  onClose: () => void;
}) {
  const historyQuery = useQuery({
    queryKey: ['project-standby-history', project?.projectId ?? 'closed'],
    queryFn: () => getProjectStandbyHistory(project!.projectId),
    enabled: Boolean(project?.projectId),
    staleTime: 60_000
  });

  const titleProject = historyQuery.data?.project ?? project;
  const entries = historyQuery.data?.entries ?? [];
  const projectLabel = titleProject
    ? [titleProject.code, titleProject.name].filter(Boolean).join(' — ')
    : 'Projeto';

  return (
    <Modal
      open={project !== null}
      onClose={onClose}
      appearance="design-system"
      title="Histórico de standby"
      size="lg"
      ariaDescribedBy="acp-standby-history-description"
      panelClassName="acp-standby-ds-modal"
      footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}
    >
      <div className="acp-standby-ds">
        <p id="acp-standby-history-description" className="acp-standby-ds__context">
          {projectLabel} · Somente dias com tempo de standby registrado são exibidos.
        </p>
        {historyQuery.isLoading ? <Skeleton variant="table-rows" lines={5} label="Carregando histórico de standby" />
          : historyQuery.isError ? <Alert tone="danger" title="Não foi possível carregar o histórico de standby"
            action={<Button size="sm" variant="secondary" loading={historyQuery.isFetching}
              onClick={() => void historyQuery.refetch()}>Tentar novamente</Button>} />
          : <StandbyHistoryTable entries={entries} />}
      </div>
    </Modal>
  );
}
