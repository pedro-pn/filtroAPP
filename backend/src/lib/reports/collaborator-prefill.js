export async function getLastReportCollaboratorPrefill({ projectId, date }, database) {
  const report = await database.report.findFirst({
    where: {
      projectId,
      reportType: 'RDO',
      deletedAt: null,
      reportDate: { lte: new Date(`${date}T23:59:59.999Z`) }
    },
    orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      collaborators: { select: { collaboratorId: true } }
    }
  });
  if (!report) return null;
  return {
    collaboratorIds: report.collaborators.map(link => link.collaboratorId).filter(Boolean)
  };
}
