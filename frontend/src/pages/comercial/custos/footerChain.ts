/**
 * O rodapé-guia do levantamento de custos.
 *
 * Esta é a peça mais interessante da tela, e a que quase ninguém nota: o botão
 * primário do rodapé **muda de texto E de destino** conforme a seção atual.
 * Durante o preenchimento, ele avança uma etapa por vez; no resumo, eventuais
 * pendências levam de volta ao primeiro ponto que ainda precisa de correção.
 *
 *   mão de obra → materiais e insumos → mob./desmob. → comissões → salvar
 *
 * Ou seja: **o app já sabe o caminho e já sabe o que falta — ele só não diz
 * qual campo**. É o outro lado exato da lacuna L1: a informação existe, a
 * localização é que se perde. É também o roteiro do tutorial (L4), e o
 * mantenedor confirmou que é assim que se usa na prática.
 *
 * Portado de `app/custos/page.tsx:595-604`. As mensagens são as da referência,
 * ao pé da letra — mudá-las é divergência, não melhoria.
 *
 * Fica isolado num módulo puro porque é regra de navegação, não desenho: assim
 * dá para testar a cadeia inteira sem montar 465 controles na tela.
 */

export type CostSection = 'premises' | 'labor' | 'inputs' | 'logistics' | 'summary';

/** As pendências que a cadeia consulta, na ordem em que ela as consulta. */
export type PendingSections = {
  labor: boolean;
  inputs: boolean;
  logistics: boolean;
  commercial: boolean;
};

/** O que impede o salvamento quando não há mais seção pendente. */
export type SaveGuards = {
  saving: boolean;
  /** `draft.title` já sem espaços nas pontas. */
  title: string;
  validPricing: boolean;
  salePrice: number;
};

export type FooterAction =
  | { kind: 'goto'; label: string; target: CostSection; disabled: false }
  | { kind: 'save'; label: string; target: null; disabled: boolean };

/**
 * A cadeia, na ordem da referência. **A ordem importa**: com mão de obra e
 * logística pendentes ao mesmo tempo, o rodapé manda para mão de obra — porque
 * a logística depende da equipe dimensionada, e resolver na ordem inversa faz
 * o usuário refazer o trabalho.
 */
const CHAIN: Array<{ key: keyof PendingSections; label: string; target: CostSection }> = [
  {
    key: 'labor',
    label: 'Preencher itens obrigatórios da mão de obra →',
    target: 'labor'
  },
  {
    key: 'inputs',
    label: 'Revisar materiais e insumos →',
    target: 'inputs'
  },
  {
    key: 'logistics',
    label: 'Preencher mobilização e desmobilização →',
    target: 'logistics'
  },
  {
    key: 'commercial',
    label: 'Completar comissões e indicações →',
    target: 'summary'
  }
];

const SECTION_ORDER: CostSection[] = ['premises', 'labor', 'inputs', 'logistics', 'summary'];
const SECTION_LABEL: Record<CostSection, string> = {
  premises: 'Premissas',
  labor: 'Mão de obra',
  inputs: 'Materiais e insumos',
  logistics: 'Logística',
  summary: 'Resumo e QQP'
};

const NEXT_SECTION: Record<Exclude<CostSection, 'summary'>, CostSection> = {
  premises: 'labor',
  labor: 'inputs',
  inputs: 'logistics',
  logistics: 'summary'
};

const CURRENT_PENDING_KEY: Partial<
  Record<Exclude<CostSection, 'summary'>, keyof PendingSections>
> = {
  labor: 'labor',
  inputs: 'inputs',
  logistics: 'logistics'
};

function labelDaPendencia(
  step: (typeof CHAIN)[number],
  secaoAtual?: CostSection
): string {
  if (!secaoAtual) return step.label;

  const atual = SECTION_ORDER.indexOf(secaoAtual);
  const destino = SECTION_ORDER.indexOf(step.target);
  if (destino < atual) {
    return `Voltar para ${SECTION_LABEL[step.target]} e corrigir pendências ←`;
  }
  if (destino === atual) {
    return `Corrigir pendências de ${SECTION_LABEL[step.target]}`;
  }
  return `Ir para ${SECTION_LABEL[step.target]} e corrigir pendências →`;
}

export function footerAction(
  pending: PendingSections,
  guards: SaveGuards,
  secaoAtual?: CostSection
): FooterAction {
  if (secaoAtual && secaoAtual !== 'summary') {
    const pendingKey = CURRENT_PENDING_KEY[secaoAtual];
    const currentStep = CHAIN.find(step => step.key === pendingKey);
    if (pendingKey && pending[pendingKey] && currentStep) {
      return {
        kind: 'goto',
        label: labelDaPendencia(currentStep, secaoAtual),
        target: currentStep.target,
        disabled: false
      };
    }

    const target = NEXT_SECTION[secaoAtual];
    return {
      kind: 'goto',
      label: `Salvar e ir para ${SECTION_LABEL[target]} →`,
      target,
      disabled: false
    };
  }

  for (const step of CHAIN) {
    if (pending[step.key]) {
      // Enquanto há seção pendente o botão NUNCA fica desabilitado: ele é um
      // atalho para resolver, não uma trava. Desabilitar aqui esconderia o
      // caminho justamente de quem está perdido.
      return {
        kind: 'goto',
        label: labelDaPendencia(step, secaoAtual),
        target: step.target,
        disabled: false
      };
    }
  }

  return {
    kind: 'save',
    label: guards.saving ? 'Salvando...' : 'Finalizar e criar proposta',
    target: null,
    // Pendência de conteúdo não pode tornar o botão mudo. O clique é justamente
    // o gatilho que revela os campos inválidos e explica para onde voltar.
    disabled: guards.saving
  };
}

/**
 * Se o salvamento está travado pelo **conteúdo** do levantamento, e não por já
 * estar salvando.
 *
 * A distinção existe porque o botão desabilitado é mudo: ele não diz o que
 * falta. Quando a cadeia já chegou no fim e mesmo assim ele não deixa salvar,
 * o que sobrou são campos — e é o único momento em que a tela pode acender o
 * vermelho sem que o usuário tenha clicado, porque não há mais nada para
 * clicar. "Salvando..." não é falta de nada e não deve acender coisa alguma.
 */
export function saveBlockedByContent(guards: SaveGuards): boolean {
  return !guards.title.trim() || !guards.validPricing || !(guards.salePrice > 0);
}

/**
 * Abrir uma seção não é uma tentativa de preenchê-la.
 *
 * O vermelho só aparece quando a ação já está na própria seção pendente ou
 * quando a pessoa tenta criar a proposta. Navegar normalmente para uma seção
 * ainda não visitada mantém os campos neutros.
 */
export function deveRevelarErrosAoAcionar(
  acao: FooterAction,
  secaoAtual: CostSection,
  tentandoCriarProposta = false
): boolean {
  return (
    acao.kind === 'save' ||
    acao.target === secaoAtual ||
    (secaoAtual === 'summary' && acao.kind === 'goto') ||
    (tentandoCriarProposta && acao.kind === 'goto')
  );
}

/** A cadeia em texto, para o roteiro do tutorial de primeiro acesso (L4). */
export function chainSummary(): string[] {
  return [...CHAIN.map(step => step.label), 'Finalizar e criar proposta'];
}
