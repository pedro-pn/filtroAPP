# Entrega: PDF de relatórios e contato corporativo para o Omni

Data: 2026-11-11. Branch: `feat/omni-pdf-relatorios`.
Spec: [spec.md](spec.md). Contrato OpenAPI: **1.14.0**.
Catálogo API: **2026-11-11.1**; catálogo de dados: **2026-11-11**.

## O que mudou

- `GET /api/integracoes/v1/rdo/relatorios/:id/pdf`, operação `operational.Report.download`: escopo novo **rdo.relatorios.pdf.download**, PERSONAL, dependente de rdo.relatorios.read.
- Seleção compartilhada com a tela: FINAL_ASSINADO, ZAPSIGN, MANUAL, BASE_APROVADO e CACHE. Integridade de versões por SHA-256; frescor de cache compartilha metadados/fingerprint, fontes RDO e links. Extração preserva fallback legado da tela e mantém arquivos de domínio em lib/reports.
- Abertura gerenciada sem symlinks, leitura limitada mesmo se o arquivo crescer após stat, limite de 50 MiB, Content-Length, nome seguro, no-store e nosniff. Mesma medição de cotas/bytes e auditoria. Playground devolve apenas verificação JSON, sem bytes do PDF.
- Campo `pdf` em `/rdo/relatorios` condicionado ao novo escopo, sem filesystem na listagem. Identifica referências locais das versões persistidas; download verifica disponibilidade definitiva.
- IDs de MaintenanceAttachment DOCUMENT ligados ao RDO_MAINTENANCE por `pdf.maintenanceAttachmentIds`, somente com escopos base/metadados de manutenção e mesma visibilidade da rota existente.
- `GET /api/integracoes/v1/colaboradores`: campos **emailCorporativo** e **userId**, sob escopo novo **colaboradores.contato_corporativo.read**, PERSONAL, dependente de colaboradores.operacional.read. Apenas conta vinculada; e-mail validado com domínio exato @filtrovali.com.br. Sem conta, ambos null; conta com e-mail pessoal mantém userId e emailCorporativo null. Sem CPF ou contatos pessoais.
- Tokens existentes permanecem com seus escopos. Contratos antigos sem as novas permissões mantêm os campos anteriores. Nenhuma migration, deploy ou mudança no Omni foi executada.
- reports.js reduzido de 7344 para 7186 linhas; teto arquitetural atualizado para 7186.

## Limitações explícitas

Entrega PDF base/final pronto, sem anexos PDF e sem sobreposição de assinaturas parciais; o final mantém assinaturas completas. O pipeline da tela permite até 200 MiB de anexos, acima do limite da integração. Não gera, repara hashes ou reconcilia ZapSign no pedido. ZapSign precisa estar no cache local. Não há disparo de geração em segundo plano: preparar documento pelo fluxo existente da tela e repetir. Uma origem prioritária indisponível não libera origem inferior na integração.

O indicador barato da listagem não verifica disco/hashes e não cobre cache gerado, ZapSign ou manuais históricos fora da versão ativa. `atualizadoEm` usa a criação da versão persistida, não mtime do arquivo. Mudanças de documento/conta podem não atualizar updatedAt do relatório/colaborador: reconciliar por leitura completa. O recorte existente de colaboradores por equipe de relatórios aprovados é preservado e não representa alocação atual.

## Exemplo de item em /rdo/relatorios

Item parcial; os campos existentes permanecem:

```json
{
  "id": "relatorio-ficticio",
  "reportType": "RDO",
  "status": "SIGNED",
  "pdf": {
    "disponivel": true,
    "versao": "FINAL_ASSINADO",
    "nomeArquivo": "Missão 5719 Jupiá - RDO 147 - 09-11-2026 - segunda.pdf",
    "atualizadoEm": "2026-11-10T12:00:00.000Z"
  }
}
```

Sem referência persistida: `"pdf":{"disponivel":false}`. Em manutenção:
`"pdf":{"disponivel":false,"maintenanceAttachmentIds":["documento-ficticio"]}`.
Use cada ID em `GET /api/integracoes/v1/manutencao/anexos/:id/download`.

| HTTP | Código | Condição |
|---|---|---|
| 404 | FILE_NOT_FOUND | Relatório invisível/inexistente, caminho/arquivo persistido indisponível ou RDO_MAINTENANCE. |
| 409 | PDF_NOT_READY | Cache ausente/obsoleto, ZapSign não cacheado, PDF incompleto ou hash inválido; Retry-After: 30. |
| 413 | FILE_TOO_LARGE | Mais de 50 MiB. |
| 403 | PROJECT_NOT_ALLOWED | Projeto fora do recorte da credencial. |
| 403 | INSUFFICIENT_SCOPE | Escopo obrigatório ausente. |

## O que marcar no token do Omni

Rotacionar preservando permissões, recorte, cotas e validade atuais e acrescentar:

1. **rdo.relatorios.pdf.download** + **rdo.relatorios.read**.
2. Manter **rdo.relatorios.todos.read** para PENDING, RETURNED, APPROVED e SIGNED; sem ele, somente APPROVED.
3. **manutencao.registros.read**, **manutencao.anexos.metadata.read** e **manutencao.anexos.download** para descobrir/baixar documentos de manutenção.
4. **colaboradores.contato_corporativo.read** + **colaboradores.operacional.read** para emailCorporativo/userId. Não marcar colaboradores.pii.read para essa finalidade.

## Pergunta sobre SIGNED — sem implementar

A fonte confirma que publishedReport só aceita APPROVED. Não há justificativa registrada para excluir SIGNED. Como assinatura sucede aprovação, isso parece uma lacuna; não é possível afirmar a intenção original. Proposta separada: considerar APPROVED e SIGNED publicados, revisar dependentes (inclusive recorte de colaboradores e manutenção) e incluir testes de listagem/download. A mudança ampliaria acesso de tokens básicos existentes; nesta feature, a regra foi preservada.

## Validação

- `npm test` no backend, com URL fictícia inoperante para satisfazer configuração: **2812 testes, 2774 aprovados, 0 falhas, 38 ignorados**, aproximadamente 78s. Integrações dependentes de bancos/artefatos externos permanecem condicionais; os testes novos usam também Prisma real com PostgreSQL WASM descartável, sem acesso à URL da aplicação.
- A execução inicial encontrou uma contagem fixa antiga do catálogo (corrigida de quatro para cinco downloads) e uma URL fictícia com sufixo _test que ativava indevidamente um teste de banco externo. A execução final usa `/filtro_unit` e passa.
- Verificação final direcionada (PDF, cache, OpenAPI e fallback legado ZapSign): **34/34 aprovados**, sem skips.
- `npm run architecture:check`: **PASS**.
- `git diff --check`: **PASS**.
- Revisão com detect_changes, get_review_context, get_affected_flows, impact_radius e tests_for do grafo, seguida de conferência da fonte e dos testes. O grafo sinalizou fluxo compartilhado de assinaturas; o fallback legado da tela ganhou regressão específica. Ligações estáticas de testes no grafo estavam incompletas, então a evidência é a execução real.

Checklist de especificação aprovado; artefatos specify/clarify/plan/tasks/implement concluídos. Não existem hooks de extensão configurados em .specify/extensions.yml nesta cópia.

## Preparação da PR e CI

- Teste Prisma real ajustado para calcular snapshotAt no instante da consulta, permitindo execução após a data dos fixtures unitários.
- Frontend: 890 testes aprovados, lint e build aprovados.
- Auditorias npm de backend e frontend aprovadas no limiar high do workflow, sem vulnerabilidades altas ou críticas. Alertas abaixo desse limiar já pertencem aos lockfiles atuais; não houve alteração de dependências.
- Diff dos novos arquivos normalizado para passar também em git diff --cached --check.
