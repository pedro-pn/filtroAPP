import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import {
  createQualityRecord,
  exportQualityRecords,
  listQualityNatures,
  listQualityProjects,
  listQualityRecords,
  removeQualityRecord,
  type QualityImpact,
  type QualityNature,
  type QualityRecord,
  type QualityRecordListParams,
  type QualityRecordPayload,
  type QualityRecordType,
  type QualityRecordUpdatePayload,
  type QualityStatus,
  updateQualityRecord
} from '../../api/qualidade';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { SearchBar } from '../../components/ui/SearchBar';
import { SearchCombobox } from '../../components/ui/SearchCombobox';
import { useToast } from '../../components/ui/ToastContext';
import { Badge, Button, Card, DataTable, Select, type DataTableColumn } from '../../components/ui/ds';
import { makeQualidadeSchemas } from '../../../../shared/schemas/qualidade.js';
import { QualityRecordFormModal } from './QualityRecordFormModal';

interface Props {
  isManager: boolean;
}

type ConfirmState = {
  title: string;
  description?: string;
  highlight?: string;
  confirmLabel?: string;
  onConfirm: () => void;
};

const schemas = makeQualidadeSchemas(z);
const typeLabels = new Map(schemas.typeOptions.map(option => [option.value, option.label]));
const impactLabels = new Map(schemas.impactOptions.map(option => [option.value, option.label]));
const statusLabels = new Map(schemas.statusOptions.map(option => [option.value, option.label]));

function formatDate(value?: string | null) {
  if (!value) return '-';
  const [year, month, day] = value.split('-');
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function projectLabel(record: QualityRecord) {
  if (!record.project) return 'Interno/SGQ';
  return [record.project.code, record.project.name].filter(Boolean).join(' - ');
}

function natureName(record: QualityRecord) {
  return record.nature?.name || '-';
}

function httpHref(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? text : null;
  } catch {
    return null;
  }
}

function attachmentHref(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.startsWith('/api/qualidade-anexos/')) return text;
  return httpHref(text);
}

function evidenceLinks(record: QualityRecord) {
  const items = Array.isArray(record.evidences) ? record.evidences : [];
  const legacyHref = httpHref(record.evidence);
  if (!items.length && legacyHref) return [{ href: legacyHref, label: 'Evidência' }];
  return items
    .map(item => {
      if (item.kind === 'LINK') {
        const href = httpHref(item.url);
        if (href) return { href, label: item.label || 'Link' };
      }
      if (item.kind === 'ATTACHMENT') {
        const href = attachmentHref(item.publicUrl);
        if (href) return { href, label: item.fileName || 'Anexo' };
      }
      return null;
    })
    .filter((item): item is { href: string; label: string } => Boolean(item));
}

function fileNameForExport() {
  return `registros-qualidade-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

function triggerDownload(blob: Blob) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileNameForExport();
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export function QualityRecordsTab({ isManager }: Props) {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [type, setType] = useState<QualityRecordType | ''>('');
  const [status, setStatus] = useState<QualityStatus | ''>('');
  const [impact, setImpact] = useState<QualityImpact | ''>('');
  const [projectId, setProjectId] = useState('');
  const [natureId, setNatureId] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches);
  const [formRecord, setFormRecord] = useState<QualityRecord | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [expandedEvidenceIds, setExpandedEvidenceIds] = useState<Set<string>>(() => new Set());

  const projectsQuery = useQuery({
    queryKey: ['qualidade', 'projetos'],
    queryFn: listQualityProjects
  });
  const naturesQuery = useQuery({
    queryKey: ['qualidade', 'naturezas', { includeInactive: true }],
    queryFn: () => listQualityNatures({ includeInactive: true })
  });

  const params = useMemo<QualityRecordListParams>(() => ({
    page: 1,
    pageSize: 50,
    q,
    type,
    status,
    impact,
    projectId,
    natureId
  }), [impact, natureId, projectId, q, status, type]);

  const recordsQuery = useQuery({
    queryKey: ['qualidade', 'registros', params],
    queryFn: () => listQualityRecords(params)
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['qualidade', 'registros'] });
    queryClient.invalidateQueries({ queryKey: ['qualidade', 'naturezas'] });
    queryClient.invalidateQueries({ queryKey: ['qualidade', 'project-deviations'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: QualityRecordPayload) => createQualityRecord(payload),
    onSuccess: () => {
      invalidate();
      setFormRecord(undefined);
      showToast('Registro cadastrado.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível cadastrar.', 'error')
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: QualityRecordUpdatePayload }) => updateQualityRecord(id, payload),
    onSuccess: () => {
      invalidate();
      setFormRecord(undefined);
      showToast('Registro salvo.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeQualityRecord(id),
    onSuccess: () => {
      invalidate();
      showToast('Registro excluído.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível excluir.', 'error')
  });

  const exportMutation = useMutation({
    mutationFn: () => exportQualityRecords(params),
    onSuccess: blob => {
      triggerDownload(blob);
      showToast('Exportação gerada.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível exportar.', 'error')
  });

  const projects = projectsQuery.data || [];
  const natures: QualityNature[] = naturesQuery.data || [];
  const records = recordsQuery.data?.items || [];
  const saving = createMutation.isPending || updateMutation.isPending;
  const activeFilterCount = [type, status, impact, projectId, natureId].filter(Boolean).length;

  function handleSubmit(payload: QualityRecordPayload | QualityRecordUpdatePayload) {
    if (formRecord) updateMutation.mutate({ id: formRecord.id, payload: payload as QualityRecordUpdatePayload });
    else createMutation.mutate(payload as QualityRecordPayload);
  }

  function confirmRemove(record: QualityRecord) {
    setConfirm({
      title: 'Excluir registro',
      description: 'O registro será removido do módulo Qualidade.',
      highlight: `${record.number} - ${natureName(record)}`,
      confirmLabel: 'Excluir',
      onConfirm: () => removeMutation.mutate(record.id)
    });
  }

  function toggleEvidenceList(recordId: string) {
    setExpandedEvidenceIds(current => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  function resetFilters() {
    setQ('');
    setType('');
    setStatus('');
    setImpact('');
    setProjectId('');
    setNatureId('');
  }

  function recordActions(record: QualityRecord) {
    return isManager ? <>
      <Button size="sm" variant="secondary" onClick={() => setFormRecord(record)}>Editar</Button>
      <RemoveIconButton label={`Remover registro ${record.number}`} onClick={() => confirmRemove(record)} />
    </> : null;
  }

  function recordEvidence(record: QualityRecord) {
    const evidences = evidenceLinks(record);
    if (!evidences.length) return null;
    const expanded = expandedEvidenceIds.has(record.id);
    return <div className="quality-evidence-collapse">
      <button className="quality-evidence-collapse-toggle" type="button" aria-expanded={expanded} onClick={() => toggleEvidenceList(record.id)}>
        <span>Evidências</span><strong>{evidences.length}</strong><small>{expanded ? 'Recolher' : 'Ver'}</small>
      </button>
      {expanded ? <ul className="quality-evidence-list">{evidences.map((evidence, index) => <li key={`${evidence.href}-${index}`}>
        <a className="equip-link quality-evidence-link" href={evidence.href} target="_blank" rel="noreferrer">{evidence.label}</a>
      </li>)}</ul> : null}
    </div>;
  }

  const columns: DataTableColumn<QualityRecord>[] = [
    { key: 'number', header: 'Registro', rowHeader: true, render: record => <div className="quality-record-identity"><strong>{record.number}</strong>{record.origin ? <span>{record.origin}</span> : null}{recordEvidence(record)}</div> },
    { key: 'type', header: 'Tipo', render: record => typeLabels.get(record.type) || record.type },
    { key: 'destination', header: 'Projeto e natureza', render: record => <div className="quality-record-detail"><strong>{projectLabel(record)}</strong><span>{natureName(record)}</span></div> },
    { key: 'status', header: 'Impacto e status', render: record => <div className="quality-record-status"><Badge tone={record.impact === 'ALTO' ? 'danger' : record.impact === 'MEDIO' ? 'warning' : record.impact ? 'success' : 'neutral'}>{impactLabels.get(record.impact || '') || record.impact || 'Sem impacto'}</Badge><Badge>{statusLabels.get(record.status || '') || record.status || 'Sem status'}</Badge></div> },
    { key: 'event', header: 'Evento', render: record => <div className="quality-record-detail"><strong>{formatDate(record.eventDate)}</strong><span>{record.occurrences12m} ocorrência(s) · {record.recurrent ? 'Recorrente' : 'Sem recorrência'}</span></div> }
  ];

  return (
    <Card className="quality-tab quality-records-v2" padding="md" data-quality-records>
      <div className="admin-toolbar quality-toolbar">
        <div>
          <div className="sec">Registros</div>
          <p className="rel-meta">{recordsQuery.data?.total ?? 0} registro(s) encontrado(s)</p>
        </div>
        <div className="admin-form-actions quality-action-bar">
          <Button variant="secondary" size="sm" onClick={() => exportMutation.mutate()} loading={exportMutation.isPending}>
            {exportMutation.isPending ? 'Exportando…' : 'Exportar'}
          </Button>
          {isManager ? <Button variant="primary" size="sm" onClick={() => setFormRecord(null)}>Registrar</Button> : null}
        </div>
      </div>

      <SearchBar
        value={q}
        onChange={setQ}
        placeholder="Buscar por Nº, origem, descrição ou RNC"
        ariaLabel="Buscar registros de qualidade"
        count={{ shown: records.length, total: recordsQuery.data?.total || records.length }}
      />
      <details className="quality-filter-details" open={filtersOpen} onToggle={event => setFiltersOpen(event.currentTarget.open)}>
        <summary>Filtros {activeFilterCount ? <Badge tone="brand">{activeFilterCount}</Badge> : null}</summary>
      <div className="quality-filters">
        <Select aria-label="Filtrar tipo" value={type} onChange={event => setType(event.target.value as QualityRecordType | '')}>
          <option value="">Todos os tipos</option>
          {schemas.typeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <Select aria-label="Filtrar status" value={status} onChange={event => setStatus(event.target.value as QualityStatus | '')}>
          <option value="">Todos os status</option>
          {schemas.statusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <Select aria-label="Filtrar impacto" value={impact} onChange={event => setImpact(event.target.value as QualityImpact | '')}>
          <option value="">Todos os impactos</option>
          {schemas.impactOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <SearchCombobox
          label="Filtrar projeto"
          hideLabel
          value={projectId}
          onChange={setProjectId}
          variant="select"
          portal
          placeholder="Pesquisar projeto"
          options={[
            { value: '', label: 'Todos os projetos' },
            { value: 'INTERNAL', label: 'Interno/SGQ' },
            ...projects.map(project => ({ value: project.id, label: `${project.code} - ${project.name}` }))
          ]}
        />
        <SearchCombobox
          label="Filtrar Natureza"
          hideLabel
          value={natureId}
          onChange={setNatureId}
          variant="select"
          portal
          placeholder="Pesquisar natureza"
          options={[
            { value: '', label: 'Todas as Naturezas' },
            ...natures.map(nature => ({ value: nature.id, label: `${nature.name}${nature.isActive ? '' : ' (inativa)'}` }))
          ]}
        />
        <Button variant="secondary" size="sm" onClick={resetFilters}>Limpar</Button>
      </div>
      </details>

      {recordsQuery.isLoading ? <p className="placeholder-copy">Carregando registros...</p> : null}
      {recordsQuery.isError ? <p className="equip-form-error">Não foi possível carregar os registros.</p> : null}
      {!recordsQuery.isLoading && !recordsQuery.isError ? <DataTable
        className="quality-records-table-v2"
        rows={records}
        columns={columns}
        getRowId={record => record.id}
        ariaLabel="Registros de qualidade"
        density="compact"
        mobileBreakpoint="lg"
        rowActions={isManager ? recordActions : undefined}
        mobile={{ ariaLabel: 'Registros de qualidade', renderItem: record => ({
          title: `Nº ${record.number}`,
          subtitle: typeLabels.get(record.type) || record.type,
          status: <Badge tone={record.impact === 'ALTO' ? 'danger' : record.impact === 'MEDIO' ? 'warning' : record.impact ? 'success' : 'neutral'}>{impactLabels.get(record.impact || '') || 'Sem impacto'}</Badge>,
          metadata: [
            { label: 'Projeto', value: projectLabel(record) },
            { label: 'Natureza', value: natureName(record) },
            { label: 'Evento', value: formatDate(record.eventDate) },
            { label: 'Ocorrências', value: `${record.occurrences12m}${record.recurrent ? ' · Recorrente' : ''}` }
          ],
          value: recordEvidence(record),
          actions: recordActions(record)
        }) }}
      /> : null}

      {formRecord !== undefined ? (
        <QualityRecordFormModal
          open
          record={formRecord}
          projects={projects}
          natures={natures}
          saving={saving}
          onClose={() => setFormRecord(undefined)}
          onSubmit={handleSubmit}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        appearance="design-system"
        title={confirm?.title || ''}
        description={confirm?.description}
        highlight={confirm?.highlight}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </Card>
  );
}
