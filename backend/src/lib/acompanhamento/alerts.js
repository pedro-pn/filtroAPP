/*
 * Sinais de risco de um projeto (módulo Acompanhamento). Função pura: recebe os números já
 * calculados e devolve os alertas (código + nível + rótulo). Reusada pelos cards e pelo dashboard
 * do projeto.
 *
 * Níveis: 'danger' (vermelho, estourou) e 'warn' (âmbar, em risco).
 */

const WARN_PCT = 90; // a partir daqui, "em risco"
const STALE_DAYS = 7; // sem RDO por N dias (obra iniciada e não concluída) = parado

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function daysBetween(from, to) {
  const a = new Date(from); const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

/**
 * @param {object} input
 * @param {Date|string|null} input.startDate
 * @param {number|null} input.plannedDays          dias corridos previstos (comercial)
 * @param {number|null} input.gasto                gasto realizado (Omie, sem salário)
 * @param {number|null} input.plannedCost          custo previsto (comercial)
 * @param {Date|string|null} input.lastRdoDate     data do último RDO
 * @param {'TRABALHADO'|'STANDBY'|'PARADO'|'SEM_RDO'|null} input.lastDayStatus
 * @param {number|null} input.progressPct           avanço (p/ suprimir alertas quando ~concluído)
 * @param {Date} [input.now]
 * @returns {Array<{code:string, level:'danger'|'warn', label:string}>}
 */
export function computeAlerts({
  startDate = null, plannedDays = null, gasto = null, plannedCost = null,
  lastRdoDate = null, lastDayStatus = null, progressPct = null, now = new Date()
} = {}) {
  const alerts = [];
  const started = Boolean(startDate);
  const done = num(progressPct) != null && num(progressPct) >= 100;

  // Prazo consumido (dias corridos desde o início vs previsto).
  const planned = num(plannedDays);
  if (started && planned && planned > 0 && !done) {
    const elapsed = Math.max(0, daysBetween(startDate, now) ?? 0);
    const pct = (elapsed / planned) * 100;
    if (pct > 100) alerts.push({ code: 'PRAZO', level: 'danger', label: 'Prazo estourado' });
    else if (pct >= WARN_PCT) alerts.push({ code: 'PRAZO', level: 'warn', label: 'Prazo em risco' });
  }

  // Custo realizado vs previsto (ambos sem salário do lado do realizado).
  const cost = num(plannedCost);
  const spent = num(gasto);
  if (cost != null && cost >= 0 && spent != null) {
    const pct = cost > 0 ? (spent / cost) * 100 : spent > 0 ? Infinity : 0;
    if (pct > 100) alerts.push({ code: 'CUSTO', level: 'danger', label: 'Custo acima do previsto' });
    else if (pct >= WARN_PCT) alerts.push({ code: 'CUSTO', level: 'warn', label: 'Custo em risco' });
  }

  // Projeto parado: sem RDO há muitos dias, ou último dia em standby de jornada cheia.
  if (started && !done) {
    const sinceLast = lastRdoDate ? daysBetween(lastRdoDate, now) : null;
    if (sinceLast != null && sinceLast >= STALE_DAYS) {
      alerts.push({ code: 'PARADO', level: 'danger', label: `Parado há ${sinceLast} dia(s)` });
    } else if (lastDayStatus === 'PARADO') {
      alerts.push({ code: 'STANDBY', level: 'warn', label: 'Último dia em standby' });
    }
  }

  return alerts;
}
