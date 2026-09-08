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
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SearchBar } from '../../components/ui/SearchBar';
import { useToast } from '../../components/ui/ToastContext';
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

function impactBadgeClass(impact: QualityImpact | null) {
  if (impact === 'ALTO') return 'badge badge-rej';
  if (impact === 'MEDIO') return 'badge badge-pen';
  if (!impact) return 'badge';
  return 'badge badge-ok';
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

  return (
    <section className="page-card quality-tab" data-quality-records>
      <div className="admin-toolbar quality-toolbar">
        <div>
          <div className="sec">Registros</div>
          <p className="rel-meta">{recordsQuery.data?.total ?? 0} registro(s) encontrado(s)</p>
        </div>
        <div className="admin-form-actions quality-action-bar">
          <Button variant="secondary" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
            {exportMutation.isPending ? 'Exportando…' : 'Exportar'}
          </Button>
          {isManager ? <Button variant="mini" onClick={() => setFormRecord(null)}>Registrar</Button> : null}
        </div>
      </div>

      <div className="quality-filters">
        <SearchBar
          value={q}
          onChange={setQ}
          placeholder="Buscar por Nº, origem, descrição ou RNC"
          ariaLabel="Buscar registros de qualidade"
          count={{ shown: records.length, total: recordsQuery.data?.total || records.length }}
        />
        <select aria-label="Filtrar tipo" value={type} onChange={event => setType(event.target.value as QualityRecordType | '')}>
          <option value="">Todos os tipos</option>
          {schemas.typeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select aria-label="Filtrar status" value={status} onChange={event => setStatus(event.target.value as QualityStatus | '')}>
          <option value="">Todos os status</option>
          {schemas.statusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select aria-label="Filtrar impacto" value={impact} onChange={event => setImpact(event.target.value as QualityImpact | '')}>
          <option value="">Todos os impactos</option>
          {schemas.impactOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select aria-label="Filtrar projeto" value={projectId} onChange={event => setProjectId(event.target.value)}>
          <option value="">Todos os projetos</option>
          <option value="INTERNAL">Interno/SGQ</option>
          {projects.map(project => <option key={project.id} value={project.id}>{project.code} - {project.name}</option>)}
        </select>
        <select aria-label="Filtrar Natureza" value={natureId} onChange={event => setNatureId(event.target.value)}>
          <option value="">Todas as Naturezas</option>
          {natures.map(nature => <option key={nature.id} value={nature.id}>{nature.name}{nature.isActive ? '' : ' (inativa)'}</option>)}
        </select>
        <button className="mini-btn alt" type="button" onClick={resetFilters}>Limpar</button>
      </div>

      {recordsQuery.isLoading ? <p className="placeholder-copy">Carregando registros...</p> : null}
      {recordsQuery.isError ? <p className="equip-form-error">Não foi possível carregar os registros.</p> : null}
      {!recordsQuery.isLoading && !records.length ? <p className="placeholder-copy">Nenhum registro encontrado.</p> : null}

      {records.length ? (
        <div className="acp-table-wrap quality-table-wrap">
          <table className="acp-table quality-records-table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Tipo</th>
                <th>Projeto</th>
                <th>Natureza</th>
                <th>Impacto</th>
                <th>Status</th>
                <th>Evento</th>
                <th>Ocorrências</th>
                <th>Recorrente?</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {records.map(record => {
                const evidences = evidenceLinks(record);
                const evidenceExpanded = expandedEvidenceIds.has(record.id);
                return (
                  <tr key={record.id}>
                    <td data-label="Nº">
                      <strong>{record.number}</strong>
                      {record.origin ? <span className="stock-table-muted">{record.origin}</span> : null}
                      {evidences.length ? (
                        <div className="quality-evidence-collapse">
                          <button
                            className="quality-evidence-collapse-toggle"
                            type="button"
                            aria-expanded={evidenceExpanded}
                            onClick={() => toggleEvidenceList(record.id)}
                          >
                            <span>Evidências</span>
                            <strong>{evidences.length}</strong>
                            <small>{evidenceExpanded ? 'Recolher' : 'Ver'}</small>
                          </button>
                          {evidenceExpanded ? (
                            <ul className="quality-evidence-list">
                              {evidences.map((evidence, index) => (
                                <li key={`${evidence.href}-${index}`}>
                                  <a className="equip-link quality-evidence-link" href={evidence.href} target="_blank" rel="noreferrer">
                                    {evidence.label}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td data-label="Tipo">{typeLabels.get(record.type) || record.type}</td>
                    <td data-label="Projeto">{projectLabel(record)}</td>
                    <td data-label="Natureza">{natureName(record)}</td>
                    <td data-label="Impacto"><span className={impactBadgeClass(record.impact)}>{impactLabels.get(record.impact || '') || record.impact || '-'}</span></td>
                    <td data-label="Status"><span className="badge">{statusLabels.get(record.status || '') || record.status || '-'}</span></td>
                    <td data-label="Evento">{formatDate(record.eventDate)}</td>
                    <td data-label="Ocorrências">{record.occurrences12m}</td>
                    <td data-label="Recorrente?">{record.recurrent ? 'SIM' : 'não'}</td>
                    <td data-label="Ações">
                      {isManager ? (
                        <div className="admin-form-actions quality-row-actions">
                          <button className="mini-btn alt" type="button" onClick={() => setFormRecord(record)}>Editar</button>
                          <button className="danger-button stock-table-action" type="button" onClick={() => confirmRemove(record)}>Excluir</button>
                        </div>
                      ) : (
                        <span className="placeholder-copy">Somente leitura</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

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
    </section>
  );
}
