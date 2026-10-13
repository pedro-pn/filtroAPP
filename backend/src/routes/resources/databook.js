import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import { agendarFilaDatabook } from '../../lib/databook/jobs.js';
import {
  caminhoDoPdf,
  listarDatabooks,
  nomeDoArquivo,
  obterRevisao,
  prepararRevisao,
  resumoDoDialogo,
  serializarRevisao,
  solicitarGeracao
} from '../../lib/databook/service.js';
import { requireAuth, requireModuleRole } from '../../middleware/auth.js';

// Data Book do projeto: gestor e coordenador do RDO (abas Projetos e Arquivados).
export const DATABOOK_ROLES = ['rdo:manager', 'rdo:coordinator'];

const servicosPadrao = {
  listarDatabooks, resumoDoDialogo, prepararRevisao, solicitarGeracao, obterRevisao, agendarFilaDatabook
};

function intervalo(source) {
  return { inicio: String(source?.inicio || ''), fim: String(source?.fim || '') };
}

export function createDatabookRouter({ authenticate = requireAuth, servicos = servicosPadrao } = {}) {
  const s = { ...servicosPadrao, ...servicos };
  const router = Router();
  router.use(authenticate, requireModuleRole(...DATABOOK_ROLES));

  router.get('/projects/:projectId', asyncHandler(async (req, res) => {
    res.json(await s.listarDatabooks(req.params.projectId));
  }));

  router.get('/projects/:projectId/intervalo', asyncHandler(async (req, res) => {
    const { inicio, fim } = intervalo(req.query);
    res.json(await s.resumoDoDialogo(req.params.projectId, { inicio: inicio || undefined, fim: fim || undefined }));
  }));

  router.post('/projects/:projectId/revisao', asyncHandler(async (req, res) => {
    res.json(await s.prepararRevisao(req.params.projectId, intervalo(req.body)));
  }));

  router.post('/projects/:projectId/gerar', asyncHandler(async (req, res) => {
    const revisao = await s.solicitarGeracao(req.params.projectId, {
      ...intervalo(req.body),
      edicoes: req.body?.edicoes,
      descricao: req.body?.descricao
    }, req.auth.user);
    s.agendarFilaDatabook();
    res.status(202).json(serializarRevisao(revisao));
  }));

  router.get('/revisoes/:id', asyncHandler(async (req, res) => {
    res.json(serializarRevisao(await s.obterRevisao(req.params.id)));
  }));

  router.get('/revisoes/:id/pdf', asyncHandler(async (req, res) => {
    const revisao = await s.obterRevisao(req.params.id);
    res.download(caminhoDoPdf(revisao), nomeDoArquivo(revisao));
  }));

  return router;
}

export default createDatabookRouter();
