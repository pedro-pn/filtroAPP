import type { ProjectWorkflowIconName } from '../pages/efetivo/components/ProjectWorkflowIcon';

// Ícone padrão de cada área responsável; uma seção pode sobrepor com a prop `icon`.
export const PROJECT_WORKFLOW_AREA_ICONS: Record<string, ProjectWorkflowIconName> = {
  'Operações': 'clipboard',
  'Administrativo': 'building',
  'Ativos': 'wrench',
  'Suprimentos': 'package',
  'Logística': 'truck',
  'QSMS': 'shield',
  'Autorização': 'lock',
  'Encerramento': 'flag',
  'Análise': 'search',
  'Comercial': 'briefcase',
  'Documentação': 'file',
  'Execução': 'activity',
  'Qualidade': 'award'
};

export function initialsOf(name: string | null | undefined) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return (first + last).toLocaleUpperCase('pt-BR');
}
