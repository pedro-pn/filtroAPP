import prisma from '../prisma.js';

export const PROJECT_MANAGEMENT_NOTE_MAX_LENGTH = 2000;

export function normalizeProjectManagementNoteContent(value) {
  const content = String(value ?? '').trim();
  if (!content) throw new Error('Escreva uma nota antes de adicionar.');
  if (content.length > PROJECT_MANAGEMENT_NOTE_MAX_LENGTH) {
    throw new Error(`A nota deve ter no máximo ${PROJECT_MANAGEMENT_NOTE_MAX_LENGTH} caracteres.`);
  }
  return content;
}

async function assertProjectExists(client, projectId) {
  const project = await client.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true }
  });
  if (!project) throw new Error('Projeto não encontrado.');
}

export function projectManagementNoteToResponse(row) {
  return {
    id: row.id,
    projectId: row.projectId,
    content: row.content,
    author: {
      id: row.createdByUserId ?? null,
      name: row.createdByName
    },
    createdAt: row.createdAt
  };
}

export async function listProjectManagementNotes(projectId, { client = prisma } = {}) {
  await assertProjectExists(client, projectId);
  const notes = await client.projectManagementNote.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
  });
  return notes.map(projectManagementNoteToResponse);
}

export async function createProjectManagementNote(projectId, content, {
  userId,
  userName,
  client = prisma
} = {}) {
  const normalizedContent = normalizeProjectManagementNoteContent(content);
  const normalizedUserName = String(userName ?? '').trim();
  if (!userId || !normalizedUserName) throw new Error('Usuário responsável pela nota não identificado.');

  await assertProjectExists(client, projectId);
  const note = await client.projectManagementNote.create({
    data: {
      projectId,
      content: normalizedContent,
      createdByUserId: userId,
      createdByName: normalizedUserName
    }
  });
  return projectManagementNoteToResponse(note);
}
