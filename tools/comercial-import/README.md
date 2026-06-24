# Importação do banco comercial Access → app

Scripts do lado do colaborador para enviar periodicamente o `propostas_bd.accdb` ao app, que
importa as propostas para o banco de dados (módulo Acompanhamento de Projetos).

- `enviar-propostas.ps1` — Windows / PowerShell (onde fica o Access). Agende no Agendador de Tarefas.
- `enviar-propostas.sh` — Linux/macOS/Git Bash (curl). Agende no cron.

## Configurar

Em ambos, ajuste:
- **URL do app** (ex.: `https://relatorios.suaempresa.com.br`)
- **Token** = valor de `COMMERCIAL_IMPORT_TOKEN` definido no servidor
- **Caminho** do `propostas_bd.accdb`

O endpoint é `POST /api/acompanhamento/comercial/import` (envio binário, `application/octet-stream`,
header `X-File-Name`, auth `Authorization: Bearer <token>`). Reenvio idêntico é detectado por hash e
ignorado; cada proposta é atualizada por `cod_bd` (idempotente).
