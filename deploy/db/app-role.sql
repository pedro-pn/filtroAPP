-- Papel de banco com privilégio mínimo para a API e o worker do filtroAPP.
--
-- Idempotente: pode ser executado quantas vezes for preciso (inclusive depois
-- de cada restore). Deve rodar como o DONO das tabelas (o usuário que aplica as
-- migrations; hoje `postgres`), porque ALTER DEFAULT PRIVILEGES vale para os
-- objetos criados por esse papel no futuro.
--
-- Uso (psql):
--   psql -v ON_ERROR_STOP=1 -v app_role=filtrovali_app -d filtrovali -f deploy/db/app-role.sql
-- Para definir/rotacionar a senha, passe também -v app_password=... (o wrapper
-- deploy/db/apply-app-role.sh lê a senha de um arquivo e não a expõe no shell).
--
-- O papel resultante:
--   * entra no banco, mas não é superusuário, não cria banco nem papel;
--   * lê e grava linhas de todas as tabelas do schema public;
--   * usa as sequences e executa as funções (triggers) do schema public;
--   * NÃO cria, altera, apaga ou trunca tabelas; NÃO escreve em _prisma_migrations.

\if :{?app_role}
\else
  \set app_role filtrovali_app
\endif

\set QUIET on
SET client_min_messages = warning;

-- 1. Papel ------------------------------------------------------------------
SELECT format('CREATE ROLE %I LOGIN', :'app_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role')
\gexec

ALTER ROLE :"app_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;

\if :{?app_password}
  ALTER ROLE :"app_role" WITH PASSWORD :'app_password';
\endif

-- 2. Banco e schema ---------------------------------------------------------
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_role')
\gexec

-- Padrão do PostgreSQL 15+; explícito para bancos restaurados de versões antigas.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_role";

-- 3. Objetos existentes -----------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO :"app_role";

-- Histórico de migrations é do dono; a aplicação só pode ler.
SELECT format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM %I', '_prisma_migrations', :'app_role')
WHERE to_regclass('public._prisma_migrations') IS NOT NULL
\gexec

-- 4. Objetos futuros (criados pelas próximas migrations deste mesmo dono) ----
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO :"app_role";

-- 5. Conferência --------------------------------------------------------------
\set QUIET off
SELECT
  r.rolname AS app_role,
  r.rolsuper AS superuser,
  r.rolcreatedb AS createdb,
  r.rolcreaterole AS createrole,
  has_schema_privilege(r.rolname, 'public', 'CREATE') AS can_create_in_public,
  (
    SELECT count(*)
    FROM pg_tables t
    WHERE t.schemaname = 'public'
      AND t.tablename <> '_prisma_migrations'
      AND NOT (
        has_table_privilege(r.rolname, format('public.%I', t.tablename), 'SELECT')
        AND has_table_privilege(r.rolname, format('public.%I', t.tablename), 'INSERT')
        AND has_table_privilege(r.rolname, format('public.%I', t.tablename), 'UPDATE')
        AND has_table_privilege(r.rolname, format('public.%I', t.tablename), 'DELETE')
      )
  ) AS tables_missing_grants
FROM pg_roles r
WHERE r.rolname = :'app_role';
