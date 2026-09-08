# Data model: Recebimento de projetos por webhook

## Project (existente)

Não há alteração de schema. O fluxo usa os campos existentes:

| Campo | Origem | Regra no recebimento |
|---|---|---|
| `code` | `code` | obrigatório, `trim`, identificador único e chave idempotente |
| `name` | `name` | obrigatório, `trim` |
| `clientName` | `clientName` | obrigatório, `trim` |
| `clientCnpj` | `clientCnpj` | obrigatório, somente os 14 dígitos normalizados |
| `contractCode` (interno existente) | `proposalCode` + `revision` | número extraído da proposta e persistido como “{proposta} Rev. {revisão}”; com `revision: -1`, persiste somente “{proposta}” |
| `location` | `location` | obrigatório, `trim` |
| `isActive` | sistema | `true` |
| `registrationPending` | sistema | `true` até a confirmação do gestor |
| `visibleToCollaborators` | sistema | `false` |
| `managerOnly` | sistema | `false` |
| contas/e-mails/usuários/sequências | sistema | vazios/desabilitados |

## CommercialProposal e ProjectBudget (existentes)

Não há alteração de schema. O webhook expõe somente `proposalCode`; `contractCode`
permanece como detalhe interno do modelo existente e não é aceito no payload externo.
`revision` é `-1` quando ausente na origem ou um inteiro não negativo da proposta do
webhook. O sentinela `-1` é normalizado para a revisão comercial `0`; o valor efetivo é
usado para localizar uma `CommercialProposal` principal por `codProp` + `nRev` com
`parentCodProp=null`. Quando o projeto ainda não tem fonte vigente, a regra manual
existente materializa a proposta em `ProjectBudget.sourceProposalCodBd` e preenche
`Project.commercialProposalCode`.

## Invariantes

1. Enquanto existir um registro, `code` é único inclusive se ele estiver soft-deleted.
2. Projeto pendente não provisiona conta de cliente.
3. Projeto pendente não pode ser selecionado nem aceito para novo relatório.
4. Somente o salvamento dos seis campos obrigatórios válidos remove a pendência.
5. Reenvio idêntico nunca altera campos nem restaura `registrationPending`.
6. Uma fonte comercial já escolhida não é substituída pelo webhook.
7. Propostas adicionais nunca são escolhidas como revisão principal automática.

## Transições

```text
inexistente --webhook válido--> pendente + revisão comercial, quando localizada
pendente --salvar revisão válida--> verificado
pendente --excluir--> excluído
pendente/verificado sem revisão comercial --reenvio idêntico--> tenta selecionar a revisão pedida
pendente/verificado com revisão comercial --reenvio idêntico--> preserva a seleção vigente
qualquer existente --reenvio divergente--> conflito, sem mudança
```

## Concorrência

A criação tenta usar a restrição única existente. Se duas requisições passarem pela
leitura inicial, apenas uma cria; a outra recebe `P2002`, relê `code` e retorna sucesso
idempotente ou conflito conforme os seis campos persistidos.
