#!/usr/bin/env bash
# Sincroniza o banco de homologação com o último snapshot de produção.
#
# Comportamento:
#   - Se o ambiente de homologação estiver PARADO: sobe o banco, aplica o snapshot,
#     roda migrations e desliga tudo ao final.
#   - Se o ambiente de homologação estiver RODANDO: para o backend e nginx,
#     aplica o snapshot, roda migrations e sobe tudo novamente.
#
# Uso no crontab (03:00 diário):
#   0 3 * * * /root/apps/filtroAPP-staging/deploy/sync-staging.sh >> /root/logs/sync-staging.log 2>&1
#
# Variáveis configuráveis via ambiente ou backend/.env.staging:
#   PROJECT_DIR, BACKUP_ROOT, STAGING_COMPOSE_FILE, POSTGRES_DB, POSTGRES_USER,
#   STAGING_POSTGRES_PASSWORD, STAGING_ADMIN_USERNAME, STAGING_ADMIN_PASSWORD
#   ou STAGING_ADMIN_PASSWORD_HASH, REPORTS_VOLUME, RESTORE_REPORTS,
#   BUILD_SERVICES, ALLOW_PARTIAL_RESTORE, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(dirname "$SCRIPT_DIR")}"
STAGING_COMPOSE_FILE="${STAGING_COMPOSE_FILE:-docker-compose.staging.yml}"
STAGING_ENV_FILE="${STAGING_ENV_FILE:-$PROJECT_DIR/backend/.env.staging}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/backups/filtrovali}"
POSTGRES_DB="${POSTGRES_DB:-filtrovali}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
REPORTS_VOLUME="${REPORTS_VOLUME:-filtrovali_staging_relatorios}"
RESTORE_REPORTS="${RESTORE_REPORTS:-false}"
BUILD_SERVICES="${BUILD_SERVICES:-true}"
ALLOW_PARTIAL_RESTORE="${ALLOW_PARTIAL_RESTORE:-false}"
LOCKFILE="${LOCKFILE:-/tmp/filtrovali-sync-staging.lock}"

TELEGRAM_TOKEN="${TELEGRAM_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

# Carrega variáveis do backend/.env.staging (incluindo STAGING_POSTGRES_PASSWORD).
if [ -f "$STAGING_ENV_FILE" ]; then
  set -o allexport
  # shellcheck source=/dev/null
  source "$STAGING_ENV_FILE"
  set +o allexport
fi

STAGING_POSTGRES_PASSWORD="${STAGING_POSTGRES_PASSWORD:-${POSTGRES_PASSWORD:-}}"
export STAGING_POSTGRES_PASSWORD

if [ -z "$STAGING_POSTGRES_PASSWORD" ]; then
  echo "[sync-staging] STAGING_POSTGRES_PASSWORD não está configurado. Preencha $STAGING_ENV_FILE antes de recriar o volume do Postgres." >&2
  exit 1
fi

STAGING_ADMIN_USERNAME="${STAGING_ADMIN_USERNAME:-staging-admin}"
STAGING_ADMIN_NAME="${STAGING_ADMIN_NAME:-Administrador Staging}"
STAGING_ADMIN_EMAIL="${STAGING_ADMIN_EMAIL:-staging-admin@filtrovali.invalid}"
STAGING_ADMIN_PASSWORD="${STAGING_ADMIN_PASSWORD:-}"
STAGING_ADMIN_PASSWORD_HASH="${STAGING_ADMIN_PASSWORD_HASH:-}"

export STAGING_ADMIN_USERNAME
export STAGING_ADMIN_NAME
export STAGING_ADMIN_EMAIL
export STAGING_ADMIN_PASSWORD
export STAGING_ADMIN_PASSWORD_HASH

if [ -z "$STAGING_ADMIN_PASSWORD" ] && [ -z "$STAGING_ADMIN_PASSWORD_HASH" ]; then
  echo "[sync-staging] configure STAGING_ADMIN_PASSWORD ou STAGING_ADMIN_PASSWORD_HASH em $STAGING_ENV_FILE. O sync não restaura credenciais de produção em homologação." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Funções auxiliares
# ---------------------------------------------------------------------------

log() {
  echo "[sync-staging] $(date '+%Y-%m-%d %H:%M:%S') $*"
}

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

sql_identifier() {
  printf "%s" "$1" | sed 's/"/""/g'
}

cleanup_failed_restore() {
  if [ -n "${PREVIOUS_DB:-}" ]; then
    local previous_db_sql
    local postgres_db_sql
    local postgres_db_literal
    local target_exists

    previous_db_sql="$(sql_identifier "$PREVIOUS_DB")"
    postgres_db_sql="$(sql_identifier "$POSTGRES_DB")"
    postgres_db_literal="$(sql_escape "$POSTGRES_DB")"
    target_exists="$(
      docker compose -f "$STAGING_COMPOSE_FILE" exec -T postgres \
        psql -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
        -c "SELECT 1 FROM pg_database WHERE datname = '${postgres_db_literal}' LIMIT 1;" \
        2>/dev/null | tr -d '[:space:]'
    )" || true

    if [ "$target_exists" != "1" ]; then
      docker compose -f "$STAGING_COMPOSE_FILE" exec -T postgres \
        psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
        -c "ALTER DATABASE \"${previous_db_sql}\" RENAME TO \"${postgres_db_sql}\";" \
        >/dev/null 2>&1 || true
    else
      docker compose -f "$STAGING_COMPOSE_FILE" exec -T postgres \
        psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
        -c "DROP DATABASE IF EXISTS \"${previous_db_sql}\";" \
        >/dev/null 2>&1 || true
    fi
  fi

  if [ -n "${RESTORE_DB:-}" ]; then
    local restore_db_sql
    restore_db_sql="$(sql_identifier "$RESTORE_DB")"
    docker compose -f "$STAGING_COMPOSE_FILE" exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
      -c "DROP DATABASE IF EXISTS \"${restore_db_sql}\";" \
      >/dev/null 2>&1 || true
  fi
}

ensure_staging_admin_password_hash() {
  if [ -n "$STAGING_ADMIN_PASSWORD_HASH" ]; then
    return
  fi

  log "gerando hash do usuário administrador exclusivo de homologação"
  STAGING_ADMIN_PASSWORD_HASH="$(
    docker compose -f "$STAGING_COMPOSE_FILE" run --rm --no-deps \
      -e STAGING_ADMIN_PASSWORD \
      backend node --input-type=module -e "import { hashPassword } from './src/lib/password.js'; const password = process.env.STAGING_ADMIN_PASSWORD; if (!password) process.exit(1); console.log(await hashPassword(password));" \
      | tail -n 1
  )"
  export STAGING_ADMIN_PASSWORD_HASH

  if [ -z "$STAGING_ADMIN_PASSWORD_HASH" ]; then
    log "não foi possível gerar STAGING_ADMIN_PASSWORD_HASH" >&2
    exit 1
  fi
}

create_staging_mock_report_files() {
  log "substituindo volume de relatórios por artefatos mockados de homologação"
  docker compose -f "$STAGING_COMPOSE_FILE" run --rm --no-deps \
    backend node --input-type=module <<'NODE'
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const reportsDir = process.env.REPORTS_DIR || process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'Relatórios');
const reportsRoot = path.resolve(reportsDir);
const mockDir = path.join(reportsRoot, '_staging_mock');

if (!reportsRoot || reportsRoot === path.parse(reportsRoot).root) {
  throw new Error(`REPORTS_DIR inseguro para limpeza: ${reportsRoot}`);
}

async function writePdf(fileName, title) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText(title, { x: 56, y: 760, size: 18, font: bold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText('Documento sintético gerado para homologação.', { x: 56, y: 720, size: 12, font });
  page.drawText('Não contém dados reais de produção.', { x: 56, y: 700, size: 12, font });
  page.drawText(`Gerado em: ${new Date().toISOString()}`, { x: 56, y: 680, size: 10, font });
  await fs.writeFile(path.join(mockDir, fileName), await pdf.save());
}

async function clearDirectoryContents(dir) {
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir);
  await Promise.all(entries.map(entry => fs.rm(path.join(dir, entry), { recursive: true, force: true })));
}

function writeDocx(fileName) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`));
  zip.addFile('_rels/.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`));
  zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Romaneio sintético de homologação</w:t></w:r></w:p>
    <w:p><w:r><w:t>Não contém dados reais de produção.</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`));
  zip.writeZip(path.join(mockDir, fileName));
}

await clearDirectoryContents(reportsRoot);
await fs.mkdir(mockDir, { recursive: true });
await writePdf('report-source.pdf', 'Relatório sintético de homologação');
await writePdf('report-final.pdf', 'Relatório assinado sintético de homologação');
await writePdf('romaneio.pdf', 'Romaneio sintético de homologação');
await writePdf('certificate.pdf', 'Certificado sintético de homologação');
writeDocx('romaneio.docx');
await fs.writeFile(
  path.join(mockDir, 'attachment.txt'),
  'Anexo sintético de homologação. Não contém dados reais de produção.\n',
  'utf8'
);
NODE
  log "artefatos mockados de homologação criados"
}

sanitize_staging_database() {
  local admin_username_sql
  local admin_name_sql
  local admin_email_sql
  local admin_password_hash_sql

  admin_username_sql="$(sql_escape "$STAGING_ADMIN_USERNAME")"
  admin_name_sql="$(sql_escape "$STAGING_ADMIN_NAME")"
  admin_email_sql="$(sql_escape "$STAGING_ADMIN_EMAIL")"
  admin_password_hash_sql="$(sql_escape "$STAGING_ADMIN_PASSWORD_HASH")"

  log "sanitizando credenciais, sessões e tokens públicos restaurados de produção"
  docker compose -f "$STAGING_COMPOSE_FILE" exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
BEGIN;

DELETE FROM "UserSession";
DELETE FROM "PasswordResetToken";
DELETE FROM "EmailChangeToken";
DELETE FROM "NotificationPreferenceToken";
DELETE FROM "ReportDraft";

UPDATE "User"
SET
  "username" = 'staging-user-' || "id",
  "name" = 'Usuário Staging ' || "id",
  "email" = NULL,
  "clientCnpj" = NULL,
  "passwordHash" = 'staging-disabled',
  "emailVerifiedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Collaborator"
SET
  "name" = 'Colaborador Staging ' || "code",
  "email" = NULL,
  "cpf" = NULL,
  "registrationNumber" = NULL,
  "signatureImage" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Project"
SET
  "clientName" = 'Cliente Staging',
  "clientCnpj" = '00.000.000/0000-00',
  "clientEmailPrimary" = '',
  "clientEmailCc" = ARRAY[]::text[],
  "clientSigners" = ARRAY[]::jsonb[],
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Report"
SET
  "zapsignDocToken" = NULL,
  "zapsignSignerToken" = NULL,
  "zapsignDocUrl" = NULL,
  "specialConditions" = CASE
    WHEN jsonb_typeof("specialConditions"::jsonb) = 'object'
      THEN ("specialConditions"::jsonb - 'generalUploads' - '__leaderSnapshot')::jsonb
    ELSE "specialConditions"
  END;

UPDATE "ReportService"
SET
  "extraData" = CASE
    WHEN jsonb_typeof("extraData"::jsonb) = 'object'
      THEN ("extraData"::jsonb - '__uploads__')::jsonb
    ELSE "extraData"
  END;

UPDATE "ReportVersion"
SET
  "sourcePdfUrl" = '/relatorios/_staging_mock/report-source.pdf',
  "finalPdfUrl" = CASE
    WHEN "finalPdfUrl" IS NULL THEN NULL
    ELSE '/relatorios/_staging_mock/report-final.pdf'
  END,
  "sourceDocumentHash" = 'staging-mock-source',
  "finalDocumentHash" = CASE
    WHEN "finalDocumentHash" IS NULL THEN NULL
    ELSE 'staging-mock-final'
  END;

UPDATE "ReportAttachment"
SET
  "label" = 'Anexo sintético de homologação',
  "fileName" = 'anexo-staging.txt',
  "mimeType" = 'text/plain',
  "storagePath" = '_staging_mock/attachment.txt';

UPDATE "ReportSignature"
SET
  "signerName" = 'Assinante Staging ' || "id",
  "declaredSignerName" = NULL,
  "signerEmail" = 'assinatura-' || "id" || '@staging.invalid',
  "ipAddress" = NULL,
  "userAgent" = NULL,
  "signatureImageDataUrl" = NULL,
  "tokenHash" = NULL,
  "tokenEncrypted" = NULL,
  "tokenIv" = NULL,
  "tokenAuthTag" = NULL,
  "tokenExpiresAt" = NULL;

UPDATE "ClientReportReview"
SET
  "comment" = NULL,
  "ipAddress" = NULL,
  "userAgent" = NULL;

UPDATE "ReportAuditLog"
SET
  "description" = NULL,
  "ipAddress" = NULL,
  "userAgent" = NULL;

UPDATE "EpiSignatureRequest"
SET
  "tokenHash" = 'staging-scrubbed-' || "id",
  "status" = CASE WHEN "status" = 'PENDING' THEN 'EXPIRED' ELSE "status" END,
  "expiresAt" = LEAST("expiresAt", CURRENT_TIMESTAMP),
  "signatureImageDataUrl" = NULL,
  "signatureSignerName" = NULL,
  "ipAddress" = NULL,
  "userAgent" = NULL;

UPDATE "SatisfactionSurvey"
SET
  "tokenHash" = 'staging-scrubbed-' || "id",
  "tokenEncrypted" = '',
  "tokenIv" = '',
  "tokenAuthTag" = '',
  "emailTo" = 'pesquisa-' || "id" || '@staging.invalid',
  "expiresAt" = LEAST("expiresAt", CURRENT_TIMESTAMP),
  "reminderOptOutAt" = COALESCE("reminderOptOutAt", CURRENT_TIMESTAMP),
  "expirationNotifiedAt" = COALESCE("expirationNotifiedAt", CURRENT_TIMESTAMP),
  "submittedIp" = NULL,
  "submittedUserAgent" = NULL;

UPDATE "RomaneioNotificationRecipient"
SET
  "name" = NULL,
  "email" = 'romaneio-' || "id" || '@staging.invalid',
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Romaneio"
SET
  "driverName" = 'Motorista Staging',
  "vehiclePlate" = 'STG0000',
  "docxUrl" = CASE
    WHEN "docxUrl" IS NULL THEN NULL
    ELSE '/relatorios/_staging_mock/romaneio.docx'
  END,
  "pdfUrl" = CASE
    WHEN "pdfUrl" IS NULL THEN NULL
    ELSE '/relatorios/_staging_mock/romaneio.pdf'
  END,
  "emailStatus" = NULL,
  "emailError" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "AllocationReportRecipient"
SET
  "name" = NULL,
  "email" = 'alocacao-' || "id" || '@staging.invalid',
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "DataSubjectRequest"
SET
  "name" = 'Titular Staging ' || "id",
  "email" = 'titular-' || "id" || '@staging.invalid',
  "identifier" = NULL,
  "details" = 'Sanitizado em homologação',
  "ipAddress" = NULL,
  "userAgent" = NULL,
  "responseNotes" = NULL,
  "responseEmailError" = NULL,
  "identityVerificationEvidence" = NULL,
  "completionNotes" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "DataSubjectRequestResponseAttempt"
SET
  "message" = 'Sanitizado em homologação',
  "emailTo" = 'resposta-' || "id" || '@staging.invalid',
  "emailSubject" = NULL,
  "providerMessageId" = NULL,
  "error" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "CalibrationCertificate"
SET
  "fileName" = 'certificado-staging.pdf',
  "mimeType" = 'application/pdf',
  "storagePath" = '_staging_mock/certificate.pdf',
  "publicToken" = 'staging-scrubbed-' || "id";

UPDATE "ReportVersion"
SET "validationCode" = CASE
  WHEN "validationCode" IS NULL THEN NULL
  ELSE 'STAGING-' || "id"
END;

WITH admin_user AS (
  INSERT INTO "User" (
    "id",
    "username",
    "name",
    "email",
    "passwordHash",
    "role",
    "accountType",
    "isActive",
    "emailVerifiedAt",
    "notifyReportsByEmail",
    "notifySignaturesByEmail",
    "notifySignatureRemindersByEmail",
    "notifySurveyRemindersByEmail",
    "notifyCalibrationRemindersByEmail",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    'staging-admin-user',
    '${admin_username_sql}',
    '${admin_name_sql}',
    '${admin_email_sql}',
    '${admin_password_hash_sql}',
    'MANAGER'::"UserRole",
    'ADMIN'::"AccountType",
    true,
    CURRENT_TIMESTAMP,
    false,
    false,
    false,
    false,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT ("username") DO UPDATE
  SET
    "name" = EXCLUDED."name",
    "email" = EXCLUDED."email",
    "passwordHash" = EXCLUDED."passwordHash",
    "role" = EXCLUDED."role",
    "accountType" = EXCLUDED."accountType",
    "isActive" = true,
    "emailVerifiedAt" = CURRENT_TIMESTAMP,
    "notifyReportsByEmail" = false,
    "notifySignaturesByEmail" = false,
    "notifySignatureRemindersByEmail" = false,
    "notifySurveyRemindersByEmail" = false,
    "notifyCalibrationRemindersByEmail" = false,
    "collaboratorId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "id"
),
admin_roles("module", "role") AS (
  VALUES
    ('RDO'::"AppModule", 'RDO_MANAGER'::"ModuleRoleCode"),
    ('ROMANEIO'::"AppModule", 'ROMANEIO_MANAGER'::"ModuleRoleCode"),
    ('EPI'::"AppModule", 'EPI_TECHNICIAN'::"ModuleRoleCode"),
    ('PRIVACY'::"AppModule", 'PRIVACY_ADMIN'::"ModuleRoleCode")
)
INSERT INTO "ModuleRole" ("id", "userId", "module", "role", "createdAt")
SELECT
  'staging-admin-' || admin_roles."module"::text || '-' || admin_roles."role"::text,
  admin_user."id",
  admin_roles."module",
  admin_roles."role",
  CURRENT_TIMESTAMP
FROM admin_user
CROSS JOIN admin_roles
ON CONFLICT ("userId", "module", "role") DO NOTHING;

COMMIT;
SQL
  log "sanitização de homologação concluída"
}

notify_failure() {
  local exit_code="$?"
  local line_no="${BASH_LINENO[0]}"
  local cmd="${BASH_COMMAND}"

  log "falhou com exit code $exit_code na linha $line_no: $cmd" >&2
  cleanup_failed_restore

  if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    local host
    host="$(hostname)"
    local message
    message="❌ Falha no sync-staging Filtrovali

Servidor: $host
Data: $(date '+%Y-%m-%d %H:%M:%S')
Linha: $line_no
Comando: $cmd
Exit code: $exit_code"

    curl -sS \
      -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${message}" \
      >/dev/null || true
  fi

  rm -f "$LOCKFILE"
  exit "$exit_code"
}

trap notify_failure ERR

# ---------------------------------------------------------------------------
# Lock — evita execuções simultâneas (ex: cron atrasado)
# ---------------------------------------------------------------------------

if [ -e "$LOCKFILE" ]; then
  log "outro processo em andamento (lockfile: $LOCKFILE), abortando." >&2
  exit 1
fi
touch "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

# ---------------------------------------------------------------------------
# Validação do backup
# ---------------------------------------------------------------------------

LATEST_BACKUP="$BACKUP_ROOT/latest"

if [ ! -L "$LATEST_BACKUP" ] && [ ! -d "$LATEST_BACKUP" ]; then
  log "nenhum backup encontrado em $LATEST_BACKUP" >&2
  exit 1
fi

BACKUP_DIR="$(readlink -f "$LATEST_BACKUP")"

if [ ! -f "$BACKUP_DIR/postgres.sql.gz" ]; then
  log "arquivo não encontrado: $BACKUP_DIR/postgres.sql.gz" >&2
  exit 1
fi

log "validando integridade gzip do dump do banco"
gzip -t "$BACKUP_DIR/postgres.sql.gz"

# Alerta se o backup tiver mais de 48 horas (problema no script de backup).
BACKUP_AGE_HOURS=$(( ( $(date +%s) - $(stat -c %Y "$BACKUP_DIR/postgres.sql.gz") ) / 3600 ))
if [ "$BACKUP_AGE_HOURS" -gt 48 ]; then
  log "AVISO: backup mais recente tem ${BACKUP_AGE_HOURS}h — verifique o script de backup." >&2
fi

log "usando backup: $BACKUP_DIR (${BACKUP_AGE_HOURS}h atrás)"

# ---------------------------------------------------------------------------
# Estado atual do ambiente de homologação
# ---------------------------------------------------------------------------

cd "$PROJECT_DIR"

STAGING_WAS_UP=false
if docker compose -f "$STAGING_COMPOSE_FILE" ps --quiet --status running 2>/dev/null | grep -q .; then
  STAGING_WAS_UP=true
  log "ambiente de homologação estava RODANDO"
else
  log "ambiente de homologação estava PARADO"
fi

# ---------------------------------------------------------------------------
# Preparação: garantir que o postgres de homologação está disponível
# ---------------------------------------------------------------------------

if [ "$STAGING_WAS_UP" = "true" ]; then
  log "parando backend e nginx para aplicar o snapshot"
  docker compose -f "$STAGING_COMPOSE_FILE" stop backend nginx
else
  log "subindo apenas o postgres de homologação"
  docker compose -f "$STAGING_COMPOSE_FILE" up -d postgres
fi

log "aguardando postgres de homologação ficar pronto"
WAIT_SECS=0
until docker compose -f "$STAGING_COMPOSE_FILE" exec -T postgres \
    pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q 2>/dev/null; do
  if [ "$WAIT_SECS" -ge 60 ]; then
    log "postgres não ficou pronto após 60s — verifique: docker compose -f $STAGING_COMPOSE_FILE logs postgres" >&2
    exit 1
  fi
  sleep 2
  WAIT_SECS=$(( WAIT_SECS + 2 ))
done
log "postgres pronto"

# ---------------------------------------------------------------------------
# Restauração do banco
# ---------------------------------------------------------------------------

RESTORE_DB="${POSTGRES_DB}_restore_$(date +%s)_$$"
PREVIOUS_DB="${POSTGRES_DB}_previous_$(date +%s)_$$"
RESTORE_DB_SQL="$(sql_identifier "$RESTORE_DB")"
PREVIOUS_DB_SQL="$(sql_identifier "$PREVIOUS_DB")"
POSTGRES_DB_SQL="$(sql_identifier "$POSTGRES_DB")"
RESTORE_DB_LITERAL="$(sql_escape "$RESTORE_DB")"
POSTGRES_DB_LITERAL="$(sql_escape "$POSTGRES_DB")"

log "criando banco temporário $RESTORE_DB para restaurar o snapshot"
docker compose -f "$STAGING_COMPOSE_FILE" exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS \"${RESTORE_DB_SQL}\";" \
  -c "CREATE DATABASE \"${RESTORE_DB_SQL}\";" \
  >/dev/null

log "restaurando banco temporário a partir de $BACKUP_DIR/postgres.sql.gz"
gunzip -c "$BACKUP_DIR/postgres.sql.gz" \
  | docker compose -f "$STAGING_COMPOSE_FILE" exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$RESTORE_DB" -q

log "ativando banco restaurado"
docker compose -f "$STAGING_COMPOSE_FILE" exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres <<SQL
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname IN ('${POSTGRES_DB_LITERAL}', '${RESTORE_DB_LITERAL}')
  AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "${PREVIOUS_DB_SQL}";
ALTER DATABASE "${POSTGRES_DB_SQL}" RENAME TO "${PREVIOUS_DB_SQL}";
ALTER DATABASE "${RESTORE_DB_SQL}" RENAME TO "${POSTGRES_DB_SQL}";
DROP DATABASE "${PREVIOUS_DB_SQL}";
SQL

RESTORE_DB=""
PREVIOUS_DB=""
log "banco restaurado e ativado"

# ---------------------------------------------------------------------------
# Arquivos de relatórios em homologação
# ---------------------------------------------------------------------------

if [ "$RESTORE_REPORTS" = "true" ]; then
  log "AVISO: RESTORE_REPORTS=true é ignorado em homologação; arquivos reais de produção não são restaurados." >&2
fi

# ---------------------------------------------------------------------------
# Migrations pendentes
# ---------------------------------------------------------------------------

if [ "$BUILD_SERVICES" = "true" ]; then
  log "buildando backend e nginx de homologação"
  docker compose -f "$STAGING_COMPOSE_FILE" build backend nginx
else
  log "build de backend/nginx desativado (BUILD_SERVICES=false)"
fi

log "aplicando migrations pendentes"
docker compose -f "$STAGING_COMPOSE_FILE" run --rm --no-deps \
  backend sh -c "npx prisma migrate deploy"

create_staging_mock_report_files
ensure_staging_admin_password_hash
sanitize_staging_database

# ---------------------------------------------------------------------------
# Restauração do estado do ambiente
# ---------------------------------------------------------------------------

if [ "$STAGING_WAS_UP" = "true" ]; then
  log "subindo backend e nginx com o banco atualizado"
  docker compose -f "$STAGING_COMPOSE_FILE" up -d --force-recreate backend nginx
  log "homologação atualizada e RODANDO"
else
  log "desligando ambiente de homologação"
  docker compose -f "$STAGING_COMPOSE_FILE" down
  log "homologação atualizada e PARADA (suba manualmente quando precisar)"
fi

# ---------------------------------------------------------------------------

log "concluído"
