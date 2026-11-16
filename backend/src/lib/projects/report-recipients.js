import { z } from 'zod';
import { makeProjectReportRecipientsSchema, normalizeProjectReportRecipients } from '../../../../shared/schemas/project-report-recipients.js';
import { shouldProvisionProjectClientAccounts } from '../project-visibility.js';
import { projectReportRecipientsInput } from './report-recipients-input.js';

const projectReportRecipientsSchema = makeProjectReportRecipientsSchema(z);

export async function saveProjectReportRecipients(tx, projectId, payload, dependencies = {}) {
  const data = normalizeProjectReportRecipients(projectReportRecipientsSchema.parse(projectReportRecipientsInput(payload)));
  const previousProject = await tx.project.findFirst({ where: { id: projectId } });
  const updated = await tx.project.update({ where: { id: projectId }, data });
  if (shouldProvisionProjectClientAccounts(updated)) {
    const accounts = dependencies.clientAccounts || await import('../client-account.js');
    await accounts.ensureClientAccountForProject(tx, updated, { previousProject });
    await accounts.ensureClientCcAccounts(tx, updated, { previousProject });
  }
  return updated;
}
