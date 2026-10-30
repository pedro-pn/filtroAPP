import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// PostgreSQL real via WASM; delegados traduzem somente os selects do serviço em
// SQL parametrizado. Migration/gatilhos/rollback executam sem doubles.
export async function phase2Database() {
  const db = new PGlite({ parsers: { 1114: value => new Date(`${value}Z`) } });
  await db.exec(`
    CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT, email TEXT, "isActive" BOOLEAN DEFAULT true);
    CREATE TABLE "ApiCredential" (id TEXT PRIMARY KEY);
    CREATE TABLE "Project" (id TEXT PRIMARY KEY, code TEXT, "operatorId" TEXT, "deletedAt" TIMESTAMP, "managerOnly" BOOLEAN DEFAULT false, "distributionSettings" JSONB);
    CREATE TABLE "ProjectWorkflow" (id TEXT PRIMARY KEY, "projectId" TEXT, stage TEXT, "leaderUserId" TEXT, "plannerUserId" TEXT);
    CREATE TABLE "Report" (id TEXT PRIMARY KEY, "projectId" TEXT, status TEXT DEFAULT 'PENDING', "createdAt" TIMESTAMP DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now(),
      "deletedAt" TIMESTAMP, "approvedAt" TIMESTAMP, "returnedAt" TIMESTAMP, "clientReleasedAt" TIMESTAMP, "zapsignSignedAt" TIMESTAMP, "physicalSignedAt" TIMESTAMP);
    CREATE TABLE "ReportAuditLog" (id TEXT PRIMARY KEY, "reportId" TEXT, action TEXT, "createdAt" TIMESTAMP);
    CREATE TABLE "ReportDraft" (id TEXT PRIMARY KEY, "projectId" TEXT);
    CREATE TABLE "Romaneio" (id TEXT PRIMARY KEY, "projectId" TEXT, type TEXT, "pdfUrl" TEXT, "docxUrl" TEXT, "createdAt" TIMESTAMP DEFAULT now());
    CREATE TABLE "QualityRecord" (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, number TEXT UNIQUE, type TEXT, seq INT, year INT,
      "registeredAt" TIMESTAMP, origin TEXT, "projectId" TEXT, "eventDate" TIMESTAMP, "natureId" TEXT, description TEXT, impact TEXT,
      "actionOwner" TEXT, status TEXT, "createdById" TEXT, "updatedById" TEXT, "deletedById" TEXT, "deletedAt" TIMESTAMP,
      "createdAt" TIMESTAMP DEFAULT now(), "updatedAt" TIMESTAMP DEFAULT now());
    CREATE TABLE "QualityEvidence" (id TEXT PRIMARY KEY, "recordId" TEXT, label TEXT);
    CREATE TABLE "QualityRecordSeq" (type TEXT, year INT, "lastSeq" INT, PRIMARY KEY(type, year));
    INSERT INTO "User" (id,name,email) VALUES ('u1','Qualidade fictícia','quality@example.test');
    INSERT INTO "ApiCredential" VALUES ('cred'),('cred2');
    INSERT INTO "Project" (id,code) VALUES ('p1','5850'),('p2','9999');
    INSERT INTO "Report" (id,"projectId",status,"createdAt","zapsignSignedAt") VALUES ('legacy','p1','SIGNED','2026-01-01','2026-02-01');
  `);
  await db.exec(await readFile(new URL('../../prisma/migrations/20261028160000_omni_phase2/migration.sql', import.meta.url), 'utf8'));
  const insert = async (connection, table, data) => {
    const entries = Object.entries(data);
    return (await connection.query(`INSERT INTO "${table}" (${entries.map(([key]) => `"${key}"`).join(',')}) VALUES (${entries.map((_,i) => `$${i+1}`).join(',')}) RETURNING *`, entries.map(([,v]) => v))).rows[0];
  };
  const clientFor = connection => ({
    $queryRaw: async (strings,...values) => (await connection.query(strings.reduce((sql,part,i) => sql+part+(i<values.length?`$${i+1}`:''),''),values)).rows,
    project: {
      async findMany() { return (await connection.query(`SELECT * FROM "Project" WHERE "deletedAt" IS NULL AND
        ("distributionSettings"->'api' = 'true'::jsonb OR ("distributionSettings" IS NULL AND NOT "managerOnly"))`)).rows; },
      async findFirst({where}) {
      return (await connection.query('SELECT * FROM "Project" WHERE "deletedAt" IS NULL')).rows.find(row => {
        if(where.code && row.code!==where.code) return false;
        if(typeof where.id==='string') return row.id===where.id;
        return !where.id || where.id.in.includes(row.id) && (!where.id.equals || row.id===where.id.equals);
      }) || null;
    } },
    user: { async findMany({where,take}) {return (await connection.query('SELECT * FROM "User" WHERE "isActive" AND lower(email)=lower($1) LIMIT $2',[where.email.equals,take])).rows;} },
    integrationQualityReceipt: {
      async findUnique({where}) {const k=where.credentialId_key;return (await connection.query('SELECT * FROM "IntegrationQualityReceipt" WHERE "credentialId"=$1 AND key=$2',[k.credentialId,k.key])).rows[0]||null;},
      async create({data}) {return insert(connection,'IntegrationQualityReceipt',data);}
    },
    qualityRecordSeq: {async upsert({create}) {return (await connection.query('INSERT INTO "QualityRecordSeq" (type,year,"lastSeq") VALUES ($1,$2,1) ON CONFLICT(type,year) DO UPDATE SET "lastSeq"="QualityRecordSeq"."lastSeq"+1 RETURNING *',[create.type,create.year])).rows[0];}},
    qualityRecord: {async create({data}) {return insert(connection,'QualityRecord',data);}},
    integrationEvent: {async findMany({where,take}) {
      return (await connection.query('SELECT * FROM "IntegrationEvent" WHERE sequence>$1 AND "occurredAt">=$2 AND type=ANY($3::text[]) AND ("projectId" IS NULL OR "projectId"=ANY($6::text[])) AND ($4::text[] IS NULL OR "projectId"=ANY($4::text[])) ORDER BY sequence LIMIT $5',
        [String(where.sequence.gt),where.occurredAt.gte,where.type.in,where.projectId?.in||null,take,where.OR[1].projectId.in])).rows;
    }}
  });
  const client=clientFor(db);
  client.$transaction=fn=>db.transaction(tx=>fn(clientFor(tx)));
  const rows=async table=>(await db.query(`SELECT * FROM "${table}"`)).rows;
  return {db,client,rows};
}
