import type { ProjectDetail, ProjectDetailCollaborator } from '../../api/acompanhamentoComercial';
import { HelpTip } from '../ui/HelpTip';
import { Alert, Badge, Button, Card, DataTable } from '../ui/ds';
import { brl, fmtDate, fmtHours } from './projectDetailModel';

export function ProjectDetailPeople({ data, isGroup, collaborators = data.colaboradores, showingPlannedCollaborators = false, onSelect, onSelectRates }: {
  data: ProjectDetail;
  isGroup: boolean;
  collaborators?: ProjectDetailCollaborator[];
  showingPlannedCollaborators?: boolean;
  onSelect: (collaborator: ProjectDetailCollaborator, source: 'POINT' | 'REPORT') => void;
  onSelectRates: (collaborator: ProjectDetailCollaborator) => void;
}) {
  const name = (c: ProjectDetailCollaborator) => <Button variant="link" size="sm" multiline
    aria-haspopup="dialog" aria-label={`Consultar valor por hora de ${c.name}`}
    onClick={() => onSelectRates(c)}>{c.name}</Button>;
  const hasPointHours = (c: ProjectDetailCollaborator) => c.horasApropriadas != null && c.horasApropriadas > 0;
  const costValue = (c: ProjectDetailCollaborator) => hasPointHours(c) ? c.custo : c.custoEstimadoRdo ?? c.custo;
  const rateValue = (c: ProjectDetailCollaborator) => hasPointHours(c) ? c.custoHora : c.custoHoraEstimadoRdo ?? c.custoHora;
  const estimate = (value: number, hourly = false) => (
    <span className="acp-detail-cell">
      <strong>{brl(value)}{hourly ? '/h' : ''}</strong>
      <Badge tone="info" multiline>Estimativa RDO</Badge>
    </span>
  );
  const cost = (c: ProjectDetailCollaborator) => !hasPointHours(c) && c.custoEstimadoRdo != null
    ? estimate(c.custoEstimadoRdo) : brl(c.custo);
  const rate = (c: ProjectDetailCollaborator) => !hasPointHours(c) && c.custoHoraEstimadoRdo != null
    ? estimate(c.custoHoraEstimadoRdo, true) : c.custoHora != null ? `${brl(c.custoHora)}/h` : '—';
  const hours = (c: ProjectDetailCollaborator) => (
    c.horasApropriadas != null && c.horasApropriadas > 0 ? (
      <Button size="sm" variant="secondary" onClick={() => onSelect(c, 'POINT')}
        aria-label={`Conferir os dias apropriados de ${c.name}: ${fmtHours(c.horasApropriadas)}`}>
        {fmtHours(c.horasApropriadas)}
      </Button>
    ) : c.horas > 0 ? (
      <Button size="sm" variant="secondary" className="acp-detail-report-hours-trigger"
        onClick={() => onSelect(c, 'REPORT')}
        title={`Conferir os RDOs de origem da jornada e do custo estimado de ${c.name}`}
        aria-label={`Conferir ${fmtHours(c.horas)} dos relatórios de ${c.name} e a estimativa RDO`}>
        {fmtHours(c.horas)} · RDO
      </Button>
    ) : fmtHours(c.horasApropriadas)
  );
  const travel = (c: ProjectDetailCollaborator) => c.horasDeslocamento > 0 ? (
    <span className="acp-detail-cell">
      <strong>{fmtHours(c.horasDeslocamento)}</strong>
      {c.custoDeslocamento != null ? <small>{brl(c.custoDeslocamento)} do custo</small> : null}
    </span>
  ) : '—';
  const overlap = (c: ProjectDetailCollaborator) => (
    <span className="acp-detail-cell">
      <span>{fmtHours(c.horasLancadas)}</span>
      {c.sobreposicaoHoras > 0 ? <Badge tone="warning" multiline>{fmtHours(c.sobreposicaoHoras)} em sobreposição</Badge> : null}
    </span>
  );
  const rowId = (c: ProjectDetailCollaborator) => collaborators.indexOf(c);
  return <Card padding="sm" className="acp-detail-block">
    <details open>
      <summary className="acp-detail-summary">Colaboradores na obra <Badge tone="neutral">{collaborators.length}</Badge></summary>
      {showingPlannedCollaborators ? <Alert tone="info">Ainda não há RDO para este projeto. A equipe exibida corresponde ao planejamento.</Alert> : null}
      {collaborators.length > 0 && !showingPlannedCollaborators ? (
        <Alert tone="info" title={`Base da apropriação: ponto de ${fmtDate(data.maoDeObra.periodStart)} a ${fmtDate(data.maoDeObra.periodEnd)}`}>
          O deslocamento já está incluído nas horas e no custo total; aparece separado apenas para detalhamento.
          {' '}Sem horas apropriadas, a estimativa RDO usa a jornada dos relatórios e o cargo vigente em cada data;
          não compõe os totais do ponto.
        </Alert>
      ) : null}
      <DataTable rows={collaborators} getRowId={rowId} ariaLabel="Colaboradores na obra"
        className="acp-detail-people" density="compact" mobileBreakpoint="xl"
        emptyState="Nenhum colaborador nos relatórios de execução."
        columns={[
          { key: 'name', sortValue: c => c.name, header: 'Nome', rowHeader: true, render: c => <>{name(c)}{showingPlannedCollaborators ? <Badge tone="info">Planejado</Badge> : null}</> },
          { key: 'role', header: 'Cargo' },
          { key: 'hours', header: <HelpTip help="Horas do ponto atribuídas ao projeto pelo mesmo rateio que calculou o custo. Quando não houver apropriação do Ponto Mais, a jornada dos relatórios serve de base para a estimativa RDO. Em um grupo, soma a apropriação das missões.">Horas apropriadas</HelpTip>, sortValue: c => c.horasApropriadas != null && c.horasApropriadas > 0 ? c.horasApropriadas : c.horas, render: hours, align: 'right' },
          { key: 'cost', sortValue: costValue, header: <HelpTip help="Parcela do custo total do colaborador atribuída ao projeto no período do ponto. Sem horas apropriadas, mostra a estimativa RDO: jornada dos relatórios × custo/hora do cargo vigente em cada data, com encargos, benefícios e modalidade da obra. A estimativa não compõe os totais do ponto.">Custo apropriado / RDO</HelpTip>, render: cost, align: 'right' },
          { key: 'rate', sortValue: rateValue, header: <HelpTip help="Custo apropriado dividido pelas horas apropriadas. Para valores identificados como estimativa RDO, é o custo estimado dividido pela jornada dos relatórios.">Custo/h</HelpTip>, render: rate, align: 'right' },
          { key: 'travel', sortValue: c => c.horasDeslocamento, header: <HelpTip help="Horas apropriadas em dias marcados como viagem. O valor abaixo é a parcela proporcional do custo apropriado e não representa um custo adicional.">Deslocamento</HelpTip>, render: travel, align: 'right' },
        ]}
        mobile={{ renderItem: c => ({
          title: name(c), subtitle: c.role,
          metadata: [
            { label: 'Horas apropriadas', value: hours(c) },
            { label: 'Custo apropriado / RDO', value: cost(c) },
            { label: 'Custo/h', value: rate(c) },
            { label: 'Deslocamento', value: travel(c) },
          ],
        }) }}
      />
      {collaborators.length > 0 && !showingPlannedCollaborators ? <details className="acp-detail-section">
        <summary className="acp-detail-summary">Conferir jornada dos relatórios</summary>
        <p className="acp-detail-muted">
          {isGroup
            ? 'Esta jornada vem dos RDOs e serve de base para a estimativa quando não há horas apropriadas pelo ponto. O total sem sobreposição considera, em cada data, a maior jornada lançada entre as missões mescladas.'
            : 'Esta jornada vem dos RDOs e serve de base para a estimativa quando não há horas apropriadas pelo ponto.'}
        </p>
        <DataTable rows={collaborators} getRowId={rowId} ariaLabel="Jornada dos relatórios"
          density="compact" mobileBreakpoint="md"
          columns={[
            { key: 'name', sortValue: c => c.name, header: 'Nome', rowHeader: true, render: name },
            { key: 'hours', header: isGroup ? 'Jornada sem sobreposição' : 'Jornada dos relatórios', sortValue: c => c.horas, render: c => fmtHours(c.horas), align: 'right' },
            ...(isGroup ? [{ key: 'sum', sortValue: (c: ProjectDetailCollaborator) => c.horasLancadas, header: 'Soma por missão', render: overlap, align: 'right' as const }] : []),
          ]}
          mobile={{ renderItem: c => ({
            title: name(c),
            metadata: [
              { label: isGroup ? 'Sem sobreposição' : 'Jornada dos relatórios', value: fmtHours(c.horas) },
              ...(isGroup ? [{ label: 'Soma por missão', value: overlap(c) }] : []),
            ],
          }) }}
        />
      </details> : null}
    </details>
  </Card>;
}
