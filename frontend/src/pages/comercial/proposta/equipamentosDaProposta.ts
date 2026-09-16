import { EQUIPAMENTOS_E_FERRAMENTAS_PADRAO } from '../../../../../shared/comercial/dist/modelo-documento.js';
import type { ScopeTopic } from '../../../../../shared/comercial/dist/scope-content.js';
import { scopeTopicsText } from '../../../../../shared/comercial/dist/scope-descriptions.js';

export type ServicoDoEscopo = { title?: string; description?: string; topics?: ScopeTopic[] };

const EQUIPAMENTO = {
  limpezaQuimica: '1 unidade de limpeza química',
  bombaPneumatica: '1 bomba pneumática',
  flushingPrimario: '1 unidade de flushing primário',
  filtragem: '1 unidade de filtragem absoluta/transferência',
  flushingSecundario: '1 unidade de flushing secundário',
  termovacuo: '1 termovácuo',
  centrifuga: '1 centrífuga',
  bombaTeste: '1 bomba de teste hidrostático',
  bombaRunOut: '1 bomba de run out',
  kittiwake: '1 Kittiwake',
  contadorParticulas: '1 contador eletrônico de partículas a laser',
  hidrojato: '1 hidrojato 20k/40k'
} as const;

const REGRAS: Array<{ termos: RegExp; equipamentos: string[] }> = [
  {
    termos: /limpeza quimica|decapagem|passivacao/,
    equipamentos: [EQUIPAMENTO.limpezaQuimica, EQUIPAMENTO.bombaPneumatica]
  },
  {
    // "Flushing" sem qualificador sugere as duas unidades; a decisão final
    // continua com o vendedor na lista de seleção.
    termos: /flushing/,
    equipamentos: [EQUIPAMENTO.flushingPrimario, EQUIPAMENTO.flushingSecundario]
  },
  {
    termos: /filtragem|transferencia/,
    equipamentos: [EQUIPAMENTO.filtragem]
  },
  {
    termos: /termovacuo|desidratacao.*oleo|desidratacao de oleo/,
    equipamentos: [EQUIPAMENTO.termovacuo]
  },
  {
    termos: /centrifugacao|centrifuga/,
    equipamentos: [EQUIPAMENTO.centrifuga]
  },
  {
    termos: /teste hidrostatico|teste de pressao/,
    equipamentos: [EQUIPAMENTO.bombaTeste]
  },
  { termos: /run out/, equipamentos: [EQUIPAMENTO.bombaRunOut] },
  {
    termos: /contagem de particulas|contador de particulas|classe de limpeza/,
    equipamentos: [EQUIPAMENTO.contadorParticulas]
  },
  {
    termos: /kittiwake|teor de agua|agua no oleo/,
    equipamentos: [EQUIPAMENTO.kittiwake]
  },
  { termos: /hidrojateamento|hidrojato/, equipamentos: [EQUIPAMENTO.hidrojato] }
];

function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

/** Texto do equipamento sem a quantidade inicial, usado para comparar a seleção. */
export function descricaoDoEquipamento(valor: string): string {
  return String(valor || '')
    .trim()
    .replace(/^(?:\d+\s*[x×]\s*[—-]?\s*|\d+\s+)/u, '')
    .trim();
}

export function quantidadeDoEquipamento(valor: string): number {
  const quantidade = Number.parseInt(String(valor || '').trim().match(/^\d+/u)?.[0] || '1', 10);
  return Number.isFinite(quantidade) && quantidade > 0 ? quantidade : 1;
}

export function mesmoEquipamento(a: string, b: string): boolean {
  return normalizar(descricaoDoEquipamento(a)) === normalizar(descricaoDoEquipamento(b));
}

/**
 * Mantém o catálogo original para uma unidade e usa “N × descrição” acima
 * disso. A marcação é legível no documento e não força pluralizações frágeis.
 */
export function equipamentoComQuantidade(valor: string, quantidade: number): string {
  const inteira = Math.max(1, Math.trunc(Number(quantidade) || 1));
  const descricao = descricaoDoEquipamento(valor);
  return inteira === 1 ? `1 ${descricao}` : `${inteira} × ${descricao}`;
}

/** Altera só o nome nesta proposta, sem mudar a quantidade nem o catálogo. */
export function renomearEquipamento(
  selecionados: string[],
  equipamento: string,
  nome: string
): { equipamentos: string[]; erro?: string } {
  const indice = selecionados.findIndex(item => mesmoEquipamento(item, equipamento));
  if (indice < 0) {
    return { equipamentos: selecionados, erro: 'Este equipamento não está mais selecionado.' };
  }
  const descricao = nome.trim();
  if (!descricao) {
    return { equipamentos: selecionados, erro: 'Informe o nome do equipamento.' };
  }

  // O prefixo explícito protege nomes que começam com números (ex.: 20 000 psi).
  const renomeado = equipamentoComQuantidade(
    `1 ${descricao}`,
    quantidadeDoEquipamento(selecionados[indice])
  );
  if (selecionados.some((item, i) => i !== indice && mesmoEquipamento(item, renomeado))) {
    return { equipamentos: selecionados, erro: 'Já existe um equipamento selecionado com este nome.' };
  }
  return {
    equipamentos: selecionados.map((item, i) => i === indice ? renomeado : item)
  };
}

/** Equipamentos recomendados pelos títulos e descrições do capítulo 2. */
export function equipamentosSugeridosPeloEscopo(
  servicos: ServicoDoEscopo[]
): string[] {
  const texto = normalizar(
    servicos.map(servico => `${servico.title || ''} ${Array.isArray(servico.topics)
      ? scopeTopicsText(servico.topics) : servico.description || ''}`).join(' ')
  );
  const sugeridos = new Set<string>();

  for (const regra of REGRAS) {
    if (!regra.termos.test(texto)) continue;
    regra.equipamentos.forEach(equipamento => sugeridos.add(equipamento));
  }

  // Mantém a mesma ordem estável do catálogo impresso.
  return EQUIPAMENTOS_E_FERRAMENTAS_PADRAO.filter(item => sugeridos.has(item));
}
