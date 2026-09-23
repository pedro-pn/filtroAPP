# Research: prontidão comercial da gestão de projetos

## Decisões

### Papel Comercial separado da operação

**Decisão**: registrar `efetivo:commercial` no catálogo do módulo, incluí-lo no acesso de leitura e criar uma permissão específica para editar fatos comerciais. Elegibilidade e poderes do Líder exigem papel operacional vigente (`ADMIN`, `EFETIVO_MANAGER` ou `EFETIVO_VIEWER`).

**Motivo**: hoje qualquer papel do módulo poderia ser candidato a Líder. Acrescentar o papel sem restringir esse caminho permitiria ao Comercial editar checklist e etapa quando designado ou quando seu papel fosse trocado depois da designação.

**Alternativa rejeitada**: ampliar `isEfetivoManager`. Isso concederia toda a gestão operacional ao Comercial.

### Entidade própria e projeção de ausências

**Decisão**: persistir somente fatos alterados em `ProjectWorkflowCommercialFact`, com unicidade por projeto e chave. O serviço projeta as oito ausências como pendentes a partir do catálogo compartilhado.

**Motivo**: evita criar oito registros no início da gestão, mantém o catálogo versionável e simplifica projetos antigos.

**Alternativa rejeitada**: oito colunas em `ProjectWorkflow`. Essa forma mistura regras por tipo, torna procedência e auditoria repetitivas e dificulta a integração futura.

### Procedência protegida no servidor

**Decisão**: o PATCH da interface não aceita `source` nem metadados externos. O serviço verifica a origem persistida dentro da mesma transação e rejeita alteração de um fato CRM. O modelo guarda identificador, URL, versão textual, atualização na origem e sincronização.

**Motivo**: segue o precedente de cadastros gerenciados externamente e impede que o cliente transforme um fato manual em CRM ou sobrescreva uma sincronização.

**Alternativa rejeitada**: um campo apenas visual de origem. Ele não protege a fonte de verdade.

### Sem endpoint antes do contrato CRM

**Decisão**: preparar modelo e serviço interno, sem publicar webhook ou rota de sincronização.

**Motivo**: autenticação, idempotência, assinatura e formato do CRM ainda não foram definidos. Uma API provisória criaria um contrato difícil de retirar.

### Liberação calculada

**Decisão**: calcular `RELEASED` somente quando os oito fatos estiverem válidos conforme o catálogo. Pendências expõem motivos e as operações afetadas `PURCHASE`, `HIRING` e `MOBILIZATION`.

**Motivo**: o valor é derivado e deve refletir imediatamente qualquer reabertura, sem risco de um booleano persistido ficar desatualizado.

### Compatibilidade do handover

**Decisão**: proposta técnica/comercial válida atende o item equivalente do gate, em alternativa ao checklist legado. Respostas antigas continuam válidas e não são convertidas em fatos.

**Motivo**: evita exigir o mesmo sinal duas vezes e preserva autoria e semântica dos dados anteriores.

### Avanço explícito com avaliação no servidor

**Decisão**: manter a transição como ação confirmada pelo Líder. A API retorna destinos com `allowed` e `issues`, e o modal coloca as ações no rodapé fixo.

**Motivo**: concluir um campo pode ser uma gravação parcial; mover automaticamente o projeto reduziria a rastreabilidade e surpreenderia o usuário.

### Catálogo reservado de credenciais

**Decisão**: incluir o novo modelo como `RESERVED` no catálogo de dados acessíveis por credenciais e atualizar a contagem/documentação.

**Motivo**: dados comerciais e metadados de sincronização não devem ficar disponíveis a credenciais genéricas antes de um contrato externo dedicado.

