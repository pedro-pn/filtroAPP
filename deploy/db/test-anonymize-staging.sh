#!/usr/bin/env bash
# Exercita deploy/db/anonymize-staging.sql num banco PostgreSQL descartável já
# migrado (usado no CI). Nunca aponte para produção ou homologação: o script
# grava dados fictícios e apaga tabelas inteiras.
#
# Uso: deploy/db/test-anonymize-staging.sh postgresql://postgres:postgres@localhost:5432/staging_anon_test
set -euo pipefail

DB_URL="${1:?informe a URL de um banco descartável já migrado}"
case "$DB_URL" in
  *_test|*_test\?*) ;;
  *) echo "[anon-test] por segurança, o nome do banco precisa terminar em _test" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="$SCRIPT_DIR/anonymize-staging.sql"

q() { psql "$DB_URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
fail() { echo "::error::[anon-test] $*" >&2; exit 1; }
expect() { # expect <descrição> <sql> <valor esperado>
  local got
  got="$(q "$2")"
  [ "$got" = "$3" ] || fail "$1: esperado '$3', obtido '$got'"
  echo "ok - $1"
}

echo "[anon-test] semeando dados pessoais fictícios"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "JobRole" ("id", "name", "normalizedKey", "updatedAt")
VALUES ('anon-role', 'Cargo Anon', 'cargo-anon', now());

INSERT INTO "Collaborator" ("id", "code", "name", "jobRoleId", "email", "cpf", "registrationNumber", "signatureImage", "efetivoNote", "updatedAt")
VALUES
  ('anon-col-1', 'A001', 'Maria Real da Silva', 'anon-role', 'maria.real@empresa.com.br', '123.456.789-09', 'MAT-777', 'data:image/png;base64,AAAA', 'atestado médico', now()),
  ('anon-col-2', 'A002', 'João Real Souza', 'anon-role', 'joao.real@gmail.com', '987.654.321-00', 'MAT-888', NULL, NULL, now());

INSERT INTO "User" ("id", "username", "name", "email", "passwordHash", "role", "updatedAt")
VALUES ('anon-user-1', 'maria.real', 'Maria Real da Silva', 'maria.real@empresa.com.br', 'scrypt$hash-real', 'MANAGER', now());

INSERT INTO "UserSession" ("id", "userId", "tokenHash", "expiresAt")
VALUES ('anon-session-1', 'anon-user-1', 'session-hash-real', now() + interval '1 day');

INSERT INTO "ConectaRhAggregate" ("id", "companyId", "aggregateType", "externalId", "revision", "data", "occurredAt")
VALUES ('anon-agg-1', 'company', 'employment', 'ext-1', 1,
        '{"cpf": "123.456.789-09", "salary": 8500.5, "name": "Maria Real da Silva"}', now());

INSERT INTO "EquipmentNotificationRecipient" ("id", "email", "updatedAt")
VALUES ('anon-rec-1', 'gestor.real@empresa.com.br', now()),
       ('anon-rec-2', 'outro.real@empresa.com.br', now());

INSERT INTO "PontoExternalEmployee" ("externalEmployeeId", "registrationNumber", "externalName", "updatedAt")
VALUES ('ext-emp-1', 'MAT-777', 'MARIA REAL DA SILVA', now());
SQL

echo "[anon-test] coluna nova com dado pessoal e sem regra: a anonimização precisa falhar e não alterar nada"
q 'ALTER TABLE "JobRole" ADD COLUMN "contactPhone" text'
q "UPDATE \"JobRole\" SET \"contactPhone\" = '(11) 99999-0000'"
GUARD_LOG="$(mktemp)"
if psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$SQL" > "$GUARD_LOG" 2>&1; then
  cat "$GUARD_LOG"
  fail "a trava deveria reprovar JobRole.contactPhone"
fi
grep -q 'JobRole.contactPhone' "$GUARD_LOG" || { cat "$GUARD_LOG"; fail "a mensagem de erro não cita a coluna sem regra"; }
expect "falha desfaz tudo (CPF original intacto)" \
  "SELECT cpf FROM \"Collaborator\" WHERE id = 'anon-col-1'" '123.456.789-09'
expect "falha desfaz tudo (sessão intacta)" 'SELECT count(*) FROM "UserSession"' '1'
q 'ALTER TABLE "JobRole" DROP COLUMN "contactPhone"'

echo "[anon-test] anonimização completa"
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$SQL"

expect "CPF removido" 'SELECT count(*) FROM "Collaborator" WHERE cpf IS NOT NULL' '0'
expect "e-mail de colaborador removido" 'SELECT count(*) FROM "Collaborator" WHERE email IS NOT NULL' '0'
expect "assinatura removida" 'SELECT count(*) FROM "Collaborator" WHERE "signatureImage" IS NOT NULL' '0'
expect "nota pessoal removida" 'SELECT count(*) FROM "Collaborator" WHERE "efetivoNote" IS NOT NULL' '0'
expect "nome do colaborador trocado" "SELECT name FROM \"Collaborator\" WHERE id = 'anon-col-1'" 'Colaborador Staging A001'
expect "matrícula virou hash" \
  "SELECT count(*) FROM \"Collaborator\" WHERE \"registrationNumber\" LIKE 'STG-%' AND \"registrationNumber\" <> 'MAT-777'" '1'
expect "hash da matrícula é o mesmo no Ponto (ligação preservada)" \
  "SELECT count(*) FROM \"Collaborator\" c JOIN \"PontoExternalEmployee\" p ON p.\"registrationNumber\" = c.\"registrationNumber\" WHERE c.id = 'anon-col-1'" '1'
expect "nome do Ponto anonimizado" "SELECT count(*) FROM \"PontoExternalEmployee\" WHERE \"externalName\" ILIKE '%MARIA%'" '0'
expect "usuário anonimizado" \
  "SELECT username || '|' || coalesce(email, '') || '|' || \"passwordHash\" FROM \"User\" WHERE id = 'anon-user-1'" \
  'staging-user-anon-user-1||staging-disabled'
expect "sessões apagadas" 'SELECT count(*) FROM "UserSession"' '0'
expect "payload do Conecta RH (CPF/salário) apagado" "SELECT data::text FROM \"ConectaRhAggregate\" WHERE id = 'anon-agg-1'" '{}'
expect "e-mails únicos de destinatários continuam únicos e fictícios" \
  "SELECT count(DISTINCT email) || '|' || count(*) FILTER (WHERE email LIKE '%@staging.invalid') FROM \"EquipmentNotificationRecipient\"" '2|2'
expect "nenhum dado semeado sobreviveu em lugar nenhum" \
  "SELECT count(*) FROM (SELECT row_to_json(t)::text AS j FROM \"Collaborator\" t UNION ALL SELECT row_to_json(t)::text FROM \"User\" t UNION ALL SELECT row_to_json(t)::text FROM \"ConectaRhAggregate\" t UNION ALL SELECT row_to_json(t)::text FROM \"PontoExternalEmployee\" t) x WHERE j ~* '(123\\.456\\.789|987\\.654\\.321|maria\\.real|joao\\.real|real da silva|MAT-777|8500\\.5)'" '0'

echo "[anon-test] rodar de novo é seguro (idempotente)"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$SQL" > /dev/null
expect "segunda execução mantém o resultado" 'SELECT count(*) FROM "Collaborator" WHERE cpf IS NOT NULL' '0'

echo "[anon-test] tudo certo"
