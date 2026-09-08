import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import { test } from 'node:test';

import app from '../src/app.js';
import {
  createProjectManagementNote,
  listProjectManagementNotes,
  normalizeProjectManagementNoteContent
} from '../src/lib/acompanhamento/project-notes.js';
import prisma from '../src/lib/prisma.js';

const bearerToken = 'project-note-test-token';

function session({ manager = false } = {}) {
  return {
    id: `session-acompanhamento-${manager ? 'manager' : 'viewer'}`,
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: manager ? 'manager-1' : 'viewer-1',
      username: manager ? 'manager' : 'viewer',
      name: manager ? 'Gestora Acompanhamento' : 'Visualizador Acompanhamento',
      email: manager ? 'manager@example.com' : 'viewer@example.com',
      role: manager ? 'MANAGER' : 'COLLABORATOR',
      accountType: manager ? 'ADMIN' : 'INTERNAL',
      isActive: true,
      moduleRoles: manager ? [] : [{ role: 'ACOMPANHAMENTO_VIEWER' }]
    }
  };
}

function dispatchApp(method, pathName, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = new Readable({
      read() {
        if (payload) this.push(payload);
        this.push(null);
      }
    });
    req.method = method;
    req.url = pathName;
    req.headers = {
      authorization: `Bearer ${bearerToken}`,
      host: '127.0.0.1',
      ...(payload ? {
        'content-type': 'application/json',
        'content-length': String(payload.length)
      } : {})
    };
    req.socket = new PassThrough();
    req.socket.remoteAddress = '127.0.0.1';
    req.socket.encrypted = false;
    req.connection = req.socket;

    const chunks = [];
    const responseHeaders = new Map();
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });
    res.statusCode = 200;
    res.setHeader = (name, value) => responseHeaders.set(String(name).toLowerCase(), value);
    res.getHeader = name => responseHeaders.get(String(name).toLowerCase());
    res.getHeaders = () => Object.fromEntries(responseHeaders);
    res.removeHeader = name => responseHeaders.delete(String(name).toLowerCase());
    res.writeHead = (statusCode, headersToSet = {}) => {
      res.statusCode = statusCode;
      Object.entries(headersToSet).forEach(([name, value]) => res.setHeader(name, value));
      return res;
    };
    res.end = (chunk, encoding, callback) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      Writable.prototype.end.call(res, callback);
      const rawBody = Buffer.concat(chunks).toString('utf8');
      resolve({ statusCode: res.statusCode, json: rawBody ? JSON.parse(rawBody) : null });
      return res;
    };

    app.handle(req, res, reject);
  });
}

function stubSession(t, value) {
  const originalFindUnique = prisma.userSession.findUnique;
  prisma.userSession.findUnique = async () => value;
  t.after(() => {
    prisma.userSession.findUnique = originalFindUnique;
  });
}

test('normalizeProjectManagementNoteContent mantém quebras de linha e valida o limite', () => {
  assert.equal(normalizeProjectManagementNoteContent('  Primeira linha\nSegunda linha  '), 'Primeira linha\nSegunda linha');
  assert.throws(() => normalizeProjectManagementNoteContent('   '), /Escreva uma nota/);
  assert.throws(() => normalizeProjectManagementNoteContent('x'.repeat(2001)), /no máximo 2000/);
});

test('serviço cria a nota com o nome do gestor registrado no momento da inclusão', async () => {
  const calls = [];
  const client = {
    project: {
      findFirst: async args => {
        calls.push({ operation: 'project.findFirst', args });
        return { id: 'project-1' };
      }
    },
    projectManagementNote: {
      create: async args => {
        calls.push({ operation: 'projectManagementNote.create', args });
        return {
          id: 'note-1',
          ...args.data,
          createdAt: new Date('2026-08-26T17:30:00.000Z')
        };
      }
    }
  };

  const note = await createProjectManagementNote('project-1', '  Cliente pediu revisão.  ', {
    userId: 'manager-1',
    userName: 'Gestora Acompanhamento',
    client
  });

  assert.equal(note.content, 'Cliente pediu revisão.');
  assert.deepEqual(note.author, { id: 'manager-1', name: 'Gestora Acompanhamento' });
  assert.equal(calls[1].args.data.createdByName, 'Gestora Acompanhamento');
});

test('serviço lista as notas mais recentes primeiro', async () => {
  const client = {
    project: { findFirst: async () => ({ id: 'project-1' }) },
    projectManagementNote: {
      findMany: async args => {
        assert.deepEqual(args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
        return [{
          id: 'note-2',
          projectId: 'project-1',
          content: 'Nota mais recente',
          createdByUserId: 'manager-1',
          createdByName: 'Gestora Acompanhamento',
          createdAt: new Date('2026-08-26T18:00:00.000Z')
        }];
      }
    }
  };

  const notes = await listProjectManagementNotes('project-1', { client });
  assert.equal(notes[0].content, 'Nota mais recente');
  assert.equal(notes[0].author.name, 'Gestora Acompanhamento');
});

test('POST de nota identifica o gestor autenticado', async t => {
  stubSession(t, session({ manager: true }));
  const originals = {
    projectFindFirst: prisma.project.findFirst,
    noteCreate: prisma.projectManagementNote.create
  };
  prisma.project.findFirst = async () => ({ id: 'project-1' });
  prisma.projectManagementNote.create = async args => ({
    id: 'note-1',
    ...args.data,
    createdAt: new Date('2026-08-26T17:30:00.000Z')
  });
  t.after(() => {
    prisma.project.findFirst = originals.projectFindFirst;
    prisma.projectManagementNote.create = originals.noteCreate;
  });

  const response = await dispatchApp(
    'POST',
    '/api/acompanhamento/comercial/projetos/project-1/notas-gestao',
    { content: ' Aguardando retorno do cliente. ' }
  );

  assert.equal(response.statusCode, 201);
  assert.equal(response.json.content, 'Aguardando retorno do cliente.');
  assert.deepEqual(response.json.author, { id: 'manager-1', name: 'Gestora Acompanhamento' });
  assert.equal(response.json.createdAt, '2026-08-26T17:30:00.000Z');
});

test('visualizador pode ler, mas não adicionar notas da gestão', async t => {
  stubSession(t, session());
  const originals = {
    projectFindFirst: prisma.project.findFirst,
    noteFindMany: prisma.projectManagementNote.findMany
  };
  let projectQueries = 0;
  prisma.project.findFirst = async () => {
    projectQueries += 1;
    return { id: 'project-1' };
  };
  prisma.projectManagementNote.findMany = async () => [];
  t.after(() => {
    prisma.project.findFirst = originals.projectFindFirst;
    prisma.projectManagementNote.findMany = originals.noteFindMany;
  });

  const listResponse = await dispatchApp(
    'GET',
    '/api/acompanhamento/comercial/projetos/project-1/notas-gestao'
  );
  assert.equal(listResponse.statusCode, 200);
  assert.deepEqual(listResponse.json, []);

  const createResponse = await dispatchApp(
    'POST',
    '/api/acompanhamento/comercial/projetos/project-1/notas-gestao',
    { content: 'Tentativa sem permissão' }
  );
  assert.equal(createResponse.statusCode, 403);
  assert.match(createResponse.json.error, /gestor de Acompanhamento/);
  assert.equal(projectQueries, 1);
});
