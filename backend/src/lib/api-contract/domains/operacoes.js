import { rdoRoute } from './rdo.js';

export { EMPTY, FILE } from './rdo.js';
export { jsonResponseSchema, libValidatedBodySchema } from './efetivo.js';

// Contratos dos domínios operacionais (spec 042, fase 4): equipamentos (dados
// técnicos, manuais, notificações, certificados, anexos), EPI (entregas,
// devoluções, assinaturas, tamanhos), estoque, qualidade, romaneio, logística e
// os cadastros de inventário do RDO (equipamentos, unidades, manômetros e
// contadores de partículas). A fase 5 usa o mesmo helper para acompanhamento
// (comercial, custo, ponto, conciliação), assinaturas avulsas, pesquisa de
// satisfação, cadastros do RDO, notificações, anotações, contas, credenciais de
// API, privacidade e operação. Como nas fases 2 e 3, os handlers já validam a
// entrada; o contrato documenta e deixa a validação no handler (`validateInput:
// 'handler'`), para não mudar a ordem das respostas (ex.: 403 de papel antes do
// 400 de dados, 409 EPI_SIGNED_HISTORY_LOCKED da guarda de 20 anos).
export function opsRoute(key, options = {}) {
  return rdoRoute(key, options);
}
