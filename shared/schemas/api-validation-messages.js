// Fallback local ao API Playground: não muda o idioma global do Zod nem expõe a entrada rejeitada.
// Mensagens explícitas dos schemas têm prioridade sobre este mapa nas chamadas parse/resolver.
export function apiValidationError(issue) {
  switch (issue.code) {
    case 'invalid_type':
      if ('input' in issue && (issue.input === undefined || issue.input === null || issue.input === '')) return 'Preencha este campo.';
      if (issue.expected === 'int') return 'Informe um número inteiro.';
      if (issue.expected === 'number') return 'Informe um número válido.';
      if (issue.expected === 'string') return 'Informe um texto válido.';
      if (issue.expected === 'array') return 'Informe uma lista de valores válidos.';
      return 'Preencha este campo corretamente.';
    case 'too_small':
      if (issue.origin === 'string') return issue.input === '' ? 'Preencha este campo.' : `Informe pelo menos ${issue.minimum} caracteres.`;
      if (issue.origin === 'array' || issue.origin === 'set') return `Selecione pelo menos ${issue.minimum} item(ns).`;
      return `Informe um valor ${issue.inclusive ? 'maior ou igual a' : 'maior que'} ${issue.minimum}.`;
    case 'too_big':
      if (issue.origin === 'string') return `Use no máximo ${issue.maximum} caracteres.`;
      if (issue.origin === 'array' || issue.origin === 'set') return `Selecione no máximo ${issue.maximum} item(ns).`;
      return `Informe um valor ${issue.inclusive ? 'menor ou igual a' : 'menor que'} ${issue.maximum}.`;
    case 'invalid_value':
    case 'invalid_union':
      return 'Selecione uma opção válida.';
    case 'invalid_format':
      if (issue.format === 'datetime') return 'Informe uma data e hora válidas.';
      if (issue.format === 'date') return 'Informe uma data válida.';
      if (issue.format === 'email') return 'Informe um e-mail válido.';
      return 'Informe um valor no formato válido.';
    case 'unrecognized_keys':
      return 'A solicitação contém campos não permitidos.';
    case 'not_multiple_of':
      return `Informe um múltiplo de ${issue.divisor}.`;
    case 'custom':
      return undefined;
    default:
      return 'Valor inválido.';
  }
}
