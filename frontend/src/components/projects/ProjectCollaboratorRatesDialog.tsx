import { useQuery } from '@tanstack/react-query';
import type { ProjectDetailCollaborator } from '../../api/acompanhamentoComercial';
import { getCollaboratorHourlyRates, type CollaboratorHourlyRates, type HourlyCostScenario } from '../../api/acompanhamentoCusto';
import { Modal } from '../ui/Modal';
import { Alert, Button, DataTable, EmptyState, Skeleton } from '../ui/ds';
import { brl, fmtDate } from './projectDetailModel';
import './ProjectCollaboratorRatesDialog.css';

const scenarioLabels: Record<HourlyCostScenario, { label: string; description: string }> = {
  normal: { label: 'Normal', description: 'Em Itajaí, com produtividade' },
  he70: { label: 'Hora extra 70%', description: 'Uma hora extra na modalidade normal, com DSR e encargos' },
  he100: { label: 'Hora extra 100%', description: 'Uma hora extra na modalidade normal, com DSR e encargos' },
  offshore: { label: 'Offshore', description: 'Com adicional de confinamento' },
  viagem: { label: 'Viagem', description: 'Com adicional de transferência' }
};

export function CollaboratorHourlyRatesContent({ data }: { data: CollaboratorHourlyRates }) {
  return <div className="acp-collaborator-rates">
    <p className="acp-collaborator-rates__context">
      {data.name} · {data.role || 'Cargo não disponível'} · Referência: {fmtDate(data.referenceDate)}
    </p>
    {!data.available ? <Alert tone="info">
      Não há parâmetros de custo disponíveis para o cargo deste colaborador na data de referência.
    </Alert> : null}
    <DataTable rows={data.scenarios} getRowId={row => row.scenario}
      ariaLabel="Valor por hora do colaborador por cenário" density="compact" mobileBreakpoint="md"
      columns={[
        { key: 'scenario', header: 'Cenário', rowHeader: true, sortable: false, render: row => scenarioLabels[row.scenario].label },
        { key: 'description', header: 'Composição', sortable: false, render: row => scenarioLabels[row.scenario].description },
        { key: 'hourlyCost', header: 'Valor/hora', align: 'right', sortable: false, render: row => <strong>{row.hourlyCost == null ? '—' : `${brl(row.hourlyCost)}/h`}</strong> }
      ]}
      mobile={{ renderItem: row => ({
        title: scenarioLabels[row.scenario].label,
        subtitle: scenarioLabels[row.scenario].description,
        value: row.hourlyCost == null ? '—' : `${brl(row.hourlyCost)}/h`
      }) }}
    />
    {data.available ? <p className="acp-collaborator-rates__explanation">
      Normal, offshore e viagem consideram {data.workingDays} dias úteis e {data.monthlyHours}h mensais,
      com encargos, provisões, benefícios e custos anuais rateados. Horas extras mostram o custo adicional
      de uma hora, com seus reflexos. Os valores usam os parâmetros do cargo vigentes na data de referência.
    </p> : null}
  </div>;
}

export function ProjectCollaboratorRatesDialog({ collaborator, referenceDate, onClose }: {
  collaborator: ProjectDetailCollaborator | null;
  referenceDate: string;
  onClose: () => void;
}) {
  const ratesQuery = useQuery({
    queryKey: ['collaborator-hourly-rates', collaborator?.collaboratorId, referenceDate],
    queryFn: () => getCollaboratorHourlyRates(collaborator!.collaboratorId!, referenceDate),
    enabled: Boolean(collaborator?.collaboratorId),
    staleTime: 60_000
  });

  return <Modal open={Boolean(collaborator)} onClose={onClose} appearance="design-system"
    title="Valor/hora do colaborador" size="lg"
    footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
    {!collaborator?.collaboratorId ? <EmptyState title="Colaborador sem vínculo disponível"
      description="Atualize o dashboard para consultar os valores por hora." />
      : ratesQuery.isLoading ? <Skeleton variant="table-rows" lines={5} label="Carregando valores por hora" />
      : ratesQuery.isError ? <Alert tone="danger" title="Não foi possível carregar os valores por hora"
        action={<Button size="sm" variant="secondary" loading={ratesQuery.isFetching}
          onClick={() => void ratesQuery.refetch()}>Tentar novamente</Button>} />
      : ratesQuery.data ? <CollaboratorHourlyRatesContent data={ratesQuery.data} /> : null}
  </Modal>;
}
