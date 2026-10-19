import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { selectCommercialAppRevision, queryCommercialAppAdditional, removeCommercialAppAdditional,
  downloadCommercialAppDocument, resolveCommercialAppAdditionalScope, type CommercialAppQuery, type CommercialAppRevision } from '../../api/acompanhamentoComercial';
import { ADDITIONAL_PROPOSAL_METRICS, normalizeAdditionalMetricInclusion } from '../../../../shared/modules/additional-proposal-metrics.js';
import { Button, Field, Input, Select, Switch } from '../ui/ds';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/ToastContext';
import './CommercialAppAdditionalProposals.css';

export function CommercialAppAdditionalProposals({ projectId, items, onSaved, canManage = true, showQuery = true, queries = [] }: {
  queries?: CommercialAppQuery[];
  canManage?: boolean; showQuery?: boolean;
  projectId: string; items: CommercialAppRevision[]; onSaved: () => void;
}) {
  const [code, setCode] = useState('');
  const [revision, setRevision] = useState('0');
  const toast = useToast();
  const query = useMutation({ mutationFn: () => queryCommercialAppAdditional(projectId, code, Number(revision)),
    onSuccess: () => { toast('Consulta agendada. A revisão recebida ficará aguardando seleção.'); onSaved(); },
    onError: (error: Error) => toast(error.message, 'error') });
  const groups = new Map<string, CommercialAppRevision[]>();
  for (const item of items) groups.set(item.proposalCode, [...(groups.get(item.proposalCode) ?? []), item]);
  return <div>
    {queries.filter(job => !['SYNCED', 'SUPERSEDED'].includes(job.status)).map(job => <p role="status" key={job.proposalCode}>
      Adicional {job.proposalCode}, revisão {job.revisionNumber}: {job.status === 'ERROR'
        ? 'falha na consulta. Uma nova tentativa automática está agendada.' : 'buscando proposta e documentos…'}
    </p>)}
    {[...groups].map(([number, revisions]) => <AdditionalPicker key={`${number}-${revisions[0].selectionVersion}`}
      projectId={projectId} revisions={revisions} onSaved={onSaved} canManage={canManage} />)}
    {canManage && showQuery ? <details className="commercial-additional-query-details">
      <summary>Consultar extra escopo no ComercialAPP</summary>
      <div className="commercial-additional-query">
        <Field required label="Número do adicional" id={`additional-code-${projectId}`}>
          <Input value={code} inputMode="numeric" onChange={event => setCode(event.target.value)} />
        </Field>
        <Field required label="Revisão" id={`additional-revision-${projectId}`}>
          <Input type="number" min={0} value={revision} onChange={event => setRevision(event.target.value)} />
        </Field>
        <Button size="sm" disabled={query.isPending || !/^\d{1,40}$/.test(code) || !/^\d+$/.test(revision)}
          onClick={() => query.mutate()}>Consultar adicional</Button>
      </div>
    </details> : null}
  </div>;
}

function AdditionalPicker({ projectId, revisions, onSaved, canManage }: {
  canManage: boolean;
  projectId: string; revisions: CommercialAppRevision[]; onSaved: () => void;
}) {
  const current = revisions.find(row => row.selectionStatus === 'SELECTED');
  const [externalId, setExternalId] = useState(current?.externalId ?? revisions[0].externalId);
  const [inclusion, setInclusion] = useState(() => normalizeAdditionalMetricInclusion(revisions[0].metricInclusion));
  const [operation, setOperation] = useState<'SELECT' | 'REMOVE' | 'MANUAL' | 'COMMERCIAL' | null>(null);
  const [reason, setReason] = useState('');
  const selected = revisions.find(row => row.externalId === externalId) ?? revisions[0];
  const older = Boolean(current && selected.revisionNumber < current.revisionNumber);
  const toast = useToast();
  const save = useMutation({ mutationFn: () => operation === 'REMOVE'
    ? removeCommercialAppAdditional(projectId, selected.proposalCode, selected.selectionVersion, reason)
    : operation === 'MANUAL' || operation === 'COMMERCIAL'
      ? resolveCommercialAppAdditionalScope(projectId, selected.proposalCode, selected.selectionVersion, operation, reason)
    : selectCommercialAppRevision(projectId, selected.externalId, false, {
      expectedSelectionVersion: selected.selectionVersion, allowOlderRevision: older, reason: reason || undefined, metricInclusion: inclusion
    }), onSuccess: () => { setOperation(null); setReason(''); toast('Contribuição adicional atualizada.'); onSaved(); },
    onError: (error: Error) => { toast(error.message, 'error'); onSaved(); } });
  async function openDocument(documentId: string) {
    const tab = window.open('', '_blank');
    try {
      const file = await downloadCommercialAppDocument(projectId, selected.externalId, documentId);
      const url = URL.createObjectURL(file);
      if (tab) tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { tab?.close(); toast(error instanceof Error ? error.message : 'Documento indisponível.', 'error'); }
  }
  return <div className="acp-additional-proposal-row commercial-additional">
    <p><strong>Adicional {selected.proposalCode}</strong> · Mãe {selected.parentProposalCode} · ComercialAPP</p>
    <p>{current ? `Selecionada: revisão ${current.revisionNumber}` : 'Aguardando seleção'} · {selected.approvedAt ? 'Aprovada no ComercialAPP' : 'Sem aprovação recebida'}</p>
    <div className="project-revision-picker__actions">
      <Select aria-label={`Revisão do adicional ComercialAPP ${selected.proposalCode}`} value={externalId}
        onChange={event => setExternalId(event.target.value)}>
        {revisions.map(row => <option key={row.externalId} value={row.externalId}>
          {`Rev ${row.revisionNumber} · ${Number(row.salePrice).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
        </option>)}
      </Select>
      {canManage ? <Button size="sm" disabled={save.isPending} onClick={() => setOperation('SELECT')}>Selecionar contribuição</Button> : null}
      {current && canManage ? <Button size="sm" variant="secondary" disabled={save.isPending} onClick={() => setOperation('REMOVE')}>Remover contribuição</Button> : null}
    </div>
    <details><summary>Campos considerados e documentos da revisão {selected.revisionNumber}</summary>
      {ADDITIONAL_PROPOSAL_METRICS.map(({ key, label }) => <Switch key={key} label={label}
        checked={inclusion[key]} disabled={!canManage} onChange={event => setInclusion(value => ({ ...value, [key]: event.target.checked }))} />)}
      {current?.scopeImport?.issues?.map(issue => <p key={issue}>{issue}</p>)}
      {canManage && current && (current.scopeImport?.status === 'MANUAL_OVERRIDE' || current.scopeImport?.pendingExternalId || current.scopeImport?.issues?.length) ? <div>
        <p>{current.scopeImport?.status === 'MANUAL_OVERRIDE' ? 'Edição manual preservada nesta contribuição.' : 'Escopo desta contribuição exige conferência.'}</p>
        <Button size="sm" variant="secondary" onClick={() => setOperation('COMMERCIAL')}>Usar escopo comercial</Button>
        <Button size="sm" variant="secondary" onClick={() => setOperation('MANUAL')}>Manter edição manual</Button>
      </div> : null}
      {selected.documents.map(document => <p key={document.id}>
        <Button size="sm" variant="ghost" onClick={() => void openDocument(document.id)}>{document.fileName}</Button>
      </p>)}
    </details>
    <ConfirmDialog open={operation !== null} appearance="design-system"
      title={operation === 'REMOVE' ? 'Remover contribuição do orçamento?' : operation === 'MANUAL' || operation === 'COMMERCIAL' ? 'Resolver escopo desta contribuição?' : older ? 'Selecionar revisão anterior?' : 'Selecionar contribuição adicional?'}
      description={operation === 'REMOVE' ? 'A remoção operacional preserva o histórico, os documentos e o escopo editado manualmente.'
        : `Adicional ${selected.proposalCode}, revisão ${selected.revisionNumber}, vinculado à mãe ${selected.parentProposalCode}.`}
      confirmLabel={operation === 'REMOVE' ? 'Confirmar remoção' : operation === 'MANUAL' || operation === 'COMMERCIAL' ? 'Confirmar escopo' : 'Selecionar contribuição'}
      danger={operation === 'REMOVE'} confirmDisabled={save.isPending || ((older || operation !== 'SELECT') && !reason.trim())}
      onConfirm={() => save.mutate()} onCancel={() => { setOperation(null); setReason(''); }}>
      <Field required={older || operation !== 'SELECT'} label={older || operation !== 'SELECT' ? 'Motivo obrigatório' : 'Motivo (opcional)'} id={`additional-reason-${selected.proposalCode}`}>
        <Input value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} />
      </Field>
    </ConfirmDialog>
  </div>;
}
