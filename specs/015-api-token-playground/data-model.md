# Data model: API Playground e tokens de integração

## Princípios do modelo

- O segredo nunca é uma coluna. Somente seletor público, últimos quatro caracteres e verificador HMAC são persistidos.
- Estado temporal é derivado de `startsAt`, `expiresAt` e `revokedAt`; não há job necessário para “expirar” uma credencial.
- Escopos e operações válidos pertencem ao catálogo versionado em código. O banco registra concessões e histórico, não cria capacidades novas.
- Eventos administrativos são separados do uso externo. Nenhuma das duas trilhas aceita segredo ou conteúdo integral de resposta.
- Restrições de projeto são explícitas por modo `ALL` ou `SELECTED`; uma coleção vazia nunca muda o significado silenciosamente.
- Todas as datas são armazenadas em UTC e exibidas no fuso do usuário.

## Entidades persistidas

### `ApiCredential`

Representa uma identidade de integração.

| Campo | Tipo lógico | Regra |
|---|---|---|
| `id` | identificador | Interno e imutável |
| `selector` | texto curto único | Parte pública aleatória usada para localizar a linha |
| `secretVerifier` | bytes/texto fixo | HMAC-SHA-256; nunca serializado |
| `hashKeyVersion` | inteiro curto | Seleciona a versão de chave do cofre; não contém a chave |
| `secretLastFour` | texto de 4 caracteres | Apenas identificação visual |
| `name` | texto | Obrigatório, 3–100; nomes repetidos são permitidos e diferenciados pelo prefixo |
| `purpose` | texto | Obrigatório, 10–500 |
| `recipientName` | texto | Obrigatório, 2–120 |
| `recipientContact` | texto opcional | E-mail ou referência operacional, até 200 |
| `description` | texto opcional | Até 1.000 |
| `startsAt` | instante | Padrão: criação; não pode ser retroativo além da tolerância do servidor |
| `expiresAt` | instante opcional | Obrigatório salvo confirmação explícita de não expiração; posterior a `startsAt` |
| `neverExpiresConfirmedAt` | instante opcional | Evidência da confirmação de risco |
| `projectAccessMode` | `ALL`/`SELECTED` | `SELECTED` exige ao menos um projeto |
| `allowedIpCidrs` | lista de texto | Normalizada, sem duplicatas, IPv4/IPv6; vazio significa sem restrição de IP |
| `allowedFormats` | lista | Inicialmente contém `JSON`; downloads usam formato do arquivo |
| `requestsPerMinute` | inteiro | Dentro do mínimo/máximo global |
| `requestsPerDay` | inteiro | Deve ser compatível com o limite por minuto |
| `rowsPerDay` | inteiro | Limite de itens devolvidos em coleções |
| `maxPageSize` | inteiro | 1–500 e não maior que o global |
| `lastUsedAt` | instante opcional | Atualização limitada para não escrever duas vezes quando o bucket já cobre a janela |
| `revokedAt` | instante opcional | Uma vez preenchido não é removido |
| `revokedByUserId` | relação opcional | Conta admin responsável |
| `revocationReason` | texto opcional | Obrigatório quando revogada |
| `rotatedFromId` | autorrelação opcional | Forma a linhagem de rotação; uma credencial tem no máximo uma substituta ativa |
| `overlapEndsAt` | instante opcional | Se ausente na rotação, a anterior é revogada imediatamente |
| `createdByUserId` | relação | Conta admin criadora |
| `version` | inteiro | Concorrência otimista em alterações administrativas |
| `issuanceRequestId` | texto único | Chave de idempotência da emissão; nunca é segredo |
| `createdAt`/`updatedAt` | instantes | Auditoria técnica |

Índices: `selector` e `issuanceRequestId` únicos; `(revokedAt, expiresAt)`; `createdByUserId`; `lastUsedAt`; busca normalizada de nome/destinatário conforme recurso já adotado no banco.

### `ApiCredentialScope`

Concessão de um código de escopo conhecido.

| Campo | Tipo lógico | Regra |
|---|---|---|
| `id` | identificador | Interno |
| `credentialId` | relação | Obrigatória |
| `scopeCode` | texto | Deve existir no catálogo em runtime |
| `grantedAt`/`grantedByUserId` | instante/relação | Origem da concessão |
| `revokedAt`/`revokedByUserId` | instante/relação opcionais | Redução imediata preservando histórico |

Restrição única em `(credentialId, scopeCode)`. Uma concessão revogada não pode ser reativada na mesma credencial; para ampliar novamente, rotaciona-se.

### `ApiCredentialProject`

Projeto explicitamente permitido quando `projectAccessMode = SELECTED`.

| Campo | Tipo lógico | Regra |
|---|---|---|
| `credentialId` | relação | Credencial |
| `projectId` | relação | Projeto existente |
| `grantedAt`/`grantedByUserId` | instante/relação | Auditoria da inclusão |
| `revokedAt`/`revokedByUserId` | instante/relação opcionais | Remoção imediata e histórica |

Restrição única em `(credentialId, projectId)` e validação de ao menos um projeto ativo no modo `SELECTED`.

### `ApiCredentialEvent`

Evento administrativo imutável.

| Campo | Tipo lógico | Regra |
|---|---|---|
| `id` | identificador | Interno |
| `credentialId` | relação | Obrigatória |
| `actorUserId` | relação opcional | Nulo apenas para evento automático |
| `type` | enum | `CREATED`, `SECRET_REVEALED`, `METADATA_UPDATED`, `RESTRICTIONS_REDUCED`, `SCOPE_REDUCTION`, `PRIVILEGE_INCREASE_REJECTED`, `TESTED`, `ROTATED`, `REVOKED`, `EXPIRED_NOTICE` |
| `reason` | texto opcional | Obrigatório em revogação/ações de risco |
| `summary` | JSON redigido | Somente IDs, códigos e antes/depois não secretos |
| `requestId` | texto opcional | Correlação/chave de idempotência, única por ação mutável |
| `actorIp`/`actorUserAgent` | texto opcional | Normalizados/truncados conforme política |
| `createdAt` | instante | Imutável |

`summary` passa por allowlist por tipo de evento; propriedades desconhecidas são descartadas.

### `ApiRequestLog`

Registro resumido de uso externo.

| Campo | Tipo lógico | Regra |
|---|---|---|
| `id` | identificador | Interno |
| `credentialId` | relação | Mantida após revogação |
| `requestId` | texto único | Devolvido ao cliente |
| `operationId`/`scopeCode` | texto | Valores do catálogo |
| `pathTemplate` | texto | Ex.: `/qualidade/registros`, nunca URL bruta |
| `statusCode`/`outcomeCode` | inteiro/texto | Resultado seguro |
| `responseRows`/`responseBytes` | inteiro | Métricas, não conteúdo |
| `durationMs` | inteiro | Duração total |
| `clientIp`/`userAgent` | texto opcional | Origem normalizada e truncada |
| `filterSummary` | JSON redigido | Apenas nomes de filtro e faixas não pessoais permitidas |
| `createdAt` | instante | Base da retenção |

Índices em `(credentialId, createdAt)`, `(operationId, createdAt)`, `statusCode` e `requestId` único.

### `ApiUsageBucket`

Contador persistente usado para cotas.

| Campo | Tipo lógico | Regra |
|---|---|---|
| `credentialId` | relação | Credencial |
| `windowKind` | `MINUTE`/`DAY` | Tipo de janela UTC |
| `windowStart` | instante | Truncado conforme janela |
| `requests` | inteiro | Incremento atômico antes da execução |
| `rows`/`bytes` | inteiro | Incremento após resposta; reservas são reconciliadas em erro |
| `updatedAt` | instante | Diagnóstico |

Restrição única `(credentialId, windowKind, windowStart)`. A decisão de cota deve usar atualização condicional/transação Prisma para impedir ultrapassagem concorrente.

## Chave de verificação fora do banco

`ApiTokenHashKeyVersion` não é uma tabela. `ApiCredential.hashKeyVersion` identifica a versão, enquanto a chave permanece no ambiente/cofre do servidor. Se houver rotação da chave, o middleware aceita temporariamente as versões configuradas e novos tokens usam somente a versão atual. Nenhum valor de chave vai para Prisma.

## Catálogos em código

### `ApiScopeDefinition`

Campos: `code`, `label`, `domain`, `description`, `sensitivity`, `availability`, `requiredScopes`, `operations`, `exposedFields`, `excludedFields`, `supportsProjectFilter`, `supportsDeleted`, `version`.

### `ApiOperationDefinition`

Campos internos: `operationId`, `method` (somente `GET`), `path`, `requiredScopes`, `optionalScopes`, `queryParams`, `pathParams`, `supportsPlayground`, `responseKind`. A projeção administrativa adiciona `domain` e `parameters`, com descritores tipados de formulário. `DOWNLOAD_CHECK` identifica somente a verificação JSON no console; não muda a resposta binária do endpoint externo. Nenhum desses metadados cria tabela ou concessão nova.

O boot/teste falha se houver código duplicado, operação sem escopo, escopo disponível sem operação ou schema/serializador ausente.

## Estados e transições

```text
SCHEDULED --startsAt--> ACTIVE --expiresAt--> EXPIRED
     |                    |
     +------revoke--------+------revoke------> REVOKED

ACTIVE --rotate--> nova SCHEDULED/ACTIVE
                \-> antiga REVOKED imediatamente
                    ou ACTIVE_UNTIL_OVERLAP_END -> REVOKED
```

- `NEAR_EXPIRY` é apresentação derivada, não estado persistido.
- `EXPIRED` nunca volta a `ACTIVE` por edição.
- `REVOKED` é terminal.
- Rotação copia metadados/restrições/escopos ativos para uma nova linha dentro de transação, gera novo segredo e registra eventos nas duas credenciais.

## Fluxo de autenticação

1. Exigir HTTPS no perímetro, aplicar um limite grosseiro por IP e ler somente `Authorization: Bearer`.
2. Validar comprimento/formato antes de qualquer consulta.
3. Extrair seletor e localizar uma única `ApiCredential` com concessões/restrições necessárias.
4. Recalcular HMAC e comparar bytes em tempo constante; para seletor inexistente, executar a mesma comparação contra verificador fictício.
5. Avaliar revogação, início, expiração e sobreposição.
6. Obter IP efetivo apenas da cadeia de proxies confiável e aplicar CIDRs.
7. Autorizar operação, escopos e projetos.
8. Validar query/cursor e reservar cota.
9. Executar projeção pública, finalizar contadores e gravar uso redigido.
10. Em qualquer falha de token, responder `401 INVALID_TOKEN` sem distinguir causa; falha de escopo/recurso usa `403`; cota usa `429`.

## Migração e compatibilidade

- Uma migração aditiva cria as seis tabelas e índices; nenhum modelo atual é alterado para publicação automática.
- Relações com `User` e `Project` usam comportamento de exclusão compatível com preservação de auditoria; usuários/projetos removidos não apagam eventos.
- O catálogo v1 começa somente com as operações de Qualidade marcadas disponíveis.
- `schemaVersion` começa em `1.0`; campos opcionais podem ser adicionados de forma compatível, enquanto remoção/renomeação exige nova versão de API ou esquema.
- Limpeza após 365 dias ocorre por job existente de retenção estendido para logs de uso; eventos críticos de ciclo de vida seguem a política aprovada para auditoria.
