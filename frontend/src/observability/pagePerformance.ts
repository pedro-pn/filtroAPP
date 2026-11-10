// Local, opt-in diagnostics. Samples contain only known surface labels, never URLs or IDs.
export const PAGE_PERFORMANCE_KEY = 'filtro:page-performance';
const MAX_SAMPLES = 200;
const WINDOW_MS = 15 * 60_000;
const surfaces = new Set([
  ...['pendentes', 'aprovados', 'projetos', 'arquivados', 'equipe', 'usuarios', 'nps', 'estatisticas'].map(tab => `gestor:${tab}`),
  'acompanhamento:cards', 'acompanhamento:detail',
  ...['visao-geral', 'calendario', 'colaboradores', 'disponibilidade', 'evolucao', 'produtividade', 'conferencia', 'administracao'].map(section => `efetivo:${section}`)
]);
export interface PagePerformanceSample {
  surface: string;
  phase: 'content-visible' | 'refresh-complete';
  source: 'cache' | 'network';
  refreshing: boolean;
  durationMs: number;
}
export function createPagePerformanceRecorder(now: () => number, enabled: () => boolean) {
  let openedAt: number | undefined;
  let dropped = 0;
  const samples: PagePerformanceSample[] = [];
  return {
    record(sample: PagePerformanceSample) {
      if (!enabled() || !surfaces.has(sample.surface) || !Number.isFinite(sample.durationMs) || sample.durationMs < 0) return;
      openedAt ??= now();
      if (now() - openedAt >= WINDOW_MS) return;
      if (samples.length === MAX_SAMPLES) { dropped++; return; }
      samples.push({ surface: sample.surface, phase: sample.phase, source: sample.source,
        refreshing: sample.refreshing, durationMs: Math.round(sample.durationMs * 10) / 10 });
    },
    report() {
      const groups = new Map<string, PagePerformanceSample[]>();
      for (const sample of samples) {
        const key = JSON.stringify([sample.surface, sample.phase, sample.source, sample.refreshing]);
        const group = groups.get(key) || [];
        group.push(sample); groups.set(key, group);
      }
      return [...groups.values()].map(group => {
        const durations = group.map(sample => sample.durationMs).sort((a, b) => a - b);
        const complete = dropped === 0 && durations.length >= 100;
        const percentile = (value: number) => complete ? durations[Math.ceil(durations.length * value) - 1] : null;
        const { surface, phase, source, refreshing } = group[0];
        return { surface, phase, source, refreshing, count: durations.length, truncated: dropped > 0,
          sufficientSamples: durations.length >= 100, p50Ms: percentile(.5), p95Ms: percentile(.95) };
      });
    },
    read() { return { samples: samples.map(sample => ({ ...sample })), dropped, windowMs: WINDOW_MS, maxSamples: MAX_SAMPLES }; },
    clear() { samples.length = 0; dropped = 0; openedAt = undefined; }
  };
}
export function pagePerformanceEnabled() {
  try { return sessionStorage.getItem(PAGE_PERFORMANCE_KEY) === 'true'; } catch { return false; }
}
export const pagePerformance = createPagePerformanceRecorder(() => performance.now(), pagePerformanceEnabled);
let navigation: { key: string; startedAt: number } | undefined;
export function beginPagePerformanceNavigation(key: string) {
  if (navigation?.key === key) return;
  navigation = { key, startedAt: navigation ? performance.now() : 0 };
}
export function pagePerformanceNavigation() { return navigation; }
export function installPagePerformanceDiagnostics() {
  if (pagePerformanceEnabled()) Object.assign(window, { filtroPagePerformance: {
    read: pagePerformance.read, report: pagePerformance.report, clear: pagePerformance.clear
  } });
}
