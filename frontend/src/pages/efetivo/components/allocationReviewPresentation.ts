import type {
  AllocationReviewKind,
  AllocationReviewValue,
  AllocationReviewValueKind,
  ReviewDayView,
  ReviewProject,
  ReviewRowView,
  SourceState
} from '../../../api/allocationReview';

// Apresentação da conferência semanal de alocação (feature 037).

export type ReviewShowFilter = 'all' | 'pend' | 'todo';
export type ReviewGroupMode = 'proj' | 'name';
export type ReviewViewMode = 'semana' | 'mes';

export const KIND_LABELS: Record<AllocationReviewValueKind, string> = {
  PROJECT: 'Projeto',
  TRAVEL: 'Viagem',
  SEDE: 'Sede',
  FOLGA: 'Folga',
  FERIAS: 'Férias',
  AFASTAMENTO: 'Afastamento',
  TREINAMENTO: 'Treinamento',
  NONE: 'Sem informação'
};

export const IDLE_KINDS: AllocationReviewKind[] = ['SEDE', 'FOLGA', 'FERIAS', 'AFASTAMENTO', 'TREINAMENTO'];
export const ABSENCE_ALERT_KINDS = new Set<AllocationReviewValueKind>(['FOLGA', 'FERIAS', 'AFASTAMENTO']);

export const SOURCE_LABELS = { ponto: 'Ponto Mais', rdo: 'RDO', efetivo: 'Efetivo' } as const;
export const SOURCE_STATE_LABELS: Record<SourceState, string> = { confirms: 'confirma', diverges: 'diverge', none: 'sem dado' };

export function parseShowFilter(value: string | null): ReviewShowFilter {
  return value === 'pend' || value === 'todo' ? value : 'all';
}

// "Por nome" é o padrão; "Por projeto" é opcional.
export function parseGroupMode(value: string | null): ReviewGroupMode {
  return value === 'proj' ? 'proj' : 'name';
}

export function parseViewMode(value: string | null): ReviewViewMode {
  return value === 'mes' ? 'mes' : 'semana';
}

export function parseYearMonth(value: string | null, fallbackDate: string) {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  return fallbackDate.slice(0, 7);
}

export function addMonths(yearMonth: string, months: number) {
  const [year, month] = yearMonth.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Abreviação de um dia na visão do mês.
export function monthCellLabel(value: AllocationReviewValue | null, projectsById: Map<string, ReviewProject>) {
  if (!value) return '–';
  if (value.kind === 'PROJECT' || value.kind === 'TRAVEL') {
    if (value.projectIds.length > 1) return `${value.projectIds.length}p`;
    return projectsById.get(value.projectIds[0])?.code || '?';
  }
  return { SEDE: 'S', FOLGA: 'F', FERIAS: 'Fé', AFASTAMENTO: 'Af', TREINAMENTO: 'Tr', NONE: '?' }[value.kind] || '?';
}

const DAY_MS = 86400000;

function utc(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function mondayOf(dateKey: string) {
  const date = utc(dateKey);
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  return new Date(date.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

export function addWeeks(weekStart: string, weeks: number) {
  return new Date(utc(weekStart).getTime() + weeks * 7 * DAY_MS).toISOString().slice(0, 10);
}

export function todaySaoPaulo(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// Por padrão abre a última semana encerrada, que é a que o responsável confere.
export function defaultWeekStart(now = new Date()) {
  return addWeeks(mondayOf(todaySaoPaulo(now)), -1);
}

export function parseWeekStart(value: string | null, now = new Date()) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(utc(value).getTime())) return mondayOf(value);
  return defaultWeekStart(now);
}

export function isoWeekNumber(weekStart: string) {
  const date = utc(weekStart);
  const thursday = new Date(date.getTime() + 3 * DAY_MS);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil(((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

export function formatDayMonth(dateKey: string) {
  const [, month, day] = dateKey.split('-');
  return `${day}/${month}`;
}

export function formatFullDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}

export function weekRangeLabel(weekStart: string, weekEnd: string) {
  return `${formatDayMonth(weekStart)} a ${formatFullDate(weekEnd)}`;
}

export function formatHours(value: number) {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`;
}

export function projectShortLabel(project: ReviewProject | undefined, fallbackId: string) {
  if (!project) return fallbackId;
  return project.clientName ? `${project.code} · ${project.clientName}` : `${project.code} · ${project.name}`;
}

export function projectFullLabel(project: ReviewProject | undefined, fallbackId: string) {
  if (!project) return fallbackId;
  return `${project.code} · ${project.name}${project.clientName ? ` (${project.clientName})` : ''}`;
}

export interface CellDisplay {
  title: string;
  subtitle?: string | null;
  detail: string | null;
  tone: 'project' | 'travel' | 'sede' | 'folga' | 'absence' | 'none';
}

export function cellDisplay(value: AllocationReviewValue | null, projectsById: Map<string, ReviewProject>): CellDisplay {
  if (!value) return { title: 'Fora do vínculo', detail: null, tone: 'folga' };
  if (value.kind === 'PROJECT' || value.kind === 'TRAVEL') {
    const projects = value.projectIds.map(id => projectsById.get(id));
    const first = projects[0];
    const label = value.projectIds.map((id, index) => projectShortLabel(projects[index], id)).join(' + ');
    const cnpjs = [...new Set(projects.map(project => project?.clientCnpj).filter(Boolean))];
    const codes = value.projectIds.map((id, index) => projects[index]?.code || id).join(' + ');
    const clients = [...new Set(projects.map(project => project?.clientName || project?.name).filter(Boolean))].join(' + ');
    return {
      title: value.kind === 'TRAVEL' ? `Viagem → ${codes}` : codes,
      subtitle: clients || (first ? null : label),
      detail: cnpjs.length ? cnpjs.join(' · ') : 'CNPJ não cadastrado',
      tone: value.kind === 'TRAVEL' ? 'travel' : 'project'
    };
  }
  if (value.kind === 'SEDE') return { title: 'Sede', detail: null, tone: 'sede' };
  if (value.kind === 'FOLGA') return { title: 'Folga', detail: null, tone: 'folga' };
  if (value.kind === 'NONE') return { title: 'Sem informação', detail: null, tone: 'none' };
  return { title: KIND_LABELS[value.kind], detail: null, tone: 'absence' };
}

export function valueText(value: AllocationReviewValue | null, projectsById: Map<string, ReviewProject>) {
  const display = cellDisplay(value, projectsById);
  const title = display.subtitle ? `${display.title} ${display.subtitle}` : display.title;
  return display.detail ? `${title}, CNPJ ${display.detail}` : title;
}

export function sameValue(left: AllocationReviewValue | null, right: AllocationReviewValue | null) {
  if (!left || !right || left.kind !== right.kind) return false;
  const a = [...left.projectIds].sort();
  const b = [...right.projectIds].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

interface SearchableRow {
  collaborator: { name: string; jobRole: string | null };
  days: Array<{ value: AllocationReviewValue | null }>;
}

export function rowMatchesSearch(row: SearchableRow, query: string, projectsById: Map<string, ReviewProject>) {
  const normalized = normalize(query);
  if (!normalized) return true;
  const haystack = [
    row.collaborator.name,
    row.collaborator.jobRole || '',
    ...row.days.flatMap(day => (day.value?.projectIds || []).map(id => {
      const project = projectsById.get(id);
      return project ? `${project.code} ${project.name} ${project.clientName || ''}` : id;
    }))
  ].join(' ');
  return normalize(haystack).includes(normalized);
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function filterRows(rows: ReviewRowView[], show: ReviewShowFilter, query: string, projectsById: Map<string, ReviewProject>) {
  return rows.filter(row => {
    if (show === 'pend' && row.pendingCount === 0) return false;
    if (show === 'todo' && row.confirmed) return false;
    return rowMatchesSearch(row, query, projectsById);
  });
}

export interface RowGroup {
  key: string;
  title: string;
  rows: ReviewRowView[];
}

export function groupRows(rows: ReviewRowView[], mode: ReviewGroupMode, projectsById: Map<string, ReviewProject>): RowGroup[] {
  const sorted = [...rows].sort((a, b) => a.collaborator.name.localeCompare(b.collaborator.name, 'pt-BR'));
  if (mode === 'name') return [{ key: 'all', title: '', rows: sorted }];
  const groups = new Map<string, RowGroup>();
  for (const row of sorted) {
    const project = row.mainProjectId ? projectsById.get(row.mainProjectId) : undefined;
    const allAbsent = row.days.filter(day => day.eligible).every(day => day.value && ['FERIAS', 'AFASTAMENTO'].includes(day.value.kind));
    const key = row.mainProjectId || (allAbsent ? 'zz-ausencia' : 'zz-sede');
    const title = project
      ? `${project.code} · ${project.name}${project.clientCnpj ? ` · CNPJ ${project.clientCnpj}` : ''}`
      : key === 'zz-ausencia' ? 'Férias e afastamentos' : 'Sede e sem projeto na semana';
    if (!groups.has(key)) groups.set(key, { key, title, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key, 'pt-BR'));
}

export function dayCellKey(collaboratorId: string, date: string) {
  return `${collaboratorId}|${date}`;
}

export function pendingText(day: Pick<ReviewDayView, 'pendingReason'>) {
  if (day.pendingReason === 'NO_INFORMATION') return 'sem informação';
  if (day.pendingReason === 'PLAN_ONLY') return 'só o planejamento indica';
  if (day.pendingReason === 'DIVERGENCE') return 'fontes divergem';
  return '';
}
