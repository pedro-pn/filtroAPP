import { clientCanAccessProject } from '../client-project-access.js';
import { getOfficialMissionContext } from '../efetivo/planning/official-mission-context.js';
import prisma from '../prisma.js';
import { officialMissionContextQuerySchema } from '../workforce/schemas.js';
import { getLastReportCollaboratorPrefill } from './collaborator-prefill.js';

function canReadProject(auth, project) {
  if (auth.user.role === 'MANAGER') return true;
  if (!project?.isActive || project.deletedAt || project.managerOnly) return false;
  if (auth.user.role === 'COORDINATOR') return true;
  if (auth.user.role === 'CLIENT') return clientCanAccessProject(auth, project);
  return Boolean(project.visibleToCollaborators || project.authorizedUsers?.some(link => link.userId === auth.user?.id));
}

export async function reportPlanningContextHandler(req, res) {
  const query = officialMissionContextQuerySchema.parse(req.query);
  const project = await prisma.project.findUnique({ where: { id: query.projectId }, include: { authorizedUsers: true } });
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado.' });
  if (!canReadProject(req.auth, project)) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar o planejamento deste projeto.' });
  }
  res.json(await getOfficialMissionContext(query));
}

export async function reportCollaboratorPrefillHandler(req, res) {
  const query = officialMissionContextQuerySchema.parse(req.query);
  const project = await prisma.project.findUnique({ where: { id: query.projectId }, include: { authorizedUsers: true } });
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado.' });
  if (!canReadProject(req.auth, project)) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar os RDOs deste projeto.' });
  }
  res.json(await getLastReportCollaboratorPrefill(query, prisma));
}
