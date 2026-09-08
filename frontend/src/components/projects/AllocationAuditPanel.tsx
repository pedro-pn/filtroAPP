import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  getAllocationAudit,
  getPontoLinkCollaborators,
  getPontoMaisReconciliationProjects,
  type AllocationAuditCollaborator,
  type AllocationDay
} from '../../api/acompanhamentoPonto';
import { useUrlParamState } from '../../hooks/useUrlParamState';
import { Button } from '../ui/Button';
import { allocationReasonLabel, fmtHours } from './allocationReasons';

type AuditMode = 'collaborator' | 'project';

function parseAuditMode(value: string | null): AuditMode {
  return value === 'project' ? 'project' : 'collaborator';
}

function fmtFullDate(dateKey: string): string {
  const [y, m, d] = dateKey.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : dateKey;
}

function projectList(refs: Array<{ code: string | null; projectId: string }>): string {
  return refs.map(ref => ref.code ?? ref.projectId).join(', ');
}

function allocationList(day: AllocationDay): string {
  if (!day.allocations.length) return '—';
  return day.allocations
    .map(item => (day.allocations.length > 1
      ? `${item.code ?? item.projectId} (${Math.round(item.weight * 100)}%)`
      : `${item.code ?? item.projectId}`))
    .join(' + ');
}

type SortKey = 'date' | 'normalHours' | 'he70Hours' | 'he100Hours' | 'tags' | 'rdo' | 'manual' | 'allocated' | 'reason';

const SORT_COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: 'date', label: 'Data' },
  { key: 'normalHours', label: 'Normais', numeric: true },
  { key: 'he70Hours', label: 'HE70', numeric: true },
  { key: 'he100Hours', label: 'HE100', numeric: true },
  { key: 'tags', label: 'Etiquetas do Ponto Mais' },
  { key: 'rdo', label: 'RDO do dia' },
  { key: 'manual', label: 'Manual' },
  { key: 'allocated', label: 'Alocado' },
  { key: 'reason', label: 'Motivo' }
];

// Valor comparável de cada coluna: número para as de hora, texto para o resto.
function sortValue(day: AllocationDay, key: SortKey): string | number {
  switch (key) {
    case 'date': return day.date;
    case 'normalHours': return day.normalHours;
    case 'he70Hours': return day.he70Hours;
    case 'he100Hours': return day.he100Hours;
    case 'tags': return day.tags.join(' | ');
    case 'rdo': return day.rdoProjects.map(item => item.code ?? item.projectId).join(', ');
    case 'manual': return projectList(day.manualProjects);
    case 'allocated': return allocationList(day);
    default: return allocationReasonLabel(day.reason);
  }
}

function sortDays(days: AllocationDay[], key: SortKey, direction: 'asc' | 'desc'): AllocationDay[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...days].sort((left, right) => {
    const a = sortValue(left, key);
    const b = sortValue(right, key);
    const compared = typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), 'pt-BR');
    // A data desempata para a ordem não embaralhar entre renders.
    return compared !== 0 ? compared * factor : left.date.localeCompare(right.date);
  });
}

function toCsv(collaborators: AllocationAuditCollaborator[]): string {
  const header = [
    'Colaborador', 'Cargo', 'Data', 'Normais', 'HE70', 'HE100',
    'Etiquetas', 'Etiqueta->Projeto', 'RDO do dia', 'Seleção manual', 'Alocado', 'Motivo'
  ];
  const rows = collaborators.flatMap(collaborator => collaborator.days.map(day => [
    collaborator.name,
    collaborator.role ?? '',
    day.date,
    day.normalHours.toFixed(2),
    day.he70Hours.toFixed(2),
    day.he100Hours.toFixed(2),
    day.tags.join(' | '),
    projectList(day.tagProjects),
    day.rdoProjects.map(item => `${item.code ?? item.projectId}:${item.hours.toFixed(1)}h`).join(' '),
    projectList(day.manualProjects),
    allocationList(day),
    allocationReasonLabel(day.reason)
  ]));
  return [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\n');
}

function downloadCsv(content: string, fileName: string) {
  // BOM para o Excel abrir o CSV em UTF-8.
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AllocationAuditPanel() {
  const [mode, setMode] = useUrlParamState<AuditMode>({
    param: 'auditoria',
    defaultValue: 'collaborator',
    parse: parseAuditMode
  });
  const [collaboratorId, setCollaboratorId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [onlyUnallocated, setOnlyUnallocated] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'date', direction: 'asc' });

  function toggleSort(key: SortKey) {
    setSort(previous => (
      previous.key === key
        ? { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'date' ? 'asc' : 'desc' }
    ));
  }

  const { data: collaborators } = useQuery({
    queryKey: ['ponto-collaborators-link'],
    queryFn: getPontoLinkCollaborators
  });
  const { data: projects } = useQuery({
    queryKey: ['ponto-projects-link'],
    queryFn: getPontoMaisReconciliationProjects
  });

  const byProject = mode === 'project';
  const ready = byProject ? Boolean(projectId) : Boolean(collaboratorId);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['ponto-auditoria-alocacao', mode, collaboratorId, projectId, de, ate, onlyUnallocated],
    queryFn: () => getAllocationAudit({
      collaboratorId: byProject ? undefined : collaboratorId,
      projectId: byProject ? projectId : undefined,
      de: de || undefined,
      ate: ate || undefined,
      somenteNaoAlocados: onlyUnallocated
    }),
    enabled: ready
  });

  const rows = useMemo(() => data?.collaborators ?? [], [data]);
  const totals = useMemo(() => {
    const hours = rows.reduce((sum, item) => sum + item.totals.hours, 0);
    const unallocated = rows.reduce((sum, item) => sum + item.totals.unallocatedHours, 0);
    const days = rows.reduce((sum, item) => sum + item.days.length, 0);
    return { hours, unallocated, days };
  }, [rows]);

  return (
    <div className="page-card" data-acp-auditoria>
      <div className="sec">Auditoria da alocação do ponto</div>
      <p className="placeholder-copy ponto-panel-copy">
        Mostra, dia a dia, para onde foram as horas de cada colaborador e por qual motivo. É a mesma
        decisão que gera o custo de mão de obra dos cards de projeto.
      </p>

      <div className="acp-seg" role="tablist" aria-label="Visão da auditoria">
        <button
          type="button"
          role="tab"
          aria-selected={!byProject}
          className={`acp-seg-btn${!byProject ? ' active' : ''}`}
          onClick={() => setMode('collaborator')}
        >
          Por colaborador
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={byProject}
          className={`acp-seg-btn${byProject ? ' active' : ''}`}
          onClick={() => setMode('project')}
        >
          Por projeto
        </button>
      </div>

      <div className="ponto-filter-row">
        {byProject ? (
          <div className="field-group ponto-filter-grow">
            <label htmlFor="audit-project">Missão</label>
            <select id="audit-project" value={projectId} onChange={event => setProjectId(event.target.value)}>
              <option value="">Selecione a missão…</option>
              {(projects ?? []).map(project => (
                <option key={project.id} value={project.id}>{project.code} — {project.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="field-group ponto-filter-grow">
            <label htmlFor="audit-collaborator">Colaborador</label>
            <select
              id="audit-collaborator"
              value={collaboratorId}
              onChange={event => setCollaboratorId(event.target.value)}
            >
              <option value="">Selecione o colaborador…</option>
              {(collaborators ?? []).map(collaborator => (
                <option key={collaborator.id} value={collaborator.id}>
                  {collaborator.name}{collaborator.role ? ` — ${collaborator.role}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field-group">
          <label htmlFor="audit-de">De</label>
          <input id="audit-de" type="date" value={de} onChange={event => setDe(event.target.value)} />
        </div>
        <div className="field-group">
          <label htmlFor="audit-ate">Até</label>
          <input id="audit-ate" type="date" value={ate} onChange={event => setAte(event.target.value)} />
        </div>
        <label className="field-check" htmlFor="audit-only-unallocated">
          <input
            id="audit-only-unallocated"
            type="checkbox"
            checked={onlyUnallocated}
            onChange={event => setOnlyUnallocated(event.target.checked)}
          />
          Só dias não alocados
        </label>
        <Button
          variant="mini"
          disabled={!rows.length}
          onClick={() => downloadCsv(toCsv(rows), `auditoria-ponto-${byProject ? 'projeto' : 'colaborador'}.csv`)}
        >
          Exportar CSV
        </Button>
      </div>

      {!ready ? (
        <p className="placeholder-copy">
          {byProject ? 'Selecione uma missão para auditar.' : 'Selecione um colaborador para auditar.'}
        </p>
      ) : null}
      {ready && (isLoading || isFetching) ? <p className="placeholder-copy">Carregando…</p> : null}
      {ready && !isLoading && !rows.length ? (
        <p className="placeholder-copy">Nenhum dia de ponto no período selecionado.</p>
      ) : null}

      {rows.length ? (
        <div className="ponto-audit-summary">
          <span><strong>{totals.days}</strong> dia(s)</span>
          <span><strong>{fmtHours(totals.hours)}</strong> no ponto</span>
          <span><strong>{fmtHours(totals.unallocated)}</strong> sem alocação</span>
        </div>
      ) : null}

      {rows.map(collaborator => (
        <div key={collaborator.collaboratorId} className="det-section">
          <div className="sec ponto-subtitle">
            {collaborator.name}{collaborator.role ? ` · ${collaborator.role}` : ''}
          </div>
          <div className="ponto-audit-summary">
            {collaborator.totals.byProject.map(project => (
              <span key={project.projectId}>
                {project.code ?? project.projectId}: <strong>{fmtHours(project.normalHours)}</strong>
                {project.he70Hours + project.he100Hours > 0
                  ? ` (+${fmtHours(project.he70Hours + project.he100Hours)} HE)`
                  : ''}
              </span>
            ))}
            {collaborator.totals.unallocatedHours > 0 ? (
              <span>Sem alocação: <strong>{fmtHours(collaborator.totals.unallocatedHours)}</strong></span>
            ) : null}
          </div>
          <div className="ponto-audit-scroll" tabIndex={0} role="region" aria-label={`Dias de ${collaborator.name}`}>
            <table className="acp-table">
              <thead>
                <tr>
                  {SORT_COLUMNS.map(column => {
                    const active = sort.key === column.key;
                    return (
                      <th
                        key={column.key}
                        aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                        className={column.numeric ? 'ponto-audit-num' : undefined}
                      >
                        <button
                          type="button"
                          className={`ponto-audit-sort${active ? ' active' : ''}`}
                          onClick={() => toggleSort(column.key)}
                        >
                          {column.label}
                          <span aria-hidden="true">{active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortDays(collaborator.days, sort.key, sort.direction).map(day => {
                  const isTarget = byProject && day.allocations.some(item => item.projectId === projectId);
                  const classes = [
                    !day.allocated ? 'ponto-audit-row-unallocated' : '',
                    isTarget ? 'ponto-audit-row-target' : ''
                  ].filter(Boolean).join(' ');
                  return (
                    <tr key={day.date} className={classes || undefined}>
                      <td>{fmtFullDate(day.date)}</td>
                      <td className="ponto-audit-num">{day.normalHours.toFixed(2)}</td>
                      <td className="ponto-audit-num">{day.he70Hours.toFixed(2)}</td>
                      <td className="ponto-audit-num">{day.he100Hours.toFixed(2)}</td>
                      <td>{day.tags.length ? day.tags.join(' | ') : '—'}</td>
                      <td>
                        {day.rdoProjects.length
                          ? day.rdoProjects.map(item => `${item.code ?? item.projectId} (${item.hours.toFixed(1)}h)`).join(', ')
                          : '—'}
                      </td>
                      <td>{day.manualProjects.length ? projectList(day.manualProjects) : '—'}</td>
                      <td>{allocationList(day)}</td>
                      <td>{allocationReasonLabel(day.reason)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
