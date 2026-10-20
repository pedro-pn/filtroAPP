import type { CrmOpportunityCard as Opportunity } from '../../api/acompanhamentoComercial';
import { Badge, Card } from '../ui/ds';
import { brl, formatDate } from './projectCardFormatting';

export function CrmOpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  return (
    <Card padding="sm" className="acp-project acp-opportunity" data-acp-opportunity={opportunity.id}
      header={<div className="acp-project__heading"><div className="acp-project__identity"><h2>{opportunity.name}</h2>
        <p className="acp-project__secondary">{opportunity.clientName}</p></div></div>}
      footer={opportunity.externalUrl ? <a href={opportunity.externalUrl} target="_blank" rel="noopener noreferrer">Abrir no PrismaCRM</a> : undefined}>
      <div className="acp-project__body">
        <div className="acp-project__statuses"><Badge tone="warning" multiline>Oportunidade quente · Em negociação</Badge></div>
        <p className="acp-project__secondary">Aguardando fechamento e número do projeto.</p>
        <dl className="acp-opportunity__details">
          {opportunity.location ? <div><dt>Local</dt><dd>{opportunity.location}</dd></div> : null}
          {opportunity.proposalCode ? <div><dt>Proposta</dt><dd>{opportunity.proposalCode}{opportunity.revision !== null ? ` · Rev. ${opportunity.revision}` : ''}</dd></div> : null}
          {opportunity.estimatedValue !== null ? <div><dt>Valor estimado</dt><dd>{brl(opportunity.estimatedValue)}</dd></div> : null}
          {opportunity.expectedCloseDate ? <div><dt>Previsão de fechamento</dt><dd>{formatDate(opportunity.expectedCloseDate)}</dd></div> : null}
          {opportunity.expectedStartDate ? <div><dt>Previsão de início</dt><dd>{formatDate(opportunity.expectedStartDate)}</dd></div> : null}
        </dl>
      </div>
    </Card>
  );
}
