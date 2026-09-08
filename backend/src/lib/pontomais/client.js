import env from '../../config/env.js';

const DEFAULT_BASE_URL = 'https://api.pontomais.com.br/external_api/v1';
const DEFAULT_COLUMNS = {
  workDays: [
    'date',
    'employee_id',
    'employee_name',
    'registration_number',
    'summary',
    'extra_time',
    'total_time',
    'overnight_time'
  ].join(','),
  timeCards: [
    'employee_name',
    'registration_number',
    'date',
    'time',
    'time_card_index',
    'tag_manager'
  ].join(',')
};

export class PontoMaisError extends Error {
  constructor(message, { code = 'UPSTREAM', status = null, retryable = false } = {}) {
    super(message);
    this.name = 'PontoMaisError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function pontomaisConfigured(token = env.pontomaisApiToken) {
  return Boolean(String(token || '').trim());
}

function externalDateKey(value) {
  const text = String(value || '').trim();
  const brazilian = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  const key = brazilian
    ? `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`
    : iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  if (!key) return null;
  const parsed = new Date(`${key}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key ? key : null;
}

export function earliestEmployeeAdmissionDate(employees = []) {
  const dates = employees
    .flatMap(employee => [employee?.admission_date, employee?.initial_date])
    .map(externalDateKey)
    .filter(Boolean)
    .sort();
  if (!dates.length) {
    throw new PontoMaisError('O Ponto Mais não informou uma data inicial válida para o histórico.', {
      code: 'INVALID_RESPONSE'
    });
  }
  return dates[0];
}

function sanitizedHttpError(status) {
  if (status === 401 || status === 403) {
    return new PontoMaisError('A autenticação com o Ponto Mais foi recusada.', { code: 'AUTH', status });
  }
  if (status === 429) {
    return new PontoMaisError('O Ponto Mais limitou temporariamente as consultas.', {
      code: 'RATE_LIMIT', status, retryable: true
    });
  }
  if (status >= 500) {
    return new PontoMaisError('O Ponto Mais está temporariamente indisponível.', {
      code: 'UNAVAILABLE', status, retryable: true
    });
  }
  return new PontoMaisError('O Ponto Mais recusou os parâmetros da consulta.', {
    code: 'INVALID_REQUEST', status
  });
}

function reportGroups(json) {
  if (!Array.isArray(json?.data)) {
    throw new PontoMaisError('O Ponto Mais retornou um relatório inválido.', { code: 'INVALID_RESPONSE' });
  }
  const groups = json.data.flatMap(item => Array.isArray(item) ? item : [item]);
  if (groups.some(item => !item || typeof item !== 'object' || Array.isArray(item) || !Array.isArray(item.data))) {
    throw new PontoMaisError('O Ponto Mais retornou um relatório incompleto.', { code: 'INVALID_RESPONSE' });
  }
  return groups;
}

function hasExternalIdentity(row) {
  return row.employee_id !== undefined
    || String(row.registration_number ?? '').trim() !== ''
    || String(row.employee_name ?? '').trim() !== '';
}

function validWorkDayRow(row) {
  return typeof row.date === 'string'
    && row.date.trim() !== ''
    && hasExternalIdentity(row)
    && Object.hasOwn(row, 'summary')
    && (Array.isArray(row.summary) || typeof row.summary === 'string' || typeof row.summary === 'number')
    && Object.hasOwn(row, 'extra_time')
    && Array.isArray(row.extra_time)
    && Object.hasOwn(row, 'overnight_time');
}

function validTimeCardRow(row) {
  return typeof row.date === 'string'
    && row.date.trim() !== ''
    && typeof row.time === 'string'
    && row.time.trim() !== ''
    && hasExternalIdentity(row)
    && Object.hasOwn(row, 'tag_manager');
}

function reportRows(json, validateRow) {
  return reportGroups(json).flatMap(group => {
    if (group.data.some(row => (
      !row || typeof row !== 'object' || Array.isArray(row) || !validateRow(row)
    ))) {
      throw new PontoMaisError('O Ponto Mais retornou linhas incompletas.', { code: 'INVALID_RESPONSE' });
    }
    return group.data.map(row => ({ ...row, __header: group.header || {} }));
  });
}

function reportPageInfo(heading, expectedPage) {
  if (heading?.page === undefined || heading?.page === null || heading.page === '') {
    if (expectedPage === 1) return { current: 1, total: 1 };
    throw new PontoMaisError('O Ponto Mais interrompeu a paginação do relatório.', { code: 'INVALID_RESPONSE' });
  }
  const match = String(heading.page).match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  const current = match ? Number(match[1]) : 0;
  const total = match ? Number(match[2]) : 0;
  if (!Number.isInteger(current) || !Number.isInteger(total) || current !== expectedPage || total < current) {
    throw new PontoMaisError('O Ponto Mais retornou paginação inválida.', { code: 'INVALID_RESPONSE' });
  }
  return { current, total };
}

const defaultSleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function createPontoMaisClient({
  token = env.pontomaisApiToken,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 20_000,
  maxAttempts = 3,
  perPage = 500,
  sleep = defaultSleep
} = {}) {
  const accessToken = String(token || '').trim();
  const pageSize = Math.max(1, Math.min(500, Number(perPage) || 500));

  async function requestJson(path, { method = 'GET', query = {}, body } = {}) {
    if (!accessToken) {
      throw new PontoMaisError('A integração com o Ponto Mais não está configurada.', {
        code: 'NOT_CONFIGURED'
      });
    }
    if (typeof fetchImpl !== 'function') {
      throw new PontoMaisError('Cliente HTTP indisponível para consultar o Ponto Mais.', {
        code: 'UNAVAILABLE'
      });
    }

    const url = new URL(`${String(baseUrl).replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    let lastError = null;
    for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
      try {
        const response = await fetchImpl(url, {
          method,
          headers: {
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            'access-token': accessToken
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal
        });
        const rawText = await response.text();
        if (!response.ok) throw sanitizedHttpError(response.status);
        let json;
        try {
          json = JSON.parse(rawText);
        } catch {
          throw new PontoMaisError('O Ponto Mais retornou uma resposta inválida.', {
            code: 'INVALID_RESPONSE', status: response.status
          });
        }
        if (!json || typeof json !== 'object' || Array.isArray(json)) {
          throw new PontoMaisError('O Ponto Mais retornou uma resposta inválida.', {
            code: 'INVALID_RESPONSE', status: response.status
          });
        }
        return json;
      } catch (error) {
        const normalized = error instanceof PontoMaisError
          ? error
          : new PontoMaisError('Não foi possível conectar ao Ponto Mais.', {
            code: 'UNAVAILABLE', retryable: true
          });
        lastError = normalized;
        if (!normalized.retryable || attempt >= Math.max(1, maxAttempts)) throw normalized;
        await sleep(150 * (2 ** (attempt - 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  async function listEmployeesByActive(active) {
    const employees = [];
    let page = 1;
    let total = Infinity;
    while (employees.length < total) {
      const json = await requestJson('/employees', {
        query: {
          active: String(active),
          attributes: 'id,name,first_name,last_name,cpf,registration_number,active,has_time_cards,admission_date,initial_date',
          count: 'true',
          page,
          per_page: pageSize,
          sort_direction: 'asc',
          sort_property: 'first_name',
          incluirAnexos: 'false'
        }
      });
      if (!Array.isArray(json.employees)) {
        throw new PontoMaisError('O Ponto Mais retornou colaboradores inválidos.', {
          code: 'INVALID_RESPONSE'
        });
      }
      if (json.employees.some(employee => (
        !employee || typeof employee !== 'object' || Array.isArray(employee)
        || employee.id === undefined || employee.id === null || String(employee.id).trim() === ''
      ))) {
        throw new PontoMaisError('O Ponto Mais retornou colaboradores incompletos.', {
          code: 'INVALID_RESPONSE'
        });
      }
      employees.push(...json.employees.map(employee => ({
        ...employee,
        active: typeof employee.active === 'boolean' ? employee.active : active
      })));
      const count = Number(json.meta?.count);
      if (!Number.isInteger(count) || count < 0 || count < employees.length) {
        throw new PontoMaisError('O Ponto Mais retornou paginação de colaboradores inválida.', {
          code: 'INVALID_RESPONSE'
        });
      }
      total = count;
      if (json.employees.length === 0 || employees.length >= total) break;
      page += 1;
    }
    return employees;
  }

  async function listEmployees() {
    const activeEmployees = await listEmployeesByActive(true);
    const inactiveEmployees = await listEmployeesByActive(false);
    const byId = new Map();
    for (const employee of [...activeEmployees, ...inactiveEmployees]) {
      const key = String(employee.id);
      if (!byId.has(key)) byId.set(key, employee);
    }
    return [...byId.values()];
  }

  async function getHistoryStartDate() {
    return earliestEmployeeAdmissionDate(await listEmployees());
  }

  async function listReport(path, startDate, endDate, columns, validateRow) {
    const rows = [];
    let page = 1;
    let totalPages = 1;
    do {
      const json = await requestJson(path, {
        method: 'POST',
        body: {
          report: {
            start_date: startDate,
            end_date: endDate,
            group_by: 'employee',
            row_filters: 'with_inactives,has_time_cards',
            columns,
            format: 'json',
            page,
            per_page: pageSize
          }
        }
      });
      rows.push(...reportRows(json, validateRow));
      totalPages = reportPageInfo(json.heading, page).total;
      page += 1;
    } while (page <= totalPages);
    return rows;
  }

  async function listWorkDays(startDate, endDate) {
    return listReport('/reports/work_days', startDate, endDate, DEFAULT_COLUMNS.workDays, validWorkDayRow);
  }

  async function listTimeCards(startDate, endDate) {
    return listReport('/reports/time_cards', startDate, endDate, DEFAULT_COLUMNS.timeCards, validTimeCardRow);
  }

  return { listEmployees, getHistoryStartDate, listWorkDays, listTimeCards };
}
