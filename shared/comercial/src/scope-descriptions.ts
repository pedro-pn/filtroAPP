import { normalizeScopeServiceItems, type ScopeServiceItem, type ScopeTopic } from "./scope-content.js";

const INTRO = "Serviço especializado em mão de obra e execução técnica na manutenção";

export const SCOPE_DESCRIPTION_TEMPLATES = [
  { id: "visita-tecnica", title: "Visita técnica", description: `${INTRO} e visita técnica.` },
  {
    id: "tubulacoes",
    title: "Teste hidrostático, limpeza química e flushing primário",
    description: `${INTRO}, teste hidrostático, limpeza química em regime pressurizado e flushing primário em tubulações de sistemas hidráulico e lubrificante, com as respectivas medidas`,
  },
  { id: "flushing-secundario", title: "Flushing secundário", description: `${INTRO} e flushing secundário em aproximadamente litros de óleo;` },
  { id: "filtragem", title: "Filtragem absoluta", description: `${INTRO} e filtragem absoluta em aproximadamente litros de óleo;` },
  { id: "desidratacao", title: "Desidratação", description: `${INTRO} e desidratação em aproximadamente litros de óleo;` },
  { id: "reservatorio", title: "Limpeza interna de reservatório", description: `${INTRO} e limpeza interna de reservatório;` },
  { id: "drenagem", title: "Drenagem e abastecimento de óleo", description: `${INTRO}, drenagem e abastecimento de óleo;` },
  { id: "desgaseificacao", title: "Desgaseificação", description: `${INTRO} e desgaseificação em...` },
  {
    id: "pre-engenharia",
    title: "Pré-engenharia",
    description: `${INTRO} e serviço de pré engenharia – Estudo detalhado antes da execução:`,
    subitems: [
      "Levantamento de dados e necessidade do cliente;",
      "Levantamento de desenhos e elaboração de fluxogramas do processo a ser realizado;",
      "Levantamento e identificação de utilidades necessárias;",
      "Se necessário, definição de fabricação de provisórios necessários com antecedência;",
      "Identificação e preparação quanto aos processos internos e as documentações, ambientais, segurança, meio ambiente e qualidade.",
    ],
  },
] satisfies Array<{ id: string; title: string; description: string; subitems?: string[] }>;

export function createScopeDescriptionItem(id: string, templateId?: string): ScopeServiceItem {
  const template = SCOPE_DESCRIPTION_TEMPLATES.find(item => item.id === templateId);
  return {
    id,
    format: "paragraph",
    title: template?.title ?? "Texto livre",
    description: template?.description ?? "",
    ...(template?.subitems ? { subitems: [...template.subitems] } : {}),
  };
}

export function splitScopeParagraphs(text: string): string[] {
  return text.split(/\r\n|\r|\n/).map(part => part.trim()).filter(Boolean);
}

export function createScopeTopic(id: string, templateId?: string): ScopeTopic {
  const template = SCOPE_DESCRIPTION_TEMPLATES.find(item => item.id === templateId);
  return {
    id,
    text: template?.description ?? "",
    ...(template ? { templateId: template.id } : {}),
    ...(template?.subitems ? {
      children: template.subitems.map((text, i) => ({ id: `${id}-sub-${i}`, text })),
    } : {}),
  };
}

/** Adapta dados antigos sem gravar por cima do rascunho só por abrir a aba. */
export function scopeTopicsForItem(item: Pick<ScopeServiceItem, "id" | "description" | "topics" | "subitems">): ScopeTopic[] {
  if (Array.isArray(item.topics)) return item.topics;
  const texts = splitScopeParagraphs(item.description || "");
  const topics: ScopeTopic[] = (texts.length ? texts : [""]).map((text, i) => ({
    id: `${item.id}-topic-${i}`, text,
  }));
  if (item.subitems?.length) {
    topics[topics.length - 1].children = item.subitems.flatMap(splitScopeParagraphs)
      .map((text, i) => ({ id: `${item.id}-sub-${i}`, text }));
  }
  return topics;
}

export function scopeTopicsText(topics: ScopeTopic[]): string {
  return topics.flatMap(topic => [topic.text, scopeTopicsText(topic.children ?? [])]).filter(Boolean).join("\n");
}

export function scopeItemWithTopics(item: ScopeServiceItem, topics: ScopeTopic[]): ScopeServiceItem {
  return { ...item, topics, description: scopeTopicsText(topics), format: undefined, subitems: undefined };
}

export type ScopeDescriptionParagraph = {
  key: string;
  scopeItemId: string;
  topicId: string;
  number: string;
  level: number;
  text: string;
};

/** Uma única sequência para a prévia e o Word/PDF, inclusive textos colados. */
export function scopeDescriptionParagraphs(value: unknown, { includeEmpty = false } = {}): ScopeDescriptionParagraph[] {
  const paragraphs: ScopeDescriptionParagraph[] = [];
  let number = 0;
  for (const item of normalizeScopeServiceItems(value)) {
    function visit(topics: ScopeTopic[], prefix: string, start = 0): number {
      let current = start;
      for (const topic of topics) {
        const parts = splitScopeParagraphs(topic.text);
        if (!parts.length && includeEmpty) parts.push("");
        // Um pai apagado não pode apagar seus filhos nem criar número fantasma.
        if (!parts.length) {
          current = visit(topic.children ?? [], prefix, current);
          continue;
        }
        for (const [index, text] of parts.entries()) {
          current += 1;
          const number = `${prefix}.${current}`;
          paragraphs.push({
            key: `${item.id}-${topic.id}-${index}`, scopeItemId: item.id, topicId: topic.id,
            number, level: number.split(".").length - 1, text,
          });
        }
        visit(topic.children ?? [], `${prefix}.${current}`);
      }
      return current;
    }
    number = visit(scopeTopicsForItem(item), "2", number);
  }
  return paragraphs;
}
