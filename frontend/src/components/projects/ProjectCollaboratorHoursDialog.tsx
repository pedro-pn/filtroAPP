import type { ProjectDetailCollaborator } from '../../api/acompanhamentoComercial';
import { Modal } from '../ui/Modal';
import { Alert, Badge, Button, DataTable, EmptyState } from '../ui/ds';
import './ProjectCollaboratorHoursDialog.css';

type PointDay = ProjectDetailCollaborator['diasApropriados'][number];
type ReportDay = ProjectDetailCollaborator['horasRelatoriosPorData'][number];

const fmtHours = (value?: number | null) => (
  value == null
    ? '—'
    : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}h`
);

function fmtDate(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateKey : date.toLocaleDateString('pt-BR');
}

function rdoLabel(rdo: PointDay['rdos'][number]) {
  const mission = rdo.projetoCodigo ? `Missão ${rdo.projetoCodigo} · ` : '';
  return `${mission}${rdo.numero != null ? `RDO ${rdo.numero}` : 'RDO sem número'}`;
}

function pointSources(day: PointDay) {
  return day.rdos.length
    ? day.rdos.map(rdoLabel).join(' · ')
    : <Badge tone="warning">Sem RDO</Badge>;
}

function reportSources(day: ReportDay) {
  return day.relatorios?.length ? (
    <ul className="acp-collaborator-hours__reports">
      {day.relatorios.map(report => (
        <li key={report.id}>
          {report.projetoCodigo && `Missão ${report.projetoCodigo} · `}
          {report.tipo} {report.numero ?? 'sem número'} · {fmtHours(report.horas)}
        </li>
      ))}
    </ul>
  ) : <span className="acp-collaborator-hours__muted">Origem não disponível. Atualize a página para consultar.</span>;
}

export function ProjectCollaboratorHoursDialog({
  collaborator,
  source = 'POINT',
  isGroup = false,
  onSourceChange,
  onClose
}: {
  collaborator: ProjectDetailCollaborator | null;
  source?: 'POINT' | 'REPORT';
  isGroup?: boolean;
  onSourceChange?: (source: 'POINT' | 'REPORT') => void;
  onClose: () => void;
}) {
  const days = collaborator?.diasApropriados ?? [];
  const reportDays = collaborator?.horasRelatoriosPorData ?? [];
  const fromReports = source === 'REPORT';
  const dayCount = fromReports ? reportDays.length : days.length;
  const reportDaysWithoutPoint = reportDays.filter(reportDay => !days.some(day => day.data === reportDay.data));

  return (
    <Modal
      open={Boolean(collaborator)}
      onClose={onClose}
      appearance="design-system"
      title={fromReports ? 'Jornada dos relatórios' : 'Horas apropriadas'}
      size="lg"
      panelClassName="acp-collaborator-hours-dialog"
      footer={<Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>}
    >
      <div className="acp-collaborator-hours">
        <p className="acp-collaborator-hours__context">{collaborator?.name} · {collaborator?.role}</p>

        {onSourceChange && reportDays.length > 0 ? (
          <div className="acp-collaborator-hours__sources" role="group" aria-label="Fonte das horas">
            <Button type="button" size="sm" variant={fromReports ? 'secondary' : 'primary'}
              aria-pressed={!fromReports} onClick={() => onSourceChange('POINT')}>Ponto apropriado</Button>
            <Button type="button" size="sm" variant={fromReports ? 'primary' : 'secondary'}
              aria-pressed={fromReports} onClick={() => onSourceChange('REPORT')}>Todos os RDOs</Button>
          </div>
        ) : null}

        {!fromReports && reportDaysWithoutPoint.length > 0 ? (
          <Alert tone="info">
            Há presença nos RDOs em {reportDaysWithoutPoint.map(day => fmtDate(day.data)).join(', ')} sem horas
            do ponto apropriadas nesta missão. Consulte “Todos os RDOs” para ver a jornada completa.
          </Alert>
        ) : null}

        <div className="acp-collaborator-hours__summary" role="note">
          <span>{dayCount} dia{dayCount === 1 ? '' : 's'} considerado{dayCount === 1 ? '' : 's'}</span>
          <strong>{fmtHours(fromReports ? collaborator?.horas : collaborator?.horasApropriadas)}</strong>
        </div>

        {fromReports ? (
          <>
            <p className="acp-collaborator-hours__explanation">
              Estas horas vêm dos relatórios de execução. Sem apropriação pelo ponto, o custo é estimado pelo
              custo/hora do cargo vigente em cada data, com encargos, benefícios e modalidade da obra.
              A estimativa identificada como RDO não compõe os totais do ponto.
              {collaborator?.custoEstimadoRdo == null && !(collaborator?.horasApropriadas && collaborator.horasApropriadas > 0)
                && ' O valor depende de parâmetros de custo disponíveis para todas as datas e de permissão para consultar custos.'}
              {isGroup && ' Em cada data, a jornada considerada é a maior soma diária entre as missões mescladas. Todos os relatórios de origem aparecem abaixo.'}
            </p>
            <DataTable<ReportDay>
              rows={reportDays}
              getRowId={day => day.data}
              ariaLabel="Jornada dos relatórios por dia"
              density="compact"
              mobileBreakpoint="md"
              emptyState={<EmptyState title="Nenhuma jornada de relatório encontrada" description="Este colaborador ainda não tem jornada registrada em RDO." />}
              columns={[
                { key: 'date', header: 'Data', rowHeader: true, render: day => fmtDate(day.data) },
                { key: 'reports', header: 'Relatórios de origem', render: reportSources },
                { key: 'hours', header: 'Jornada considerada', render: day => <strong>{fmtHours(day.horas)}</strong>, align: 'right' }
              ]}
              mobile={{ renderItem: day => ({
                title: fmtDate(day.data),
                value: fmtHours(day.horas),
                metadata: [{ label: 'Relatórios de origem', value: reportSources(day) }]
              }) }}
            />
          </>
        ) : (
          <DataTable<PointDay>
            rows={days}
            getRowId={day => day.data}
            ariaLabel="Horas apropriadas por dia"
            density="compact"
            mobileBreakpoint="md"
            emptyState={<EmptyState title="Nenhum dia apropriado encontrado" description="Não há horas do ponto atribuídas a este colaborador nesta missão." />}
            columns={[
              { key: 'date', header: 'Data', rowHeader: true, render: day => fmtDate(day.data) },
              { key: 'rdos', header: 'RDO', render: pointSources },
              { key: 'normal', header: 'Normais', render: day => fmtHours(day.horasNormais), align: 'right' },
              { key: 'overtime', header: 'Extras', render: day => fmtHours(day.horasExtras), align: 'right' },
              { key: 'total', header: 'Total', render: day => <strong>{fmtHours(day.horas)}</strong>, align: 'right' },
              { key: 'context', header: 'Contexto', render: day => day.emViagem ? <Badge tone="warning">Em viagem</Badge> : 'Obra' }
            ]}
            mobile={{ renderItem: day => ({
              title: fmtDate(day.data),
              value: fmtHours(day.horas),
              status: day.emViagem ? <Badge tone="warning">Em viagem</Badge> : 'Obra',
              metadata: [
                { label: 'RDO', value: pointSources(day) },
                { label: 'Normais', value: fmtHours(day.horasNormais) },
                { label: 'Extras', value: fmtHours(day.horasExtras) }
              ]
            }) }}
          />
        )}
      </div>
    </Modal>
  );
}
