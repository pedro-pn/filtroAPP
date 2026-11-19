# Restauração de backup nunca comprovada

- **Início / detecção / fim:** último registro de restauração em 2026-07-03 (migração para a VPS); detectado na auditoria em 18/11; primeiro ensaio no mesmo dia.
- **Quem detectou e como:** auditoria (pilar 3.5): backups diários no Backblaze B2 existiam, mas não havia ensaio periódico nem exigência de status de restauração (`OPERATIONS_REQUIRE_RESTORE_STATUS=false`).
- **Impacto:** nenhum incidente conhecido. Em um desastre, o backup poderia estar corrompido ou incompleto sem que ninguém soubesse; também não havia volta de versão documentada.
- **Linha do tempo:** auditoria → PR #591 (`deploy/restore-drill.sh`, `deploy/deploy-prod.sh` com volta automática, runbook) → ensaio em 18/11 a partir de `b2://filtrovali-backups/daily/2026-11-18-020001`: banco restaurado em **24 s**, ensaio completo em **195 s**, conferências de sanidade aprovadas (261 migrations, usuários, projetos, relatórios).
- **Causa raiz:** o backup era monitorado, a restauração não; não havia rotina que provasse que o backup volta.
- **Correção aplicada:** #591; cron mensal do ensaio (dia 2, 04:30) e `OPERATIONS_REQUIRE_RESTORE_STATUS=true` com prazo de 35 dias, o que gera alerta se o ensaio falhar ou atrasar.
- **O que muda para não repetir:** o painel de Operações mostra o último ensaio; ensaio de volta de versão (`deploy-prod.sh --rollback`) pendente de execução em janela tranquila (régua 1.5).
