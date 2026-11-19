import { Router } from 'express';
import { z } from 'zod';

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
import { expensiveRouteLimit } from '../../lib/rate-limit.js';
import { defineRoute } from '../../lib/api-contract/registry.js';
import { rdoRoute, jsonObjectSchema, FILE } from '../../lib/api-contract/domains/rdo.js';

// Data Book do projeto: gestor e coordenador do RDO (abas Projetos e Arquivados).
export const DATABOOK_ROLES = ['rdo:manager', 'rdo:coordinator'];

const servicosPadrao = {
  listarDatabooks, resumoDoDialogo, prepararRevisao, solicitarGeracao, obterRevisao, agendarFilaDatabook,
  prepararEdicao, criarPrevia, pdfDaPrevia
};

// Corpo das rotas de revisão, prévia e geração (lacuna 7.2 da spec 042): o
// formato é conferido pelo contrato; intervalo() e aplicarEdicoes() seguem com
// as regras de negócio (hash do escopo, campos e tamanhos das edições).
const databookIntervalShape = {
  inicio: z.string().max(40).optional(),
  fim: z.string().max(40).optional(),
  contributionKey: z.string().min(1).max(200).nullable().optional(),
  scopeVersion: z.string().max(64).nullable().optional()
};
export const databookIntervalSchema = z.object(databookIntervalShape);
const databookEditsShape = {
  edicoes: z.record(z.string(), z.unknown()).nullable().optional().describe('Edições do documento (ver aplicarEdicoes em lib/databook/service.js)'),
  descricao: z.string().max(2000).nullable().optional()
};
export const databookPreviewSchema = z.object({ ...databookIntervalShape, ...databookEditsShape, origemRevisaoId: z.string().max(200).nullable().optional() });
export const databookGenerateSchema = z.object({ ...databookIntervalShape, ...databookEditsShape, previaId: z.string().max(200).nullable().optional() });

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

  defineRoute(router, rdoRoute('GET /projects/:projectId', { summary: 'Data Books do projeto', tag: 'databook', responses: { 200: jsonObjectSchema } }), asyncHandler(async (req, res) => {
    res.json(await s.listarDatabooks(req.params.projectId));
  }));

  defineRoute(router, rdoRoute('GET /projects/:projectId/intervalo', { summary: 'Resumo do período escolhido para o Data Book', tag: 'databook', query: z.object({ inicio: z.string().max(40).optional(), fim: z.string().max(40).optional(), contributionKey: z.string().min(1).max(200).nullable().optional(), scopeVersion: z.string().max(64).nullable().optional() }), validatedBy: 'handler (intervalo())', responses: { 200: jsonObjectSchema }, errors: [400, 401, 403, 404] }), asyncHandler(async (req, res) => {
    const { inicio, fim, contributionKey } = intervalo(req.query);
    res.json(await s.resumoDoDialogo(req.params.projectId, { inicio: inicio || undefined, fim: fim || undefined, ...(contributionKey != null ? { contributionKey } : {}) }));
  }));

  defineRoute(router, rdoRoute('POST /projects/:projectId/revisao', { summary: 'Preparar a revisão do Data Book', tag: 'databook', body: databookIntervalSchema, bodyOptional: true, validateInput: 'check', responses: { 200: jsonObjectSchema }, errors: [400, 401, 403, 404] }), asyncHandler(async (req, res) => {
    res.json(await s.prepararRevisao(req.params.projectId, intervalo(req.body)));
  }));

  defineRoute(router, rdoRoute('POST /projects/:projectId/previa', { summary: 'Gerar a prévia do Data Book com as edições', tag: 'databook', body: databookPreviewSchema, bodyOptional: true, validateInput: 'check', responses: { 200: jsonObjectSchema }, errors: [400, 401, 403, 404, 409] }), asyncHandler(async (req, res) => {
    res.json(await s.criarPrevia(req.params.projectId, {
      ...intervalo(req.body), edicoes: req.body?.edicoes, descricao: req.body?.descricao,
      origemRevisaoId: req.body?.origemRevisaoId
    }, req.auth.user));
  }));

  defineRoute(router, rdoRoute('GET /previas/:id/pdf', { summary: 'PDF da prévia do Data Book', tag: 'databook', responses: { 200: FILE }, errors: [401, 403, 404, 429] }), ...expensiveRouteLimit('document'), asyncHandler(async (req, res) => {
    const arquivo = await s.pdfDaPrevia(req.params.id, req.auth.user);
    res.setHeader('Cache-Control', 'no-store');
    // O caminho já foi validado e autorizado ao autor; a pasta das prévias é oculta.
    res.type('pdf').sendFile(arquivo, { dotfiles: 'allow' });
  }));

  defineRoute(router, rdoRoute('POST /projects/:projectId/gerar', { summary: 'Gerar o Data Book (fila)', tag: 'databook', body: databookGenerateSchema, bodyOptional: true, validateInput: 'check', responses: { 202: jsonObjectSchema }, errors: [400, 401, 403, 404, 409, 429] }), ...expensiveRouteLimit('generation'), asyncHandler(async (req, res) => {
    const revisao = await s.solicitarGeracao(req.params.projectId, {
      ...intervalo(req.body),
      edicoes: req.body?.edicoes,
      descricao: req.body?.descricao,
      ...(req.body?.previaId ? { previaId: req.body.previaId } : {})
    }, req.auth.user);
    s.agendarFilaDatabook();
    res.status(202).json(serializarRevisao(revisao));
  }));

  defineRoute(router, rdoRoute('GET /revisoes/:id', { summary: 'Revisão do Data Book', tag: 'databook', responses: { 200: jsonObjectSchema }, errors: [401, 403, 404] }), asyncHandler(async (req, res) => {
    res.json(serializarRevisao(await s.obterRevisao(req.params.id)));
  }));

  defineRoute(router, rdoRoute('GET /revisoes/:id/edicao', { summary: 'Dados para editar uma revisão do Data Book', tag: 'databook', responses: { 200: jsonObjectSchema }, errors: [401, 403, 404] }), asyncHandler(async (req, res) => {
    res.json(await s.prepararEdicao(req.params.id));
  }));

  defineRoute(router, rdoRoute('GET /revisoes/:id/pdf', { summary: 'PDF de uma revisão do Data Book', tag: 'databook', responses: { 200: FILE }, errors: [401, 403, 404, 429] }), ...expensiveRouteLimit('document'), asyncHandler(async (req, res) => {
    const revisao = await s.obterRevisao(req.params.id);
    res.download(caminhoDoPdf(revisao), nomeDoArquivo(revisao));
  }));

  return router;
}

export default createDatabookRouter();
