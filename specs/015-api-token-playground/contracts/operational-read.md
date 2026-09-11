# Coleções operacionais — incremento de 2026-09-08

Este contrato complementa Qualidade v1. Publica 15 coleções e 12 novos escopos operacionais para extração servidor-a-servidor por destinatário designado no token. Não publica os demais candidatos.

## Endpoints e campos

Base: `/api/integracoes/v1`. Todos os endpoints são GET, paginados; campos não listados não existem na resposta. Cada item contém também `id`, `createdAt`, `updatedAt`. Datas são ISO-8601 UTC; decimais são texto para preservar precisão.

| Endpoint | Escopo | Campos adicionais | Visibilidade |
|---|---|---|---|
| `/colaboradores` | `colaboradores.operacional.read` | `code`, `name`, `jobRoleId`, `isActive` | Com projetos selecionados, inclui somente colaboradores de equipes de relatórios aprovados desses projetos; não representa alocação atual. |
| `/cargos` | `cargos.read` | `name`, `isActive`, `isOperational` | Cadastro global compartilhado; não é limitado por projeto. |
| `/projetos` | `projetos.read` | `code`, `name`, `isActive`, `location`, `clientSegment`, `mobilizationDate`, `demobilizationDate`, `startDate` | Somente projetos autorizados e não excluídos. |
| `/clientes/segmentos` | `clientes.segmentos.read` | `label`, `slug`, `isActive` | Cadastro global compartilhado; não é limitado por projeto. |
| `/rdo/relatorios` | `rdo.relatorios.read` | `projectId`, `projectCode`, `projectName`, `reportType`, `sequenceNumber`, `reportNumber`, `status`, `reportDate`, `arrivalTime`, `departureTime`, `lunchBreak`, `daytimeCount`, `daytimeWorkedMinutes`, `nighttimeWorkedMinutes`, `daytimeOvertimeMinutes`, `nighttimeOvertimeMinutes`, `totalOvertimeMinutes`, `approvedAt`, `dailyDescription`, `overtimeReason` | Somente relatórios aprovados, não excluídos e de projetos autorizados não excluídos. |
| `/rdo/dds` | `rdo.dds.read` | `name`, `isActive` | Cadastro global compartilhado; não é limitado por projeto. |
| `/manutencao/registros` | `manutencao.registros.read` | `reportId`, `equipmentId`, `profileId`, `maintenanceDate`, `status`, `approvedAt` | Respeita o projeto do relatório aprovado. Manutenções avulsas aprovadas somente com acesso a todos os projetos. |
| `/manutencao/perfis` | `manutencao.perfis.read` | `name`, `isActive` | Cadastro global compartilhado; não é limitado por projeto. |
| `/manutencao/perfis/itens` | `manutencao.perfis.read` | `profileId`, `label`, `isActive` | Cadastro global compartilhado; não é limitado por projeto. |
| `/producao/limpezas` | `producao.limpezas.read` | `reportId`, `material`, `quantityKg` | Somente limpezas de relatórios aprovados e projetos autorizados não excluídos. |
| `/equipamentos` | `equipamentos.read` | `code`, `name`, `categoryId`, `maintenanceProfileId`, `isActive` | Cadastro global compartilhado; não é limitado por projeto. |
| `/equipamentos/rdo` | `equipamentos.read` | `code`, `name`, `isActive` | Cadastro global compartilhado; não é limitado por projeto. |
| `/equipamentos/categorias` | `equipamentos.categorias.read` | `name`, `isActive` | Cadastro global compartilhado; não é limitado por projeto. |
| `/estoque/itens` | `estoque.itens.read` | `type`, `categoryId`, `code`, `name`, `manufacturer`, `unitLabel`, `isActive` | Cadastro global compartilhado; não é limitado por projeto. |
| `/estoque/categorias` | `estoque.itens.read` | `type`, `name`, `isActive` | Cadastro global compartilhado; não é limitado por projeto. |

## Paginação, restrições e compatibilidade

- `limit`: 1–500, limitado pelo token e teto global; omitido usa o menor entre 100 e o limite do token.
- `updatedSince` inclusivo; `snapshotAt` fixa o teto da primeira página. Não são aceitas datas futuras ou início posterior ao teto. A ordenação é sempre `updatedAt ASC, id ASC`.
- O cursor assinado incorpora operação, filtros normalizados e política de projetos. Reutilizar em outra operação, alterar filtros/projetos ou adulterar assinatura gera erro antes da consulta.
- `projectCode` (recomendado) e `projectId` (compatibilidade) somente nos recursos com vínculo a projeto, inclusive colaboradores; o projeto deve pertencer ao recorte do token. O código é texto, preserva zeros à esquerda e não pode ser combinado com `projectId`. `reportType` aceita um ou mais tipos separados por vírgula na coleção de relatórios e nas coleções RDO relacionadas. Exemplo: `/rdo/relatorios?projectCode=5800&reportType=RCPU`. Cadastros globais não aceitam esses filtros. `active` somente nos recursos com `isActive`.
- Não há snapshot transacional entre requisições: alterações posteriores ao teto podem sair desta carga e entrar na próxima sincronização. Consumir por upsert, com sobreposição de `updatedSince`. Remoções físicas e mudanças de visibilidade/vínculo não geram tombstones neste incremento: executar reconciliação completa periódica, inclusive equipes que mudaram de projeto.
- Somente as relações de contexto e os textos operacionais explicitamente contratados são incluídos. O escopo não implica acesso a contatos, JSON livre, arquivos, custos ou dados pessoais completos. Cada consulta usa `select` explícito e a resposta é serializada pela mesma allowlist tipada.
- `ALL` não amplia os escopos. `SELECTED` filtra no banco antes da paginação; manutenções avulsas sem relatório ficam fora. Um projeto excluído torna seus relatórios/produção invisíveis.
- A simulação usa o mesmo serviço, cotas e política do endpoint e mostra no máximo 20 itens. Ela não comprova a restrição de IP.
- Nenhum token existente recebe as novas permissões automaticamente. Emitir nova credencial ou rotacionar explicitamente pelo contrato administrativo.
- Não há migração de banco neste incremento. Homologação das novas operações e carga/performance são verificações próprias do operador antes da publicação.

## Limite do primeiro incremento

Equipes, serviços, versões, anexos, metadados de assinaturas/auditoria de relatórios, movimentações, lotes, documentos/custos e complementos de manutenção foram publicados no segundo incremento autorizado: [operational-expanded-read.md](operational-expanded-read.md). Esse contrato estende o conjunto inicial acima sem ampliar suas projeções-base. Calibrações, efetivo, ponto, EPI, romaneios, comercial, Omie, pesquisas e assinaturas avulsas continuam candidatos. Autenticação, credenciais, privacidade e infraestrutura seguem reservadas/proibidas conforme catálogo.

## Ampliação de RDO em 2026-09-09

A projeção de relatórios inclui o número visível, a identificação do projeto e os textos de descrição diária/horas extras. A projeção de serviços inclui os campos técnicos do formulário, com objetos fechados e formatos antigos normalizados. Veja [Identificação e dados técnicos de RDO e serviços](../../../docs/API_INTEGRACOES.md#identificação-e-dados-técnicos-de-rdo-e-serviços). Não há migração nem novos escopos obrigatórios; clientes devem aceitar os campos adicionais.
