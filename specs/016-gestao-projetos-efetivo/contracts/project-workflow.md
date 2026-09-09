# Contrato HTTP

Base `/api/efetivo/project-workflow`, autenticação existente e acesso Efetivo obrigatório. Datas `YYYY-MM-DD`, erros pt-BR, 400 validação, 403 permissão, 404 projeto indisponível, 409 conflito de versão/criação.

- GET `/`: query search (até 120), page (>=1, padrão1); 100 por página. Retorna items de projetos elegíveis com gestão resumida (ou null), total/page/pageSize. Sem escrita.
- GET `/leaders`: contas ativas com acesso Efetivo, id/name. Sem dados pessoais adicionais.
- GET `/:projectId`: Project + gestão, checklists, respostas, pendências, últimos 50 eventos, permissões do usuário, catálogo compartilhado pelo cliente.
- POST `/:projectId`: gestor inicia {leaderUserId, plannedMobilizationDate}. 201; conflito se já inicializado.
- PATCH `/:projectId`: {version, action, ...dados}. União discriminada:
  - settings: leaderUserId, plannedMobilizationDate. Só gestor altera líder; líder pode alterar a própria previsão.
  - checklist: key, status, note. Não aplicável exige note.
  - critical: key, answer. Sim assegura existência da pendência na transação.
  - issue: issueId, description, area, ownerName, requiredLeadTimeDays, dueDate, criticality, status.
  - accept: somente próprio líder, checklist handover completo; grava aceite e etapa análise.
  - stage: stage dentre as quatro etapas, transições/gates definidos em data-model.md.

POST/PATCH usam Zod antes do serviço e retornam detalhe atualizado. Só gestor ou líder do projeto altera; versão obrigatória; toda mudança gera evento. Nenhum endpoint move equipe, aplica cenário, autoriza mobilização ou envia mensagens.
