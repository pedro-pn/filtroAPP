import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPontoMaisClient,
  earliestEmployeeAdmissionDate,
  PontoMaisError
} from '../src/lib/pontomais/client.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function reportPage(page, total, rows) {
  return {
    heading: { page: `${page}/${total}` },
    data: [[{ header: {}, data: rows, footer: [], totals: [] }]],
    meta: {}
  };
}

test('cliente envia token internamente e pagina colaboradores e jornadas', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/employees')) {
      const page = Number(parsed.searchParams.get('page'));
      const active = parsed.searchParams.get('active');
      return jsonResponse({
        employees: active === 'true'
          ? (page === 1 ? [{ id: 1, name: 'Pessoa 1' }] : [{ id: 2, name: 'Pessoa 2' }])
          : [{ id: 3, name: 'Pessoa 3' }],
        meta: { count: active === 'true' ? 2 : 1 }
      });
    }
    const body = JSON.parse(init.body);
    const page = body.report.page;
    return jsonResponse(reportPage(page, 2, [{
      date: `0${page}/08/2026`,
      employee_id: page,
      summary: ['00:00', '00:00', '00:00', '08:00'],
      extra_time: [],
      overnight_time: '00:00'
    }]));
  };
  const client = createPontoMaisClient({ token: 'token-de-teste', fetchImpl, perPage: 1 });

  const employees = await client.listEmployees();
  const workDays = await client.listWorkDays('2026-08-01', '2026-08-02');

  assert.deepEqual(employees.map(item => item.id), [1, 2, 3]);
  assert.deepEqual(employees.map(item => item.active), [true, true, false]);
  assert.equal(workDays.length, 2);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => call.init.headers['access-token'] === 'token-de-teste'));
  const employeeCalls = calls.filter(call => new URL(call.url).pathname.endsWith('/employees'));
  assert.deepEqual([...new Set(employeeCalls.map(call => new URL(call.url).searchParams.get('active')))], ['true', 'false']);
  assert.ok(employeeCalls.every(call => new URL(call.url).searchParams.get('attributes').includes('admission_date')));
});

test('colaboradores ativos e inativos são deduplicados e definem o início histórico', async () => {
  const client = createPontoMaisClient({
    token: 'token-de-teste',
    fetchImpl: async url => {
      const active = new URL(url).searchParams.get('active');
      return jsonResponse({
        employees: active === 'true'
          ? [
              { id: 1, active: true, admission_date: '10/03/2021', initial_date: '10/03/2021' },
              { id: 2, active: true, admission_date: '02/01/2020', initial_date: '02/01/2020' }
            ]
          : [
              { id: 1, active: false, admission_date: '10/03/2021', initial_date: '10/03/2021' },
              { id: 3, active: false, admission_date: '15/07/2018', initial_date: '15/07/2018' }
            ],
        meta: { count: 2 }
      });
    }
  });

  const employees = await client.listEmployees();
  assert.deepEqual(employees.map(item => item.id), [1, 2, 3]);
  assert.equal(earliestEmployeeAdmissionDate(employees), '2018-07-15');
  assert.equal(await client.getHistoryStartDate(), '2018-07-15');
});

test('descoberta histórica rejeita datas ausentes ou inválidas de forma sanitizada', () => {
  assert.throws(
    () => earliestEmployeeAdmissionDate([
      { id: 1, admission_date: null, initial_date: '' },
      { id: 2, admission_date: '31/02/2020', initial_date: 'desconhecida' }
    ]),
    error => error instanceof PontoMaisError
      && error.code === 'INVALID_RESPONSE'
      && !/31\/02|desconhecida/.test(error.message)
  );
});

test('registros de ponto são coletados sem inventar paginação ausente', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({
      heading: {},
      data: [[{
        header: {},
        data: [{ date: '01/08/2026', time: '08:00', registration_number: '42', tag_manager: null }],
        footer: [],
        totals: []
      }]],
      meta: {}
    });
  };
  const client = createPontoMaisClient({ token: 'token-de-teste', fetchImpl });
  const rows = await client.listTimeCards('2026-08-01', '2026-08-02');
  assert.equal(rows.length, 1);
  assert.equal(calls, 1);
});

test('registros de ponto percorrem todas as páginas informadas pelo relatório', async () => {
  const requestedPages = [];
  const client = createPontoMaisClient({
    token: 'token-de-teste',
    perPage: 1,
    fetchImpl: async (_url, init = {}) => {
      const body = JSON.parse(init.body);
      requestedPages.push({ page: body.report.page, perPage: body.report.per_page });
      return jsonResponse(reportPage(body.report.page, 2, [{
        date: `0${body.report.page}/08/2026`,
        time: '08:00',
        registration_number: '42',
        tag_manager: `Missão 57${body.report.page}`
      }]));
    }
  });

  const rows = await client.listTimeCards('2026-08-01', '2026-08-02');

  assert.deepEqual(requestedPages, [{ page: 1, perPage: 1 }, { page: 2, perPage: 1 }]);
  assert.deepEqual(rows.map(row => row.date), ['01/08/2026', '02/08/2026']);
});

test('relatórios incompletos são rejeitados sem expor o corpo recebido', async () => {
  const client = createPontoMaisClient({
    token: 'segredo-nao-pode-vazar',
    fetchImpl: async () => jsonResponse({
      heading: { page: '1/1' },
      data: [[{ header: {}, footer: [], totals: [], detalhe_privado: 'não deve sair' }]]
    })
  });

  await assert.rejects(
    () => client.listWorkDays('2026-08-01', '2026-08-02'),
    error => {
      assert.ok(error instanceof PontoMaisError);
      assert.equal(error.code, 'INVALID_RESPONSE');
      assert.doesNotMatch(error.message, /segredo|detalhe_privado|não deve sair/);
      return true;
    }
  );
});

test('linhas sem campos obrigatórios são rejeitadas antes da normalização', async () => {
  const client = createPontoMaisClient({
    token: 'token-de-teste',
    fetchImpl: async () => jsonResponse(reportPage(1, 1, [{
      date: '01/08/2026',
      employee_id: 101,
      registration_number: '42'
    }]))
  });

  await assert.rejects(
    () => client.listWorkDays('2026-08-01', '2026-08-02'),
    error => error instanceof PontoMaisError && error.code === 'INVALID_RESPONSE'
  );
});

test('cliente repete apenas falhas transitórias dentro do limite', async () => {
  const statuses = [500, 429, 200, 200];
  let calls = 0;
  const client = createPontoMaisClient({
    token: 'token-de-teste',
    maxAttempts: 3,
    sleep: async () => {},
    fetchImpl: async () => {
      const status = statuses[calls++];
      return jsonResponse(status === 200 ? { employees: [], meta: { count: 0 } } : { detail: 'não expor' }, status);
    }
  });
  assert.deepEqual(await client.listEmployees(), []);
  assert.equal(calls, 4);
});

test('erro de autenticação não repete nem revela token ou corpo', async () => {
  let calls = 0;
  const client = createPontoMaisClient({
    token: 'segredo-nao-pode-vazar',
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ cpf: '00000000000', detail: 'corpo confidencial' }, 401);
    }
  });

  await assert.rejects(
    () => client.listEmployees(),
    error => {
      assert.ok(error instanceof PontoMaisError);
      assert.equal(error.code, 'AUTH');
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /segredo|confidencial|00000000000/);
      return true;
    }
  );
  assert.equal(calls, 1);
});

test('timeout/rede respeita o número máximo de tentativas', async () => {
  let calls = 0;
  const client = createPontoMaisClient({
    token: 'token-de-teste',
    maxAttempts: 2,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      const error = new Error('detalhe de rede que não deve sair');
      error.name = 'AbortError';
      throw error;
    }
  });
  await assert.rejects(
    () => client.listEmployees(),
    error => error instanceof PontoMaisError && error.code === 'UNAVAILABLE'
  );
  assert.equal(calls, 2);
});
