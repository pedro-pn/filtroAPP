import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

const requests = new AsyncLocalStorage();

export function withRequestPerformance(trace, callback) {
  return requests.run(trace, callback);
}

// Os nomes são constantes do código. Nenhum parâmetro, corpo ou resultado é guardado.
export function measureRequestStage(name, callback) {
  const trace = requests.getStore();
  if (!trace) return callback();
  const started = performance.now();
  const finish = () => {
    if (!Object.hasOwn(trace.stages, name) && Object.keys(trace.stages).length >= 20) return;
    trace.stages[name] = (trace.stages[name] || 0) + performance.now() - started;
  };
  try {
    const result = callback();
    if (result && typeof result.then === 'function') return result.finally(finish);
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}
