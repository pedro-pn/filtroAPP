import { useQuery } from '@tanstack/react-query';

import { getEfetivoCollaboratorDetail, type EfetivoPeriod } from '../../../api/efetivo';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';

interface Props {
  collaboratorId: string;
  period: EfetivoPeriod;
  onClose: () => void;
}

function hours(value: number) {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

export function ProductivityCollaboratorDetail({ collaboratorId, period, onClose }: Props) {
  const query = useQuery({
    queryKey: ['efetivo', 'produtividade', 'colaborador', collaboratorId, period.ano, period.ateMes],
    queryFn: () => getEfetivoCollaboratorDetail(collaboratorId, period)
  });

  return (
    <Modal open onClose={onClose} ariaLabelledBy="efetivo-detail-title" panelClassName="modal-card efetivo-modal efetivo-detail-modal">
      <div className="efetivo-modal-layout">
        <header className="efetivo-modal-header">
          <div>
            <h3 id="efetivo-detail-title">Detalhe mensal</h3>
            <p>{query.data?.colaborador.nome || 'Carregando colaborador…'}</p>
          </div>
          <Button variant="mini" onClick={onClose} aria-label="Fechar detalhe">Fechar</Button>
        </header>
        <div className="efetivo-modal-body">
          {query.isLoading ? <p className="placeholder-copy">Carregando meses…</p> : null}
          {query.isError ? <p className="placeholder-copy">Não foi possível carregar o detalhe mensal.</p> : null}
          {query.data ? (
            <>
              <div className="efetivo-detail-summary">
                <span><small>HH acumuladas</small><strong>{hours(query.data.colaborador.hhAcumuladas)}</strong></span>
                <span><small>HE excluídas</small><strong>{hours(query.data.colaborador.heExcluidas)}</strong></span>
                <span><small>Meses analisados</small><strong>{query.data.colaborador.mesesAnalisados.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</strong></span>
              </div>
              <div className="efetivo-table-wrap">
                <table className="efetivo-table efetivo-detail-table">
                  <thead>
                    <tr><th>Mês</th><th>HH normais</th><th>HE excluídas</th><th>Distância da referência</th><th>Situação</th></tr>
                  </thead>
                  <tbody>
                    {query.data.meses.map(month => (
                      <tr key={month.mes}>
                        <td data-label="Mês">{monthLabel(month.mes)}</td>
                        <td data-label="HH normais">{hours(month.hhNormais)}</td>
                        <td data-label="HE excluídas">{hours(month.heExcluidas)}</td>
                        <td data-label="Distância da referência">{hours(month.distanciaReferencia)}</td>
                        <td data-label="Situação" className="efetivo-month-flags">
                          {month.ferias ? <span className="efetivo-badge">Férias</span> : null}
                          {month.instavel ? <span className="efetivo-badge warning">Pode mudar</span> : null}
                          {!month.ferias && !month.instavel ? 'Consolidado' : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
        <footer className="efetivo-modal-footer"><Button variant="secondary" onClick={onClose}>Voltar à lista</Button></footer>
      </div>
    </Modal>
  );
}
