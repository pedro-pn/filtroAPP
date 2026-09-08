/*
 * Módulo Acompanhamento — sincronização do VR Ponto Mais e custo de mão de obra (HH).
 *
 *   POST /api/acompanhamento/ponto/sync          sincronização pela API (gestor)
 *   GET  /api/acompanhamento/ponto/sync-runs    auditoria da integração (gestor)
 *   GET  /api/acompanhamento/ponto/pending      pendências de conciliação (gestor)
 *   POST /api/acompanhamento/ponto/import        envio do .xlsx (gestor) — cru (application/octet-stream)
 *   GET  /api/acompanhamento/ponto/imports       histórico de importações
 *   GET  /api/acompanhamento/ponto/colaboradores custo/hora do período vigente + não-vinculados
 *   POST /api/acompanhamento/ponto/vincular      { normalizedName, rawName?, collaboratorId } (gestor)
 *
 * O XLSX permanece apenas para compatibilidade histórica/recuperação administrativa. A atualização
 * normal é automática no backend e não depende desta tela nem de upload.
 */

import express, { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { importPonto, linkPontoName } from '../../lib/acompanhamento/ponto-import.js';
import { computeCollaboratorRates } from '../../lib/acompanhamento/labor-cost.js';
import {
  getPontoMaisPending,
  getPontoMaisIntegrationStatus,
  linkPontoMaisExternalEmployee,
  linkPontoMaisProjectTag,
  listPontoMaisIgnoredProjectTags,
  listPontoMaisExternalEmployees,
  listPontoMaisSyncRuns,
  PontoSyncError,
  runPontoMaisSync,
  setPontoMaisDayProjectOverride,
  setPontoMaisDayProjectOverridesBatch,
  setPontoMaisExternalEmployeeIgnored,
  setPontoMaisProjectTagIgnored
} from '../../lib/pontomais/sync.js';
import { normalizeName } from '../../lib/pontomais/normalize.js';
import prisma from '../../lib/prisma.js';
import {
  AllocationAuditError,
  getAllocationAudit,
  getUnallocatedDays,
  resolveUnallocatedDays
} from '../../lib/acompanhamento/allocation-audit.js';
import { requireAcompanhamentoAccess, requireAcompanhamentoManager, requireAuth } from '../../middleware/auth.js';

const router = Router();

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB (o export real tem ~centenas de KB)

export function currentUnmatchedPontoNames(periods = []) {
  const byName = new Map();
  for (const period of periods) {
    const normalizedName = String(period?.normalizedName || '').trim();
    if (!normalizedName) continue;
    byName.set(normalizedName, {
      rawName: String(period?.rawName || normalizedName).trim() || normalizedName,
      normalizedName
    });
  }
  return [...byName.values()];
}

function strictDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const syncPeriodSchema = z.object({
  startDate: z.string().refine(strictDateKey, 'Data inicial inválida.'),
  endDate: z.string().refine(strictDateKey, 'Data final inválida.')
}).strict().superRefine((data, ctx) => {
  if (!strictDateKey(data.startDate) || !strictDateKey(data.endDate)) return;
  const start = new Date(`${data.startDate}T00:00:00.000Z`);
  const end = new Date(`${data.endDate}T00:00:00.000Z`);
  const inclusiveDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (inclusiveDays < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'A data final deve ser igual ou posterior à inicial.' });
  } else if (inclusiveDays > 31) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'O período máximo é de 31 dias.' });
  }
});

export const syncRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
}).strict();

export const externalEmployeeLinkSchema = z.object({
  externalEmployeeId: z.string().trim().min(1).max(200),
  collaboratorId: z.string().trim().min(1).max(200)
}).strict();

export const externalEmployeeIgnoreSchema = z.object({
  externalEmployeeId: z.string().trim().min(1).max(200),
  ignored: z.boolean()
}).strict();

export const projectTagLinkSchema = z.object({
  rawTag: z.string().trim().min(1).max(500),
  projectId: z.string().trim().min(1).max(200)
}).strict();

export const projectTagIgnoreSchema = z.object({
  rawTag: z.string().trim().min(1),
  ignored: z.boolean().default(true)
});

export const dayProjectOverrideSchema = z.object({
  externalEmployeeId: z.string().trim().min(1).max(200),
  date: z.string().refine(strictDateKey, 'Data da jornada inválida.'),
  projectId: z.string().trim().min(1).max(200).optional(),
  projectIds: z.array(z.string().trim().min(1).max(200)).min(1).max(50).optional()
}).strict().refine(value => Boolean(value.projectId) !== Boolean(value.projectIds), {
  message: 'Informe projectId ou projectIds.'
});

export const dayProjectOverridesBatchSchema = z.object({
  items: z.array(dayProjectOverrideSchema).min(1).max(200)
}).strict();

export function mapPontoSyncHttpError(error) {
  const code = error instanceof PontoSyncError ? error.code : 'PONTOMAIS_UNAVAILABLE';
  const definitions = {
    SYNC_IN_PROGRESS: [409, 'Já existe uma sincronização do Ponto Mais em andamento.'],
    PONTOMAIS_NOT_CONFIGURED: [424, 'A integração com o Ponto Mais não está configurada.'],
    PONTOMAIS_AUTH: [502, 'O Ponto Mais recusou a credencial configurada.'],
    PONTOMAIS_INVALID_RESPONSE: [502, 'O Ponto Mais retornou dados incompatíveis com a integração.'],
    PONTOMAIS_UNAVAILABLE: [503, 'Não foi possível consultar o Ponto Mais. Os dados anteriores foram preservados.']
  };
  const [status, message] = definitions[code] || definitions.PONTOMAIS_UNAVAILABLE;
  return {
    status,
    body: {
      error: message,
      code: definitions[code] ? code : 'PONTOMAIS_UNAVAILABLE',
      ...(error instanceof PontoSyncError && error.runId ? { runId: error.runId } : {})
    }
  };
}

/*
 * Fiação padrão do router. Fica exportada porque os testes injetam services próprios e, com o mapa
 * escondido aqui dentro, uma função nova no serviço podia ficar sem entrada aqui e só quebrar em
 * runtime — foi exatamente o que aconteceu com o "ignorar etiqueta".
 */
export const defaultPontoMaisIntegration = {
  runSync: runPontoMaisSync,
  getIntegrationStatus: getPontoMaisIntegrationStatus,
  listSyncRuns: listPontoMaisSyncRuns,
  getPending: getPontoMaisPending,
  listExternalEmployees: listPontoMaisExternalEmployees,
  setExternalEmployeeIgnored: setPontoMaisExternalEmployeeIgnored,
  linkExternalEmployee: linkPontoMaisExternalEmployee,
  linkProjectTag: linkPontoMaisProjectTag,
  setProjectTagIgnored: setPontoMaisProjectTagIgnored,
  listIgnoredProjectTags: listPontoMaisIgnoredProjectTags,
  setDayProjectOverride: setPontoMaisDayProjectOverride,
  setDayProjectOverridesBatch: setPontoMaisDayProjectOverridesBatch
};

export function createPontoMaisIntegrationRouter({
  authenticate = requireAuth,
  authorizeAccess = requireAcompanhamentoAccess,
  authorizeManager = requireAcompanhamentoManager,
  services = {},
  db = prisma
} = {}) {
  const routes = Router();
  const integration = { ...defaultPontoMaisIntegration, ...services };

  routes.post(
    '/sync',
    authenticate,
    authorizeManager,
    asyncHandler(async (req, res) => {
      const parsed = syncPeriodSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Período inválido.',
          code: 'INVALID_PERIOD'
        });
      }
      try {
        const result = await integration.runSync({
          ...parsed.data,
          requestedByUserId: req.auth?.user?.id ?? null,
          trigger: 'MANUAL'
        });
        return res.status(result.skippedDuplicate ? 200 : 201).json(result);
      } catch (error) {
        const mapped = mapPontoSyncHttpError(error);
        return res.status(mapped.status).json(mapped.body);
      }
    })
  );

  routes.get(
    '/integration-status',
    authenticate,
    authorizeAccess,
    asyncHandler(async (_req, res) => {
      res.json(await integration.getIntegrationStatus());
    })
  );

  routes.get(
    '/sync-runs',
    authenticate,
    authorizeManager,
    asyncHandler(async (req, res) => {
      const parsed = syncRunsQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: 'Limite inválido.', code: 'INVALID_LIMIT' });
      return res.json(await integration.listSyncRuns(parsed.data));
    })
  );

  routes.get(
    '/pending',
    authenticate,
    authorizeManager,
    asyncHandler(async (_req, res) => {
      res.json(await integration.getPending());
    })
  );

  routes.get(
    '/external-employees',
    authenticate,
    authorizeManager,
    asyncHandler(async (_req, res) => {
      res.json(await integration.listExternalEmployees());
    })
  );

  routes.post(
    '/external-employees/ignore',
    authenticate,
    authorizeManager,
    asyncHandler(async (req, res) => {
      const parsed = externalEmployeeIgnoreSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Preferência do colaborador inválida.', code: 'INVALID_PREFERENCE' });
      }
      try {
        return res.json(await integration.setExternalEmployeeIgnored({
          ...parsed.data,
          ignoredByUserId: req.auth?.user?.id ?? null
        }));
      } catch (error) {
        if (error instanceof PontoSyncError && error.code === 'EXTERNAL_EMPLOYEE_NOT_FOUND') {
          return res.status(404).json({ error: error.message, code: error.code });
        }
        throw error;
      }
    })
  );

  routes.get(
    '/reconciliation-projects',
    authenticate,
    authorizeManager,
    asyncHandler(async (_req, res) => {
      const projects = await db.project.findMany({
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        select: { id: true, code: true, name: true, isActive: true, deletedAt: true }
      });
      res.json(projects.map(project => ({
        id: project.id,
        code: project.code,
        name: project.name,
        isActive: project.isActive,
        historical: Boolean(project.deletedAt)
      })));
    })
  );

  routes.post(
    '/external-employees/link',
    authenticate,
    authorizeManager,
    asyncHandler(async (req, res) => {
      const parsed = externalEmployeeLinkSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Vínculo de colaborador inválido.', code: 'INVALID_LINK' });
      try {
        return res.json(await integration.linkExternalEmployee({
          ...parsed.data,
          createdByUserId: req.auth?.user?.id ?? null
        }));
      } catch (error) {
        if (error instanceof PontoSyncError && error.code === 'COLLABORATOR_NOT_FOUND') {
          return res.status(404).json({ error: error.message, code: error.code });
        }
        throw error;
      }
    })
  );

  routes.post(
    '/project-tags/link',
    authenticate,
    authorizeManager,
    asyncHandler(async (req, res) => {
      const parsed = projectTagLinkSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Vínculo de etiqueta inválido.', code: 'INVALID_LINK' });
      try {
        return res.json(await integration.linkProjectTag({
          ...parsed.data,
          createdByUserId: req.auth?.user?.id ?? null
        }));
      } catch (error) {
        if (error instanceof PontoSyncError && ['PROJECT_NOT_FOUND', 'INVALID_TAG'].includes(error.code)) {
          return res.status(error.code === 'PROJECT_NOT_FOUND' ? 404 : 400).json({ error: error.message, code: error.code });
        }
        throw error;
      }
    })
  );

  routes.get(
    '/project-tags/ignored',
    authenticate,
    authorizeManager,
    asyncHandler(async (_req, res) => {
      res.json(await integration.listIgnoredProjectTags());
    })
  );

  routes.post(
    '/project-tags/ignore',
    authenticate,
    authorizeManager,
    asyncHandler(async (req, res) => {
      const parsed = projectTagIgnoreSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Etiqueta inválida.', code: 'INVALID_TAG' });
      try {
        return res.json(await integration.setProjectTagIgnored({
          ...parsed.data,
          ignoredByUserId: req.auth?.user?.id ?? null
        }));
      } catch (error) {
        if (error instanceof PontoSyncError && error.code === 'INVALID_TAG') {
          return res.status(400).json({ error: error.message, code: error.code });
        }
        throw error;
      }
    })
  );

  routes.post(
    '/day-project-overrides',
    authenticate,
    authorizeManager,
    asyncHandler(async (req, res) => {
      const parsed = dayProjectOverrideSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Seleção de projeto inválida.',
          code: 'INVALID_DAY_PROJECT_OVERRIDE'
        });
      }
      try {
        return res.json(await integration.setDayProjectOverride({
          ...parsed.data,
          createdByUserId: req.auth?.user?.id ?? null
        }));
      } catch (error) {
        if (error instanceof PontoSyncError) {
          if (['PENDING_NOT_FOUND', 'PROJECT_NOT_FOUND', 'COLLABORATOR_NOT_FOUND'].includes(error.code)) {
            return res.status(404).json({ error: error.message, code: error.code });
          }
          if (error.code === 'INVALID_PROJECT_SELECTION') {
            return res.status(400).json({ error: error.message, code: error.code });
          }
        }
        throw error;
      }
    })
  );

  routes.post(
    '/day-project-overrides/batch',
    authenticate,
    authorizeManager,
    asyncHandler(async (req, res) => {
      const parsed = dayProjectOverridesBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Seleções de projeto inválidas.',
          code: 'INVALID_DAY_PROJECT_OVERRIDE'
        });
      }
      try {
        return res.json(await integration.setDayProjectOverridesBatch({
          ...parsed.data,
          createdByUserId: req.auth?.user?.id ?? null
        }));
      } catch (error) {
        if (error instanceof PontoSyncError) {
          if (['PENDING_NOT_FOUND', 'PROJECT_NOT_FOUND', 'COLLABORATOR_NOT_FOUND'].includes(error.code)) {
            return res.status(404).json({ error: error.message, code: error.code });
          }
          if (error.code === 'INVALID_PROJECT_SELECTION') {
            return res.status(400).json({ error: error.message, code: error.code });
          }
        }
        throw error;
      }
    })
  );

  return routes;
}

router.use(createPontoMaisIntegrationRouter());

// Recebe o .xlsx como binário cru (curl --data-binary @arquivo ou fetch com body do File).
router.post(
  '/import',
  requireAuth,
  requireAcompanhamentoManager,
  express.raw({
    type: [
      'application/octet-stream',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ],
    limit: MAX_FILE_BYTES
  }),
  asyncHandler(async (req, res) => {
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({ error: 'Corpo vazio. Envie o .xlsx do ponto como application/octet-stream.' });
    }
    const fileName = String(req.headers['x-file-name'] || 'PontoMais_resumo.xlsx');
    try {
      const summary = await importPonto({ buffer, fileName, importedByUserId: req.auth?.user?.id ?? null });
      return res.status(summary.skippedDuplicate ? 200 : 201).json(summary);
    } catch (error) {
      return res.status(422).json({ error: `Falha ao importar o ponto: ${error.message}` });
    }
  })
);

router.get(
  '/imports',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    const take = Math.min(Number(req.query.limit) || 50, 500);
    // Sem recorte por origem, as centenas de snapshots da API empurram as planilhas para fora da
    // janela e elas ficam inalcançáveis na tela — inclusive para exclusão.
    const source = String(req.query.source || '').trim().toUpperCase();
    const where = source === 'PONTOMAIS_API'
      ? { source: 'PONTOMAIS_API' }
      : source === 'XLSX'
        ? { NOT: { source: 'PONTOMAIS_API' } }
        : undefined;
    const imports = await prisma.pontoImport.findMany({
      ...(where ? { where } : {}),
      orderBy: { createdAt: 'desc' },
      take
    });
    res.json(imports);
  })
);

// Exclui um import do ponto (e seus resumos, via cascade). Gestor.
router.delete(
  '/imports/:id',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    try {
      const existing = await prisma.pontoImport.findUnique({ where: { id: req.params.id }, select: { source: true } });
      if (!existing) return res.status(404).json({ error: 'Importação não encontrada.' });
      if (existing.source === 'PONTOMAIS_API') {
        return res.status(409).json({ error: 'Snapshots sincronizados pela API não podem ser excluídos manualmente.' });
      }
      await prisma.pontoImport.delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch {
      res.status(404).json({ error: 'Importação não encontrada.' });
    }
  })
);

router.get(
  '/colaboradores',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const { pontoImport, pontoImports = [], periodStart, periodEnd, fileName, rates } = await computeCollaboratorRates();
    const xlsxImportIds = pontoImports
      .filter(item => item.source !== 'PONTOMAIS_API')
      .map(item => item.id);
    const [unmatchedPeriods, ignoredExternalEmployees] = xlsxImportIds.length
      ? await Promise.all([
        prisma.pontoPeriodSummary.findMany({
          where: {
            importId: { in: xlsxImportIds },
            collaboratorId: null
          },
          select: { rawName: true, normalizedName: true },
          orderBy: { createdAt: 'asc' }
        }),
        prisma.pontoExternalEmployee.findMany({
          where: { ignoredAt: { not: null } },
          select: { externalName: true }
        })
      ])
      : [[], []];
    // Quem foi marcado como ignorado na aba de colaboradores não volta como pendência aqui. A lista
    // do XLSX é por nome (a planilha não traz o id externo), então o cruzamento é pelo nome
    // normalizado — o mesmo critério que o vínculo automático já usa.
    const ignoredNames = new Set(ignoredExternalEmployees.map(item => normalizeName(item.externalName)));
    res.json({
      importId: pontoImport?.id ?? null,
      periodStart: periodStart ?? null,
      periodEnd: periodEnd ?? null,
      fileName: fileName ?? pontoImport?.fileName ?? null,
      rates,
      unmatched: currentUnmatchedPontoNames(unmatchedPeriods).filter(item => !ignoredNames.has(item.normalizedName))
    });
  })
);

// Colaboradores para seletores do acompanhamento. Por padrão retorna ativos; a reconciliação
// do ponto pode incluir históricos/inativos para custos retroativos.
router.get(
  '/colaboradores-ativos',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const collaborators = await prisma.collaborator.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, jobRoleId: true, jobRole: { select: { id: true, name: true } }, isActive: true }
    });
    res.json(collaborators.map(item => ({ ...item, role: item.jobRole?.name || '' })));
  })
);

const linkSchema = z.object({
  normalizedName: z.string().trim().min(1).optional(),
  rawName: z.string().trim().min(1).optional(),
  collaboratorId: z.string().trim().min(1)
}).refine(data => data.normalizedName || data.rawName, { message: 'Informe normalizedName ou rawName.' });

router.post(
  '/vincular',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    const data = linkSchema.parse(req.body);
    try {
      const result = await linkPontoName({ ...data, createdByUserId: req.auth?.user?.id ?? null });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  })
);


// === Auditoria da alocação diária do ponto ===
// Leitura e resolução restritas ao gestor do módulo: a trilha expõe onde cada hora de cada
// colaborador foi parar, que é a mesma sensibilidade do custo de mão de obra.

const dateKeySchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');

export const allocationAuditQuerySchema = z.object({
  collaboratorId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  de: dateKeySchema.optional(),
  ate: dateKeySchema.optional(),
  somenteNaoAlocados: z.enum(['true', 'false']).optional()
});

export const unallocatedQuerySchema = z.object({
  de: dateKeySchema.optional(),
  ate: dateKeySchema.optional()
});

export const resolveUnallocatedSchema = z.object({
  items: z.array(z.object({
    collaboratorId: z.string().trim().min(1),
    date: dateKeySchema,
    projectIds: z.array(z.string().trim().min(1)).min(1)
  })).min(1).max(200)
});

router.get(
  '/auditoria-alocacao',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    const parsed = allocationAuditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Filtro inválido.',
        code: 'INVALID_AUDIT_FILTER'
      });
    }
    const { collaboratorId, projectId, de, ate, somenteNaoAlocados } = parsed.data;
    return res.json(await getAllocationAudit({
      collaboratorId: collaboratorId ?? null,
      projectId: projectId ?? null,
      from: de ?? null,
      to: ate ?? null,
      onlyUnallocated: somenteNaoAlocados === 'true'
    }));
  })
);

router.get(
  '/dias-sem-alocacao',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    const parsed = unallocatedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Filtro inválido.',
        code: 'INVALID_AUDIT_FILTER'
      });
    }
    return res.json(await getUnallocatedDays({
      from: parsed.data.de ?? null,
      to: parsed.data.ate ?? null
    }));
  })
);

router.post(
  '/dias-sem-alocacao/resolver',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    const parsed = resolveUnallocatedSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Seleção inválida.',
        code: 'INVALID_DAY_ALLOCATION'
      });
    }
    try {
      return res.json(await resolveUnallocatedDays({
        items: parsed.data.items,
        createdByUserId: req.auth?.user?.id ?? null
      }));
    } catch (error) {
      if (error instanceof AllocationAuditError) {
        const status = error.code === 'PROJECT_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({ error: error.message, code: error.code });
      }
      throw error;
    }
  })
);

// Contagem para o aviso na navegação do módulo. O balde de projeto não cadastrado fica de fora de
// propósito: aquilo é fila de cadastro de missão, não pendência a resolver.
router.get(
  '/pendencias/contagem',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (_req, res) => {
    const [unallocated, integrationPending] = await Promise.all([
      getUnallocatedDays(),
      getPontoMaisPending()
    ]);
    const unlinkedEmployees = integrationPending.employees.length;
    res.json({
      unallocatedDays: unallocated.counts.actionableDays,
      unallocatedBlocks: unallocated.actionable.length,
      unallocatedHours: unallocated.counts.actionableHours,
      // Conflito é um recorte dos dias sem alocação, não uma fila separada: somá-lo ao total
      // contaria o mesmo dia duas vezes.
      conflictDays: unallocated.counts.conflictDays,
      unlinkedEmployees,
      total: unallocated.counts.actionableDays + unlinkedEmployees
    });
  })
);

export default router;
