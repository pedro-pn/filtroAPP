import { useQuery } from '@tanstack/react-query';

import {
  getProjectStandbyHistory
} from '../../api/acompanhamentoComercial';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

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
      ariaLabelledBy="acp-standby-history-title"
      ariaDescribedBy="acp-standby-history-description"
      panelClassName="modal-card acp-manage-card acp-standby-history-modal"
    >
      <div className="acp-manage acp-standby-history">
        <div className="acp-manage-head">
          <div>
            <div className="sec" id="acp-standby-history-title">Histórico de standby</div>
            <div className="acp-standby-history-project">
              {projectLabel}
            </div>
          </div>
          <Button variant="mini" className="alt" onClick={onClose} aria-label="Fechar histórico de standby">
            ✕
          </Button>
        </div>

        <div className="acp-manage-body">
          <p id="acp-standby-history-description" className="acp-standby-history-description">
            Somente dias com tempo de standby registrado são exibidos.
          </p>

          {historyQuery.isLoading ? (
            <div className="placeholder-copy" aria-live="polite">Carregando histórico de standby…</div>
          ) : historyQuery.isError ? (
            <div className="acp-standby-history-error" role="alert">
              <span>Não foi possível carregar o histórico de standby deste projeto.</span>
              <Button
                variant="mini"
                className="alt"
                disabled={historyQuery.isFetching}
                onClick={() => historyQuery.refetch()}
              >
                {historyQuery.isFetching ? 'Tentando novamente…' : 'Tentar novamente'}
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <div className="placeholder-copy" aria-live="polite">
              Este projeto não possui registros de standby.
            </div>
          ) : (
            <div className="acp-standby-table-wrap">
              <table className="acp-standby-table">
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Horas em standby</th>
                    <th>Nº de colaboradores</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => (
                    <tr key={entry.date}>
                      <td data-label="Dia">{formatDate(entry.date)}</td>
                      <td data-label="Horas em standby" className="acp-standby-time">{formatMinutes(entry.standbyMinutes)}</td>
                      <td data-label="Nº de colaboradores">{entry.collaboratorCount ?? 'Não informado'}</td>
                      <td data-label="Motivo" className="acp-standby-reason">{entry.reason || 'Não informado'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="acp-manage-foot">
          <Button variant="mini" className="alt" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}
