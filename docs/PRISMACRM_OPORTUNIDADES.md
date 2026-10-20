# Oportunidades quentes do PrismaCRM no Acompanhamento

O PrismaCRM sinaliza oportunidades para planejamento antecipado por decisão de um
usuário. Não é necessário número de projeto, proposta importada, orçamento ou
probabilidade numérica. O Prisma deve confirmar se já existe essa marcação em sua
interface e disparar os envios quando ela mudar.

## Endpoint e credencial

`POST /api/integracoes/v1/acompanhamento/oportunidades`

- `Authorization: Bearer <token>` e `Content-Type: application/json`.
- Credencial da Central de API com acesso a projetos `ALL` e os escopos
  `acompanhamento.oportunidades.write` e `efetivo.projetos.create`. O primeiro
  depende do segundo, pois o fechamento pode criar um projeto.
- A operação aparece no playground. Enviar um POST pelo playground grava dados.
- A URL base e a credencial devem corresponder ao ambiente de homologação ou produção.

O contrato completo está no [OpenAPI](../specs/015-api-token-playground/contracts/openapi.yaml).

## Marcação inicial

```json
{
  "externalId": "id-estavel-da-oportunidade-no-prisma",
  "sourceVersion": 1,
  "sourceUpdatedAt": "2026-10-20T12:00:00Z",
  "status": "HOT",
  "name": "Limpeza química da unidade",
  "clientName": "Cliente Industrial"
}
```

Esses seis campos são obrigatórios. `externalId` identifica a oportunidade durante
toda sua vida; não deve mudar quando ela fechar ou ganhar um número de projeto.
`sourceVersion` é um inteiro positivo, crescente por oportunidade, até 2147483647.
`sourceUpdatedAt` informa o instante da alteração na origem, com fuso horário.

Campos opcionais: `clientCnpj`, `location`, `proposalCode` (numérico em texto),
`revision` (inteiro a partir de zero), `estimatedValue` (reais, até duas casas
decimais), `expectedCloseDate`, `expectedStartDate` (datas `YYYY-MM-DD`) e
`externalUrl` (HTTP ou HTTPS).

Cada envio é um retrato completo: campos opcionais ausentes ou nulos são limpos.
Para manter uma previsão ou valor, repita esse campo nas atualizações seguintes.
Não envie número fictício de projeto. `project` só é aceito no estado `WON`.

O FiltroAPP guarda um cadastro preliminar e um histórico por versão. O card aparece
em **Acompanhamento → Projetos → Futuros**, como “Oportunidade quente · Em
negociação”. Não cria `Project`, RDO, fluxo de Efetivo ou alocação de pessoas.
Valores e datas desconhecidos permanecem em branco.

## Fechamento e vínculo do projeto

Envie ao mesmo endpoint, com o mesmo `externalId` e uma versão maior:

```json
{
  "externalId": "id-estavel-da-oportunidade-no-prisma",
  "sourceVersion": 2,
  "sourceUpdatedAt": "2026-10-22T15:30:00Z",
  "status": "WON",
  "name": "Limpeza química da unidade",
  "clientName": "Cliente Industrial",
  "project": {
    "code": "05801",
    "name": "Limpeza química da unidade",
    "clientName": "Cliente Industrial",
    "clientCnpj": "12345678000190",
    "proposalCode": "4621",
    "revision": 0,
    "location": "Ilha Solteira - SP"
  }
}
```

O objeto `project` usa o mesmo contrato de `POST /api/integracoes/v1/efetivo/projetos`.
Todos os seus sete campos são obrigatórios. Se `clientCnpj` também vier no nível da
oportunidade, deve corresponder ao CNPJ do projeto.

O recebimento cria ou localiza o projeto pelo código, vincula-o à oportunidade e
grava o histórico na mesma transação. O projeto nasce pendente de conferência do
cadastro, como no fluxo normal. Se já existe com dados incompatíveis, retorna
`409 PROJECT_CODE_CONFLICT`; não sobrescreve o cadastro existente. Revisão superior
da mesma proposta é aceita e agenda uma nova busca no ComercialAPP.

A oportunidade deixa de ser emitida como card preliminar. O projeto ocupa seu
lugar em Futuros, mantendo o vínculo e histórico. Mesmo antes da importação do
orçamento, ele aparece com “Aguardando orçamento”. Depois segue a classificação
normal: trabalho ou avanço o coloca em “Em andamento”; fechar a venda não inicia
a execução automaticamente.

Para uma oportunidade enviada previamente, use este fechamento com correlação.
Enviar apenas ao endpoint antigo de projetos não informa qual oportunidade deve
ser vinculada. Se um projeto já foi criado por outra via, o fechamento com seus
mesmos dados o associa sem duplicá-lo. Um projeto só pode pertencer a uma oportunidade.

Depois de vinculado, o projeto não pode ser trocado e o estado não pode regredir
para `HOT`, `WITHDRAWN`, `LOST` ou `CANCELLED`. Correções cadastrais e tratamento de
um projeto já confirmado seguem o fluxo operacional existente. Cancelamento de
oportunidade não arquiva um projeto em execução.

## Retirada da sinalização, perda e cancelamento

Antes do fechamento, envie o mesmo retrato com versão maior e um destes estados:

| Estado | Significado | Efeito em Futuros |
| --- | --- | --- |
| `HOT` | Usuário sinalizou para planejamento | Exibe a oportunidade |
| `WITHDRAWN` | Usuário retirou a sinalização | Retira o card e mantém histórico |
| `LOST` | Negociação perdida | Retira o card e mantém histórico |
| `CANCELLED` | Oportunidade cancelada | Retira o card e mantém histórico |
| `WON` | Negociação fechada, com `project` completo | Substitui pelo projeto vinculado |

Uma nova sinalização `HOT` com versão maior pode reativar uma oportunidade ainda
não convertida. Não existe exclusão física pelo contrato.

## Respostas, repetição e recuperação

```json
{
  "outcome": "CREATED",
  "opportunity": {
    "id": "id-interno-filtroapp",
    "externalId": "id-estavel-da-oportunidade-no-prisma",
    "status": "HOT",
    "sourceVersion": 1,
    "projectId": null
  },
  "requestId": "id-da-requisicao"
}
```

- `201 CREATED`: novo cadastro preliminar.
- `200 UPDATED`: versão mais nova aplicada.
- `200 CONVERTED`: fechamento associado ao projeto; inclui `project` e
  `commercialRevision`. Pode ocorrer como primeiro evento, sem um `HOT` anterior.
- `200 REPLAYED`: mesma versão e mesmo conteúdo; não duplica histórico ou projeto.
- `200 IGNORED_OLDER`: versão menor que a vigente; não muda o cadastro.
- `400 VALIDATION_ERROR`: campos inválidos ou dados definitivos ausentes em `WON`.
- `403 INSUFFICIENT_SCOPE` / `PROJECT_NOT_ALLOWED`: escopos ou recorte incompatíveis.
- `409 SOURCE_VERSION_CONFLICT`: mesma versão com conteúdo diferente.
- `409 OPPORTUNITY_ALREADY_CONVERTED`: tentativa de regredir ou trocar o projeto.
- `409 PROJECT_OPPORTUNITY_CONFLICT`: projeto já associado a outra oportunidade.
- `409 PROJECT_UNAVAILABLE`: projeto inativo ou excluído.
- `409 CONCURRENT_UPDATE`: conflito concorrente persistente; reenvie a mesma versão.

A versão, e não o horário, ordena os eventos. Reenvios devem repetir o mesmo
conteúdo e versão. Em timeout, erro transitório ou `429`, o Prisma deve manter uma
fila de entrega, respeitar `Retry-After` e reenviar. Conflitos de conteúdo exigem
correção na origem e nova versão. O Prisma deve reenviar periodicamente o retrato
vigente e disponibilizar a carga inicial das oportunidades já sinalizadas,
incluindo retiradas/perdas/cancelamentos necessários para reconciliar o destino.

## Implantação e validação

1. Aplicar `20261020190000_crm_hot_opportunities` e gerar o Prisma Client.
2. Publicar backend e frontend compatíveis. Configurar o worker e as credenciais
   do ComercialAPP para a busca normal das propostas após o fechamento.
3. Emitir uma credencial com os dois escopos e acesso `ALL`. Credenciais antigas
   não ganham novos escopos automaticamente.
4. Homologar marcação mínima, atualização, retirada, fechamento, repetição e perda
   junto ao desenvolvedor do Prisma. A marcação na interface do Prisma ainda precisa
   ser confirmada/implementada por ele.

Testes: `backend/test/crm-opportunities.test.js` e
`backend/test/crm-opportunities.integration.test.js`. O teste PostgreSQL exige
`CRM_OPPORTUNITIES_TEST_DATABASE_URL=DATABASE_URL` em banco isolado cujo nome termine
em `_test`, com migrações aplicadas e uma `API_TOKEN_HASH_KEY_V1` de teste configurada.
