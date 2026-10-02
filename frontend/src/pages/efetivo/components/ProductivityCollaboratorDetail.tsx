import { useQuery } from '@tanstack/react-query';

import { getEfetivoCollaboratorDetail, type EfetivoPeriod } from '../../../api/efetivo';
import { Badge, Button, EmptyState, MetricCard, Skeleton } from '../../../components/ui/ds';
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
    <Modal open onClose={onClose} appearance="design-system" title="Detalhe mensal" size="lg"
      fullscreenOnMobile={false} panelClassName="efetivo-dialog efetivo-productivity-detail"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Voltar à lista</Button>}>
      <div className="efetivo-productivity-detail__content">
          {query.isLoading ? <Skeleton variant="card" /> : null}
          {query.isError ? <EmptyState variant="error" title="Não foi possível carregar o detalhe mensal." /> : null}
          {query.data ? (
            <>
              <p className="efetivo-productivity-detail__name">{query.data.colaborador.nome}</p>
              <div className="efetivo-productivity-detail__metrics">
                <MetricCard label="HH acumuladas" value={hours(query.data.colaborador.hhAcumuladas)} />
                <MetricCard label="HE excluídas" value={hours(query.data.colaborador.heExcluidas)} />
                <MetricCard label="Meses analisados" value={query.data.colaborador.mesesAnalisados.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} />
              </div>
              <div className="efetivo-table-wrap efetivo-productivity-detail__table">
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
                          {month.ferias ? <Badge tone="info">Férias</Badge> : null}
                          {month.instavel ? <Badge tone="warning">Pode mudar</Badge> : null}
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
    </Modal>
  );
}
