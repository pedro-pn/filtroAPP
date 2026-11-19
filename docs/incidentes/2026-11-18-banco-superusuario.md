# Aplicação conectando como superusuário do banco

- **Início / detecção / fim:** desde a implantação até 2026-11-18; detectado na auditoria; corrigido no mesmo dia.
- **Quem detectou e como:** auditoria (pilar 5.4): `docker-compose.prod.yml` criava só o papel `postgres`, usado pelo `DATABASE_URL` da API e do worker. Depois da troca de papel, conferência no servidor mostrou que a senha do dono ainda chegava aos containers da aplicação pelo `env_file`.
- **Impacto:** nenhum incidente conhecido. Uma falha que permitisse executar SQL ou código na API daria acesso total ao banco (ler CPF e salários, apagar o banco, executar comandos no container do Postgres).
- **Linha do tempo:** auditoria → PR #589 (papel restrito + serviço `migrate`) → ativação no servidor → verificação de que `POSTGRES_PASSWORD` seguia visível nos containers → PR #592.
- **Causa raiz:** um único papel de banco para tudo (migrations e aplicação) e um único env-file compartilhado entre o container do Postgres e os da aplicação.
- **Correção aplicada:** #589 — `filtrovali_app` (só leitura/gravação de linhas), migrations com `MIGRATION_DATABASE_URL` só no serviço `migrate`, job de CI que roda as suítes com o papel restrito; #592 — `POSTGRES_PASSWORD`/`STAGING_POSTGRES_PASSWORD` zeradas em backend e worker e `check-database-role.js --require-restricted` reprova credencial do dono no ambiente. Verificado em 18/11: `DATABASE_URL` com `filtrovali_app`, 0 credenciais do dono nos containers.
- **O que muda para não repetir:** `OPERATIONS_REQUIRE_RESTRICTED_DB_ROLE=true` faz o painel/alerta acusar papel privilegiado; o job "Database least-privilege role (PostgreSQL)" é check obrigatório da `main`.
