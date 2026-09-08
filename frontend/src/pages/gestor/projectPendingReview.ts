import type { Resolver } from 'react-hook-form';
import { z } from 'zod';

import type { Project } from '../../types/domain';

const requiredText = (label: string, max: number) => z.string()
  .trim()
  .min(1, `${label} é obrigatório.`)
  .max(max, `${label} deve ter no máximo ${max} caracteres.`);

export const pendingProjectReviewSchema = z.object({
  code: requiredText('Número do projeto', 80),
  name: requiredText('Nome do projeto', 240),
  clientName: requiredText('Cliente', 240),
  clientCnpj: requiredText('CNPJ', 64).refine(
    value => value.replace(/\D/g, '').length === 14,
    'CNPJ deve conter exatamente 14 dígitos.'
  ),
  contractCode: requiredText('Proposta', 160),
  location: requiredText('Local', 240)
});

export type PendingProjectReviewValues = z.infer<typeof pendingProjectReviewSchema>;

function zodErrorToFormErrors(error: z.ZodError) {
  return error.issues.reduce<Record<string, { type: string; message: string }>>((errors, issue) => {
    const key = String(issue.path[0] || 'form');
    if (!errors[key]) errors[key] = { type: 'manual', message: issue.message };
    return errors;
  }, {});
}

export const pendingProjectReviewResolver: Resolver<PendingProjectReviewValues> = async values => {
  const result = pendingProjectReviewSchema.safeParse(values);
  if (result.success) return { values: result.data, errors: {} };
  return { values: {}, errors: zodErrorToFormErrors(result.error) };
};

export function pendingProjectReviewValues(project: Project): PendingProjectReviewValues {
  return {
    code: project.code || '',
    name: project.name || '',
    clientName: project.clientName || '',
    clientCnpj: project.clientCnpj || '',
    contractCode: project.contractCode || '',
    location: project.location || ''
  };
}

export function pendingProjectReviewPayload(values: PendingProjectReviewValues) {
  const parsed = pendingProjectReviewSchema.parse(values);
  return {
    ...parsed,
    clientCnpj: parsed.clientCnpj.replace(/\D/g, '')
  };
}

export function projectRegistrationPending(project: Pick<Project, 'registrationPending'>) {
  return Boolean(project.registrationPending);
}

export function partitionProjectsByRegistration(projects: Project[]) {
  return {
    pending: projects.filter(projectRegistrationPending),
    ready: projects.filter(project => !projectRegistrationPending(project))
  };
}

export type PendingProjectRegistrationSource = 'WEBHOOK' | 'ROMANEIO';

export function pendingProjectRegistrationSource(project: Project): PendingProjectRegistrationSource {
  return pendingProjectReviewSchema.safeParse(pendingProjectReviewValues(project)).success
    ? 'WEBHOOK'
    : 'ROMANEIO';
}

export function automaticProjectReviewMessage(project: Project) {
  const source = pendingProjectRegistrationSource(project);
  const origin = source === 'WEBHOOK' ? 'recebido pelo webhook' : 'criado pelo Romaneio';
  return `Projeto ${origin}. Revise os dados e confirme o cadastro antes de usar em relatórios.`;
}

export function pendingProjectRegistrationMessage(projects: Project[]) {
  const webhookCount = projects.filter(project => pendingProjectRegistrationSource(project) === 'WEBHOOK').length;
  const romaneioCount = projects.length - webhookCount;
  if (webhookCount && !romaneioCount) {
    return webhookCount === 1
      ? 'Há 1 projeto recebido pelo webhook aguardando verificação manual.'
      : `Há ${webhookCount} projetos recebidos pelo webhook aguardando verificação manual.`;
  }
  if (romaneioCount && !webhookCount) {
    return romaneioCount === 1
      ? 'Há 1 projeto criado pelo Romaneio aguardando verificação manual.'
      : `Há ${romaneioCount} projetos criados pelo Romaneio aguardando verificação manual.`;
  }
  return `Há ${projects.length} projetos aguardando verificação manual: ${webhookCount} via webhook e ${romaneioCount} pelo Romaneio.`;
}

export function formatProjectSequences(project: Project) {
  const sequences = project.reportSequences || [];
  if (!sequences.length) return 'Sem sequenciais cadastrados';
  return sequences
    .map(sequence => `${sequence.reportType}: próximo ${sequence.nextNumber}`)
    .join(', ');
}

export function projectVisibilityLabel(project: Pick<Project, 'managerOnly' | 'visibleToCollaborators'>) {
  if (project.managerOnly) return 'Somente gestor';
  if (project.visibleToCollaborators) return 'Gestor, coordenador e colaboradores responsáveis';
  return 'Gestor e coordenador';
}

export function projectTitle(project: Project) {
  const name = String(project.name || '').trim();
  return name ? `${project.code} - ${name}` : `Missão ${project.code}`;
}

export function projectSearchParts(project: Project) {
  return [
    project.code,
    project.name,
    project.registrationPending ? 'cadastro pendente' : '',
    project.clientName,
    project.clientCnpj,
    project.clientEmailPrimary,
    project.clientSignerFirstName,
    project.clientSignerLastName,
    ...(project.clientEmailCc || []),
    ...(project.clientSigners || []).flatMap(signer => [signer.name, signer.firstName, signer.lastName, signer.email]),
    project.contractCode,
    project.location,
    project.operator?.name,
    projectVisibilityLabel(project),
    formatProjectSequences(project)
  ];
}
