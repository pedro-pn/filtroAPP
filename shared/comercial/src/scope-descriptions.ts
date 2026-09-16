import { descricaoComAberturaTecnica } from "./modelo-documento.js";
import { normalizeScopeServiceItems, type ScopeServiceItem } from "./scope-content.js";

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

export type ScopeDescriptionParagraph = {
  key: string;
  scopeItemId: string;
  number: string;
  level: 1 | 2;
  text: string;
};

/** Uma única sequência para a prévia e o Word/PDF, inclusive textos colados. */
export function scopeDescriptionParagraphs(value: unknown, commercial = false): ScopeDescriptionParagraph[] {
  const paragraphs: ScopeDescriptionParagraph[] = [];
  let number = 0;
  for (const item of normalizeScopeServiceItems(value)) {
    const text = item.format === "paragraph"
      ? item.description
      : [item.title, item.description].filter(Boolean).join(" — ");
    const parts = splitScopeParagraphs(text);
    if (!parts.length) continue;
    for (const [index, part] of parts.entries()) {
      number += 1;
      paragraphs.push({
        key: `${item.id}-${index}`, scopeItemId: item.id, number: `2.${number}`, level: 1,
        text: commercial && item.format !== "paragraph" ? descricaoComAberturaTecnica(part) : part,
      });
    }
    (item.subitems ?? []).flatMap(splitScopeParagraphs).forEach((part, index) => {
      paragraphs.push({
        key: `${item.id}-sub-${index}`, scopeItemId: item.id,
        number: `2.${number}.${index + 1}`, level: 2, text: part,
      });
    });
  }
  return paragraphs;
}
