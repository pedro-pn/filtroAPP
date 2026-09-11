import type { ProjectDetailCollaborator } from '../../api/acompanhamentoComercial';
import { Modal } from '../ui/Modal';

const fmtHours = (value?: number | null) => (
  value == null
    ? '—'
    : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}h`
);

function fmtDate(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateKey : date.toLocaleDateString('pt-BR');
}

function rdoLabel(rdo: ProjectDetailCollaborator['diasApropriados'][number]['rdos'][number]) {
  const mission = rdo.projetoCodigo ? `Missão ${rdo.projetoCodigo} · ` : '';
  return `${mission}${rdo.numero != null ? `RDO ${rdo.numero}` : 'RDO sem número'}`;
}

export function ProjectCollaboratorHoursDialog({
  collaborator,
  source = 'POINT',
  isGroup = false,
  onClose
}: {
  collaborator: ProjectDetailCollaborator | null;
  source?: 'POINT' | 'REPORT';
  isGroup?: boolean;
  onClose: () => void;
}) {
  const days = collaborator?.diasApropriados ?? [];
  const reportDays = collaborator?.horasRelatoriosPorData ?? [];
  const fromReports = source === 'REPORT';
  const dayCount = fromReports ? reportDays.length : days.length;

  return (
    <Modal
      open={Boolean(collaborator)}
      onClose={onClose}
      ariaLabelledBy="acp-collaborator-hours-title"
      panelClassName="modal-card acp-collaborator-hours-dialog"
    >
      <div className="acp-manage">
        <div className="acp-manage-head">
          <div>
            <div className="sec" id="acp-collaborator-hours-title">
              {fromReports ? 'Jornada dos relatórios' : 'Horas apropriadas'}
            </div>
            <p>{collaborator?.name} · {collaborator?.role}</p>
          </div>
          <button className="mini-btn alt" type="button" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="acp-manage-body">
          <div className="acp-collaborator-hours-summary" role="note">
            <span>{dayCount} dia{dayCount === 1 ? '' : 's'} considerado{dayCount === 1 ? '' : 's'}</span>
            <strong>{fmtHours(fromReports ? collaborator?.horas : collaborator?.horasApropriadas)}</strong>
          </div>

          {fromReports ? (
            <>
              <p className="acp-det-collab-audit-copy">
                Estas horas vêm dos relatórios de execução e não entram no custo apropriado.
                {isGroup && ' Em cada data, a jornada considerada é a maior soma diária entre as missões mescladas. Todos os relatórios de origem aparecem abaixo.'}
              </p>
              {reportDays.length ? (
                <div className="acp-table-wrap">
                  <table className="acp-table acp-collaborator-hours-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Relatórios de origem</th>
                        <th style={{ textAlign: 'right' }}>Jornada considerada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportDays.map(day => (
                        <tr key={day.data}>
                          <td data-label="Data">{fmtDate(day.data)}</td>
                          <td data-label="Relatórios de origem">
                            {day.relatorios?.length ? (
                              <ul className="acp-collaborator-report-sources">
                                {day.relatorios.map(report => (
                                  <li key={report.id}>
                                    {report.projetoCodigo && `Missão ${report.projetoCodigo} · `}
                                    {report.tipo} {report.numero ?? 'sem número'}
                                    {' · '}{fmtHours(report.horas)}
                                  </li>
                                ))}
                              </ul>
                            ) : <span className="placeholder-copy">Origem não disponível. Atualize a página para consultar.</span>}
                          </td>
                          <td data-label="Jornada considerada" style={{ textAlign: 'right' }}>
                            <strong>{fmtHours(day.horas)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="placeholder-copy">Nenhuma jornada de relatório foi encontrada para este colaborador.</p>}
            </>
          ) : days.length ? (
            <div className="acp-table-wrap">
              <table className="acp-table acp-collaborator-hours-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>RDO</th>
                    <th style={{ textAlign: 'right' }}>Normais</th>
                    <th style={{ textAlign: 'right' }}>Extras</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th>Contexto</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map(day => (
                    <tr key={day.data}>
                      <td data-label="Data">{fmtDate(day.data)}</td>
                      <td data-label="RDO">
                        {day.rdos.length
                          ? <span className="acp-collaborator-hours-rdos">{day.rdos.map(rdoLabel).join(' · ')}</span>
                          : <span className="acp-collaborator-hours-no-rdo">Sem RDO</span>}
                      </td>
                      <td data-label="Normais" style={{ textAlign: 'right' }}>{fmtHours(day.horasNormais)}</td>
                      <td data-label="Extras" style={{ textAlign: 'right' }}>{fmtHours(day.horasExtras)}</td>
                      <td data-label="Total" style={{ textAlign: 'right' }}><strong>{fmtHours(day.horas)}</strong></td>
                      <td data-label="Contexto">
                        {day.emViagem ? <span className="badge badge-pen">Em viagem</span> : 'Obra'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="placeholder-copy">Nenhum dia apropriado foi encontrado para este colaborador.</p>
          )}
        </div>

        <div className="acp-manage-foot">
          <button type="button" className="mini-btn alt" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </Modal>
  );
}
