// Confere com que privilégios a aplicação está conectada ao PostgreSQL.
// A API e o worker devem usar um papel sem superpoderes (deploy/db/app-role.sql);
// migrations rodam com o dono das tabelas, em um serviço separado.

export function classifyDatabaseRole(row) {
  if (!row || typeof row !== 'object') return { status: 'UNKNOWN' };
  const superuser = row.superuser === true;
  const canCreateInPublic = row.canCreateInPublic === true;
  const canCreateSchema = row.canCreateSchema === true;
  const ownsTables = Number(row.ownedTables || 0) > 0;
  const privileged = superuser || canCreateInPublic || canCreateSchema || ownsTables;
  return {
    status: privileged ? 'PRIVILEGED' : 'RESTRICTED',
    user: typeof row.user === 'string' ? row.user : null,
    superuser,
    canCreateInPublic,
    canCreateSchema,
    ownsTables
  };
}

export async function databaseRoleStatus(prismaClient) {
  if (typeof prismaClient?.$queryRaw !== 'function') return { status: 'UNKNOWN' };
  try {
    const rows = await prismaClient.$queryRaw`
      SELECT current_user::text AS "user",
        r.rolsuper AS "superuser",
        has_schema_privilege('public', 'CREATE') AS "canCreateInPublic",
        has_database_privilege(current_database(), 'CREATE') AS "canCreateSchema",
        (SELECT count(*)::int FROM pg_tables t
          WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS "ownedTables"
      FROM pg_roles r
      WHERE r.rolname = current_user
    `;
    return classifyDatabaseRole(Array.isArray(rows) ? rows[0] : null);
  } catch {
    return { status: 'UNKNOWN' };
  }
}

export async function warnIfPrivilegedDatabaseRole(prismaClient, {
  processName = 'backend',
  logger = console
} = {}) {
  const status = await databaseRoleStatus(prismaClient);
  if (status.status === 'PRIVILEGED') {
    logger.warn?.(
      `[${processName}] conectado ao PostgreSQL como "${status.user}", papel com privilégios de dono/superusuário. `
      + 'Use o papel restrito da aplicação em DATABASE_URL e deixe o dono só em MIGRATION_DATABASE_URL '
      + '(veja deploy/PRODUCTION.md, "Papel restrito do banco").'
    );
  }
  return status;
}
