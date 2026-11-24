// Metadados puros: o catálogo também é carregado pelo frontend sem pacotes do backend.
const nullableText = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const properties = {
  escopo: nullableText, servico: { type: 'string' }, rotuloServico: { type: 'string' }, equipamento: nullableText,
  avancoPct: nullableNumber, unidade: nullableText, rotuloUnidade: nullableText,
  previsto: nullableNumber, realizado: nullableNumber,
  sistemas: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
};
export const projectServicesArraySchema = {
  type: 'array', items: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
};
