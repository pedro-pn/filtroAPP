# Produção sem alertas operacionais

- **Início / detecção / fim:** desde a implantação até 2026-11-18; detectado na auditoria dos 13 pilares (18/11); corrigido no mesmo dia.
- **Quem detectou e como:** auditoria; conferência no servidor mostrou que `backend/.env.production` não tinha `OPERATIONS_ALERT_JOB_ENABLED`, `OPERATIONS_ALERT_WEBHOOK_URL` nem `ERROR_TRACKING_WEBHOOK_URL` (padrões desligados).
- **Impacto:** nenhum incidente conhecido, mas erros 500, falhas de job e backup quebrado não avisavam ninguém. O `/health` respondia `{"ok":true}` mesmo com o banco fora.
- **Linha do tempo:** auditoria → PRs #588 e #590 → variáveis configuradas no servidor → `npm run ops:test-alert` enviado.
- **Causa raiz:** o único canal de alerta era webhook opcional, desligado por padrão e sem configuração em produção; nada acusava a ausência.
- **Correção aplicada:** #588 (alertas por e-mail com limite de repetição; job de status operacional), #590 (`/health` confere o banco e informa a versão; prazos nas chamadas externas), #595 (deploy com falha/volta entra nos alertas). Em produção: `OPERATIONS_ALERT_JOB_ENABLED=true` e `OPERATIONS_ALERT_EMAILS` definidos; o job `operational-alert-check` roda (registros `COMPLETED` em `JobRun`).
- **O que muda para não repetir:** `deploy/PRODUCTION.md` lista as variáveis de alerta como parte da instalação; o painel de Operações mostra os destinatários; o teste de alerta faz parte do roteiro de deploy.
