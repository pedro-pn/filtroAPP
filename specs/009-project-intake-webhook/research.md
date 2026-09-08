# Research: Recebimento de projetos por webhook

## Decisões

### Autenticação sistema-a-sistema

- **Decisão**: `Authorization: Bearer` com segredo exclusivo
  `PROJECT_INTAKE_WEBHOOK_TOKEN`, comparado em tempo constante após SHA-256.
- **Motivo**: segue o padrão já usado pela importação comercial, mantém o segredo fora
  da URL e funciona com o HTTPS já imposto em produção. Token vazio desabilita o
  endpoint com 503, permitindo implantar antes de ativar a integração.
- **Alternativas**: sessão humana foi rejeitada por misturar identidades; HMAC com
  timestamp exigiria capturar o corpo bruto antes do parser JSON e amplia o escopo;
  mTLS/API gateway pode ser adotado depois se o risco operacional exigir.

### Payload e normalização

- **Decisão**: `POST /api/webhooks/projects` recebe `code`, `name`, `clientName`,
  `clientCnpj`, `proposalCode`, `revision` e `location`. Os textos são obrigatórios e
  têm espaços externos removidos; `revision` é `-1` quando ausente na origem ou inteiro
  não negativo. CNPJ aceita
  pontuação, remove todos os caracteres não numéricos e somente então exige exatamente
  14 dígitos. O primeiro número válido da proposta é persistido como
  “{proposta} Rev. {revisão}”; para `revision: -1`, persiste somente “{proposta}” e a
  seleção comercial procura a revisão `0`.
- **Motivo**: usa a terminologia correta no contrato externo e evita a função legada que trunca
  CNPJ acima de 14 dígitos, o que aceitaria entradas inválidas.
- **Alternativas**: `contractCode` foi rejeitado sem alias porque o webhook ainda não
  entrou em produção; objetos aninhados ficaram fora para manter o payload inequívoco.

### Seleção automática da revisão comercial

- **Decisão**: localizar a proposta principal por `codProp`, `nRev` e
  `parentCodProp=null`, preferindo a alteração comercial mais recente e, em empate, o
  maior `codBd`. Sem seleção vigente, reutilizar `setProjectBudgetRevision` para montar
  o orçamento e marcar a proposta como resolvida. Se não houver proposta, criar o
  projeto e responder `not_found`; um reenvio idêntico tenta novamente. Se já houver
  fonte no orçamento, preservá-la e manter o seletor manual existente disponível.
- **Motivo**: a mesma função usada pelo gestor mantém orçamento e projeto coerentes,
  enquanto a resposta explícita permite ao remetente distinguir vínculo, repetição,
  preservação e ausência temporária.
- **Alternativas**: atualizar diretamente apenas `commercialProposalCode` deixaria o
  orçamento sem os valores da revisão; escolher sempre no reenvio poderia desfazer uma
  correção manual.

### Número do projeto e idempotência

- **Decisão**: tratar `code` como texto exato após `trim`, preservando zeros à esquerda.
  Um código existente com os seis valores normalizados iguais retorna 200 sem alteração;
  qualquer diferença retorna 409. Uma colisão `P2002` é relida e avaliada pela mesma
  regra para cobrir requisições concorrentes.
- **Motivo**: `Project.code` já é único e é a chave natural fornecida pelo remetente.
- **Alternativas**: restringir a somente dígitos quebraria códigos alfanuméricos já
  aceitos pelo cadastro atual; normalizar caixa mudaria identificadores existentes.

### Estado de revisão

- **Decisão**: reutilizar `registrationPending=true`, sem nova coluna ou tabela. Projetos
  entram ativos, mas sem contas, usuários, e-mails ou sequências, e com visibilidade
  operacional segura. Salvar os seis campos válidos pelo fluxo atual encerra a pendência.
- **Motivo**: o modelo, índice, contador, bloco prioritário, limpeza ao salvar e bloqueio
  de provisionamento já existem para cadastros automáticos.
- **Alternativas**: criar `registrationSource` distinguiria Romaneio e webhook, mas exige
  migração sem necessidade de negócio; o texto genérico “criado automaticamente” é
  verdadeiro para ambas as origens.

### Bloqueio operacional

- **Decisão**: além da filtragem já presente no bootstrap e no provisionamento de contas,
  exigir `registrationPending=false` nos lookups dos endpoints que criam relatórios.
- **Motivo**: controles apenas na UI podem ser contornados por chamada direta à API.
- **Alternativas**: alterar filtros globais de maneira indiscriminada teria raio de
  impacto alto e poderia afetar consultas que precisam exibir pendências ao gestor.

### Experiência do gestor

- **Decisão**: manter contador e seção prioritária existentes; tornar o texto genérico,
  destacar o cartão inteiro, mostrar os seis dados, nomear a ação “Revisar cadastro” e
  tornar a seção anunciável. A confirmação valida os seis campos com Zod e estados de
  erro acessíveis. Criar um aviso/tour Driver.js entre 2026-08-13 e 2026-08-23.
- **Motivo**: o fluxo atual já oferece a maior parte da experiência, mas o texto cita
  Romaneio, o cartão não é integralmente diferente, o local não aparece e o formulário
  depende parcialmente da validação nativa.
- **Alternativas**: uma nova tela de aprovação duplicaria o editor e sua manutenção.

### Atualização e cache

- **Decisão**: limpar o cache de projetos ao criar ou confirmar idempotência; manter as
  invalidações React Query já existentes ao editar/excluir. A notificação aparece na
  carga ou atualização normal do painel, sem canal push.
- **Motivo**: atende à notificação interna solicitada com o mecanismo atual, sem adicionar
  infraestrutura em tempo real.

## Riscos mitigados

- Token nunca é aceito em query string e logs HTTP existentes não incluem headers/body.
- Reenvio após revisão não reabre a pendência.
- Erros de validação, autenticação e conflito não alteram registros.
- Falhas inesperadas usam o handler global e não expõem stack, SQL ou segredo.
- Exclusão física libera hoje o código; por isso, a garantia de reserva aplica-se ao
  registro existente, inclusive soft-deleted, e não a um projeto removido fisicamente.
