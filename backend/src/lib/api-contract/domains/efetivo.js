import { z } from 'zod';

import { rdoRoute } from './rdo.js';

export { EMPTY, FILE, jsonArraySchema, jsonObjectSchema } from './rdo.js';

// Contratos do domínio Efetivo (spec 042, fase 3): planejamento, missões e
// alocações, fluxo do projeto, conferência de alocação, ausências, produtividade,
// classificação da força de trabalho e calendário. Como no RDO, as rotas antigas
// já validam a entrada no handler com schemas zod; o contrato reaproveita esses
// schemas para documentar e deixa a validação no handler (`validateInput:
// 'handler'`), para não mudar a ordem das respostas (403 de papel antes de 400).
export function efetivoRoute(key, options = {}) {
  return rdoRoute(key, { tag: 'efetivo', ...options });
}

// Resposta JSON sem formato fixo documentado (objeto ou lista, conforme o handler).
export const jsonResponseSchema = z.unknown().describe('JSON (ver o handler para os campos)');
// Corpo validado na camada de serviço (lib), não por schema no handler.
export const libValidatedBodySchema = z.looseObject({}).describe('Objeto JSON validado pelo serviço (lib)');
