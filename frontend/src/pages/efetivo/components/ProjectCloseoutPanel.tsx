import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { getProjectCloseoutDashboard, type ProjectWorkflow, type ProjectWorkflowPatch } from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';

const money = z.string().trim().refine(value => !value || /^\d+(?:[.,]\d{1,2})?$/.test(value), 'Informe um valor válido com até duas casas decimais.');
const schema = z.object({
  quantitiesSummary: z.string().trim().max(4000, 'O texto deve ter no máximo 4000 caracteres.'),
  additionalServicesNote: z.string().trim().max(4000, 'O texto deve ter no máximo 4000 caracteres.'),
  evidenceNote: z.string().trim().max(4000, 'O texto deve ter no máximo 4000 caracteres.'),
  executedAmount: money,
  measuredAmount: money,
  approvedAmount: money,
  preparedAt: z.string(),
  sentAt: z.string(),
  approvedAt: z.string()
}).superRefine((value, ctx) => {
  const number = (input: string) => input ? Number(input.replace(',', '.')) : null;
  const executed = number(value.executedAmount);
  const measured = number(value.measuredAmount);
  const approved = number(value.approvedAmount);
  if (executed != null && measured != null && measured > executed) ctx.addIssue({ code: 'custom', path: ['measuredAmount'], message: 'O medido não pode superar o executado.' });
  if (measured != null && approved != null && approved > measured) ctx.addIssue({ code: 'custom', path: ['approvedAmount'], message: 'O aprovado não pode superar o medido.' });
  if (value.preparedAt && value.sentAt && value.preparedAt > value.sentAt) ctx.addIssue({ code: 'custom', path: ['sentAt'], message: 'O envio não pode ser anterior à preparação.' });
  if (value.sentAt && value.approvedAt && value.sentAt > value.approvedAt) ctx.addIssue({ code: 'custom', path: ['approvedAt'], message: 'A aprovação não pode ser anterior ao envio.' });
});

type Values = z.infer<typeof schema>;

function rawMoney(value: number | null) {
  return value == null ? '' : String(value).replace('.', ',');
}

function defaults(workflow: ProjectWorkflow): Values {
  return {
    quantitiesSummary: workflow.measurement.quantitiesSummary || '',
    additionalServicesNote: workflow.measurement.additionalServicesNote || '',
    evidenceNote: workflow.measurement.evidenceNote || '',
    executedAmount: rawMoney(workflow.measurement.executedAmount),
    measuredAmount: rawMoney(workflow.measurement.measuredAmount),
    approvedAmount: rawMoney(workflow.measurement.approvedAmount),
    preparedAt: workflow.measurement.preparedAt || '',
    sentAt: workflow.measurement.sentAt || '',
    approvedAt: workflow.measurement.approvedAt || ''
  };
}

function optionalMoney(value: string) {
  return value ? Number(value.replace(',', '.')) : null;
}

function payload(values: Values, version: number): ProjectWorkflowPatch {
  return {
    action: 'measurement',
    version,
    quantitiesSummary: values.quantitiesSummary || null,
    additionalServicesNote: values.additionalServicesNote || null,
    evidenceNote: values.evidenceNote || null,
    executedAmount: optionalMoney(values.executedAmount),
    measuredAmount: optionalMoney(values.measuredAmount),
    approvedAmount: optionalMoney(values.approvedAmount),
    preparedAt: values.preparedAt || null,
    sentAt: values.sentAt || null,
    approvedAt: values.approvedAt || null
  };
}

function fmtMoney(value: number | null) {
  return value == null ? '—' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fieldClass(error?: unknown) {
  return `field-group ${error ? 'field-invalid' : ''}`;
}

export function ProjectCloseoutPanel({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const query = useQuery({ queryKey: ['project-closeout', workflow.projectId], queryFn: () => getProjectCloseoutDashboard(workflow.projectId) });
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults(workflow)
  });
  useEffect(() => reset(defaults(workflow)), [reset, workflow]);
  const data = query.data;
  const executed = workflow.measurement.executedAmount;
  const measured = workflow.measurement.measuredAmount;
  const approved = workflow.measurement.approvedAmount;
  const unmeasured = executed != null && measured != null ? Math.max(0, executed - measured) : null;
  const pending = measured != null && approved != null ? Math.max(0, measured - approved) : null;

  return (
    <div className="project-closeout-panel" data-project-closeout-panel>
      {query.isLoading ? <p className="placeholder-copy">Consolidando documentos e valores…</p> : query.isError || !data ? <div className="project-closeout-load-error"><span>Não foi possível carregar as evidências automáticas.</span><Button variant="mini" onClick={() => void query.refetch()}>Tentar novamente</Button></div> : <>
        <div className="project-closeout-financial" aria-label="Resumo financeiro do encerramento">
          <article><span>Contrato</span><strong>{fmtMoney(data.financial.contractAmount)}</strong><small>Original {fmtMoney(data.financial.originalContractAmount)} · adicionais {fmtMoney(data.financial.additionalContractAmount)}</small></article>
          <article><span>Executado</span><strong>{fmtMoney(executed)}</strong><small>Informado na gestão do projeto</small></article>
          <article><span>Medido</span><strong>{fmtMoney(measured)}</strong><small>Pendente de medir: {fmtMoney(unmeasured)}</small></article>
          <article><span>Aprovado</span><strong>{fmtMoney(approved)}</strong><small>Pendente de aprovação: {fmtMoney(pending)}</small></article>
          <article><span>Faturado</span><strong>{fmtMoney(data.financial.invoicedAmount)}</strong><small>{data.financial.invoiceCount} título(s) no Omie</small></article>
        </div>
        <section className="project-closeout-documents">
          <header><div><h5>Evidências documentais</h5><p>Retrato dos registros atuais. Confirme os checklists após validar se o conjunto está completo.</p></div><span>{data.documentation.totalClientAccepted} aceite(s) do cliente</span></header>
          <div className="project-closeout-rdo-grid">
            <article><strong>{data.documentation.rdo.receivedCount}</strong><span>RDOs emitidos</span></article>
            <article><strong>{data.documentation.rdo.releasedToClientCount}</strong><span>RDOs liberados</span></article>
            <article><strong>{data.documentation.rdo.signedCount}</strong><span>RDOs assinados</span></article>
            <article><strong>{data.documentation.rdo.pendingOrReturnedCount}</strong><span>Pendentes/devolvidos</span></article>
          </div>
          <div className="project-closeout-report-list">{data.documentation.technicalReports.map(report => <article className={report.missingCount || report.returnedCount ? 'is-warning' : ''} key={report.reportType}><strong>{report.label}</strong><span>{report.issuedCount}/{report.expectedCount || '—'} emitido(s)</span><small>{report.approvedCount} aprovado(s) · {report.signedCount} assinado(s) · {report.clientAcceptedCount} aceite(s) do cliente</small></article>)}</div>
        </section>
      </>}

      <form className="project-closeout-form" noValidate onSubmit={handleSubmit(values => onPatch(payload(values, workflow.version)))}>
        <header><div><h5>Consolidação da medição</h5><p>Registre os dados da medição sem substituir os valores de contrato e faturamento.</p></div>{workflow.measurement.updatedBy ? <small>Última alteração por {workflow.measurement.updatedBy.name}</small> : null}</header>
        <div className="project-closeout-notes">
          <div className={fieldClass(errors.quantitiesSummary)}><label htmlFor="closeout-quantities">Quantitativos finais</label><textarea id="closeout-quantities" rows={3} disabled={saving || !workflow.permissions.canEdit} {...register('quantitiesSummary')} />{errors.quantitiesSummary ? <span className="field-error">{errors.quantitiesSummary.message}</span> : null}</div>
          <div className={fieldClass(errors.additionalServicesNote)}><label htmlFor="closeout-additional">Serviços adicionais</label><textarea id="closeout-additional" rows={3} disabled={saving || !workflow.permissions.canEdit} {...register('additionalServicesNote')} />{errors.additionalServicesNote ? <span className="field-error">{errors.additionalServicesNote.message}</span> : null}</div>
          <div className={fieldClass(errors.evidenceNote)}><label htmlFor="closeout-evidence">Evidências disponíveis</label><textarea id="closeout-evidence" rows={3} disabled={saving || !workflow.permissions.canEdit} {...register('evidenceNote')} />{errors.evidenceNote ? <span className="field-error">{errors.evidenceNote.message}</span> : null}</div>
        </div>
        <div className="project-closeout-fields">
          <div className={fieldClass(errors.executedAmount)}><label htmlFor="closeout-executed">Valor executado</label><input id="closeout-executed" inputMode="decimal" placeholder="0,00" disabled={saving || !workflow.permissions.canEdit} {...register('executedAmount')} />{errors.executedAmount ? <span className="field-error">{errors.executedAmount.message}</span> : null}</div>
          <div className={fieldClass(errors.measuredAmount)}><label htmlFor="closeout-measured">Valor medido</label><input id="closeout-measured" inputMode="decimal" placeholder="0,00" disabled={saving || !workflow.permissions.canEdit} {...register('measuredAmount')} />{errors.measuredAmount ? <span className="field-error">{errors.measuredAmount.message}</span> : null}</div>
          <div className={fieldClass(errors.approvedAmount)}><label htmlFor="closeout-approved">Valor aprovado</label><input id="closeout-approved" inputMode="decimal" placeholder="0,00" disabled={saving || !workflow.permissions.canEdit} {...register('approvedAmount')} />{errors.approvedAmount ? <span className="field-error">{errors.approvedAmount.message}</span> : null}</div>
          <div className={fieldClass(errors.preparedAt)}><label htmlFor="closeout-prepared-at">Medição preparada em</label><input id="closeout-prepared-at" type="date" disabled={saving || !workflow.permissions.canEdit} {...register('preparedAt')} />{errors.preparedAt ? <span className="field-error">{errors.preparedAt.message}</span> : null}</div>
          <div className={fieldClass(errors.sentAt)}><label htmlFor="closeout-sent-at">Enviada em</label><input id="closeout-sent-at" type="date" disabled={saving || !workflow.permissions.canEdit} {...register('sentAt')} />{errors.sentAt ? <span className="field-error">{errors.sentAt.message}</span> : null}</div>
          <div className={fieldClass(errors.approvedAt)}><label htmlFor="closeout-approved-at">Aprovada em</label><input id="closeout-approved-at" type="date" disabled={saving || !workflow.permissions.canEdit} {...register('approvedAt')} />{errors.approvedAt ? <span className="field-error">{errors.approvedAt.message}</span> : null}</div>
        </div>
        {workflow.permissions.canEdit ? <div className="project-workflow-inline-actions"><Button type="submit" variant="secondary" disabled={saving || !isDirty}>{saving ? 'Salvando…' : 'Salvar medição'}</Button></div> : null}
      </form>
    </div>
  );
}
