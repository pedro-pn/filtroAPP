const object = (properties, nullable = false) => ({ type: 'object', additionalProperties: false,
  required: Object.keys(properties), properties, ...(nullable ? { nullable: true } : {}) });
const enumString = values => ({ type: 'string', enum: values });
const number = { type: 'number', nullable: true };

export const weeklyTargetSchema = object({
  situacao: enumString(['PLANNED', 'NO_DATA', 'NO_RULE', 'BELOW', 'PARTIAL', 'ON_TARGET', 'ABOVE']),
  rotuloSituacao: { type: 'string' }, emAndamento: { type: 'boolean' },
  periodoInicio: { type: 'string', format: 'date' }, periodoFim: { type: 'string', format: 'date' },
  regra: enumString(['ALL', 'ANY']), cenario: { type: 'string', nullable: true }, atingimentoPct: number,
  itens: { type: 'array', items: object({
    tipo: enumString(['PROGRESS', 'SERVICE', 'ATTENDANCE']),
    servico: { type: 'string', nullable: true }, rotuloServico: { type: 'string', nullable: true },
    unidade: enumString(['PCT_POINTS', 'M', 'L', 'UN', 'COLLABORATORS']), rotuloUnidade: { type: 'string' },
    base: enumString(['WEEK_TOTAL', 'PER_PRODUCTIVE_DAY', 'PER_WORKDAY']), valorCadastrado: { type: 'number' },
    planejado: number, realizado: number, diferenca: number,
    resultado: enumString(['MET', 'BELOW', 'NO_DATA', 'PLANNED']),
    pendenciasBase: { type: 'array', items: { type: 'string' } }, descricao: { type: 'string' }
  }) },
  colaboradoresPorDia: { type: 'array', items: object({ data: { type: 'string', format: 'date' },
    planejado: { type: 'integer', minimum: 1 }, presentes: { type: 'integer', minimum: 0, nullable: true } }) }
}, true);
