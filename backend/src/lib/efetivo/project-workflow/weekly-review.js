import { PROJECT_EXECUTION_WEEKLY_CHECKS } from '../../../../../shared/schemas/project-execution.js';

const CHECK_KEYS = PROJECT_EXECUTION_WEEKLY_CHECKS.map(item => item.key);
const SAO_PAULO_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});

function dateKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function todayKey(now) {
  return SAO_PAULO_DATE_FORMATTER.format(now);
}

export function addDays(day, amount) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function mondayOfWeek(day) {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

function firstThursdayOnOrAfter(day) {
  const thursday = addDays(mondayOfWeek(day), 3);
  return thursday < day ? addDays(thursday, 7) : thursday;
}

export function reviewStartDate(mission, tracking, workflowCreatedAt, legacyStartDate = null) {
  const missionStart = dateKey(mission?.executionStartDate || tracking?.footer?.startDate);
  const workflowStart = workflowCreatedAt ? todayKey(workflowCreatedAt) : dateKey(legacyStartDate);
  return [missionStart, workflowStart].filter(Boolean).sort().at(-1) || null;
}

export function normalizeWeeklyChecks(checks) {
  return Object.fromEntries(CHECK_KEYS.map(key => [key, checks?.[key] === true]));
}

function weeklyReviewSummary(row, weekStartDate) {
  const checks = normalizeWeeklyChecks(row?.checks);
  const checkedCount = Object.values(checks).filter(Boolean).length;
  return {
    weekStartDate,
    dueDate: addDays(weekStartDate, 3),
    checks,
    checkedCount,
    note: row?.note || '',
    completedAt: row?.completedAt || null,
    completedBy: row?.completedBy || null
  };
}

export function buildProjectExecutionWeeklyReview({ stage = null, startDate = null, rows = [], now = new Date(), canVerify = false } = {}) {
  const active = stage === 'EXECUTION';
  const today = todayKey(now);
  const start = dateKey(startDate);
  const rowByWeek = new Map(rows.map(row => [dateKey(row.weekStartDate), row]));
  const pending = [];
  if (active && start) {
    for (let due = firstThursdayOnOrAfter(start); due <= today; due = addDays(due, 7)) {
      const weekStartDate = addDays(due, -3);
      const row = rowByWeek.get(weekStartDate);
      const summary = weeklyReviewSummary(row, weekStartDate);
      if (row?.completedAt && summary.checkedCount === CHECK_KEYS.length) continue;
      pending.push(summary);
    }
  }
  const recentCompleted = rows
    .filter(row => row.completedAt && CHECK_KEYS.every(key => row.checks?.[key] === true))
    .sort((left, right) => String(dateKey(right.weekStartDate)).localeCompare(String(dateKey(left.weekStartDate))))
    .slice(0, 5)
    .map(row => weeklyReviewSummary(row, dateKey(row.weekStartDate)));
  let nextDueDate = active && start ? firstThursdayOnOrAfter(today) : null;
  if (nextDueDate && nextDueDate <= today) nextDueDate = addDays(nextDueDate, 7);
  if (nextDueDate && nextDueDate < start) nextDueDate = firstThursdayOnOrAfter(start);
  return { active, pendingCount: pending.length, pending, recentCompleted, nextDueDate, permissions: { canVerify: active && Boolean(canVerify) } };
}
