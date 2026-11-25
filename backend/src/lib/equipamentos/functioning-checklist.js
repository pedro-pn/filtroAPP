import { z } from 'zod';

// Modelos para impressão. Nenhuma resposta de inspeção é registrada no app.
export const functioningChecklistSchema = z.object({
  format: z.enum(['MONTHLY', 'INSPECTION']),
  items: z.array(z.string().trim().min(1).max(300)).max(100),
  responsibleLabels: z.array(z.string().trim().min(1).max(80)).length(4).optional()
});

export const DEFAULT_RESPONSIBLE_LABELS = ['Responsável Filtrovali', 'Responsável', 'Responsável Filtrovali', 'Responsável'];

export function resolveFunctioningChecklist(equipment, category) {
  const result = functioningChecklistSchema.safeParse(equipment?.functioningChecklist ?? category?.functioningChecklist);
  return result.success ? result.data : { format: 'MONTHLY', items: [] };
}

export function hasFunctioningChecklist(template) {
  return template.format === 'INSPECTION' || template.items.length > 0;
}

export function functioningChecklistFileName(equipment, extension = 'pdf') {
  const name = `Checklist de funcionamento - ${equipment.code} - ${equipment.name}`
    .replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
  return `${name}.${extension}`;
}

export const MONTHLY_LEGEND = 'OK: Conferido | R: Funcionando com restrição | P: Parado / necessário regularização antes de operar';
