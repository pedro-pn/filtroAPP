import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import { agendarFilaDatabook } from '../../lib/databook/jobs.js';
import {
  caminhoDoPdf,
  criarPrevia,
  listarDatabooks,
  nomeDoArquivo,
  obterRevisao,
  prepararEdicao,
  prepararRevisao,
  resumoDoDialogo,
  serializarRevisao,
  solicitarGeracao
} from '../../lib/databook/service.js';
import { pdfDaPrevia } from '../../lib/databook/previas.js';
import { requireAuth, requireModuleRole } from '../../middleware/auth.js';

// Data Book do projeto: gestor e coordenador do RDO (abas Projetos e Arquivados).
export const DATABOOK_ROLES = ['rdo:manager', 'rdo:coordinator'];

const servicosPadrao = {
  listarDatabooks, resumoDoDialogo, prepararRevisao, solicitarGeracao, obterRevisao, agendarFilaDatabook,
  prepararEdicao, criarPrevia, pdfDaPrevia
};

function intervalo(source) {
  if (source?.contributionKey != null && (typeof source.contributionKey !== 'string' || source.contributionKey.length > 200 || !source.contributionKey)) throw Object.assign(new Error('Proposta inválida.'), { status: 400 });
  if (source?.scopeVersion != null && (typeof source.scopeVersion !== 'string' || !/^[a-f0-9]{64}$/.test(source.scopeVersion))) throw Object.assign(new Error('Versão do escopo inválida.'), { status: 400 });
  return { inicio: String(source?.inicio || ''), fim: String(source?.fim || ''),
    ...(source?.contributionKey != null ? { contributionKey: source.contributionKey } : {}), ...(source?.scopeVersion ? { scopeVersion: source.scopeVersion } : {}) };
}

export function createDatabookRouter({ authenticate = requireAuth, servicos = servicosPadrao } = {}) {
  const s = { ...servicosPadrao, ...servicos };
  const router = Router();
  router.use(authenticate, requireModuleRole(...DATABOOK_ROLES));

  router.get('/projects/:projectId', asyncHandler(async (req, res) => {
    res.json(await s.listarDatabooks(req.params.projectId));
  }));

  router.get('/projects/:projectId/intervalo', asyncHandler(async (req, res) => {
    const { inicio, fim, contributionKey } = intervalo(req.query);
    res.json(await s.resumoDoDialogo(req.params.projectId, { inicio: inicio || undefined, fim: fim || undefined, ...(contributionKey != null ? { contributionKey } : {}) }));
  }));

  router.post('/projects/:projectId/revisao', asyncHandler(async (req, res) => {
    res.json(await s.prepararRevisao(req.params.projectId, intervalo(req.body)));
  }));

  router.post('/projects/:projectId/previa', asyncHandler(async (req, res) => {
    res.json(await s.criarPrevia(req.params.projectId, {
      ...intervalo(req.body), edicoes: req.body?.edicoes, descricao: req.body?.descricao,
      origemRevisaoId: req.body?.origemRevisaoId
    }, req.auth.user));
  }));

  router.get('/previas/:id/pdf', asyncHandler(async (req, res) => {
    const arquivo = await s.pdfDaPrevia(req.params.id, req.auth.user);
    res.setHeader('Cache-Control', 'no-store');
    // O caminho já foi validado e autorizado ao autor; a pasta das prévias é oculta.
    res.type('pdf').sendFile(arquivo, { dotfiles: 'allow' });
  }));

  router.post('/projects/:projectId/gerar', asyncHandler(async (req, res) => {
    const revisao = await s.solicitarGeracao(req.params.projectId, {
      ...intervalo(req.body),
      edicoes: req.body?.edicoes,
      descricao: req.body?.descricao,
      ...(req.body?.previaId ? { previaId: req.body.previaId } : {})
    }, req.auth.user);
    s.agendarFilaDatabook();
    res.status(202).json(serializarRevisao(revisao));
  }));

  router.get('/revisoes/:id', asyncHandler(async (req, res) => {
    res.json(serializarRevisao(await s.obterRevisao(req.params.id)));
  }));

  router.get('/revisoes/:id/edicao', asyncHandler(async (req, res) => {
    res.json(await s.prepararEdicao(req.params.id));
  }));

  router.get('/revisoes/:id/pdf', asyncHandler(async (req, res) => {
    const revisao = await s.obterRevisao(req.params.id);
    res.download(caminhoDoPdf(revisao), nomeDoArquivo(revisao));
  }));

  return router;
}

export default createDatabookRouter();
