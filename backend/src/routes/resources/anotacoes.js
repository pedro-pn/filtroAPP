import { Router } from 'express';
import { z } from 'zod';

import { MAX_CARACTERES, adequacaoConfigurada, adequarAnotacao } from '../../lib/anotacoes/adequar.js';
import asyncHandler from '../../lib/async-handler.js';
import { createMemoryRateLimit } from '../../lib/rate-limit.js';
import { requireAuth, requireModuleRole } from '../../middleware/auth.js';

// "Adequar para relatório" (Atividades do dia e Observações do RDO): gestor e coordenador do RDO.
export const ANOTACOES_ROLES = ['rdo:manager', 'rdo:coordinator'];

const corpoSchema = z.object({
  anotacao: z.string({ error: 'Envie a anotação em texto.' })
    .trim()
    .min(1, 'Escreva a anotação antes de adequar.')
    .max(MAX_CARACTERES, `A anotação pode ter no máximo ${MAX_CARACTERES} caracteres.`)
});

const porUsuario = req => `anotacoes:${req.auth?.user?.id || req.ip}`;

export function createAnotacoesRouter({
  authenticate = requireAuth,
  adequar = adequarAnotacao,
  configurada = adequacaoConfigurada,
  limites = [
    createMemoryRateLimit({ windowMs: 60 * 1000, max: 10, keyGenerator: porUsuario,
      message: 'Muitas adequações em sequência. Aguarde um minuto e tente novamente.' }),
    createMemoryRateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 100, keyGenerator: porUsuario,
      message: 'Limite diário de adequações atingido. Tente novamente amanhã.' })
  ]
} = {}) {
  const router = Router();
  router.use(authenticate, requireModuleRole(...ANOTACOES_ROLES));

  // O frontend só mostra o botão quando a chave da OpenAI está configurada no servidor.
  router.get('/config', (_req, res) => {
    res.json({ disponivel: configurada(), maxCaracteres: MAX_CARACTERES });
  });

  router.post('/adequar', ...limites, asyncHandler(async (req, res) => {
    const parsed = corpoSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Anotação inválida.', codigo: 'INVALIDA' });
    }
    try {
      const { textoFormatado, avisos } = await adequar(parsed.data.anotacao, { usuarioId: req.auth.user.id });
      return res.json({ textoFormatado, avisos });
    } catch (error) {
      if (!error.codigo) throw error; // inesperado: segue para o tratador global
      return res.status(error.status).json({ error: error.message, codigo: error.codigo });
    }
  }));

  return router;
}

export default createAnotacoesRouter();
