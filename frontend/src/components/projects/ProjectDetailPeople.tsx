import type { ProjectDetail, ProjectDetailCollaborator } from '../../api/acompanhamentoComercial';
import { HelpTip } from '../ui/HelpTip';
import { Alert, Badge, Button, Card, DataTable } from '../ui/ds';
import { brl, fmtDate, fmtHours } from './projectDetailModel';

export function ProjectDetailPeople({ data, isGroup, collaborators = data.colaboradores, showingPlannedCollaborators = false, onSelect }: {
  data: ProjectDetail;
  isGroup: boolean;
  collaborators?: ProjectDetailCollaborator[];
  showingPlannedCollaborators?: boolean;
  onSelect: (collaborator: ProjectDetailCollaborator, source: 'POINT' | 'REPORT') => void;
}) {
  const hours = (c: ProjectDetailCollaborator) => (
    c.horasApropriadas != null && c.horasApropriadas > 0 ? (
      <Button size="sm" variant="secondary" onClick={() => onSelect(c, 'POINT')}
        aria-label={`Conferir os dias apropriados de ${c.name}: ${fmtHours(c.horasApropriadas)}`}>
        {fmtHours(c.horasApropriadas)}
      </Button>
    ) : c.horas > 0 ? (
      <Button size="sm" variant="secondary" className="acp-detail-report-hours-trigger"
        onClick={() => onSelect(c, 'REPORT')}
        title={`Conferir os RDOs de origem da jornada de ${c.name}; estas horas não entram no custo apropriado`}
        aria-label={`Conferir ${fmtHours(c.horas)} dos relatórios de ${c.name}; não entram no custo apropriado`}>
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
        </Alert>
      ) : null}
      <DataTable rows={collaborators} getRowId={rowId} ariaLabel="Colaboradores na obra"
        className="acp-detail-people" density="compact" mobileBreakpoint="xl"
        emptyState="Nenhum colaborador nos relatórios de execução."
        columns={[
          { key: 'name', header: 'Nome', rowHeader: true, render: c => <>{c.name}{showingPlannedCollaborators ? <span className="api-badge status-planned">Planejado</span> : null}</> },
          { key: 'role', header: 'Cargo' },
          { key: 'hours', header: <HelpTip help="Horas do ponto atribuídas ao projeto pelo mesmo rateio que calculou o custo. Quando não houver apropriação do Ponto Mais, a jornada dos relatórios aparece em azul como referência e não entra no custo. Em um grupo, soma a apropriação das missões.">Horas apropriadas</HelpTip>, render: hours, align: 'right' },
          { key: 'cost', header: <HelpTip help="Parcela do custo total do colaborador atribuída ao projeto no período do ponto.">Custo apropriado</HelpTip>, render: c => brl(c.custo), align: 'right' },
          { key: 'rate', header: <HelpTip help="Custo apropriado dividido pelas horas apropriadas. Por isso este valor pode variar entre colaboradores com salários-base próximos.">Custo efetivo/h</HelpTip>, render: c => c.custoHora != null ? `${brl(c.custoHora)}/h` : '—', align: 'right' },
          { key: 'travel', header: <HelpTip help="Horas apropriadas em dias marcados como viagem. O valor abaixo é a parcela proporcional do custo apropriado e não representa um custo adicional.">Deslocamento</HelpTip>, render: travel, align: 'right' },
        ]}
        mobile={{ renderItem: c => ({
          title: c.name, subtitle: c.role,
          metadata: [
            { label: 'Horas apropriadas', value: hours(c) },
            { label: 'Custo apropriado', value: brl(c.custo) },
            { label: 'Custo efetivo/h', value: c.custoHora != null ? `${brl(c.custoHora)}/h` : '—' },
            { label: 'Deslocamento', value: travel(c) },
          ],
        }) }}
      />
      {collaborators.length > 0 && !showingPlannedCollaborators ? <details className="acp-detail-section">
        <summary className="acp-detail-summary">Conferir jornada dos relatórios</summary>
        <p className="acp-detail-muted">
          {isGroup
            ? 'Esta jornada vem dos RDOs e não é usada para calcular o custo. O total sem sobreposição considera, em cada data, a maior jornada lançada entre as missões mescladas.'
            : 'Esta jornada vem dos RDOs e não é usada para calcular o custo.'}
        </p>
        <DataTable rows={collaborators} getRowId={rowId} ariaLabel="Jornada dos relatórios"
          density="compact" mobileBreakpoint="md"
          columns={[
            { key: 'name', header: 'Nome', rowHeader: true },
            { key: 'hours', header: isGroup ? 'Jornada sem sobreposição' : 'Jornada dos relatórios', render: c => fmtHours(c.horas), align: 'right' },
            ...(isGroup ? [{ key: 'sum', header: 'Soma por missão', render: overlap, align: 'right' as const }] : []),
          ]}
          mobile={{ renderItem: c => ({
            title: c.name,
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
